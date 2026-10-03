use dotenvy::dotenv;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, BlockId, BlockNumber, Filter, U64};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::{hash_map::DefaultHasher, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

const BASE_FORK_CHAIN_ID: i64 = 31337;
const BASE_MAINNET_CHAIN_ID: i64 = 8453;
const MULTICALL3_ADDRESS: &str = "0xca11bde05977b3631167028862be2a173976ca11";

#[derive(Clone, Debug)]
struct FeedMetadata {
    token: Address,
    feed: Address,
    token_decimals: u8,
    feed_decimals: u8,
}

#[derive(Clone, Debug)]
struct RegistryCache {
    chain_id: i64,
    registry: Address,
    loaded_at: std::time::Instant,
    feeds: Vec<FeedMetadata>,
    token_fingerprint: u64,
}

static REGISTRY_CACHE: OnceLock<Mutex<Option<RegistryCache>>> = OnceLock::new();

fn registry_cache() -> &'static Mutex<Option<RegistryCache>> {
    REGISTRY_CACHE.get_or_init(|| Mutex::new(None))
}

fn configured_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn lease_owner(worker: &str) -> String {
    std::env::var("INDEXER_LEASE_OWNER")
        .unwrap_or_else(|_| format!("{}:{}", std::process::id(), worker))
}

fn lease_duration_secs() -> i64 {
    let timeout = configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30);
    configured_u64(
        "INDEXER_LEASE_SECS",
        timeout.saturating_mul(3).saturating_add(60),
    )
    .max(timeout + 30) as i64
}

fn circuit_key(worker: &str, secondary: bool) -> String {
    format!(
        "{}:{}",
        worker,
        if secondary { "secondary" } else { "primary" }
    )
}

fn provider_name(secondary: bool) -> &'static str {
    if secondary {
        "secondary"
    } else {
        "primary"
    }
}

#[derive(Default)]
struct RpcHealth {
    consecutive_failures: u32,
    circuit_open_until: Option<std::time::Instant>,
}

impl RpcHealth {
    fn can_request(&self) -> bool {
        self.circuit_open_until
            .map_or(true, |until| until <= std::time::Instant::now())
    }

    fn success(&mut self) {
        self.consecutive_failures = 0;
        self.circuit_open_until = None;
    }

    fn failure(&mut self) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        let threshold = configured_u64("INDEXER_RPC_CIRCUIT_FAILURES", 3) as u32;
        if self.consecutive_failures >= threshold {
            self.circuit_open_until = Some(
                std::time::Instant::now()
                    + Duration::from_secs(configured_u64("INDEXER_RPC_CIRCUIT_COOLDOWN_SECS", 30)),
            );
        }
    }
}

fn is_supported_chain_id(chain_id: i64) -> bool {
    matches!(chain_id, BASE_FORK_CHAIN_ID | BASE_MAINNET_CHAIN_ID)
}

fn rpc_backoff_delay(failure_count: u32) -> Duration {
    let exponent = failure_count.saturating_sub(1).min(6);
    Duration::from_secs((1_u64 << exponent).min(60))
}

fn rpc_retry_delay(failure_count: u32) -> Duration {
    let base = rpc_backoff_delay(failure_count).as_millis() as u64;
    let jitter = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_millis() as u64)
        % (base / 4 + 1);
    Duration::from_millis(base.saturating_add(jitter))
}

async fn read_head(provider: &Provider<Http>) -> Result<U64, Box<dyn std::error::Error>> {
    let timeout = Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
    Ok(tokio::time::timeout(timeout, provider.get_block_number()).await??)
}

#[cfg(test)]
mod network_tests {
    use super::{
        is_supported_chain_id, rpc_backoff_delay, BASE_FORK_CHAIN_ID, BASE_MAINNET_CHAIN_ID,
    };
    use std::time::Duration;

    #[test]
    fn supports_only_base_fork_and_base_mainnet() {
        assert!(is_supported_chain_id(BASE_FORK_CHAIN_ID));
        assert!(is_supported_chain_id(BASE_MAINNET_CHAIN_ID));
        assert!(!is_supported_chain_id(84532));
    }

    #[test]
    fn rpc_backoff_is_exponential_and_capped() {
        assert_eq!(rpc_backoff_delay(1), Duration::from_secs(1));
        assert_eq!(rpc_backoff_delay(2), Duration::from_secs(2));
        assert_eq!(rpc_backoff_delay(3), Duration::from_secs(4));
        assert_eq!(rpc_backoff_delay(7), Duration::from_secs(60));
        assert_eq!(rpc_backoff_delay(100), Duration::from_secs(60));
    }
}

abigen!(
    IOthelioEvents,
    r#"[
        event BasketCreated(address indexed safe, address indexed owner, string name, uint256 createdAt)
        event BasketFunded(address indexed safe, address indexed funder, address inputAsset, uint256 inputAmount, address[] acquiredAssets, uint256[] acquiredAmounts, uint256 acquiredOutputNavUsdc)
        event BasketRebalanced(address indexed safe, address indexed controller, address[] soldAssets, uint256[] soldAmounts, address[] boughtAssets, uint256[] boughtAmounts, uint256 tradedOutputNavUsdc)
        event BasketWithdrawn(address indexed safe, address indexed owner, address outputAsset, uint256 navRedeemed, address[] withdrawnAssets, uint256[] withdrawnAmounts, uint256 remainingListedAssetsNavUsdc)
        event BasketSwapWithdrawn(address indexed safe, address indexed owner, address indexed recipient, address outputAsset, uint256 outputAmount, address[] soldAssets, uint256[] soldAmounts, uint256 remainingListedAssetsNavUsdc)
        event UntrackedAssetSwept(address indexed safe, address indexed owner, address indexed token, uint256 amount)
        event BasketSuppliedToLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount, uint256 supplyApyBps)
        event BasketBorrowedFromLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount, uint256 borrowApyBps)
        event BasketRepaidToLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount)
        event BasketWithdrawnFromLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount)
        event AerodromeRouteExecuted(address indexed basket, address indexed tokenIn, address indexed tokenOut, uint8 kind, uint256 amountIn, uint256 amountOut, int24 firstTickSpacing, int24 secondTickSpacing)
        event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)
        event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)
        event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)
        event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)
    ]"#
);

abigen!(
    SnapshotMulticall3,
    r#"[
        struct Call3 { address target; bool allowFailure; bytes callData; }
        struct Result3 { bool success; bytes returnData; }
        function aggregate3(Call3[] calls) external payable returns (Result3[])
    ]"#
);

abigen!(
    OthelioAssetRegistry,
    r#"[
        function getSupportedTokens(uint256 chainId) view returns (address[])
        function getAsset(uint256 chainId, address token) view returns (bool supported, address priceFeed, uint8 tokenDecimals, uint8 feedDecimals, bool isCoinbaseB20)
    ]"#
);

abigen!(
    SnapshotErc20,
    r#"[function balanceOf(address account) view returns (uint256)]"#
);

abigen!(
    SnapshotAggregator,
    r#"[function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)]"#
);

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

    // A secondary endpoint is used for startup failover.  Runtime failures are
    // retried without moving the durable checkpoint; operators can restart the
    // worker onto the secondary endpoint without losing a range.
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
    // Circuits are independent per worker. A failing event scan must never be
    // hidden by a successful price or reconciliation request.
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

                if current_block <= latest_block {
                    let blocks_per_range = batch_size.saturating_add(1);
                    let available_blocks = latest_block
                        .saturating_sub(current_block)
                        .saturating_add(1);
                    if available_blocks < blocks_per_range {
                        tokio::time::sleep(Duration::from_secs(configured_u64(
                            "INDEXER_HEAD_POLL_INTERVAL_SECS",
                            5,
                        )))
                        .await;
                        continue;
                    }
                    let full_ranges = available_blocks / blocks_per_range;
                    let catchup_concurrency = configured_u64("INDEXER_CATCHUP_CONCURRENCY", 3)
                        .clamp(1, 3)
                        .min(full_ranges) as usize;
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
                    // A prior range may have committed an explicit pending
                    // projection while the worker was caught up.  Retry it
                    // on every idle pass so a later reconciliation/bootstrap
                    // can make it applied without rewinding the block ledger.
                    retry_pending_position_projections(&pool, chain_id).await?;
                    tokio::time::sleep(Duration::from_secs(configured_u64(
                        "INDEXER_HEAD_POLL_INTERVAL_SECS",
                        5,
                    )))
                    .await;
                }

                // Price observations are refreshed every ten confirmed blocks.
                // NAV rollups retain the configured time cadence independently.
                let confirmed_block = latest_block.saturating_sub(indexer_confirmations);
                if confirmed_block >= last_price_block.saturating_add(price_interval_blocks) {
                    let valuation_block = latest_block.saturating_sub(indexer_confirmations);
                    // Price observations are independent of event catch-up. This allows the
                    // oracle table to refresh while a newly-started indexer replays history.
                    // Action readiness still separately requires the event checkpoint to be
                    // close enough to the chain head before using those prices.
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
                            // Continue cursor-keyset batches immediately when a
                            // full batch was returned; do not wait another 150
                            // blocks to reach pairs beyond the first 500.
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

async fn resolve_start_block(pool: &PgPool, chain_id: i64, latest_block: u64) -> u64 {
    if let Ok(start_env) = std::env::var("START_BLOCK") {
        if let Ok(block_num) = start_env.parse::<u64>() {
            return block_num.saturating_sub(1);
        }
    }

    let min_created: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT MIN(created_block) FROM baskets WHERE chain_id = $1")
            .bind(chain_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    if let Some((Some(min_block),)) = min_created {
        if min_block > 0 {
            return (min_block as u64).saturating_sub(1);
        }
    }

    if chain_id == BASE_FORK_CHAIN_ID {
        0
    } else if latest_block > 1000 {
        latest_block - 1000
    } else {
        0
    }
}

async fn worker_last_success_block(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<u64, sqlx::Error> {
    let row: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT last_success_block FROM indexer_worker_state WHERE chain_id=$1 AND worker_name=$2",
    )
    .bind(chain_id)
    .bind(worker)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(block,)| block).unwrap_or(0).max(0) as u64)
}

