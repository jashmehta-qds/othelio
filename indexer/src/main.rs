mod abis;
mod accounting;
mod db;
mod events;
mod lending;
mod oracle;
mod reconciliation;
mod utils;

use dotenvy::dotenv;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::Address;
use sqlx::postgres::PgPoolOptions;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use crate::db::{
    acquire_worker_lease, get_next_block, record_observed_head, record_worker_failure,
    release_worker_lease, renew_worker_lease, resolve_start_block, validate_or_rollback_checkpoint,
    worker_last_success_block,
};
use crate::events::{
    event_filter_addresses, fetch_and_process_ranges, retry_pending_position_projections,
};
use crate::oracle::run_hourly_valuation_tick;
use crate::reconciliation::run_reconciliation_tick;
use crate::utils::{
    circuit_key, configured_u64, is_supported_chain_id, lease_owner, provider_name, read_head,
    rpc_retry_delay, RpcHealth, BASE_MAINNET_CHAIN_ID,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://othelio:othelio@localhost:5432/othelio".to_string());
    let rpc_url = std::env::var("RPC_URL").expect("RPC_URL must be configured");
    let secondary_rpc_url = std::env::var("RPC_URL_SECONDARY").ok();
    let chain_id: i64 = std::env::var("CHAIN_ID")
        .unwrap_or_else(|_| BASE_MAINNET_CHAIN_ID.to_string())
        .parse()?;
    if !is_supported_chain_id(chain_id) {
        return Err(format!(
            "Unsupported chain ID: {}. Expected 31337 or 8453.",
            chain_id
        )
        .into());
    }
    if chain_id == BASE_MAINNET_CHAIN_ID && secondary_rpc_url.is_none() {
        return Err("RPC_URL_SECONDARY must be configured for Base mainnet; a single public RPC is not a production fallback".into());
    }
    let factory_addr_str = std::env::var("FACTORY_ADDRESS")
        .unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let module_addr_str = std::env::var("MODULE_ADDRESS")
        .unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let registry_addr_str = std::env::var("ASSET_REGISTRY_ADDRESS")
        .unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let usdc_addr_str = std::env::var("USDC_ADDRESS")
        .unwrap_or_else(|_| "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".to_string());
    let valuation_interval_secs: u64 = std::env::var("VALUATION_INTERVAL_SECS")
        .unwrap_or_else(|_| "3600".to_string())
        .parse()
        .unwrap_or(3600);
    let indexer_confirmations: u64 = std::env::var("INDEXER_CONFIRMATIONS")
        .unwrap_or_else(|_| "1".to_string())
        .parse()
        .unwrap_or(1);
    let price_interval_blocks = configured_u64("INDEXER_PRICE_INTERVAL_BLOCKS", 10).max(1);

    let lending_pool_addrs: Vec<Address> = std::env::var("LENDING_POOL_ADDRESSES")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().parse())
        .collect::<Result<_, _>>()?;
    let batch_size: u64 = std::env::var("BATCH_SIZE")
        .unwrap_or_else(|_| "2000".to_string())
        .parse()?;

    let factory_addr: Address = factory_addr_str.parse()?;
    let module_addr: Address = module_addr_str.parse()?;
    let registry_addr: Address = registry_addr_str.parse()?;
    let usdc_addr: Address = usdc_addr_str.parse()?;
    let event_addresses = event_filter_addresses(factory_addr, module_addr, &lending_pool_addrs);

    info!("🚀 [Rust Othelio Indexer] Initializing on Chain ID {} (Valuation Interval: {}s, Confirmations: {})...", chain_id, valuation_interval_secs, indexer_confirmations);

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await?;

    let primary_provider = Arc::new(Provider::<Http>::try_from(rpc_url.clone())?);
    let mut provider = primary_provider.clone();
    let mut using_secondary = false;
    let mut next_primary_probe = std::time::Instant::now();

    let observed_chain_id = provider.get_chainid().await?.as_u64();
    if observed_chain_id != chain_id as u64 {
        return Err(format!(
            "RPC chain mismatch: configured {}, observed {}",
            chain_id, observed_chain_id
        )
        .into());
    }

    let latest_block = provider
        .get_block_number()
        .await
        .map(|b| b.as_u64())
        .unwrap_or(0);
    let default_start = resolve_start_block(&pool, chain_id, latest_block).await;

    info!(
        "📌 [Rust Indexer] Start block configured as: {}",
        default_start
    );

    let mut current_block = get_next_block(&pool, chain_id, default_start).await?;
    current_block =
        validate_or_rollback_checkpoint(&pool, &provider, chain_id, current_block).await?;
    let mut last_price_block = worker_last_success_block(&pool, chain_id, "prices")
        .await
        .unwrap_or(0);
    let mut last_reconciliation_block =
        worker_last_success_block(&pool, chain_id, "reconciliation")
            .await
            .unwrap_or(0);
    let mut rpc_failure_count = 0_u32;
    let mut rpc_health: HashMap<String, RpcHealth> = HashMap::new();

    loop {
        if using_secondary && std::time::Instant::now() >= next_primary_probe {
            let timeout = Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
            if tokio::time::timeout(timeout, primary_provider.get_block_number())
                .await
                .is_ok()
            {
                provider = primary_provider.clone();
                using_secondary = false;
                info!("primary RPC probe succeeded; returning from secondary provider");
            } else {
                next_primary_probe = std::time::Instant::now()
                    + Duration::from_secs(configured_u64("INDEXER_RPC_CIRCUIT_COOLDOWN_SECS", 30));
            }
        }
        match read_head(&provider).await {
            Ok(latest_block) => {
                rpc_failure_count = 0;
                let latest_block = latest_block.as_u64();
                record_observed_head(&pool, chain_id, latest_block).await?;

                if current_block <= latest_block {
                    let blocks_per_range = batch_size.saturating_add(1);
                    let available_blocks = latest_block
                        .saturating_sub(current_block)
                        .saturating_add(1);
                    // At the live head, process a partial range immediately instead of
                    // waiting for a complete batch. Waiting for all 10 blocks kept the
                    // checkpoint one full range behind and tripped the action lag gate.
                    let available_ranges = available_blocks
                        .saturating_add(blocks_per_range.saturating_sub(1))
                        / blocks_per_range;
                    let catchup_concurrency = configured_u64("INDEXER_CATCHUP_CONCURRENCY", 3)
                        .clamp(1, 3)
                        .min(available_ranges.max(1)) as usize;
                    let window_blocks = blocks_per_range
                        .saturating_mul(catchup_concurrency as u64);
                    let to_block = current_block
                        .saturating_add(window_blocks.saturating_sub(1))
                        .min(latest_block);
                    let scan_started = std::time::Instant::now();
                    info!(
                        concurrency = catchup_concurrency,
                        "[Rust Indexer] Scanning blocks {} -> {}",
                        current_block,
                        to_block
                    );

                    if !acquire_worker_lease(&pool, chain_id, "events").await? {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    if !rpc_health
                        .entry(circuit_key("events", using_secondary))
                        .or_default()
                        .can_request()
                    {
                        release_worker_lease(&pool, chain_id, "events").await?;
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        continue;
                    }
                    let worker_timeout =
                        Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
                    let events_owner = lease_owner("events");
                    match tokio::time::timeout(
                        worker_timeout,
                        fetch_and_process_ranges(
                            &pool,
                            &provider,
                            chain_id,
                            registry_addr,
                            usdc_addr,
                            &event_addresses,
                            current_block,
                            latest_block,
                            batch_size,
                            catchup_concurrency,
                            &events_owner,
                        ),
                    )
                    .await
                    {
                        Ok(Ok(last_processed_block)) => {
                            rpc_failure_count = 0;
                            rpc_health
                                .entry(circuit_key("events", using_secondary))
                                .or_default()
                                .success();
                            if !renew_worker_lease(&pool, chain_id, "events").await? {
                                return Err("event lease was lost after checkpoint commit".into());
                            }
                            release_worker_lease(&pool, chain_id, "events").await?;
                            current_block = last_processed_block.saturating_add(1);
                            if catchup_concurrency > 1 {
                                let minimum_interval = Duration::from_millis(configured_u64(
                                    "INDEXER_CATCHUP_MIN_INTERVAL_MS",
                                    1_000,
                                ));
                                if let Some(remaining) = minimum_interval.checked_sub(scan_started.elapsed()) {
                                    tokio::time::sleep(remaining).await;
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            rpc_failure_count = rpc_failure_count.saturating_add(1);
                            rpc_health
                                .entry(circuit_key("events", using_secondary))
                                .or_default()
                                .failure();
                            if let Some(secondary) = secondary_rpc_url.as_ref() {
                                if let Ok(candidate) = Provider::<Http>::try_from(secondary.clone())
                                {
                                    provider = Arc::new(candidate);
                                    using_secondary = true;
                                    next_primary_probe = std::time::Instant::now()
                                        + Duration::from_secs(configured_u64(
                                            "INDEXER_RPC_CIRCUIT_COOLDOWN_SECS",
                                            30,
                                        ));
                                    warn!(
                                        failure_count = rpc_failure_count,
                                        provider = provider_name(using_secondary),
                                        "event worker RPC failed; switching provider"
                                    );
                                }
                            }
                            record_worker_failure(&pool, chain_id, "events", &e.to_string())
                                .await?;
                            release_worker_lease(&pool, chain_id, "events").await?;
                            current_block = get_next_block(&pool, chain_id, default_start).await?;
                            let backoff = rpc_retry_delay(rpc_failure_count);
                            warn!(
                                failure_count = rpc_failure_count,
                                retry_in_secs = backoff.as_secs(),
                                error = ?e,
                                "[RPC Error] Block range failed; keeping indexer alive and retrying"
                            );
                            tokio::time::sleep(backoff).await;
                        }
                        Err(e) => {
                            rpc_failure_count = rpc_failure_count.saturating_add(1);
                            rpc_health
                                .entry(circuit_key("events", using_secondary))
                                .or_default()
                                .failure();
                            let message = format!(
                                "worker request timed out after {}s",
                                worker_timeout.as_secs()
                            );
                            record_worker_failure(&pool, chain_id, "events", &message).await?;
                            release_worker_lease(&pool, chain_id, "events").await?;
                            current_block = get_next_block(&pool, chain_id, default_start).await?;
                            warn!(failure_count = rpc_failure_count, error = ?e, "event worker request timeout; preserving checkpoint");
                        }
                    }
                } else {
                    retry_pending_position_projections(&pool, chain_id).await?;
                    tokio::time::sleep(Duration::from_secs(configured_u64(
                        "INDEXER_HEAD_POLL_INTERVAL_SECS",
                        5,
                    )))
                    .await;
                }

                let confirmed_block = latest_block.saturating_sub(indexer_confirmations);
                if confirmed_block >= last_price_block.saturating_add(price_interval_blocks) {
                    let valuation_block = latest_block.saturating_sub(indexer_confirmations);
                    if valuation_block > 0 && acquire_worker_lease(&pool, chain_id, "prices").await? {
                        if !rpc_health
                            .entry(circuit_key("prices", using_secondary))
                            .or_default()
                            .can_request()
                        {
                            release_worker_lease(&pool, chain_id, "prices").await?;
                            continue;
                        }
                        let worker_timeout =
                            Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
                        let prices_owner = lease_owner("prices");
                        match tokio::time::timeout(
                            worker_timeout,
                            run_hourly_valuation_tick(
                                &pool,
                                &provider,
                                registry_addr,
                                chain_id,
                                valuation_block,
                                &prices_owner,
                            ),
                        )
                        .await
                        {
                            Ok(Ok(())) => {
                                rpc_health
                                    .entry(circuit_key("prices", using_secondary))
                                    .or_default()
                                    .success();
                                last_price_block = valuation_block;
                                if !renew_worker_lease(&pool, chain_id, "prices").await? {
                                    return Err(
                                        "price lease was lost after atomic checkpoint commit"
                                            .into(),
                                    );
                                }
                                release_worker_lease(&pool, chain_id, "prices").await?;
                            }
                            Ok(Err(e)) => {
                                rpc_health
                                    .entry(circuit_key("prices", using_secondary))
                                    .or_default()
                                    .failure();
                                record_worker_failure(&pool, chain_id, "prices", &e.to_string())
                                    .await?;
                                if let Some(secondary) = secondary_rpc_url.as_ref() {
                                    if let Ok(candidate) =
                                        Provider::<Http>::try_from(secondary.clone())
                                    {
                                        provider = Arc::new(candidate);
                                        using_secondary = true;
                                        next_primary_probe = std::time::Instant::now()
                                            + Duration::from_secs(configured_u64(
                                                "INDEXER_RPC_CIRCUIT_COOLDOWN_SECS",
                                                30,
                                            ));
                                    }
                                }
                                release_worker_lease(&pool, chain_id, "prices").await?;
                                error!("[Hourly Valuation Error] Tick failed: {:?}", e);
                            }
                            Err(e) => {
                                rpc_health
                                    .entry(circuit_key("prices", using_secondary))
                                    .or_default()
                                    .failure();
                                let message = format!(
                                    "price worker request timed out after {}s",
                                    worker_timeout.as_secs()
                                );
                                record_worker_failure(&pool, chain_id, "prices", &message).await?;
                                release_worker_lease(&pool, chain_id, "prices").await?;
                                warn!(error = ?e, "price worker timeout; preserving prior observations");
                            }
                        }
                    }
                }
                if confirmed_block >= last_reconciliation_block.saturating_add(150)
                    && current_block > confirmed_block
                {
                    if !acquire_worker_lease(&pool, chain_id, "reconciliation").await? {
                        continue;
                    }
                    if !rpc_health
                        .entry(circuit_key("reconciliation", using_secondary))
                        .or_default()
                        .can_request()
                    {
                        release_worker_lease(&pool, chain_id, "reconciliation").await?;
                        continue;
                    }
                    let worker_timeout =
                        Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
                    let reconciliation_owner = lease_owner("reconciliation");
                    match tokio::time::timeout(
                        worker_timeout,
                        run_reconciliation_tick(
                            &pool,
                            &provider,
                            chain_id,
                            confirmed_block,
                            &reconciliation_owner,
                        ),
                    )
                    .await
                    {
                        Ok(Ok(more_batches)) => {
                            rpc_health
                                .entry(circuit_key("reconciliation", using_secondary))
                                .or_default()
                                .success();
                            last_reconciliation_block = if more_batches {
                                confirmed_block.saturating_sub(149)
                            } else {
                                confirmed_block
                            };
                            if !renew_worker_lease(&pool, chain_id, "reconciliation").await? {
                                return Err(
                                    "reconciliation lease was lost after checkpoint commit".into(),
                                );
                            }
                            release_worker_lease(&pool, chain_id, "reconciliation").await?;
                        }
                        Ok(Err(e)) => {
                            rpc_health
                                .entry(circuit_key("reconciliation", using_secondary))
                                .or_default()
                                .failure();
                            record_worker_failure(
                                &pool,
                                chain_id,
                                "reconciliation",
                                &e.to_string(),
                            )
                            .await?;
                            if let Some(secondary) = secondary_rpc_url.as_ref() {
                                if let Ok(candidate) = Provider::<Http>::try_from(secondary.clone())
                                {
                                    provider = Arc::new(candidate);
                                    using_secondary = true;
                                    next_primary_probe = std::time::Instant::now()
                                        + Duration::from_secs(configured_u64(
                                            "INDEXER_RPC_CIRCUIT_COOLDOWN_SECS",
                                            30,
                                        ));
                                }
                            }
                            release_worker_lease(&pool, chain_id, "reconciliation").await?;
                        }
                        Err(e) => {
                            rpc_health
                                .entry(circuit_key("reconciliation", using_secondary))
                                .or_default()
                                .failure();
                            let message = format!(
                                "reconciliation worker request timed out after {}s",
                                worker_timeout.as_secs()
                            );
                            record_worker_failure(&pool, chain_id, "reconciliation", &message)
                                .await?;
                            release_worker_lease(&pool, chain_id, "reconciliation").await?;
                            warn!(error = ?e, "reconciliation timeout; preserving prior balances");
                        }
                    }
                }
            }
            Err(e) => {
                rpc_failure_count = rpc_failure_count.saturating_add(1);
                if let Some(secondary) = secondary_rpc_url.as_ref() {
                    if let Ok(candidate) = Provider::<Http>::try_from(secondary.clone()) {
                        warn!(
                            failure_count = rpc_failure_count,
                            "primary RPC unhealthy; switching to secondary endpoint"
                        );
                        provider = Arc::new(candidate);
                        using_secondary = true;
                        next_primary_probe = std::time::Instant::now()
                            + Duration::from_secs(configured_u64(
                                "INDEXER_RPC_CIRCUIT_COOLDOWN_SECS",
                                30,
                            ));
                        continue;
                    }
                }
                let backoff = rpc_retry_delay(rpc_failure_count);
                warn!(
                    failure_count = rpc_failure_count,
                    retry_in_secs = backoff.as_secs(),
                    error = ?e,
                    "[RPC Error] Failed to get latest block number; keeping indexer alive and backing off"
                );
                tokio::time::sleep(backoff).await;
            }
        }
    }
}
