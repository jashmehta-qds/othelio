use crate::db::{
    acquire_worker_lease, record_worker_failure, release_worker_lease, worker_last_success_block,
};
use crate::oracle::run_hourly_valuation_tick;
use crate::utils::{configured_u64, lease_owner, read_head, rpc_retry_delay};
use ethers::providers::{Http, Provider};
use ethers::types::Address;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{info, warn};

async fn check_prices(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    registry_addr: Address,
    confirmations: u64,
) -> Result<bool, String> {
    let timeout = Duration::from_secs(configured_u64("INDEXER_RPC_TIMEOUT_SECS", 30));
    let head = tokio::time::timeout(timeout, read_head(provider))
        .await
        .map_err(|_| "price head read timed out".to_string())?
        .map_err(|error| format!("price head read failed: {error}"))?
        .as_u64();
    let confirmed = head.saturating_sub(confirmations);
    let last_success = worker_last_success_block(pool, chain_id, "prices")
        .await
        .map_err(|error| format!("price checkpoint read failed: {error}"))?;
    let interval = configured_u64("INDEXER_PRICE_INTERVAL_BLOCKS", 10).max(1);
    if registry_addr == Address::zero()
        || confirmed == 0
        || confirmed < last_success.saturating_add(interval)
    {
        return Ok(false);
    }
    if !acquire_worker_lease(pool, chain_id, "prices")
        .await
        .map_err(|error| format!("price lease acquisition failed: {error}"))?
    {
        return Ok(false);
    }

    let owner = lease_owner("prices");
    let outcome = match tokio::time::timeout(
        timeout,
        run_hourly_valuation_tick(pool, provider, registry_addr, chain_id, confirmed, &owner),
    )
    .await
    {
        Ok(Ok(())) => Ok(true),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err(format!(
            "price worker timed out after {}s",
            timeout.as_secs()
        )),
    };
    release_worker_lease(pool, chain_id, "prices")
        .await
        .map_err(|error| format!("price lease release failed: {error}"))?;
    outcome
}

pub async fn run_price_worker(
    pool: PgPool,
    chain_id: i64,
    registry_addr: Address,
    confirmations: u64,
    primary: Arc<Provider<Http>>,
    secondary: Option<Arc<Provider<Http>>>,
) {
    let mut using_secondary = false;
    let mut failures = 0_u32;
    let mut next_primary_probe = Instant::now();
    let poll_interval =
        Duration::from_secs(configured_u64("INDEXER_HEAD_POLL_INTERVAL_SECS", 5).max(1));
    let probe_interval =
        Duration::from_secs(configured_u64("INDEXER_RPC_CIRCUIT_COOLDOWN_SECS", 30));

    loop {
        if using_secondary && Instant::now() >= next_primary_probe {
            let probe = tokio::time::timeout(probe_interval, read_head(&primary)).await;
            if matches!(probe, Ok(Ok(_))) {
                using_secondary = false;
                failures = 0;
                info!("price worker returned to primary RPC");
            } else {
                next_primary_probe = Instant::now() + probe_interval;
            }
        }
        let provider = if using_secondary {
            secondary.as_deref().unwrap_or(&primary)
        } else {
            &primary
        };
        match check_prices(&pool, provider, chain_id, registry_addr, confirmations).await {
            Ok(wrote_checkpoint) => {
                failures = 0;
                if wrote_checkpoint {
                    info!(
                        provider = if using_secondary {
                            "secondary"
                        } else {
                            "primary"
                        },
                        "price worker checkpoint advanced"
                    );
                }
                tokio::time::sleep(poll_interval).await;
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                if let Err(db_error) =
                    record_worker_failure(&pool, chain_id, "prices", &error).await
                {
                    warn!(error = %db_error, "price failure recording failed");
                }
                warn!(provider = if using_secondary { "secondary" } else { "primary" }, failures, error = %error, "price worker failed");
                if !using_secondary && failures >= 3 && secondary.is_some() {
                    using_secondary = true;
                    failures = 0;
                    next_primary_probe = Instant::now() + probe_interval;
                    warn!("price worker switching to configured secondary RPC");
                }
                tokio::time::sleep(rpc_retry_delay(failures.max(1))).await;
            }
        }
    }
}