async fn release_worker_lease(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<(), sqlx::Error> {
    let owner = lease_owner(worker);
    sqlx::query("UPDATE indexer_worker_state SET lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE chain_id=$1 AND worker_name=$2 AND lease_owner=$3")
        .bind(chain_id).bind(worker).bind(owner).execute(pool).await?;
    Ok(())
}

async fn renew_worker_lease(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<bool, sqlx::Error> {
    let owner = lease_owner(worker);
    let changed = sqlx::query("UPDATE indexer_worker_state SET lease_expires_at=NOW()+($4 * INTERVAL '1 second'), updated_at=NOW() WHERE chain_id=$1 AND worker_name=$2 AND lease_owner=$3 AND lease_expires_at > NOW()")
        .bind(chain_id).bind(worker).bind(owner).bind(lease_duration_secs()).execute(pool).await?.rows_affected();
    Ok(changed == 1)
}

async fn validate_or_rollback_checkpoint(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    current_block: u64,
) -> Result<u64, Box<dyn std::error::Error>> {
    let checkpoint: Option<(Option<i64>, Option<String>)> = sqlx::query_as("SELECT last_success_block,last_success_hash FROM indexer_worker_state WHERE chain_id=$1 AND worker_name='events'")
        .bind(chain_id).fetch_optional(pool).await?;
    let Some((Some(block), Some(hash))) = checkpoint else {
        return Ok(current_block);
    };
    let canonical = provider
        .get_block(block as u64)
        .await?
        .and_then(|value| value.hash)
        .map(|value| format!("{:#x}", value));
    if canonical.as_deref() == Some(hash.trim()) {
        return Ok(current_block);
    }
    let window: u64 = std::env::var("REORG_SEARCH_WINDOW")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256);
    let floor = (block as u64).saturating_sub(window);
    // Walk stored range boundaries backwards until one agrees with the
    // provider. Replaying from a boundary is safe and avoids storing or
    // fetching hashes for every empty block.
    let mut ancestor = None;
    let checkpoints: Vec<(i64, String)> = sqlx::query_as(
        "SELECT block_number,block_hash FROM indexer_block_checkpoints
         WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3
         ORDER BY block_number DESC",
    )
        .bind(chain_id)
        .bind(floor as i64)
        .bind(block)
        .fetch_all(pool)
        .await?;
    for (candidate, local_hash) in checkpoints {
        let remote = provider
            .get_block(candidate as u64)
            .await?
            .and_then(|b| b.hash)
            .map(|h| format!("{:#x}", h));
        if Some(local_hash.trim()) == remote.as_deref() {
            ancestor = Some(candidate as u64);
            break;
        }
    }
    let ancestor = ancestor
        .ok_or_else(|| format!("no canonical common ancestor found in {} blocks", window))?;
    warn!(
        chain_id,
        checkpoint_block = block,
        rollback_to = ancestor,
        "canonical checkpoint hash changed; rolling back to common ancestor and replaying"
    );
    let mut tx = pool.begin().await?;
    // Delete derived facts in dependency order.  The pre-ancestor accounting
    // snapshot is the replay base and must survive; replay updates it as the
    // canonical post-ancestor receipts are applied.
    for query in [
        "DELETE FROM basket_nav_observations WHERE chain_id=$1 AND block_number > $2",
        "DELETE FROM accounting_events WHERE chain_id=$1 AND block_number > $2",
        "DELETE FROM lending_market_logs WHERE chain_id=$1 AND block_number > $2",
        "DELETE FROM basket_positions WHERE chain_id=$1 AND block_number > $2",
        "DELETE FROM asset_price_observations WHERE chain_id=$1 AND block_number > $2",
        "DELETE FROM indexer_projection_events WHERE chain_id=$1 AND tx_hash IN (SELECT tx_hash FROM basket_events WHERE chain_id=$1 AND block_number > $2)",
        "DELETE FROM basket_events WHERE chain_id=$1 AND block_number > $2",
        "DELETE FROM basket_assets WHERE chain_id=$1 AND updated_block > $2",
        "DELETE FROM indexer_block_checkpoints WHERE chain_id=$1 AND block_number > $2",
    ] {
        sqlx::query(query).bind(chain_id).bind(ancestor as i64).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE lending_transaction_lifecycles SET status='PENDING',confirmed_action=NULL,receipt_log_index=NULL,receipt_block_number=NULL,receipt_block_hash=NULL,updated_at=NOW() WHERE chain_id=$1 AND receipt_block_number > $2")
        .bind(chain_id).bind(ancestor as i64).execute(&mut *tx).await?;
    sqlx::query("UPDATE indexer_state SET next_block=$1,updated_at=NOW() WHERE chain_id=$2")
        .bind(ancestor as i64 + 1)
        .bind(chain_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE indexer_worker_state SET next_block=$1,last_success_block=NULL,last_success_hash=NULL,last_error='ROLLBACK_REPLAY',updated_at=NOW() WHERE chain_id=$2 AND worker_name IN ('events','prices','nav_rollup')").bind(ancestor as i64 + 1).bind(chain_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(ancestor + 1)
}

async fn record_worker_success(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
    block: u64,
    hash: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO indexer_worker_state (chain_id,worker_name,next_block,last_success_block,last_success_hash,last_attempt_at,last_success_at,consecutive_failures,last_error)
         VALUES ($1,$2,$3,$3,$4,NOW(),NOW(),0,NULL)
         ON CONFLICT (chain_id,worker_name) DO UPDATE SET next_block=EXCLUDED.next_block,last_success_block=EXCLUDED.last_success_block,last_success_hash=COALESCE(EXCLUDED.last_success_hash,indexer_worker_state.last_success_hash),last_attempt_at=NOW(),last_success_at=NOW(),consecutive_failures=0,last_error=NULL,updated_at=NOW()",
    ).bind(chain_id).bind(worker).bind(block as i64 + 1).bind(hash).execute(pool).await?;
    Ok(())
}

async fn record_worker_failure(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
    issue: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO indexer_worker_state (chain_id,worker_name,last_attempt_at,consecutive_failures,last_error)
         VALUES ($1,$2,NOW(),1,$3)
         ON CONFLICT (chain_id,worker_name) DO UPDATE SET last_attempt_at=NOW(),consecutive_failures=indexer_worker_state.consecutive_failures+1,last_error=$3,updated_at=NOW()",
    ).bind(chain_id).bind(worker).bind(issue).execute(pool).await?;
    Ok(())
}

async fn acquire_worker_lease(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<bool, sqlx::Error> {
    let owner = lease_owner(worker);
    let row: Option<(bool,)> = sqlx::query_as("INSERT INTO indexer_worker_state (chain_id,worker_name,lease_owner,lease_expires_at) VALUES ($1,$2,$3,NOW()+($4 * INTERVAL '1 second')) ON CONFLICT (chain_id,worker_name) DO UPDATE SET lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=NOW() WHERE indexer_worker_state.lease_expires_at IS NULL OR indexer_worker_state.lease_expires_at < NOW() OR indexer_worker_state.lease_owner=$3 RETURNING true")
        .bind(chain_id).bind(worker).bind(&owner).bind(lease_duration_secs()).fetch_optional(pool).await?;
    Ok(row.map(|_| true).unwrap_or(false))
}

async fn insert_basket_event(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    basket: &str,
    event_type: &str,
    actor: &str,
    payload: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO basket_events (chain_id,tx_hash,log_index,block_number,block_hash,basket_address,event_type,actor_address,payload,occurred_at)
         VALUES ($1,$2,$3,$4,$5,LOWER($6),$7,LOWER($8),$9,NOW()) ON CONFLICT (chain_id,tx_hash,log_index) DO NOTHING",
    ).bind(chain_id).bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).bind(basket).bind(event_type).bind(actor).bind(payload).execute(&mut **tx).await?;
    Ok(())
}

/// Apply balance deltas as absolute, versioned facts. The prior fact is locked
/// per basket/asset, duplicate assets are aggregated first, and underflow or
/// unknown state schedules reconciliation instead of fabricating a quantity.
fn position_deltas_json(ordered: &[(String, (i8, U256))]) -> serde_json::Value {
    serde_json::Value::Array(
        ordered
            .iter()
            .map(|(asset, (direction, amount))| {
                json!({
                    "asset": asset,
                    "direction": direction,
                    "amount": amount.to_string(),
                })
            })
            .collect(),
    )
}

fn parse_position_deltas(
    value: &serde_json::Value,
) -> Result<Vec<(Address, i8, U256)>, Box<dyn std::error::Error>> {
    let entries = value
        .as_array()
        .ok_or("pending position deltas must be an array")?;
    entries
        .iter()
        .map(|entry| {
            let asset: Address = entry
                .get("asset")
                .and_then(|value| value.as_str())
                .ok_or("pending position delta has no asset")?
                .parse()?;
            let direction = entry
                .get("direction")
                .and_then(|value| value.as_i64())
                .ok_or("pending position delta has no direction")?
                as i8;
            let amount = U256::from_dec_str(
                entry
                    .get("amount")
                    .and_then(|value| value.as_str())
                    .ok_or("pending position delta has no amount")?,
            )?;
            Ok((asset, direction, amount))
        })
        .collect()
}

async fn project_position_deltas(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    basket: &str,
    block_number: u64,
    block_hash: &str,
    event_type: &str,
    deltas: Vec<(Address, i8, U256)>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Keep the sign attached to the net amount.  A rebalance may sell and buy
    // the same asset in one receipt; summing magnitudes while retaining the
    // first sign silently creates the wrong balance.
    let mut aggregate: HashMap<String, (i8, U256)> = HashMap::new();
    for (asset, direction, amount) in deltas {
        if amount.is_zero() {
            continue;
        }
        let key = format!("{:#x}", asset).to_lowercase();
        let entry = aggregate.entry(key).or_insert((direction, U256::zero()));
        if entry.1.is_zero() {
            entry.0 = direction;
            entry.1 = amount;
            continue;
        }
        if entry.0 == direction {
            entry.1 = entry
                .1
                .checked_add(amount)
                .ok_or("position delta overflow")?;
        } else if entry.1 >= amount {
            entry.1 = entry.1 - amount;
        } else {
            entry.0 = direction;
            entry.1 = amount - entry.1;
        }
    }
    if aggregate.is_empty() {
        return Ok(());
    }

    let mut ordered: Vec<(String, (i8, U256))> = aggregate.into_iter().collect();
    ordered.sort_by(|left, right| left.0.cmp(&right.0));
    let pending_deltas = position_deltas_json(&ordered);
    let already_projected: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM indexer_projection_events WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3",
    )
    .bind(chain_id)
    .bind(tx_hash)
    .bind(log_index)
    .fetch_optional(&mut **tx)
    .await?;
    if already_projected.is_some() {
        sqlx::query("DELETE FROM indexer_projection_pending WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3")
            .bind(chain_id).bind(tx_hash).bind(log_index).execute(&mut **tx).await?;
        return Ok(());
    }

    // Validate and lock every prior version before writing any next version.
    // This keeps a multi-asset event atomic when one asset is missing or would
    // underflow: no subset can become permanently applied.
    let mut planned = Vec::with_capacity(ordered.len());
    let mut issue: Option<String> = None;
    for (asset, (direction, amount)) in &ordered {
        let prior: Option<(String, i16)> = sqlx::query_as(
            "SELECT quantity_base_units::text,decimals
             FROM basket_positions
             WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3
             ORDER BY block_number DESC, position_version DESC, event_log_index DESC,
                      event_tx_hash DESC
             LIMIT 1",
        )
        .bind(chain_id)
        .bind(basket)
        .bind(&asset)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((quantity, decimals)) = prior else {
            issue = Some(format!(
                "{} delta has no prior absolute position for {}",
                event_type, asset
            ));
            continue;
        };
        let previous = U256::from_dec_str(&quantity)?;
        let next = if *direction < 0 {
            let Some(next) = previous.checked_sub(*amount) else {
                issue = Some(format!("{} delta underflow for {}", event_type, asset));
                continue;
            };
            next
        } else {
            previous
                .checked_add(*amount)
                .ok_or("position quantity overflow")?
        };
        planned.push((asset.clone(), next, decimals));
    }

    if let Some(issue) = issue {
        for (asset, _) in &ordered {
            sqlx::query(
                "INSERT INTO indexer_reconciliation_state
                   (chain_id,basket_address,asset_address,last_checked_block,status,last_error)
                 VALUES ($1,$2,$3,$4,'PENDING',$5)
                 ON CONFLICT (chain_id,basket_address,asset_address) DO UPDATE SET
                   status='PENDING',last_error=EXCLUDED.last_error,last_checked_block=EXCLUDED.last_checked_block",
            )
            .bind(chain_id).bind(basket).bind(asset).bind(block_number as i64).bind(&issue)
            .execute(&mut **tx).await?;
        }
        sqlx::query(
            "INSERT INTO indexer_projection_pending
               (chain_id,tx_hash,log_index,basket_address,block_number,block_hash,event_type,deltas,issue,attempts,first_seen_at,last_attempt_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,NOW(),NOW())
             ON CONFLICT (chain_id,tx_hash,log_index) DO UPDATE SET
               basket_address=EXCLUDED.basket_address,block_number=EXCLUDED.block_number,
               block_hash=EXCLUDED.block_hash,event_type=EXCLUDED.event_type,deltas=EXCLUDED.deltas,
               issue=EXCLUDED.issue,attempts=indexer_projection_pending.attempts+1,last_attempt_at=NOW()",
        )
        .bind(chain_id).bind(tx_hash).bind(log_index).bind(basket).bind(block_number as i64)
        .bind(block_hash).bind(event_type).bind(&pending_deltas).bind(issue)
        .execute(&mut **tx).await?;
        return Ok(());
    }

    for (asset, next, decimals) in planned {
        sqlx::query(
            "INSERT INTO basket_positions
               (chain_id,basket_address,asset_address,block_number,block_hash,block_timestamp,
                quantity_base_units,decimals,source,event_tx_hash,event_log_index,position_version,observed_at)
             SELECT $1,$2,$3,$4,$5,
                    COALESCE((SELECT block_timestamp FROM basket_positions
                              WHERE chain_id=$1 AND basket_address=$2
                                AND asset_address=$3 AND block_number <= $4
                              ORDER BY block_number DESC, position_version DESC,
                                       event_log_index DESC, event_tx_hash DESC LIMIT 1),NOW()),
                    $6::numeric,$7,'EVENT',$8,$9,$9,NOW()
             ON CONFLICT (chain_id,basket_address,asset_address,block_number,event_tx_hash,event_log_index,position_version)
             DO UPDATE SET quantity_base_units=EXCLUDED.quantity_base_units,
                           block_hash=EXCLUDED.block_hash,source='EVENT',observed_at=NOW()",
        )
        .bind(chain_id).bind(basket).bind(&asset).bind(block_number as i64).bind(block_hash)
        .bind(next.to_string()).bind(decimals).bind(tx_hash).bind(log_index)
        .execute(&mut **tx).await?;
    }

    // The applied claim is deliberately the final write.  Any error before
    // this point rolls back the position rows and leaves the event pending for
    // a later replay.
    sqlx::query(
        "INSERT INTO indexer_projection_events (chain_id,tx_hash,log_index)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    )
    .bind(chain_id)
    .bind(tx_hash)
    .bind(log_index)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "DELETE FROM indexer_projection_pending WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3",
    )
    .bind(chain_id)
    .bind(tx_hash)
    .bind(log_index)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn replay_pending_position_projections(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    before_block: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let rows: Vec<(String, i32, String, i64, String, String, serde_json::Value)> = sqlx::query_as(
        "SELECT tx_hash,log_index,basket_address,block_number,block_hash,event_type,deltas
         FROM indexer_projection_pending
         WHERE chain_id=$1 AND block_number < $2
         ORDER BY block_number,log_index,tx_hash",
    )
    .bind(chain_id)
    .bind(before_block as i64)
    .fetch_all(&mut **tx)
    .await?;
    for (tx_hash, log_index, basket, block_number, block_hash, event_type, deltas) in rows {
        let parsed = parse_position_deltas(&deltas)?;
        project_position_deltas(
            tx,
            chain_id,
            &tx_hash,
            log_index,
            &basket,
            block_number as u64,
            &block_hash,
            &event_type,
            parsed,
        )
        .await?;
    }
    Ok(())
}

async fn retry_pending_position_projections(
    pool: &PgPool,
    chain_id: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut tx = pool.begin().await?;
    replay_pending_position_projections(&mut tx, chain_id, u64::MAX).await?;
    tx.commit().await?;
    Ok(())
}

async fn get_next_block(
    pool: &PgPool,
    chain_id: i64,
    default_start: u64,
) -> Result<u64, sqlx::Error> {
    // The worker row is authoritative; indexer_state remains a compatibility
    // mirror for older operators and migrations.
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT next_block FROM indexer_worker_state WHERE chain_id=$1 AND worker_name='events'",
    )
    .bind(chain_id)
    .fetch_optional(pool)
    .await?;
    if let Some((next_block,)) = row {
        return Ok(next_block as u64);
    }
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT next_block FROM indexer_state WHERE chain_id = $1")
            .bind(chain_id)
            .fetch_optional(pool)
            .await?;

    match row {
        Some((next_block,)) => Ok(next_block as u64),
        None => {
            sqlx::query("INSERT INTO indexer_state (chain_id, next_block) VALUES ($1, $2) ON CONFLICT (chain_id) DO NOTHING")
                .bind(chain_id)
                .bind(default_start as i64)
                .execute(pool)
                .await?;
            Ok(default_start)
        }
    }
}

async fn update_next_block(
    pool: &PgPool,
    chain_id: i64,
    next_block: u64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE indexer_state SET next_block = $1, updated_at = NOW() WHERE chain_id = $2")
        .bind(next_block as i64)
        .bind(chain_id)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO indexer_worker_state (chain_id,worker_name,next_block) VALUES ($1,'events',$2) ON CONFLICT (chain_id,worker_name) DO UPDATE SET next_block=EXCLUDED.next_block,updated_at=NOW()")
        .bind(chain_id).bind(next_block as i64).execute(pool).await?;
    Ok(())
}

struct FetchedBlockRange {
    from_block: u64,
    to_block: u64,
    logs: Vec<Log>,
    completed_hash: String,
}

fn event_filter_addresses(
    factory_addr: Address,
    module_addr: Address,
    lending_pool_addrs: &[Address],
) -> Vec<Address> {
    let mut addresses = Vec::new();
    if factory_addr != Address::zero() {
        addresses.push(factory_addr);
    }
    if module_addr != Address::zero() {
        addresses.push(module_addr);
    }
    addresses.extend(
        lending_pool_addrs
            .iter()
            .copied()
            .filter(|address| *address != Address::zero()),
    );
    addresses
}

async fn fetch_block_range(
    provider: &Provider<Http>,
    addresses: &[Address],
    from_block: u64,
    to_block: u64,
) -> Result<FetchedBlockRange, Box<dyn std::error::Error>> {
    let filter = if addresses.is_empty() {
        Filter::new().from_block(from_block).to_block(to_block)
    } else {
        Filter::new()
            .address(addresses.to_vec())
            .from_block(from_block)
            .to_block(to_block)
    };
    let (logs, completed_block) = tokio::try_join!(
        provider.get_logs(&filter),
        provider.get_block(to_block),
    )?;
    let completed_hash = completed_block
        .and_then(|block| block.hash)
        .map(|hash| format!("{:#x}", hash))
        .ok_or_else(|| format!("canonical block {} has no hash", to_block))?;
    Ok(FetchedBlockRange {
        from_block,
        to_block,
        logs,
        completed_hash,
    })
}

async fn fetch_block_ranges(
    provider: &Provider<Http>,
    addresses: &[Address],
    from_block: u64,
    latest_block: u64,
    batch_size: u64,
    concurrency: usize,
) -> Result<Vec<FetchedBlockRange>, Box<dyn std::error::Error>> {
    let mut requested = Vec::with_capacity(concurrency.min(3).max(1));
    let mut next_from = from_block;
    for _ in 0..concurrency.clamp(1, 3) {
        if next_from > latest_block {
            break;
        }
        let to_block = next_from.saturating_add(batch_size).min(latest_block);
        requested.push((next_from, to_block));
        next_from = to_block.saturating_add(1);
    }
    let first = requested.first().copied();
    let second = requested.get(1).copied();
    let third = requested.get(2).copied();
    let (first, second, third) = tokio::try_join!(
        fetch_optional_block_range(provider, addresses, first),
        fetch_optional_block_range(provider, addresses, second),
        fetch_optional_block_range(provider, addresses, third),
    )?;
    let ranges = [first, second, third].into_iter().flatten().collect();
    Ok(ranges)
}

async fn fetch_optional_block_range(
    provider: &Provider<Http>,
    addresses: &[Address],
    range: Option<(u64, u64)>,
) -> Result<Option<FetchedBlockRange>, Box<dyn std::error::Error>> {
    match range {
        Some((from_block, to_block)) => fetch_block_range(
            provider,
            addresses,
            from_block,
            to_block,
        )
        .await
        .map(Some),
        None => Ok(None),
    }
}

async fn fetch_and_process_ranges(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    registry_addr: Address,
    usdc_addr: Address,
    addresses: &[Address],
    from_block: u64,
    latest_block: u64,
    batch_size: u64,
    concurrency: usize,
    owner: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let ranges = fetch_block_ranges(
        provider,
        addresses,
        from_block,
        latest_block,
        batch_size,
        concurrency,
    )
    .await?;
    let last_processed_block = ranges
        .last()
        .map(|range| range.to_block)
        .ok_or("no block ranges were fetched")?;
    for range in ranges {
        process_block_range(
            pool,
            provider,
            chain_id,
            registry_addr,
            usdc_addr,
            range,
            owner,
        )
        .await?;
    }
    Ok(last_processed_block)
}

async fn process_block_range(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    registry_addr: Address,
    usdc_addr: Address,
    fetched: FetchedBlockRange,
    owner: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let FetchedBlockRange {
        from_block,
        to_block,
        logs,
        completed_hash,
    } = fetched;

    // Event facts, absolute positions, pending/applied projection state, and
    // the canonical block ledger advance as one range transaction.  A crash
    // cannot leave durable projections ahead of their checkpoint.
    let mut range_tx = pool.begin().await?;
    replay_pending_position_projections(&mut range_tx, chain_id, from_block).await?;

    for log in logs {
        let tx_hash = format!("{:#x}", log.transaction_hash.unwrap_or_default());
        let block_hash = format!("{:#x}", log.block_hash.unwrap_or_default());
        let block_number = log.block_number.unwrap_or_default().as_u64();
        let log_index = log.log_index.unwrap_or_default().as_u32() as i32;

        if let Ok(event) = IOthelioEventsEvents::decode_log(&log.clone().into()) {
            match event {
                IOthelioEventsEvents::BasketCreatedFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let owner = format!("{:#x}", e.owner);
                    let name = e.name;

                    sqlx::query(
                        "INSERT INTO baskets (chain_id, address, controller, name, symbol, created_block, created_tx, created_at)
                         VALUES ($1, LOWER($2), LOWER($3), $4, 'OTH', $5, $6, NOW())
                         ON CONFLICT (chain_id, address) DO UPDATE SET controller = EXCLUDED.controller"
                    )
                    .bind(chain_id)
                    .bind(&safe)
                    .bind(&owner)
                    .bind(&name)
                    .bind(block_number as i64)
                    .bind(&tx_hash)
                        .execute(&mut *range_tx)
                    .await?;

                    let payload = json!({
                        "safe": safe,
                        "owner": owner,
                        "name": name,
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, LOWER($6), 'CREATED', LOWER($7), $8, NOW())
                         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING"
                    )
                    .bind(chain_id)
                    .bind(&tx_hash)
                    .bind(log_index)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(&safe)
                    .bind(&owner)
                    .bind(&payload)
                        .execute(&mut *range_tx)
                    .await?;

                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                    reconcile_accounting_for_basket(&mut range_tx, chain_id, &safe).await?;

                    info!(
                        "[Rust Indexer] Indexed BasketCreated: safe={} owner={}",
                        safe, owner
                    );
                }
                IOthelioEventsEvents::BasketFundedFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let funder = format!("{:#x}", e.funder);

                    let payload = json!({
                        "inputAsset": format!("{:#x}", e.input_asset),
                        "inputAmount": e.input_amount.to_string(),
                        "boughtAssets": e.acquired_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "boughtAmounts": e.acquired_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "eventReportedAcquiredOutputNavUsdc": e.acquired_output_nav_usdc.to_string(),
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, LOWER($6), 'FUNDED', LOWER($7), $8, NOW())
                         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING"
                    )
                    .bind(chain_id)
                    .bind(&tx_hash)
                    .bind(log_index)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(&safe)
                    .bind(&funder)
                    .bind(&payload)
                        .execute(&mut *range_tx)
                    .await?;

                    let funding_deltas = e
                        .acquired_assets
                        .iter()
                        .zip(e.acquired_amounts.iter())
                        .map(|(asset, amount)| (*asset, 1_i8, *amount))
                        .collect();
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "FUNDED",
                        funding_deltas,
                    )
                    .await?;

                    let first_funding: bool = sqlx::query_scalar(
                        "SELECT NOT EXISTS (SELECT 1 FROM basket_events WHERE chain_id=$1 AND basket_address=$2 AND event_type='FUNDED' AND (block_number < $3 OR (block_number=$3 AND log_index < $4)))",
                    )
                    .bind(chain_id).bind(&safe).bind(block_number as i64).bind(log_index)
                    .fetch_one(&mut *range_tx).await?;
                    if let Some(weights) = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?
                    {
                        if first_funding {
                            save_indexed_target_weights(
                                &mut range_tx,
                                chain_id,
                                &safe,
                                block_number,
                                &tx_hash,
                                log_index,
                                &weights,
                            )
                            .await?;
                        }
                    }
                    reconcile_accounting_for_basket(&mut range_tx, chain_id, &safe).await?;

                    info!(
                        "[Rust Indexer] Indexed BasketFunded: safe={} funder={}",
                        safe, funder
                    );
                }
                IOthelioEventsEvents::BasketRebalancedFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let controller = format!("{:#x}", e.controller);

                    let payload = json!({
                        "soldAssets": e.sold_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "soldAmounts": e.sold_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "boughtAssets": e.bought_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "boughtAmounts": e.bought_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "eventReportedTradedOutputNavUsdc": e.traded_output_nav_usdc.to_string(),
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, LOWER($6), 'WEIGHTS_UPDATED', LOWER($7), $8, NOW())
                         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING"
                    )
                    .bind(chain_id)
                    .bind(&tx_hash)
                    .bind(log_index)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(&safe)
                    .bind(&controller)
                    .bind(&payload)
                        .execute(&mut *range_tx)
                    .await?;

                    let mut rebalance_deltas = e
                        .sold_assets
                        .iter()
                        .zip(e.sold_amounts.iter())
                        .map(|(asset, amount)| (*asset, -1_i8, *amount))
                        .collect::<Vec<_>>();
                    rebalance_deltas.extend(
                        e.bought_assets
                            .iter()
                            .zip(e.bought_amounts.iter())
                            .map(|(asset, amount)| (*asset, 1_i8, *amount)),
                    );
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "REBALANCED",
                        rebalance_deltas,
                    )
                    .await?;

                    if let Some(weights) = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?
                    {
                        save_indexed_target_weights(
                            &mut range_tx,
                            chain_id,
                            &safe,
                            block_number,
                            &tx_hash,
                            log_index,
                            &weights,
                        )
                        .await?;
                    }
                    reconcile_accounting_for_basket(&mut range_tx, chain_id, &safe).await?;

                    info!("[Rust Indexer] Indexed BasketRebalanced: safe={}", safe);
                }
                IOthelioEventsEvents::BasketWithdrawnFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let owner = format!("{:#x}", e.owner);

                    let payload = json!({
                        "navRedeemed": e.nav_redeemed.to_string(),
                        "outputAsset": format!("{:#x}", e.output_asset),
                        "withdrawnAssets": e.withdrawn_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "withdrawnAmounts": e.withdrawn_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "eventReportedRemainingListedAssetsNavUsdc": e.remaining_listed_assets_nav_usdc.to_string(),
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, LOWER($6), 'WITHDRAWN', LOWER($7), $8, NOW())
                         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING"
                    )
                    .bind(chain_id)
                    .bind(&tx_hash)
                    .bind(log_index)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(&safe)
                    .bind(&owner)
                    .bind(&payload)
                        .execute(&mut *range_tx)
                    .await?;

                    let withdrawal_deltas = e
                        .withdrawn_assets
                        .iter()
                        .zip(e.withdrawn_amounts.iter())
                        .map(|(asset, amount)| (*asset, -1_i8, *amount))
                        .collect();
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "WITHDRAWN",
                        withdrawal_deltas,
                    )
                    .await?;

                    project_withdrawal_accounting(
                        &mut range_tx,
                        provider,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        &e.withdrawn_assets,
                        &e.withdrawn_amounts,
                        usdc_addr,
                    )
                    .await?;

                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                    reconcile_accounting_for_basket(&mut range_tx, chain_id, &safe).await?;

                    info!("[Rust Indexer] Indexed BasketWithdrawn: safe={}", safe);
                }
                IOthelioEventsEvents::BasketSwapWithdrawnFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let owner = format!("{:#x}", e.owner);
                    let payload = json!({
                        "recipient": format!("{:#x}", e.recipient), "outputAsset": format!("{:#x}", e.output_asset),
                        "outputAmount": e.output_amount.to_string(),
                        "soldAssets": e.sold_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "soldAmounts": e.sold_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "remainingListedAssetsNavUsdc": e.remaining_listed_assets_nav_usdc.to_string(),
                    });
                    insert_basket_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        "SWAP_WITHDRAWN",
                        &owner,
                        &payload,
                    )
                    .await?;
                    let sold_deltas = e
                        .sold_assets
                        .iter()
                        .zip(e.sold_amounts.iter())
                        .map(|(asset, amount)| (*asset, -1_i8, *amount))
                        .collect();
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "SWAP_WITHDRAWN",
                        sold_deltas,
                    )
                    .await?;
                    project_withdrawal_accounting(
                        &mut range_tx,
                        provider,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        &e.sold_assets,
                        &e.sold_amounts,
                        usdc_addr,
                    )
                    .await?;
                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                }
                IOthelioEventsEvents::UntrackedAssetSweptFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let owner = format!("{:#x}", e.owner);
                    let payload = json!({ "token": format!("{:#x}", e.token), "amount": e.amount.to_string() });
                    insert_basket_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        "ASSET_SWEPT",
                        &owner,
                        &payload,
                    )
                    .await?;
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "ASSET_SWEPT",
                        vec![(e.token, -1_i8, e.amount)],
                    )
                    .await?;
                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                }
                IOthelioEventsEvents::BasketSuppliedToLendingFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let actor = format!("{:#x}", e.provider);
                    let payload = json!({ "asset": format!("{:#x}", e.asset), "amount": e.amount.to_string(), "supplyApyBps": e.supply_apy_bps.to_string() });
                    insert_basket_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        "SUPPLIED_TO_LENDING",
                        &actor,
                        &payload,
                    )
                    .await?;
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "SUPPLIED_TO_LENDING",
                        vec![(e.asset, -1_i8, e.amount)],
                    )
                    .await?;
                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                }
                IOthelioEventsEvents::BasketBorrowedFromLendingFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let actor = format!("{:#x}", e.provider);
                    let payload = json!({ "asset": format!("{:#x}", e.asset), "amount": e.amount.to_string(), "borrowApyBps": e.borrow_apy_bps.to_string() });
                    insert_basket_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        "BORROWED_FROM_LENDING",
                        &actor,
                        &payload,
                    )
                    .await?;
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "BORROWED_FROM_LENDING",
                        vec![(e.asset, 1_i8, e.amount)],
                    )
                    .await?;
                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                }
                IOthelioEventsEvents::BasketRepaidToLendingFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let actor = format!("{:#x}", e.provider);
                    let payload = json!({ "asset": format!("{:#x}", e.asset), "amount": e.amount.to_string() });
                    insert_basket_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        "REPAID_TO_LENDING",
                        &actor,
                        &payload,
                    )
                    .await?;
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "REPAID_TO_LENDING",
                        vec![(e.asset, -1_i8, e.amount)],
                    )
                    .await?;
                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                }
                IOthelioEventsEvents::BasketWithdrawnFromLendingFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let actor = format!("{:#x}", e.provider);
                    let payload = json!({ "asset": format!("{:#x}", e.asset), "amount": e.amount.to_string() });
                    insert_basket_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &safe,
                        "WITHDRAWN_FROM_LENDING",
                        &actor,
                        &payload,
                    )
                    .await?;
                    project_position_deltas(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        log_index,
                        &safe,
                        block_number,
                        &block_hash,
                        "WITHDRAWN_FROM_LENDING",
                        vec![(e.asset, 1_i8, e.amount)],
                    )
                    .await?;
                    let _ = write_event_valuation_checkpoint(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        e.safe,
                        block_number,
                        &block_hash,
                    )
                    .await?;
                }
                IOthelioEventsEvents::AerodromeRouteExecutedFilter(e) => {
                    let basket = format!("{:#x}", e.basket);
                    let token_in = format!("{:#x}", e.token_in);
                    let token_out = format!("{:#x}", e.token_out);
                    let mut payload = json!({
                        "tokenIn": token_in,
                        "tokenOut": token_out,
                        "kind": e.kind,
                        "amountIn": e.amount_in.to_string(),
                        "amountOut": e.amount_out.to_string(),
                        "firstTickSpacing": e.first_tick_spacing,
                        "secondTickSpacing": e.second_tick_spacing,
                    });
                    if let Some(payload_object) = payload.as_object_mut() {
                        match route_execution_valuation(
                            provider,
                            registry_addr,
                            chain_id,
                            e.token_in,
                            e.amount_in,
                            e.token_out,
                            e.amount_out,
                            block_number,
                        )
                        .await
                        {
                            Ok(valuation) => payload_object.extend(valuation),
                            Err(issue) => {
                                payload_object.insert(
                                    "referenceValuationStatus".to_string(),
                                    json!("UNAVAILABLE"),
                                );
                                payload_object
                                    .insert("referenceValuationIssue".to_string(), json!(issue));
                            }
                        }
                    }

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, LOWER($6), 'DEX_ROUTE_EXECUTED', LOWER($6), $7, NOW())
                         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING"
                    )
                    .bind(chain_id)
                    .bind(&tx_hash)
                    .bind(log_index)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(&basket)
                    .bind(&payload)
                        .execute(&mut *range_tx)
                    .await?;

                    project_route_accounting(
                        &mut range_tx,
                        provider,
                        registry_addr,
                        chain_id,
                        usdc_addr,
                        &tx_hash,
                        log_index,
                        block_number,
                        &block_hash,
                        &basket,
                        e.token_in,
                        e.amount_in,
                        e.token_out,
                        e.amount_out,
                    )
                    .await?;

                    info!("[Rust Indexer] Indexed AerodromeRouteExecuted: basket={} tokenIn={} tokenOut={}", basket, token_in, token_out);
                }
                IOthelioEventsEvents::SupplyFilter(e) => {
                    index_lending_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        &block_hash,
                        block_number,
                        log_index,
                        e.on_behalf_of,
                        log.address,
                        e.reserve,
                        e.amount,
                        "SUPPLY",
                    )
                    .await?;
                }
                IOthelioEventsEvents::BorrowFilter(e) => {
                    index_lending_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        &block_hash,
                        block_number,
                        log_index,
                        e.on_behalf_of,
                        log.address,
                        e.reserve,
                        e.amount,
                        "BORROW",
                    )
                    .await?;
                }
                IOthelioEventsEvents::RepayFilter(e) => {
                    index_lending_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        &block_hash,
                        block_number,
                        log_index,
                        e.user,
                        log.address,
                        e.reserve,
                        e.amount,
                        "REPAY",
                    )
                    .await?;
                }
                IOthelioEventsEvents::WithdrawFilter(e) => {
                    index_lending_event(
                        &mut range_tx,
                        chain_id,
                        &tx_hash,
                        &block_hash,
                        block_number,
                        log_index,
                        e.user,
                        log.address,
                        e.reserve,
                        e.amount,
                        "WITHDRAW",
                    )
                    .await?;
                }
            }
        }
    }

    // One canonical boundary per range is enough for safe recovery. On a
    // reorg, roll back to the previous matching boundary and replay at most
    // one complete range instead of spending an RPC call on every empty block.
    sqlx::query(
        "INSERT INTO indexer_block_checkpoints (chain_id,block_number,block_hash) VALUES ($1,$2,$3)
         ON CONFLICT (chain_id,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash,processed_at=NOW()",
    )
    .bind(chain_id)
    .bind(to_block as i64)
    .bind(&completed_hash)
    .execute(&mut *range_tx)
    .await?;
    sqlx::query("UPDATE indexer_state SET next_block=GREATEST(next_block,$1),updated_at=NOW() WHERE chain_id=$2")
        .bind(to_block as i64 + 1).bind(chain_id).execute(&mut *range_tx).await?;
    let updated = sqlx::query("UPDATE indexer_worker_state SET next_block=GREATEST(next_block,$1),last_success_block=$2,last_success_hash=$3,last_attempt_at=NOW(),last_success_at=NOW(),consecutive_failures=0,last_error=NULL,updated_at=NOW() WHERE chain_id=$4 AND worker_name='events' AND lease_owner=$5 AND lease_expires_at > NOW()")
        .bind(to_block as i64 + 1)
        .bind(to_block as i64)
        .bind(&completed_hash)
        .bind(chain_id)
        .bind(owner)
        .execute(&mut *range_tx).await?;
    if updated.rows_affected() != 1 {
        return Err("event lease was lost before checkpoint advancement".into());
    }
    range_tx.commit().await?;

    Ok(())
}

/// Derive event NAV from the absolute position facts written by the event
/// reducer and the latest indexed price at or before the event block.  Event
/// ingestion must not perform an unrelated registry/balance/feed scan: a
/// missing price is recorded as deferred NAV while the event transaction still
/// commits its durable facts.
async fn record_unavailable_event_nav(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    basket: &str,
    block_number: u64,
    block_hash: &str,
    issue: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO basket_nav_observations
         (chain_id,basket_address,block_number,block_hash,block_timestamp,
          position_block_number,price_block_number,nav_usdc,kind,valuation_status,issue,observed_at)
         VALUES ($1,$2,$3,$4,NOW(),$3,$3,NULL,'EVENT','UNAVAILABLE',$5,NOW())
         ON CONFLICT (chain_id,basket_address,block_number,kind) DO UPDATE SET
           block_hash=EXCLUDED.block_hash,nav_usdc=NULL,valuation_status='UNAVAILABLE',issue=EXCLUDED.issue,observed_at=NOW()"
    ).bind(chain_id).bind(basket).bind(block_number as i64).bind(block_hash).bind(issue)
     .execute(&mut **tx).await?;
    Ok(())
}

async fn write_event_valuation_checkpoint(
    tx: &mut Transaction<'_, Postgres>,
    _provider: &Provider<Http>,
    _registry_addr: Address,
    chain_id: i64,
    safe: Address,
    block_number: u64,
    block_hash: &str,
) -> Result<Option<Vec<(String, u32)>>, Box<dyn std::error::Error>> {
    let basket = format!("{:#x}", safe).to_lowercase();
    let rows: Vec<(String, String, i16, Option<String>)> = sqlx::query_as(
        "SELECT p.asset_address, p.quantity_base_units::text, p.decimals,
                price.price_usd_e8::text
         FROM (
           SELECT DISTINCT ON (chain_id,basket_address,asset_address)
                  chain_id,basket_address,asset_address,block_number,
                  quantity_base_units,decimals
           FROM basket_positions
           WHERE chain_id=$1 AND basket_address=$2 AND block_number <= $3
             AND source='EVENT'
           ORDER BY chain_id,basket_address,asset_address,block_number DESC,
                    position_version DESC,event_log_index DESC,event_tx_hash DESC
         ) p
         LEFT JOIN LATERAL (
           SELECT apo.price_usd_e8
           FROM asset_price_observations apo
           WHERE apo.chain_id=p.chain_id AND apo.asset_address=p.asset_address
             AND apo.block_number <= $3
           ORDER BY apo.block_number DESC, apo.observed_at DESC
           LIMIT 1
         ) price ON TRUE
         ORDER BY p.asset_address",
    )
    .bind(chain_id)
    .bind(&basket)
    .bind(block_number as i64)
    .fetch_all(&mut **tx)
    .await?;

    if rows.is_empty() {
        record_unavailable_event_nav(
            tx,
            chain_id,
            &basket,
            block_number,
            block_hash,
            "no absolute event positions available",
        )
        .await?;
        return Ok(None);
    }
    if rows.iter().any(|(_, _, _, price)| price.is_none()) {
        record_unavailable_event_nav(
            tx,
            chain_id,
            &basket,
            block_number,
            block_hash,
            "one or more event positions have no price at or before the event block",
        )
        .await?;
        return Ok(None);
    }

    let mut total = U256::zero();
    let mut values = Vec::new();
    for (asset, quantity, decimals, price) in rows {
        let quantity = U256::from_dec_str(&quantity)?;
        let price = U256::from_dec_str(&price.unwrap_or_default())?;
        let value = quantity
            .checked_mul(price)
            .and_then(|value| value.checked_mul(U256::from(1_000_000u64)))
            .map(|value| value / (U256::exp10(decimals.max(0) as usize) * U256::exp10(8)))
            .ok_or("event NAV overflow")?;
        total = total.checked_add(value).ok_or("event NAV overflow")?;
        values.push((asset, value));
    }
    let nav = nav_micro_to_numeric_string(total);
    sqlx::query(
        "INSERT INTO basket_nav_observations
         (chain_id,basket_address,block_number,block_hash,block_timestamp,
          position_block_number,price_block_number,nav_usdc,kind,valuation_status,issue,observed_at)
         VALUES ($1,$2,$3,$4,NOW(),$3,$3,$5::numeric,'EVENT','COMPLETE',NULL,NOW())
         ON CONFLICT (chain_id,basket_address,block_number,kind) DO UPDATE SET
           block_hash=EXCLUDED.block_hash,nav_usdc=EXCLUDED.nav_usdc,
           valuation_status='COMPLETE',issue=NULL,observed_at=NOW()",
    )
    .bind(chain_id)
    .bind(&basket)
    .bind(block_number as i64)
    .bind(block_hash)
    .bind(&nav)
    .execute(&mut **tx)
    .await?;

    if total.is_zero() {
        return Ok(None);
    }
    let mut allocated = 0u32;
    let mut weights = values
        .iter()
        .map(|(asset, value)| {
            let bps = (*value * U256::from(10_000u64) / total).as_u32();
            allocated += bps;
            (asset.clone(), bps, *value)
        })
        .collect::<Vec<_>>();
    if let Some(largest) = weights.iter_mut().max_by_key(|entry| entry.2) {
        largest.1 += 10_000u32.saturating_sub(allocated);
    }
    Ok(Some(
        weights
            .into_iter()
            .map(|(asset, bps, _)| (asset, bps))
            .collect(),
    ))
}

/// Legacy scan implementation retained below only as historical reference;
/// all event call sites resolve to the projection based implementation above.
async fn save_indexed_target_weights(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    basket_address: &str,
    block_number: u64,
    tx_hash: &str,
    log_index: i32,
    weights: &[(String, u32)],
) -> Result<(), Box<dyn std::error::Error>> {
    if weights.is_empty() {
        return Ok(());
    }

    let latest_block: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(updated_block) FROM basket_assets WHERE chain_id=$1 AND basket_address=$2",
    )
    .bind(chain_id)
    .bind(basket_address)
    .fetch_one(&mut **tx)
    .await?;

    if latest_block.map_or(true, |latest| latest <= block_number as i64) {
        let addresses: Vec<String> = weights.iter().map(|(address, _)| address.clone()).collect();
        for (address, weight_bps) in weights {
            sqlx::query(
                "INSERT INTO basket_assets (chain_id, basket_address, asset_address, target_weight_bps, updated_block)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (chain_id, basket_address, asset_address) DO UPDATE SET
                   target_weight_bps=EXCLUDED.target_weight_bps, updated_block=EXCLUDED.updated_block",
            )
            .bind(chain_id).bind(basket_address).bind(address)
            .bind(*weight_bps as i32).bind(block_number as i64)
            .execute(&mut **tx).await?;
        }
        sqlx::query(
            "DELETE FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 AND NOT (asset_address = ANY($3::text[]))",
        )
        .bind(chain_id).bind(basket_address).bind(&addresses)
        .execute(&mut **tx).await?;
    }

    let target_payload = json!(weights
        .iter()
        .map(|(asset_address, weight_bps)| json!({
            "assetAddress": asset_address,
            "weightBps": weight_bps,
        }))
        .collect::<Vec<_>>())
    .to_string();
    sqlx::query(
        "UPDATE basket_events SET payload=jsonb_set(payload, '{targetWeights}', $5::jsonb, true)
         WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3 AND basket_address=$4",
    )
    .bind(chain_id)
    .bind(tx_hash)
    .bind(log_index)
    .bind(basket_address)
    .bind(target_payload)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn cached_registry_metadata(
    provider: &Provider<Http>,
    registry_addr: Address,
    chain_id: i64,
    block_id: BlockId,
) -> Result<Vec<FeedMetadata>, Box<dyn std::error::Error>> {
    let max_age = Duration::from_secs(configured_u64("INDEXER_REGISTRY_CACHE_SECS", 900));
    let client = Arc::new(provider.clone());
    let registry = OthelioAssetRegistry::new(registry_addr, client);
    let tokens = registry
        .get_supported_tokens(U256::from(chain_id as u64))
        .block(block_id)
        .call()
        .await?;
    let concurrency = configured_u64("INDEXER_REGISTRY_METADATA_CONCURRENCY", 8).max(1) as usize;
    let mut feeds = Vec::new();
    for chunk in tokens.chunks(concurrency) {
        let mut tasks = tokio::task::JoinSet::new();
        for token in chunk.iter().copied() {
            let registry = registry.clone();
            tasks.spawn(async move {
                registry
                    .get_asset(U256::from(chain_id as u64), token)
                    .block(block_id)
                    .call()
                    .await
                    .map(|(supported, feed, token_decimals, feed_decimals, _)| {
                        (token, supported, feed, token_decimals, feed_decimals)
                    })
            });
        }
        while let Some(result) = tasks.join_next().await {
            let (token, supported, feed, token_decimals, feed_decimals) = result??;
            if supported && feed != Address::zero() && feed_decimals <= 36 {
                feeds.push(FeedMetadata {
                    token,
                    feed,
                    token_decimals,
                    feed_decimals,
                });
            }
        }
    }
    let mut fingerprint = DefaultHasher::new();
    tokens.hash(&mut fingerprint);
    for f in &feeds {
        f.token.hash(&mut fingerprint);
        f.feed.hash(&mut fingerprint);
        f.token_decimals.hash(&mut fingerprint);
        f.feed_decimals.hash(&mut fingerprint);
    }
    let token_fingerprint = fingerprint.finish();
    {
        let cache = registry_cache().lock().await;
        if let Some(value) = cache.as_ref() {
            if value.chain_id == chain_id
                && value.registry == registry_addr
                && value.token_fingerprint == token_fingerprint
                && value.loaded_at.elapsed() < max_age
            {
                return Ok(value.feeds.clone());
            }
        }
    }
    let mut cache = registry_cache().lock().await;
    *cache = Some(RegistryCache {
        chain_id,
        registry: registry_addr,
        loaded_at: std::time::Instant::now(),
        feeds: feeds.clone(),
        token_fingerprint,
    });
    info!(chain_id, registry = ?registry_addr, feed_count = feeds.len(), "indexer registry/feed metadata cache refreshed");
    Ok(feeds)
}

struct PriceRead {
    metadata: FeedMetadata,
    round_id: U256,
    price_usd_e8: U256,
    feed_updated_at: chrono::DateTime<chrono::Utc>,
}

async fn read_price_chunk(
    provider: Arc<Provider<Http>>,
    multicall: Address,
    feeds: Vec<FeedMetadata>,
    block_id: BlockId,
    block_timestamp: chrono::DateTime<chrono::Utc>,
) -> (Vec<PriceRead>, Vec<(String, String)>) {
    let calls: Vec<Call3> = feeds
        .iter()
        .filter_map(|metadata| {
            SnapshotAggregator::new(metadata.feed, provider.clone())
                .latest_round_data()
                .calldata()
                .map(|data| Call3 {
                    target: metadata.feed,
                    allow_failure: true,
                    call_data: data,
                })
        })
        .collect();
    let response = SnapshotMulticall3::new(multicall, provider.clone())
        .aggregate_3(calls)
        .block(block_id)
        .call()
        .await;
    let Ok(results) = response else {
        return (
            Vec::new(),
            feeds
                .into_iter()
                .map(|feed| {
                    (
                        format!("{:#x}", feed.token),
                        "multicall request failed".to_string(),
                    )
                })
                .collect(),
        );
    };
    let max_age = configured_u64("PRICE_MAX_SOURCE_AGE_SECS", 86_400);
    let mut good = Vec::new();
    let mut failed = Vec::new();
    for (metadata, res) in feeds.into_iter().zip(results.into_iter()) {
        let (success, data) = (res.0, res.1);
        let token_name = format!("{:#x}", metadata.token).to_lowercase();
        if !success {
            failed.push((token_name, "feed call failed".to_string()));
            continue;
        }
        let decoded = ethers::abi::decode(
            &[
                ethers::abi::ParamType::Uint(80),
                ethers::abi::ParamType::Int(256),
                ethers::abi::ParamType::Uint(256),
                ethers::abi::ParamType::Uint(256),
                ethers::abi::ParamType::Uint(80),
            ],
            data.as_ref(),
        );
        let Ok(values) = decoded else {
            failed.push((token_name, "invalid feed response".to_string()));
            continue;
        };
        let round_id = values[0].clone().into_uint().unwrap_or_default();
        let answer =
            ethers::types::I256::from_raw(values[1].clone().into_int().unwrap_or_default());
        let updated_at = values[3].clone().into_uint().unwrap_or_default();
        let answered_in_round = values[4].clone().into_uint().unwrap_or_default();
        let source_age = block_timestamp.timestamp() - updated_at.as_u64() as i64;
        if answer.is_zero()
            || answer.is_negative()
            || round_id.is_zero()
            || answered_in_round < round_id
            || updated_at.is_zero()
            || source_age < 0
            || source_age as u64 > max_age
        {
            failed.push((token_name, "invalid or stale feed data".to_string()));
            continue;
        }
        let price_usd_e8 =
            answer.into_raw() * U256::exp10(8) / U256::exp10(metadata.feed_decimals as usize);
        let feed_updated_at = chrono::DateTime::from_timestamp(updated_at.as_u64() as i64, 0)
            .unwrap_or(block_timestamp);
        good.push(PriceRead {
            metadata,
            round_id,
            price_usd_e8,
            feed_updated_at,
        });
    }
    (good, failed)
}

/// Hourly price tick scheduler:
/// 1. Acquires a PostgreSQL advisory lock per chain_id.
/// 2. Reads each configured oracle feed ONCE at the selected finalized block (zero basket-balance RPC calls!).
/// 3. Bulk inserts price facts into `asset_price_observations`.
/// 4. Uses a set-based SQL query to revalue each active basket's latest position version against the new prices.
/// 5. Inserts `basket_nav_observations` (kind = 'HOURLY').
async fn run_hourly_valuation_tick(
    pool: &PgPool,
    provider: &Provider<Http>,
    registry_addr: Address,
    chain_id: i64,
    latest_block: u64,
    owner: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let price_block_number = latest_block;
    let block_id = BlockId::Number(BlockNumber::Number(U64::from(price_block_number)));
    let block = provider
        .get_block(block_id)
        .await
        .map_err(|e| format!("block read failed: {}", e))?
        .ok_or_else(|| format!("block {} unavailable", price_block_number))?;

    let block_hash = format!("{:#x}", block.hash.unwrap_or_default());
    let block_secs = block.timestamp.as_u64() as i64;
    let block_timestamp = chrono::DateTime::from_timestamp(block_secs, 0).unwrap_or_else(chrono::Utc::now);

    let feeds = cached_registry_metadata(provider, registry_addr, chain_id, block_id).await
        .map_err(|e| format!("registry metadata read failed: {}", e))?;
    let multicall: Address = std::env::var("MULTICALL3_ADDRESS").unwrap_or_else(|_| MULTICALL3_ADDRESS.to_string()).parse()
        .map_err(|e| format!("invalid MULTICALL3_ADDRESS: {}", e))?;
    let chunk_size = configured_u64("INDEXER_PRICE_MULTICALL_CHUNK_SIZE", 100).max(1) as usize;
    let concurrency = configured_u64("INDEXER_PRICE_MULTICALL_CONCURRENCY", 2).max(1) as usize;
    let mut feeds_succeeded = 0;
    let mut failed_assets = Vec::new();

    // Keep price facts, NAV rows, advisory lock, and worker checkpoints in one transaction connection.
    let mut write_tx = pool.begin().await.map_err(|e| format!("price write transaction failed: {e}"))?;
    let lock_row: (bool,) = sqlx::query_as("SELECT pg_try_advisory_xact_lock($1)")
        .bind(chain_id)
        .fetch_one(&mut *write_tx)
        .await
        .map_err(|e| format!("advisory lock read failed: {e}"))?;

    if !lock_row.0 {
        info!(
            "[Hourly Valuation] Advisory lock for chain_id {} unavailable; skipping tick",
            chain_id
        );
        return Err("price advisory lock unavailable".into());
    }

    let mut offset = 0;
    while offset < feeds.len() {
        let end = (offset + chunk_size * concurrency).min(feeds.len());
        let mut tasks = tokio::task::JoinSet::new();
        for chunk in feeds[offset..end].chunks(chunk_size) {
            tasks.spawn(read_price_chunk(Arc::new(provider.clone()), multicall, chunk.to_vec(), block_id, block_timestamp));
        }
        while let Some(task) = tasks.join_next().await {
            let (reads, failures) = task.map_err(|e| format!("price chunk task failed: {}", e))?;
            failed_assets.extend(failures);
            for price in reads {
                let token_addr_str = format!("{:#x}", price.metadata.token).to_lowercase();
                sqlx::query(
                    "INSERT INTO asset_price_observations (chain_id, asset_address, feed_address, block_number, block_hash, block_timestamp, feed_round_id, price_usd_e8, feed_updated_at, observed_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9,NOW())"
                )
                .bind(chain_id).bind(&token_addr_str).bind(&format!("{:#x}", price.metadata.feed).to_lowercase())
                .bind(price_block_number as i64).bind(&block_hash).bind(block_timestamp)
                .bind(price.round_id.to_string()).bind(price.price_usd_e8.to_string()).bind(price.feed_updated_at)
                .execute(&mut *write_tx).await.map_err(|e| format!("price observation write failed: {}", e))?;
                feeds_succeeded += 1;
            }
        }
        offset = end;
    }

    // Set-based SQL query to revalue active baskets using latest positions & just-inserted price observations
    let updated_rows = sqlx::query(
        "INSERT INTO basket_nav_observations (
           chain_id,
           basket_address,
           block_number,
           block_hash,
           block_timestamp,
           position_block_number,
           price_block_number,
           nav_usdc,
           kind,
           valuation_status,
           issue,
           observed_at
         )
         SELECT
           p.chain_id,
           p.basket_address,
           $2::bigint AS block_number,
           $3::text AS block_hash,
           $4::timestamptz AS block_timestamp,
           MAX(p.block_number) AS position_block_number,
           $2::bigint AS price_block_number,
           CASE
             WHEN COUNT(*) FILTER (WHERE apo.asset_address IS NULL) = 0 THEN
               ROUND(
                 SUM(
                   (p.quantity_base_units * apo.price_usd_e8 * 1000000.0) /
                   (POWER(10::numeric, p.decimals) * 100000000.0)
                 ) / 1000000.0,
                 6
               )
             ELSE NULL
           END AS nav_usdc,
           'HOURLY' AS kind,
           CASE
             WHEN COUNT(*) FILTER (WHERE apo.asset_address IS NULL) = 0 THEN 'COMPLETE'
             ELSE 'UNAVAILABLE'
           END AS valuation_status,
           CASE
             WHEN COUNT(*) FILTER (WHERE apo.asset_address IS NULL) = 0 THEN NULL::text
             ELSE 'MISSING_OR_INVALID_PRICE_AT_BLOCK'::text
           END AS issue,
           NOW() AS observed_at
         FROM (
           SELECT DISTINCT ON (chain_id, basket_address, asset_address)
             chain_id, basket_address, asset_address, block_number, position_version,
             event_log_index, event_tx_hash, block_hash, quantity_base_units, decimals
           FROM basket_positions
           WHERE chain_id = $1
           ORDER BY chain_id, basket_address, asset_address, block_number DESC,
                    position_version DESC, event_log_index DESC, event_tx_hash DESC
         ) p
         LEFT JOIN LATERAL (
           SELECT price_usd_e8, asset_address
           FROM asset_price_observations candidate
           WHERE candidate.chain_id = p.chain_id
             AND candidate.asset_address = p.asset_address
             AND candidate.block_number <= $2
           ORDER BY candidate.block_number DESC, candidate.observed_at DESC
           LIMIT 1
         ) apo ON TRUE
         WHERE p.quantity_base_units > 0
         GROUP BY p.chain_id, p.basket_address
         ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
           block_hash = EXCLUDED.block_hash,
           block_timestamp = EXCLUDED.block_timestamp,
           position_block_number = EXCLUDED.position_block_number,
           price_block_number = EXCLUDED.price_block_number,
           nav_usdc = EXCLUDED.nav_usdc,
           valuation_status = EXCLUDED.valuation_status,
           issue = EXCLUDED.issue,
           observed_at = EXCLUDED.observed_at"
    )
    .bind(chain_id)
    .bind(price_block_number as i64)
    .bind(&block_hash)
    .bind(block_timestamp)
    .execute(&mut *write_tx)
    .await
    .map_err(|e| format!("NAV observation write failed: {}", e))?;

    // If any asset feeds failed, mark dependent baskets as UNAVAILABLE
    for (failed_asset, issue_msg) in failed_assets {
        sqlx::query(
            "INSERT INTO basket_nav_observations (
               chain_id, basket_address, block_number, block_hash, block_timestamp,
               position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at
             )
             SELECT DISTINCT ON (p.chain_id, p.basket_address)
               p.chain_id, p.basket_address, $2::bigint, $3::text, $4::timestamptz,
               p.block_number, $2::bigint, NULL, 'HOURLY', 'UNAVAILABLE', $5::text, NOW()
             FROM (
               SELECT DISTINCT ON (chain_id, basket_address, asset_address)
                 chain_id, basket_address, asset_address, block_number, position_version,
                 event_log_index, event_tx_hash, block_hash, quantity_base_units
               FROM basket_positions
               WHERE chain_id = $1
               ORDER BY chain_id, basket_address, asset_address, block_number DESC,
                        position_version DESC, event_log_index DESC, event_tx_hash DESC
             ) p
             WHERE p.asset_address = $6 AND p.quantity_base_units > 0
             ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
               valuation_status = 'UNAVAILABLE', issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
        )
        .bind(chain_id)
        .bind(price_block_number as i64)
        .bind(&block_hash)
        .bind(block_timestamp)
        .bind(&issue_msg)
        .bind(&failed_asset)
        .execute(&mut *write_tx)
        .await
        .map_err(|e| format!("unavailable asset NAV write failed: {}", e))?;
    }

    let checkpoint = sqlx::query(
        "UPDATE indexer_worker_state
        SET next_block=$1,last_success_block=$2,last_success_at=NOW(),last_attempt_at=NOW(),
             consecutive_failures=0,last_error=NULL,updated_at=NOW()
         WHERE chain_id=$3 AND worker_name='prices' AND lease_owner=$4 AND lease_expires_at > NOW()"
    )
    .bind(price_block_number as i64 + 1)
    .bind(price_block_number as i64)
    .bind(chain_id)
    .bind(owner)
    .execute(&mut *write_tx)
    .await
    .map_err(|e| format!("price checkpoint write failed: {e}"))?;
    if checkpoint.rows_affected() != 1 {
        return Err("price lease was lost before checkpoint advancement".into());
    }
    sqlx::query(
        "INSERT INTO indexer_worker_state (chain_id,worker_name,next_block,last_success_block,last_success_at,last_attempt_at,consecutive_failures,last_error)
        VALUES ($1,'nav_rollup',$2,$3,NOW(),NOW(),0,NULL)
         ON CONFLICT (chain_id,worker_name) DO UPDATE SET next_block=EXCLUDED.next_block,last_success_block=EXCLUDED.last_success_block,last_success_at=NOW(),last_attempt_at=NOW(),consecutive_failures=0,last_error=NULL,updated_at=NOW()"
    )
    .bind(chain_id)
    .bind(price_block_number as i64 + 1)
    .bind(price_block_number as i64)
    .execute(&mut *write_tx)
    .await
    .map_err(|e| format!("NAV checkpoint write failed: {e}"))?;

    write_tx.commit().await.map_err(|e| format!("price/NAV commit failed: {e}"))?;

    info!(
        "⏰ [Hourly Valuation Tick] Block {} evaluated: feeds_succeeded={}, nav_rows_written={}",
        price_block_number, feeds_succeeded, updated_rows.rows_affected()
    );

    Ok(())
}

/// Repairs direct transfers and missed module events using only tracked pairs.
/// A failed pair is left untouched, so a partial provider response can never
/// overwrite a complete historical position with zero.
async fn run_reconciliation_tick(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    block_number: u64,
    owner: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let block = provider
        .get_block(BlockId::Number(BlockNumber::Number(U64::from(
            block_number,
        ))))
        .await?
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "reconciliation block unavailable",
            )
        })?;
    let block_hash = format!("{:#x}", block.hash.unwrap_or_default());
    let timestamp = chrono::DateTime::from_timestamp(block.timestamp.as_u64() as i64, 0)
        .unwrap_or_else(chrono::Utc::now);
    let cursor: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT cursor_basket,cursor_asset FROM indexer_worker_state WHERE chain_id=$1 AND worker_name='reconciliation'"
    ).bind(chain_id).fetch_optional(pool).await?.unwrap_or((None, None));
    let pairs: Vec<(String, String, String, i16)> = sqlx::query_as(
        "WITH latest AS (
           SELECT DISTINCT ON (p.basket_address,p.asset_address)
             p.basket_address,p.asset_address,p.block_hash,p.decimals
           FROM basket_positions p WHERE p.chain_id=$1
           ORDER BY p.basket_address,p.asset_address,p.block_number DESC,
                    p.position_version DESC,p.event_log_index DESC,p.event_tx_hash DESC
         )
         SELECT l.basket_address,l.asset_address,l.block_hash,l.decimals
         FROM latest l LEFT JOIN indexer_reconciliation_state r
           ON r.chain_id=$1 AND r.basket_address=l.basket_address AND r.asset_address=l.asset_address
         WHERE (r.last_checked_block IS NULL OR r.last_checked_block <= $2-150 OR r.status='DEGRADED')
           AND ($3::text IS NULL OR (l.basket_address,l.asset_address) > ($3,$4))
         ORDER BY CASE WHEN r.status='DEGRADED' THEN 0 ELSE 1 END,
                  COALESCE(r.last_checked_block,0), COALESCE(r.last_checked_at,TO_TIMESTAMP(0)), l.basket_address,l.asset_address
         LIMIT 500",
    ).bind(chain_id).bind(block_number as i64).bind(cursor.0.as_deref().map(|s| s.to_lowercase())).bind(cursor.1.as_deref().map(|s| s.to_lowercase())).fetch_all(pool).await?;
    if pairs.is_empty() {
        let mut checkpoint_tx = pool.begin().await?;
        let updated = sqlx::query("UPDATE indexer_worker_state SET cursor_basket=NULL,cursor_asset=NULL,next_block=$2,last_success_block=$2,last_success_at=NOW(),last_attempt_at=NOW(),consecutive_failures=0,last_error=NULL,updated_at=NOW() WHERE chain_id=$1 AND worker_name='reconciliation' AND lease_owner=$3 AND lease_expires_at > NOW()")
            .bind(chain_id).bind(block_number as i64).bind(owner).execute(&mut *checkpoint_tx).await?;
        if updated.rows_affected() != 1 {
            return Err("reconciliation lease was lost before checkpoint advancement".into());
        }
        checkpoint_tx.commit().await?;
        return Ok(false);
    }
    let batch_len = pairs.len();
    let cursor_after = pairs
        .last()
        .map(|(basket, asset, _, _)| (basket.clone(), asset.clone()));
    let client = Arc::new(provider.clone());
    let multicall: Address = std::env::var("MULTICALL3_ADDRESS")
        .unwrap_or_else(|_| MULTICALL3_ADDRESS.to_string())
        .parse()?;

    // Batch fetch prior quantities for all pairs in 1 query instead of 500 individual loop queries
    let pair_baskets: Vec<String> = pairs.iter().map(|(b, _, _, _)| b.clone()).collect();
    let pair_assets: Vec<String> = pairs.iter().map(|(_, a, _, _)| a.clone()).collect();
    let latest_rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT ON (basket_address, asset_address)
                basket_address, asset_address, quantity_base_units::text
         FROM basket_positions
         WHERE chain_id=$1
           AND (basket_address, asset_address) IN (
               SELECT UNNEST($2::text[]), UNNEST($3::text[])
           )
         ORDER BY basket_address, asset_address, block_number DESC,
                  position_version DESC, event_log_index DESC, event_tx_hash DESC",
    )
    .bind(chain_id)
    .bind(&pair_baskets)
    .bind(&pair_assets)
    .fetch_all(pool)
    .await?;

    let latest_map: HashMap<(String, String), String> = latest_rows
        .into_iter()
        .map(|(b, a, q)| ((b, a), q))
        .collect();

    let mut balance_calls: Vec<Call3> = Vec::new();
    for (basket, asset, _, _) in &pairs {
        let token: Address = asset.trim().parse()?;
        let holder: Address = basket.trim().parse()?;
        let calldata = SnapshotErc20::new(token, client.clone())
            .balance_of(holder)
            .calldata()
            .ok_or("failed to encode balanceOf")?;
        balance_calls.push(Call3 {
            target: token,
            allow_failure: true,
            call_data: calldata,
        });
    }
    let balance_results = if balance_calls.is_empty() {
        Vec::new()
    } else {
        SnapshotMulticall3::new(multicall, client.clone())
            .aggregate_3(balance_calls)
            .block(BlockId::Number(BlockNumber::Number(U64::from(
                block_number,
            ))))
            .call()
            .await?
    };

    let mut rec_baskets = Vec::with_capacity(batch_len);
    let mut rec_assets = Vec::with_capacity(batch_len);
    let mut rec_statuses = Vec::with_capacity(batch_len);
    let mut rec_errors = Vec::with_capacity(batch_len);

    for ((basket, asset, _previous_hash, decimals), res) in
        pairs.into_iter().zip(balance_results.into_iter())
    {
        let (success, return_data) = (res.0, res.1);
        let observed: Result<U256, String> = if success {
            ethers::abi::decode(&[ethers::abi::ParamType::Uint(256)], return_data.as_ref())
                .map_err(|error| error.to_string())
                .and_then(|values| {
                    values
                        .first()
                        .and_then(|value| value.clone().into_uint())
                        .ok_or_else(|| "invalid multicall balance result".to_string())
                })
        } else {
            Err("multicall balance call failed".to_string())
        };
        let observed = match observed {
            Ok(value) => value,
            Err(error) => {
                rec_baskets.push(basket);
                rec_assets.push(asset);
                rec_statuses.push("DEGRADED".to_string());
                rec_errors.push(Some(error));
                continue;
            }
        };
        let observed_str = observed.to_string();
        let prior_quantity = latest_map.get(&(basket.clone(), asset.clone()));
        if prior_quantity.map_or(true, |q| q != &observed_str) {
            sqlx::query(
                "INSERT INTO basket_positions
                   (chain_id,basket_address,asset_address,block_number,block_hash,block_timestamp,
                    quantity_base_units,decimals,source,event_tx_hash,event_log_index,position_version,observed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,'RECONCILIATION',$5,-1,-1,NOW())
                 ON CONFLICT (chain_id,basket_address,asset_address,block_number,event_tx_hash,event_log_index,position_version)
                 DO UPDATE SET quantity_base_units=EXCLUDED.quantity_base_units,
                               block_hash=EXCLUDED.block_hash,source='RECONCILIATION',observed_at=NOW()",
            )
                .bind(chain_id).bind(&basket).bind(&asset).bind(block_number as i64).bind(&block_hash)
                .bind(timestamp).bind(&observed_str).bind(decimals).execute(pool).await?;
        }
        rec_baskets.push(basket);
        rec_assets.push(asset);
        rec_statuses.push("COMPLETE".to_string());
        rec_errors.push(None);
    }

    // 1 bulk upsert for all reconciliation statuses instead of 500 single-row statements
    if !rec_baskets.is_empty() {
        sqlx::query(
            "INSERT INTO indexer_reconciliation_state
               (chain_id,basket_address,asset_address,last_checked_block,last_checked_hash,last_checked_at,status,last_error)
             SELECT $1, UNNEST($2::text[]), UNNEST($3::text[]), $4, $5, NOW(), UNNEST($6::text[]), UNNEST($7::text[])
             ON CONFLICT (chain_id,basket_address,asset_address) DO UPDATE SET
               last_checked_block=EXCLUDED.last_checked_block,
               last_checked_hash=EXCLUDED.last_checked_hash,
               last_checked_at=NOW(),
               status=EXCLUDED.status,
               last_error=EXCLUDED.last_error",
        )
        .bind(chain_id)
        .bind(&rec_baskets)
        .bind(&rec_assets)
        .bind(block_number as i64)
        .bind(&block_hash)
        .bind(&rec_statuses)
        .bind(&rec_errors)
        .execute(pool)
        .await?;
    }
    let more = batch_len == 500;
    let mut checkpoint_tx = pool.begin().await?;
    if more {
        if let Some((basket, asset)) = cursor_after {
            sqlx::query("UPDATE indexer_worker_state SET cursor_basket=$2,cursor_asset=$3,next_block=$4,last_success_block=$4,last_success_at=NOW(),last_attempt_at=NOW(),consecutive_failures=0,last_error=NULL,updated_at=NOW() WHERE chain_id=$1 AND worker_name='reconciliation' AND lease_owner=$5 AND lease_expires_at > NOW()")
            .bind(chain_id).bind(basket).bind(asset).bind(block_number as i64).bind(owner).execute(&mut *checkpoint_tx).await?;
        }
    } else {
        sqlx::query("UPDATE indexer_worker_state SET cursor_basket=NULL,cursor_asset=NULL,next_block=$2,last_success_block=$2,last_success_at=NOW(),last_attempt_at=NOW(),consecutive_failures=0,last_error=NULL,updated_at=NOW() WHERE chain_id=$1 AND worker_name='reconciliation' AND lease_owner=$3 AND lease_expires_at > NOW()")
            .bind(chain_id).bind(block_number as i64).bind(owner).execute(&mut *checkpoint_tx).await?;
    }
    let checkpoint_ok = sqlx::query("SELECT 1 FROM indexer_worker_state WHERE chain_id=$1 AND worker_name='reconciliation' AND lease_owner=$2 AND lease_expires_at > NOW()")
        .bind(chain_id).bind(owner).fetch_optional(&mut *checkpoint_tx).await?.is_some();
    if !checkpoint_ok {
        return Err("reconciliation lease was lost before checkpoint advancement".into());
    }
    checkpoint_tx.commit().await?;
    Ok(more)
}

fn nav_micro_to_numeric_string(value: U256) -> String {
    let main = value / U256::from(1_000_000u64);
    let rem = value % U256::from(1_000_000u64);
    format!("{}.{:06}", main, rem)
}

#[derive(Clone)]
struct AccountingMutation {
    kind: &'static str,
    asset: String,
    quantity: U256,
    decimals: u8,
    acquisition_basis_micro: Option<U256>,
    valuation_source: &'static str,
}

/// Projects one atomic route into current weighted-average state. A route either
/// updates every affected asset or records every affected asset as INCOMPLETE;
/// it never leaves half of an asset-to-asset rebalance accounted for.
async fn project_route_accounting(
    tx: &mut Transaction<'_, Postgres>,
    provider: &Provider<Http>,
    registry_addr: Address,
    chain_id: i64,
    usdc: Address,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    basket: &str,
    token_in: Address,
    amount_in: U256,
    token_out: Address,
    amount_out: U256,
) -> Result<(), Box<dyn std::error::Error>> {
    if amount_in.is_zero()
        || amount_out.is_zero()
        || token_in == token_out
        || registry_addr == Address::zero()
    {
        return mark_route_incomplete(
            tx,
            chain_id,
            tx_hash,
            log_index,
            block_number,
            block_hash,
            basket,
            token_in,
            amount_in,
            token_out,
            amount_out,
            usdc,
            "invalid route receipt",
        )
        .await;
    }
    let block_id = BlockId::Number(BlockNumber::Number(U64::from(block_number)));
    let block = provider.get_block(block_id).await?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "route block unavailable")
    })?;
    let occurred_at = chrono::DateTime::from_timestamp(block.timestamp.as_u64() as i64, 0)
        .unwrap_or_else(chrono::Utc::now);
    let client = Arc::new(provider.clone());
    let registry = OthelioAssetRegistry::new(registry_addr, client.clone());
    let (_, _, input_decimals, _, _) = registry
        .get_asset(U256::from(chain_id as u64), token_in)
        .block(block_id)
        .call()
        .await?;
    let (_, _, output_decimals, _, _) = registry
        .get_asset(U256::from(chain_id as u64), token_out)
        .block(block_id)
        .call()
        .await?;
    let mut mutations = Vec::new();
    if token_in != usdc {
        mutations.push(AccountingMutation {
            kind: "REDUCTION",
            asset: format!("{:#x}", token_in).to_lowercase(),
            quantity: amount_in,
            decimals: input_decimals,
            acquisition_basis_micro: None,
            valuation_source: "NONE",
        });
    }
    if token_out != usdc {
        let (basis, source) = if token_in == usdc {
            (amount_in, "USDC_RECEIPT")
        } else {
            (
                route_oracle_value_micro(
                    &registry, client, chain_id, token_out, amount_out, block_id,
                )
                .await
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?,
                "ORACLE_AT_EXECUTION",
            )
        };
        mutations.push(AccountingMutation {
            kind: "ACQUISITION",
            asset: format!("{:#x}", token_out).to_lowercase(),
            quantity: amount_out,
            decimals: output_decimals,
            acquisition_basis_micro: Some(basis),
            valuation_source: source,
        });
    }
    apply_accounting_mutations(
        tx,
        chain_id,
        tx_hash,
        log_index,
        block_number,
        block_hash,
        occurred_at,
        basket,
        mutations,
    )
    .await
}

async fn project_withdrawal_accounting(
    tx: &mut Transaction<'_, Postgres>,
    provider: &Provider<Http>,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    basket: &str,
    assets: &[Address],
    amounts: &[U256],
    usdc: Address,
) -> Result<(), Box<dyn std::error::Error>> {
    if assets.len() != amounts.len() {
        return Ok(());
    }
    let block_id = BlockId::Number(BlockNumber::Number(U64::from(block_number)));
    let block = provider.get_block(block_id).await?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "withdrawal block unavailable")
    })?;
    let occurred_at = chrono::DateTime::from_timestamp(block.timestamp.as_u64() as i64, 0)
        .unwrap_or_else(chrono::Utc::now);
    let mut mutations = Vec::new();
    for (asset, amount) in assets.iter().zip(amounts) {
        if *asset == usdc || amount.is_zero() {
            continue;
        }
        // The existing state is the source for token decimals; zero is only a
        // placeholder here and is replaced before application.
        mutations.push(AccountingMutation {
            kind: "TRANSFER_OUT",
            asset: format!("{:#x}", asset).to_lowercase(),
            quantity: *amount,
            decimals: 0,
            acquisition_basis_micro: None,
            valuation_source: "NONE",
        });
    }
    apply_accounting_mutations(
        tx,
        chain_id,
        tx_hash,
        log_index,
        block_number,
        block_hash,
        occurred_at,
        basket,
        mutations,
    )
    .await
}

async fn apply_accounting_mutations(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    occurred_at: chrono::DateTime<chrono::Utc>,
    basket: &str,
    mut mutations: Vec<AccountingMutation>,
) -> Result<(), Box<dyn std::error::Error>> {
    if mutations.is_empty() {
        return Ok(());
    }
    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM accounting_events WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3 LIMIT 1",
    )
    .bind(chain_id)
    .bind(tx_hash)
    .bind(log_index)
    .fetch_optional(&mut **tx)
    .await?;
    if exists.is_some() {
        return Ok(());
    }

    let mut applied: Vec<(AccountingMutation, U256, String)> = Vec::new();
    let mut issue: Option<String> = None;
    for mutation in mutations.iter_mut() {
        let row: Option<(String, String, String, i16)> = sqlx::query_as(
            "SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status, decimals FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3 FOR UPDATE"
        ).bind(chain_id).bind(basket).bind(&mutation.asset).fetch_optional(&mut **tx).await?;
        if mutation.kind == "ACQUISITION" {
            let delta = mutation.acquisition_basis_micro.ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "acquisition missing basis")
            })?;
            applied.push((mutation.clone(), delta, String::new()));
            continue;
        }
        let Some((quantity, basis, status, decimals)) = row else {
            issue = Some(format!(
                "missing prior accounting basis for {}",
                mutation.asset
            ));
            break;
        };
        if status != "COMPLETE" {
            issue = Some(format!(
                "prior accounting state incomplete for {}",
                mutation.asset
            ));
            break;
        }
        let quantity = U256::from_dec_str(&quantity)?;
        let basis = U256::from_dec_str(&basis)?;
        if quantity.is_zero() || mutation.quantity > quantity {
            issue = Some(format!(
                "reduction exceeds open quantity for {}",
                mutation.asset
            ));
            break;
        }
        mutation.decimals = decimals as u8;
        let basis_removed = basis.checked_mul(mutation.quantity).ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "basis multiplication overflow",
            )
        })? / quantity;
        applied.push((mutation.clone(), basis_removed, String::new()));
    }
    if let Some(issue) = issue {
        return record_incomplete_mutations(
            tx,
            chain_id,
            tx_hash,
            log_index,
            block_number,
            block_hash,
            occurred_at,
            basket,
            mutations,
            &issue,
        )
        .await;
    }
    for (mutation, basis, _) in applied {
        let (basis_delta, next_quantity, next_basis) = if mutation.kind == "ACQUISITION" {
            let current: Option<(String, String, String)> = sqlx::query_as("SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3 FOR UPDATE")
                .bind(chain_id).bind(basket).bind(&mutation.asset).fetch_optional(&mut **tx).await?;
            match current {
                Some((quantity, open_basis, status)) if status == "COMPLETE" => (
                    basis.to_string(),
                    U256::from_dec_str(&quantity)?
                        .checked_add(mutation.quantity)
                        .ok_or_else(|| {
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "quantity overflow",
                            )
                        })?,
                    U256::from_dec_str(&open_basis)?
                        .checked_add(basis)
                        .ok_or_else(|| {
                            std::io::Error::new(std::io::ErrorKind::InvalidData, "basis overflow")
                        })?,
                ),
                Some(_) => {
                    return record_incomplete_mutations(
                        tx,
                        chain_id,
                        tx_hash,
                        log_index,
                        block_number,
                        block_hash,
                        occurred_at,
                        basket,
                        mutations,
                        "prior accounting state incomplete",
                    )
                    .await;
                }
                None => (basis.to_string(), mutation.quantity, basis),
            }
        } else {
            let (quantity, open_basis, _): (String, String, String) = sqlx::query_as("SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3 FOR UPDATE")
                .bind(chain_id).bind(basket).bind(&mutation.asset).fetch_one(&mut **tx).await?;
            let next_quantity = U256::from_dec_str(&quantity)? - mutation.quantity;
            let next_basis = U256::from_dec_str(&open_basis)? - basis;
            (format!("-{}", basis), next_quantity, next_basis)
        };
        let event_id: (String,) = sqlx::query_as(
            "INSERT INTO accounting_events (chain_id,basket_address,tx_hash,log_index,block_number,block_hash,occurred_at,kind,asset_address,quantity_base_units,decimals,basis_delta_usdc_micro,valuation_source,status,issue)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11,$12::numeric,$13,'COMPLETE',NULL) RETURNING id::text"
        ).bind(chain_id).bind(basket).bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).bind(occurred_at)
         .bind(mutation.kind).bind(&mutation.asset).bind(mutation.quantity.to_string()).bind(mutation.decimals as i16).bind(&basis_delta).bind(mutation.valuation_source)
         .fetch_one(&mut **tx).await?;
        sqlx::query(
            "INSERT INTO asset_cost_basis (chain_id,basket_address,asset_address,quantity_base_units,decimals,open_basis_usdc_micro,accounting_status,issue,last_event_id,updated_at)
             VALUES ($1,$2,$3,$4::numeric,$5,$6::numeric,'COMPLETE',NULL,$7::uuid,NOW())
             ON CONFLICT (chain_id,basket_address,asset_address) DO UPDATE SET quantity_base_units=EXCLUDED.quantity_base_units, decimals=EXCLUDED.decimals, open_basis_usdc_micro=EXCLUDED.open_basis_usdc_micro, accounting_status='COMPLETE', issue=NULL, last_event_id=EXCLUDED.last_event_id, updated_at=NOW()"
        ).bind(chain_id).bind(basket).bind(&mutation.asset).bind(next_quantity.to_string()).bind(mutation.decimals as i16).bind(next_basis.to_string()).bind(event_id.0)
         .execute(&mut **tx).await?;
    }
    Ok(())
}

async fn record_incomplete_mutations(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    occurred_at: chrono::DateTime<chrono::Utc>,
    basket: &str,
    mutations: Vec<AccountingMutation>,
    issue: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    for mutation in mutations {
        sqlx::query("INSERT INTO accounting_events (chain_id,basket_address,tx_hash,log_index,block_number,block_hash,occurred_at,kind,asset_address,quantity_base_units,decimals,basis_delta_usdc_micro,valuation_source,status,issue) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11,0,$12,'INCOMPLETE',$13) ON CONFLICT DO NOTHING")
            .bind(chain_id).bind(basket).bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).bind(occurred_at).bind(mutation.kind).bind(&mutation.asset).bind(mutation.quantity.to_string()).bind(mutation.decimals as i16).bind(mutation.valuation_source).bind(issue).execute(&mut **tx).await?;
        sqlx::query("INSERT INTO asset_cost_basis (chain_id,basket_address,asset_address,quantity_base_units,decimals,open_basis_usdc_micro,accounting_status,issue,updated_at) VALUES ($1,$2,$3,0,$4,0,'INCOMPLETE',$5,NOW()) ON CONFLICT (chain_id,basket_address,asset_address) DO UPDATE SET accounting_status='INCOMPLETE', issue=EXCLUDED.issue, updated_at=NOW()")
            .bind(chain_id).bind(basket).bind(&mutation.asset).bind(mutation.decimals as i16).bind(issue).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn mark_route_incomplete(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    basket: &str,
    token_in: Address,
    amount_in: U256,
    token_out: Address,
    amount_out: U256,
    usdc: Address,
    issue: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut mutations = Vec::new();
    if token_in != usdc {
        mutations.push(AccountingMutation {
            kind: "REDUCTION",
            asset: format!("{:#x}", token_in).to_lowercase(),
            quantity: amount_in,
            decimals: 0,
            acquisition_basis_micro: None,
            valuation_source: "NONE",
        });
    }
    if token_out != usdc {
        mutations.push(AccountingMutation {
            kind: "ACQUISITION",
            asset: format!("{:#x}", token_out).to_lowercase(),
            quantity: amount_out,
            decimals: 0,
            acquisition_basis_micro: None,
            valuation_source: "NONE",
        });
    }
    record_incomplete_mutations(
        tx,
        chain_id,
        tx_hash,
        log_index,
        block_number,
        block_hash,
        chrono::Utc::now(),
        basket,
        mutations,
        issue,
    )
    .await
}

async fn reconcile_accounting_for_basket(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    basket: &str,
) -> Result<(), sqlx::Error> {
    // A replayed receipt is trustworthy only if its derived open quantity equals
    // the latest exact checkpointed Safe balance. Unknown positive holdings are
    // inserted as INCOMPLETE instead of displaying a made-up zero basis.
    sqlx::query(
        "WITH latest_positions AS (
           SELECT DISTINCT ON (asset_address) asset_address, quantity_base_units, decimals
           FROM basket_positions WHERE chain_id=$1 AND basket_address=$2
           ORDER BY asset_address, block_number DESC, position_version DESC,
                    event_log_index DESC, event_tx_hash DESC, observed_at DESC, block_hash DESC
         )
         INSERT INTO asset_cost_basis (chain_id,basket_address,asset_address,quantity_base_units,decimals,open_basis_usdc_micro,accounting_status,issue,updated_at)
         SELECT $1,$2,lp.asset_address,0,lp.decimals,0,'INCOMPLETE','missing receipt-derived acquisition basis',NOW()
         FROM latest_positions lp LEFT JOIN asset_cost_basis acb ON acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=lp.asset_address
         WHERE lp.quantity_base_units > 0 AND acb.asset_address IS NULL
         ON CONFLICT (chain_id,basket_address,asset_address) DO NOTHING"
    ).bind(chain_id).bind(basket).execute(&mut **tx).await?;
    sqlx::query(
        "WITH latest_positions AS (
           SELECT DISTINCT ON (asset_address) asset_address, quantity_base_units
           FROM basket_positions WHERE chain_id=$1 AND basket_address=$2
           ORDER BY asset_address, block_number DESC, position_version DESC,
                    event_log_index DESC, event_tx_hash DESC, observed_at DESC, block_hash DESC
         )
         UPDATE asset_cost_basis acb SET accounting_status='INCOMPLETE', issue='accounting quantity does not reconcile to latest indexed balance', updated_at=NOW()
         FROM latest_positions lp WHERE acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=lp.asset_address
           AND acb.accounting_status='COMPLETE' AND acb.quantity_base_units <> lp.quantity_base_units"
    ).bind(chain_id).bind(basket).execute(&mut **tx).await?;
    Ok(())
}

async fn route_execution_valuation(
    provider: &Provider<Http>,
    registry_addr: Address,
    chain_id: i64,
    token_in: Address,
    amount_in: U256,
    token_out: Address,
    amount_out: U256,
    block_number: u64,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if registry_addr == Address::zero() || amount_in.is_zero() {
        return Err("route valuation is not configured".to_string());
    }
    let block_id = BlockId::Number(BlockNumber::Number(U64::from(block_number)));
    let client = Arc::new(provider.clone());
    let registry = OthelioAssetRegistry::new(registry_addr, client.clone());
    let (_, _, input_decimals, _, _) = registry
        .get_asset(U256::from(chain_id as u64), token_in)
        .block(block_id)
        .call()
        .await
        .map_err(|error| format!("input asset config failed: {error}"))?;
    let (_, _, output_decimals, _, _) = registry
        .get_asset(U256::from(chain_id as u64), token_out)
        .block(block_id)
        .call()
        .await
        .map_err(|error| format!("output asset config failed: {error}"))?;
    let input_value = route_oracle_value_micro(
        &registry,
        client.clone(),
        chain_id,
        token_in,
        amount_in,
        block_id,
    )
    .await?;
    let output_value =
        route_oracle_value_micro(&registry, client, chain_id, token_out, amount_out, block_id)
            .await?;
    let execution_rate_e18 = amount_out
        .checked_mul(U256::exp10(input_decimals as usize))
        .and_then(|value| value.checked_mul(U256::exp10(18usize)))
        .ok_or_else(|| "execution-rate overflow".to_string())?
        / (amount_in * U256::exp10(output_decimals as usize));
    let input_usdc = nav_micro_to_numeric_string(input_value)
        .parse::<f64>()
        .unwrap_or(0.0);
    let output_usdc = nav_micro_to_numeric_string(output_value)
        .parse::<f64>()
        .unwrap_or(0.0);
    let mut values = serde_json::Map::new();
    values.insert(
        "executionPriceTokenOutPerTokenIn".to_string(),
        json!(execution_rate_e18.to_string()),
    );
    values.insert("executionPriceScale".to_string(), json!("1e18"));
    values.insert("inputOracleValueUsdc".to_string(), json!(input_usdc));
    values.insert("outputOracleValueUsdc".to_string(), json!(output_usdc));
    values.insert(
        "executionCostUsdc".to_string(),
        json!(input_usdc - output_usdc),
    );
    values.insert("referenceValuationStatus".to_string(), json!("COMPLETE"));
    Ok(values)
}

async fn route_oracle_value_micro<M: Middleware + 'static>(
    registry: &OthelioAssetRegistry<M>,
    client: Arc<Provider<Http>>,
    chain_id: i64,
    token: Address,
    amount: U256,
    block_id: BlockId,
) -> Result<U256, String> {
    let (supported, feed, token_decimals, feed_decimals, _) = registry
        .get_asset(U256::from(chain_id as u64), token)
        .block(block_id)
        .call()
        .await
        .map_err(|error| format!("asset config failed: {error}"))?;
    if !supported || feed == Address::zero() {
        return Err(format!("unsupported route asset {token:#x}"));
    }
    let (_, answer, _, _, _) = SnapshotAggregator::new(feed, client)
        .latest_round_data()
        .block(block_id)
        .call()
        .await
        .map_err(|error| format!("route price failed: {error}"))?;
    if answer.is_negative() || answer.is_zero() {
        return Err(format!("invalid route price {token:#x}"));
    }
    let denominator = U256::exp10(token_decimals as usize) * U256::exp10(feed_decimals as usize);
    amount
        .checked_mul(answer.into_raw())
        .and_then(|value| value.checked_mul(U256::from(1_000_000u64)))
        .map(|value| value / denominator)
        .ok_or_else(|| "route value overflow".to_string())
}

async fn index_lending_event(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    tx_hash: &str,
    block_hash: &str,
    block_number: u64,
    log_index: i32,
    basket: Address,
    market: Address,
    asset: Address,
    amount: U256,
    action: &str,
) -> Result<(), sqlx::Error> {
    let basket = format!("{:#x}", basket);
    let market = format!("{:#x}", market);
    let asset = format!("{:#x}", asset);
    let amount = amount.to_string();
    sqlx::query(
        "INSERT INTO lending_market_logs
           (chain_id, basket_address, action, asset_address, amount, winning_provider, winning_pool,
            winning_supply_apy, winning_borrow_apy, all_market_quotes, tx_hash, log_index,
            block_number, block_hash, actor_address, created_at)
         SELECT $1,LOWER($2),$3,LOWER($4),$5,'AAVE_V3',LOWER($6),NULL,NULL,'[]'::jsonb,$7,$8,$9,$10,LOWER($2),NOW()
         WHERE EXISTS (SELECT 1 FROM baskets WHERE chain_id=$1 AND address=LOWER($2))
         ON CONFLICT (chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL DO NOTHING"
    )
    .bind(chain_id).bind(&basket).bind(action).bind(&asset).bind(&amount).bind(&market)
    .bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).execute(&mut **tx).await?;

    sqlx::query(
        "UPDATE lending_transaction_lifecycles SET status='CONFIRMED_SUCCESS', confirmed_action=$3,
           confirmed_asset_address=LOWER($4), confirmed_amount=$5, confirmed_market_address=LOWER($6),
           receipt_log_index=$7, receipt_block_number=$8, receipt_block_hash=$9,
           reason=NULL, settled_at=NOW(), updated_at=NOW()
         WHERE chain_id=$1 AND tx_hash=$2 AND basket_address=LOWER($10)
           AND requested_action=$3 AND requested_asset_address=LOWER($4) AND requested_market_address=LOWER($6)"
    )
    .bind(chain_id).bind(tx_hash).bind(action).bind(&asset).bind(&amount).bind(&market)
    .bind(log_index).bind(block_number as i64).bind(block_hash).bind(&basket).execute(&mut **tx).await?;
    info!(
        "[Rust Indexer] Indexed lending {}: basket={} market={} amount={}",
        action, basket, market, amount
    );
    Ok(())
}
