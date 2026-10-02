use std::sync::Arc;
use std::time::Duration;
use dotenvy::dotenv;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, BlockId, BlockNumber, Filter, U64};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

const BASE_FORK_CHAIN_ID: i64 = 31337;
const BASE_MAINNET_CHAIN_ID: i64 = 8453;

fn is_supported_chain_id(chain_id: i64) -> bool {
    matches!(chain_id, BASE_FORK_CHAIN_ID | BASE_MAINNET_CHAIN_ID)
}

fn rpc_backoff_delay(failure_count: u32) -> Duration {
    let exponent = failure_count.saturating_sub(1).min(6);
    Duration::from_secs((1_u64 << exponent).min(60))
}

#[cfg(test)]
mod network_tests {
    use super::{is_supported_chain_id, rpc_backoff_delay, BASE_FORK_CHAIN_ID, BASE_MAINNET_CHAIN_ID};
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
        event AerodromeRouteExecuted(address indexed basket, address indexed tokenIn, address indexed tokenOut, uint8 kind, uint256 amountIn, uint256 amountOut, int24 firstTickSpacing, int24 secondTickSpacing)
        event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)
        event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)
        event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)
        event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)
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
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://othelio:othelio@localhost:5432/othelio".to_string());
    let rpc_url = std::env::var("RPC_URL").expect("RPC_URL must be configured");
    let chain_id: i64 = std::env::var("CHAIN_ID").unwrap_or_else(|_| BASE_MAINNET_CHAIN_ID.to_string()).parse()?;
    if !is_supported_chain_id(chain_id) {
        return Err(format!("Unsupported chain ID: {}. Expected 31337 or 8453.", chain_id).into());
    }
    let factory_addr_str = std::env::var("FACTORY_ADDRESS").unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let module_addr_str = std::env::var("MODULE_ADDRESS").unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let registry_addr_str = std::env::var("ASSET_REGISTRY_ADDRESS").unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
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

    let lending_pool_addrs: Vec<Address> = std::env::var("LENDING_POOL_ADDRESSES")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().parse())
        .collect::<Result<_, _>>()?;
    let batch_size: u64 = std::env::var("BATCH_SIZE").unwrap_or_else(|_| "2000".to_string()).parse()?;

    let factory_addr: Address = factory_addr_str.parse()?;
    let module_addr: Address = module_addr_str.parse()?;
    let registry_addr: Address = registry_addr_str.parse()?;
    let usdc_addr: Address = usdc_addr_str.parse()?;

    info!("🚀 [Rust Othelio Indexer] Initializing on Chain ID {} (Valuation Interval: {}s, Confirmations: {})...", chain_id, valuation_interval_secs, indexer_confirmations);

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await?;

    let provider = Provider::<Http>::try_from(rpc_url)?;
    let provider = Arc::new(provider);

    let observed_chain_id = provider.get_chainid().await?.as_u64();
    if observed_chain_id != chain_id as u64 {
        return Err(format!(
            "RPC chain mismatch: configured {}, observed {}",
            chain_id, observed_chain_id
        )
        .into());
    }

    let latest_block = provider.get_block_number().await.map(|b| b.as_u64()).unwrap_or(0);
    let default_start = resolve_start_block(&pool, chain_id, latest_block).await;

    info!("📌 [Rust Indexer] Start block configured as: {}", default_start);

    let mut current_block = get_next_block(&pool, chain_id, default_start).await?;
    let mut last_valuation_run: Option<std::time::Instant> = None;
    let mut rpc_failure_count = 0_u32;

    loop {
        match provider.get_block_number().await {
            Ok(latest_block) => {
                rpc_failure_count = 0;
                let latest_block = latest_block.as_u64();

                if chain_id == BASE_MAINNET_CHAIN_ID && latest_block > current_block + 50000 {
                    let target_block = latest_block.saturating_sub(100);
                    info!("[Rust Indexer] Fast-forwarding indexer from block {} to latest block {}...", current_block, target_block);
                    current_block = target_block;
                    let _ = update_next_block(&pool, chain_id, current_block).await;
                }

                if current_block <= latest_block {
                    let to_block = (current_block + batch_size).min(latest_block);
                    info!("[Rust Indexer] Scanning blocks {} -> {}", current_block, to_block);

                    match process_block_range(&pool, &provider, chain_id, factory_addr, module_addr, registry_addr, usdc_addr, &lending_pool_addrs, current_block, to_block).await {
                        Ok(()) => {
                            rpc_failure_count = 0;
                            update_next_block(&pool, chain_id, to_block + 1).await?;
                            current_block = to_block + 1;
                        }
                        Err(e) => {
                            rpc_failure_count = rpc_failure_count.saturating_add(1);
                            let backoff = rpc_backoff_delay(rpc_failure_count);
                            warn!(
                                failure_count = rpc_failure_count,
                                retry_in_secs = backoff.as_secs(),
                                error = ?e,
                                "[RPC Error] Block range failed; keeping indexer alive and retrying"
                            );
                            tokio::time::sleep(backoff).await;
                        }
                    }
                } else {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }

                // Monotonic hourly valuation tick scheduler
                if valuation_interval_secs > 0 {
                    let should_run = match last_valuation_run {
                        None => true,
                        Some(last) => last.elapsed() >= Duration::from_secs(valuation_interval_secs),
                    };
                    let valuation_block = latest_block.saturating_sub(indexer_confirmations);
                    // A valuation must use a confirmed block that normal event indexing has
                    // already processed. Otherwise it could value stale position state.
                    if should_run && valuation_block > 0 && current_block > valuation_block {
                        match run_hourly_valuation_tick(&pool, &provider, registry_addr, chain_id, valuation_block).await {
                            Ok(_) => {
                                last_valuation_run = Some(std::time::Instant::now());
                            }
                            Err(e) => {
                                error!("[Hourly Valuation Error] Tick failed: {:?}", e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                rpc_failure_count = rpc_failure_count.saturating_add(1);
                let backoff = rpc_backoff_delay(rpc_failure_count);
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

    let min_created: Option<(Option<i64>,)> = sqlx::query_as("SELECT MIN(created_block) FROM baskets WHERE chain_id = $1")
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

async fn get_next_block(pool: &PgPool, chain_id: i64, default_start: u64) -> Result<u64, sqlx::Error> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT next_block FROM indexer_state WHERE chain_id = $1")
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

async fn update_next_block(pool: &PgPool, chain_id: i64, next_block: u64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE indexer_state SET next_block = $1, updated_at = NOW() WHERE chain_id = $2")
        .bind(next_block as i64)
        .bind(chain_id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn process_block_range(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    factory_addr: Address,
    module_addr: Address,
    registry_addr: Address,
    usdc_addr: Address,
    lending_pool_addrs: &[Address],
    from_block: u64,
    to_block: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut addresses = Vec::new();
    if factory_addr != Address::zero() {
        addresses.push(factory_addr);
    }
    if module_addr != Address::zero() {
        addresses.push(module_addr);
    }
    for addr in lending_pool_addrs {
        if *addr != Address::zero() {
            addresses.push(*addr);
        }
    }

    let filter = if addresses.is_empty() {
        Filter::new().from_block(from_block).to_block(to_block)
    } else {
        Filter::new().address(addresses).from_block(from_block).to_block(to_block)
    };

    let logs = provider.get_logs(&filter).await?;

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
                    .execute(pool)
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
                    .execute(pool)
                    .await?;

                    let _ = write_event_valuation_checkpoint(pool, provider, registry_addr, chain_id, e.safe, block_number, &block_hash).await?;
                    reconcile_accounting_for_basket(pool, chain_id, &safe).await?;

                    info!("[Rust Indexer] Indexed BasketCreated: safe={} owner={}", safe, owner);
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
                    .execute(pool)
                    .await?;

                    let first_funding: bool = sqlx::query_scalar(
                        "SELECT NOT EXISTS (SELECT 1 FROM basket_events WHERE chain_id=$1 AND basket_address=$2 AND event_type='FUNDED' AND (block_number < $3 OR (block_number=$3 AND log_index < $4)))",
                    )
                    .bind(chain_id).bind(&safe).bind(block_number as i64).bind(log_index)
                    .fetch_one(pool).await?;
                    if let Some(weights) = write_event_valuation_checkpoint(pool, provider, registry_addr, chain_id, e.safe, block_number, &block_hash).await? {
                        if first_funding {
                            save_indexed_target_weights(pool, chain_id, &safe, block_number, &tx_hash, log_index, &weights).await?;
                        }
                    }
                    reconcile_accounting_for_basket(pool, chain_id, &safe).await?;

                    info!("[Rust Indexer] Indexed BasketFunded: safe={} funder={}", safe, funder);
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
                    .execute(pool)
                    .await?;

                    if let Some(weights) = write_event_valuation_checkpoint(pool, provider, registry_addr, chain_id, e.safe, block_number, &block_hash).await? {
                        save_indexed_target_weights(pool, chain_id, &safe, block_number, &tx_hash, log_index, &weights).await?;
                    }
                    reconcile_accounting_for_basket(pool, chain_id, &safe).await?;

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
                    .execute(pool)
                    .await?;

                    project_withdrawal_accounting(
                        pool, provider, chain_id, &tx_hash, log_index, block_number, &block_hash, &safe,
                        &e.withdrawn_assets, &e.withdrawn_amounts, usdc_addr,
                    ).await?;

                    let _ = write_event_valuation_checkpoint(pool, provider, registry_addr, chain_id, e.safe, block_number, &block_hash).await?;
                    reconcile_accounting_for_basket(pool, chain_id, &safe).await?;

                    info!("[Rust Indexer] Indexed BasketWithdrawn: safe={}", safe);
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
                        match route_execution_valuation(provider, registry_addr, chain_id, e.token_in, e.amount_in, e.token_out, e.amount_out, block_number).await {
                            Ok(valuation) => payload_object.extend(valuation),
                            Err(issue) => {
                                payload_object.insert("referenceValuationStatus".to_string(), json!("UNAVAILABLE"));
                                payload_object.insert("referenceValuationIssue".to_string(), json!(issue));
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
                    .execute(pool)
                    .await?;

                    project_route_accounting(
                        pool, provider, registry_addr, chain_id, usdc_addr, &tx_hash, log_index,
                        block_number, &block_hash, &basket, e.token_in, e.amount_in, e.token_out, e.amount_out,
                    ).await?;

                    info!("[Rust Indexer] Indexed AerodromeRouteExecuted: basket={} tokenIn={} tokenOut={}", basket, token_in, token_out);
                }
                IOthelioEventsEvents::SupplyFilter(e) => {
                    index_lending_event(pool, chain_id, &tx_hash, &block_hash, block_number, log_index,
                        e.on_behalf_of, log.address, e.reserve, e.amount, "SUPPLY").await?;
                }
                IOthelioEventsEvents::BorrowFilter(e) => {
                    index_lending_event(pool, chain_id, &tx_hash, &block_hash, block_number, log_index,
                        e.on_behalf_of, log.address, e.reserve, e.amount, "BORROW").await?;
                }
                IOthelioEventsEvents::RepayFilter(e) => {
                    index_lending_event(pool, chain_id, &tx_hash, &block_hash, block_number, log_index,
                        e.user, log.address, e.reserve, e.amount, "REPAY").await?;
                }
                IOthelioEventsEvents::WithdrawFilter(e) => {
                    index_lending_event(pool, chain_id, &tx_hash, &block_hash, block_number, log_index,
                        e.user, log.address, e.reserve, e.amount, "WITHDRAW").await?;
                }
            }
        }
    }

    Ok(())
}

/// An event valuation checkpoint reads exact Safe balances and feeds at its event block.
/// It inserts a versioned position row into `basket_positions` for EVERY configured supported asset
/// (including zero balances), records canonical price observations in `asset_price_observations`,
/// and inserts a compact `EVENT` NAV observation into `basket_nav_observations`.
async fn write_event_valuation_checkpoint(
    pool: &PgPool,
    provider: &Provider<Http>,
    registry_addr: Address,
    chain_id: i64,
    safe: Address,
    block_number: u64,
    block_hash: &str,
) -> Result<Option<Vec<(String, u32)>>, Box<dyn std::error::Error>> {
    let safe_string = format!("{:#x}", safe).to_lowercase();
    let block_id = BlockId::Number(BlockNumber::Number(U64::from(block_number)));

    if registry_addr == Address::zero() {
        let issue = "ASSET_REGISTRY_ADDRESS is not configured".to_string();
        sqlx::query(
            "INSERT INTO basket_nav_observations (chain_id, basket_address, block_number, block_hash, block_timestamp, position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at)
             VALUES ($1, $2, $3, $4, NOW(), $3, $3, NULL, 'EVENT', 'UNAVAILABLE', $5, NOW())
             ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
               block_hash = EXCLUDED.block_hash, nav_usdc = NULL, valuation_status = 'UNAVAILABLE', issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
        )
        .bind(chain_id).bind(&safe_string).bind(block_number as i64).bind(block_hash).bind(&issue)
        .execute(pool).await?;
        return Ok(None);
    }

    let block = match provider.get_block(block_id).await {
        Ok(Some(b)) => b,
        _ => {
            let issue = format!("canonical block {} unavailable", block_number);
            sqlx::query(
                "INSERT INTO basket_nav_observations (chain_id, basket_address, block_number, block_hash, block_timestamp, position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at)
                 VALUES ($1, $2, $3, $4, NOW(), $3, $3, NULL, 'EVENT', 'UNAVAILABLE', $5, NOW())
                 ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
                   block_hash = EXCLUDED.block_hash, nav_usdc = NULL, valuation_status = 'UNAVAILABLE', issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
            )
            .bind(chain_id).bind(&safe_string).bind(block_number as i64).bind(block_hash).bind(&issue)
            .execute(pool).await?;
            return Ok(None);
        }
    };

    let block_secs = block.timestamp.as_u64() as i64;
    let block_timestamp = chrono::DateTime::from_timestamp(block_secs, 0).unwrap_or_else(chrono::Utc::now);

    let client = Arc::new(provider.clone());
    let registry = OthelioAssetRegistry::new(registry_addr, client.clone());
    let tokens = match registry.get_supported_tokens(U256::from(chain_id as u64)).block(block_id).call().await {
        Ok(t) => t,
        Err(e) => {
            let issue = format!("asset registry read failed: {}", e);
            sqlx::query(
                "INSERT INTO basket_nav_observations (chain_id, basket_address, block_number, block_hash, block_timestamp, position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at)
                 VALUES ($1, $2, $3, $4, $5, $3, $3, NULL, 'EVENT', 'UNAVAILABLE', $6, NOW())
                 ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
                   block_hash = EXCLUDED.block_hash, nav_usdc = NULL, valuation_status = 'UNAVAILABLE', issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
            )
            .bind(chain_id).bind(&safe_string).bind(block_number as i64).bind(block_hash).bind(block_timestamp).bind(&issue)
            .execute(pool).await?;
            return Ok(None);
        }
    };

    struct AssetCheckpoint {
        token_address: String,
        feed_address: String,
        balance: U256,
        decimals: u8,
        price_usd_e8: U256,
        value_micro: U256,
        feed_round_id: U256,
        feed_updated_at: chrono::DateTime<chrono::Utc>,
    }

    let mut checkpoints = Vec::new();
    let mut total_nav_micro = U256::zero();
    let mut read_failure_issue: Option<String> = None;

    for token in tokens {
        let token_addr_str = format!("{:#x}", token).to_lowercase();
        let (supported, price_feed, token_decimals, feed_decimals, _) = match registry
            .get_asset(U256::from(chain_id as u64), token)
            .block(block_id)
            .call()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                read_failure_issue = Some(format!("asset config read failed for {}: {}", token_addr_str, e));
                break;
            }
        };

        if !supported {
            continue;
        }

        let balance = match SnapshotErc20::new(token, client.clone())
            .balance_of(safe)
            .block(block_id)
            .call()
            .await
        {
            Ok(b) => b,
            Err(e) => {
                read_failure_issue = Some(format!("balance read failed for {}: {}", token_addr_str, e));
                break;
            }
        };

        if price_feed == Address::zero() {
            read_failure_issue = Some(format!("price feed missing for {}", token_addr_str));
            break;
        }

        let (round_id, answer, _, updated_at, answered_in_round) = match SnapshotAggregator::new(price_feed, client.clone())
            .latest_round_data()
            .block(block_id)
            .call()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                read_failure_issue = Some(format!("price read failed for {}: {}", token_addr_str, e));
                break;
            }
        };

        if answer.is_negative() || answer.is_zero() || round_id == 0 || answered_in_round < round_id {
            read_failure_issue = Some(format!("invalid price round for {}", token_addr_str));
            break;
        }
        if updated_at.is_zero() || updated_at > block.timestamp {
            read_failure_issue = Some(format!("invalid price timestamp for {}", token_addr_str));
            break;
        }

        let raw_price = answer.into_raw();
        let feed_scale = U256::exp10(feed_decimals as usize);
        let price_usd_e8 = raw_price * U256::exp10(8) / feed_scale;

        let token_scale = U256::exp10(token_decimals as usize);
        let value_micro = match balance
            .checked_mul(price_usd_e8)
            .and_then(|v| v.checked_mul(U256::from(1_000_000u64)))
            .map(|v| v / (token_scale * U256::exp10(8))) {
                Some(value) => value,
                None => {
                    read_failure_issue = Some(format!("valuation overflow for {}", token_addr_str));
                    break;
                }
            };

        total_nav_micro = match total_nav_micro.checked_add(value_micro) {
            Some(value) => value,
            None => {
                read_failure_issue = Some(format!("portfolio valuation overflow for {}", safe_string));
                break;
            }
        };

        let feed_updated_secs = updated_at.as_u64() as i64;
        let feed_updated_datetime = chrono::DateTime::from_timestamp(feed_updated_secs, 0).unwrap_or(block_timestamp);

        checkpoints.push(AssetCheckpoint {
            token_address: token_addr_str,
            feed_address: format!("{:#x}", price_feed).to_lowercase(),
            balance,
            decimals: token_decimals,
            price_usd_e8,
            value_micro,
            feed_round_id: U256::from(round_id),
            feed_updated_at: feed_updated_datetime,
        });
    }

    if let Some(issue) = read_failure_issue {
        sqlx::query(
            "INSERT INTO basket_nav_observations (chain_id, basket_address, block_number, block_hash, block_timestamp, position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at)
             VALUES ($1, $2, $3, $4, $5, $3, $3, NULL, 'EVENT', 'UNAVAILABLE', $6, NOW())
             ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
               block_hash = EXCLUDED.block_hash, nav_usdc = NULL, valuation_status = 'UNAVAILABLE', issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
        )
        .bind(chain_id).bind(&safe_string).bind(block_number as i64).bind(block_hash).bind(block_timestamp).bind(&issue)
        .execute(pool).await?;
        warn!("[Rust Indexer] Event checkpoint UNAVAILABLE for basket={}: {}", safe_string, issue);
        return Ok(None);
    }

    let mut tx = pool.begin().await?;

    for cp in &checkpoints {
        // 1. basket_positions
        sqlx::query(
            "INSERT INTO basket_positions (chain_id, basket_address, asset_address, block_number, block_hash, block_timestamp, quantity_base_units, decimals, source, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, 'EVENT', NOW())
             ON CONFLICT (chain_id, basket_address, asset_address, block_number) DO UPDATE SET
               block_hash = EXCLUDED.block_hash, block_timestamp = EXCLUDED.block_timestamp, quantity_base_units = EXCLUDED.quantity_base_units, decimals = EXCLUDED.decimals, source = EXCLUDED.source, observed_at = EXCLUDED.observed_at"
        )
        .bind(chain_id)
        .bind(&safe_string)
        .bind(&cp.token_address)
        .bind(block_number as i64)
        .bind(block_hash)
        .bind(block_timestamp)
        .bind(cp.balance.to_string())
        .bind(cp.decimals as i16)
        .execute(&mut *tx).await?;

        // 2. asset_price_observations
        sqlx::query(
            "INSERT INTO asset_price_observations (chain_id, asset_address, feed_address, block_number, block_hash, block_timestamp, feed_round_id, price_usd_e8, feed_updated_at, observed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, NOW())
             ON CONFLICT (chain_id, asset_address, block_number) DO NOTHING"
        )
        .bind(chain_id)
        .bind(&cp.token_address)
        .bind(&cp.feed_address)
        .bind(block_number as i64)
        .bind(block_hash)
        .bind(block_timestamp)
        .bind(cp.feed_round_id.to_string())
        .bind(cp.price_usd_e8.to_string())
        .bind(cp.feed_updated_at)
        .execute(&mut *tx).await?;
    }

    // 3. basket_nav_observations
    let nav_str = nav_micro_to_numeric_string(total_nav_micro);

    sqlx::query(
        "INSERT INTO basket_nav_observations (chain_id, basket_address, block_number, block_hash, block_timestamp, position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at)
         VALUES ($1, $2, $3, $4, $5, $3, $3, $6::numeric, 'EVENT', 'COMPLETE', NULL, NOW())
         ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
           block_hash = EXCLUDED.block_hash, block_timestamp = EXCLUDED.block_timestamp, position_block_number = EXCLUDED.position_block_number, price_block_number = EXCLUDED.price_block_number, nav_usdc = EXCLUDED.nav_usdc, valuation_status = EXCLUDED.valuation_status, issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
    )
    .bind(chain_id)
    .bind(&safe_string)
    .bind(block_number as i64)
    .bind(block_hash)
    .bind(block_timestamp)
    .bind(&nav_str)
    .execute(&mut *tx).await?;

    tx.commit().await?;

    // A target is the measured allocation at the creation/funding/rebalance
    // checkpoint. The event itself carries trade amounts, not target weights.
    let measured_weights = if total_nav_micro.is_zero() {
        None
    } else {
        let mut weights = Vec::new();
        let mut allocated_bps = 0u32;
        for cp in checkpoints.iter().filter(|cp| !cp.value_micro.is_zero()) {
            let scaled = cp.value_micro.checked_mul(U256::from(10_000u64))
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "allocation weight overflow"))?;
            let bps = (scaled / total_nav_micro).as_u32();
            allocated_bps += bps;
            weights.push((cp.token_address.clone(), bps, cp.value_micro));
        }
        if let Some(largest) = weights.iter_mut().max_by_key(|entry| entry.2) {
            largest.1 += 10_000 - allocated_bps;
        }
        Some(weights.into_iter().map(|(address, bps, _)| (address, bps)).collect())
    };

    info!("[Rust Indexer] Event checkpoint recorded: basket={} block={} nav_usdc={}", safe_string, block_number, nav_str);

    Ok(measured_weights)
}

async fn save_indexed_target_weights(
    pool: &PgPool,
    chain_id: i64,
    basket_address: &str,
    block_number: u64,
    tx_hash: &str,
    log_index: i32,
    weights: &[(String, u32)],
) -> Result<(), Box<dyn std::error::Error>> {
    if weights.is_empty() { return Ok(()); }

    let mut tx = pool.begin().await?;
    let latest_block: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(updated_block) FROM basket_assets WHERE chain_id=$1 AND basket_address=$2",
    )
    .bind(chain_id).bind(basket_address)
    .fetch_one(&mut *tx).await?;

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
            .execute(&mut *tx).await?;
        }
        sqlx::query(
            "DELETE FROM basket_assets WHERE chain_id=$1 AND basket_address=$2 AND NOT (asset_address = ANY($3::text[]))",
        )
        .bind(chain_id).bind(basket_address).bind(&addresses)
        .execute(&mut *tx).await?;
    }

    let target_payload = json!(weights.iter().map(|(asset_address, weight_bps)| json!({
        "assetAddress": asset_address,
        "weightBps": weight_bps,
    })).collect::<Vec<_>>()).to_string();
    sqlx::query(
        "UPDATE basket_events SET payload=jsonb_set(payload, '{targetWeights}', $5::jsonb, true)
         WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3 AND basket_address=$4",
    )
    .bind(chain_id).bind(tx_hash).bind(log_index).bind(basket_address)
    .bind(target_payload)
    .execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
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
) -> Result<(), Box<dyn std::error::Error>> {
    if registry_addr == Address::zero() || latest_block == 0 {
        return Ok(());
    }

    // PostgreSQL advisory locks are session-scoped. Keep this dedicated
    // connection until the matching unlock rather than issuing both calls
    // through the pool, where they may land on different sessions.
    let mut lock_connection = pool.acquire().await?;
    let lock_row: (bool,) = sqlx::query_as("SELECT pg_try_advisory_lock($1)")
        .bind(chain_id)
        .fetch_one(&mut *lock_connection)
        .await?;

    match lock_row {
        (true,) => {},
        _ => {
            info!("[Hourly Valuation] Advisory lock for chain_id {} unavailable; skipping tick", chain_id);
            return Ok(());
        }
    }

    let res = async {
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

        let client = Arc::new(provider.clone());
        let registry = OthelioAssetRegistry::new(registry_addr, client.clone());
        let tokens = registry
            .get_supported_tokens(U256::from(chain_id as u64))
            .block(block_id)
            .call()
            .await
            .map_err(|e| format!("supported tokens read failed: {}", e))?;

        let mut feeds_succeeded = 0;
        let mut failed_assets = Vec::new();

        for token in tokens {
            let token_addr_str = format!("{:#x}", token).to_lowercase();
            let (supported, price_feed, _, feed_decimals, _) = match registry
                .get_asset(U256::from(chain_id as u64), token)
                .block(block_id)
                .call()
                .await
            {
                Ok(res) => res,
                Err(e) => {
                    failed_assets.push((token_addr_str, format!("get_asset error: {}", e)));
                    continue;
                }
            };

            if !supported || price_feed == Address::zero() {
                continue;
            }

            let (round_id, answer, _, updated_at, answered_in_round) = match SnapshotAggregator::new(price_feed, client.clone())
                .latest_round_data()
                .block(block_id)
                .call()
                .await
            {
                Ok(res) => res,
                Err(e) => {
                    failed_assets.push((token_addr_str, format!("round data error: {}", e)));
                    continue;
                }
            };

            if answer.is_negative() || answer.is_zero() || round_id == 0 || answered_in_round < round_id || updated_at.is_zero() || updated_at > block.timestamp {
                failed_assets.push((token_addr_str, "invalid round data".to_string()));
                continue;
            }

            let raw_price = answer.into_raw();
            let feed_scale = U256::exp10(feed_decimals as usize);
            let price_usd_e8 = raw_price * U256::exp10(8) / feed_scale;
            let feed_updated_secs = updated_at.as_u64() as i64;
            let feed_updated_datetime = chrono::DateTime::from_timestamp(feed_updated_secs, 0).unwrap_or(block_timestamp);

            sqlx::query(
                "INSERT INTO asset_price_observations (chain_id, asset_address, feed_address, block_number, block_hash, block_timestamp, feed_round_id, price_usd_e8, feed_updated_at, observed_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9, NOW())
                 ON CONFLICT (chain_id, asset_address, block_number) DO NOTHING"
            )
            .bind(chain_id)
            .bind(&token_addr_str)
            .bind(&format!("{:#x}", price_feed).to_lowercase())
            .bind(price_block_number as i64)
            .bind(&block_hash)
            .bind(block_timestamp)
            .bind(round_id.to_string())
            .bind(price_usd_e8.to_string())
            .bind(feed_updated_datetime)
            .execute(pool)
            .await
            .map_err(|e| format!("price observation write failed: {}", e))?;

            feeds_succeeded += 1;
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
               ROUND(
                 SUM(
                   (p.quantity_base_units * apo.price_usd_e8 * 1000000.0) /
                   (POWER(10::numeric, p.decimals) * 100000000.0)
                 ) / 1000000.0,
                 6
               ) AS nav_usdc,
               'HOURLY' AS kind,
               'COMPLETE' AS valuation_status,
               NULL::text AS issue,
               NOW() AS observed_at
             FROM (
               SELECT DISTINCT ON (chain_id, basket_address, asset_address)
                 chain_id, basket_address, asset_address, block_number, quantity_base_units, decimals
               FROM basket_positions
               WHERE chain_id = $1
               ORDER BY chain_id, basket_address, asset_address, block_number DESC
             ) p
             LEFT JOIN asset_price_observations apo
               ON apo.chain_id = p.chain_id
              AND apo.asset_address = p.asset_address
              AND apo.block_number = $2
             WHERE p.quantity_base_units > 0
             GROUP BY p.chain_id, p.basket_address
             HAVING COUNT(*) FILTER (WHERE apo.asset_address IS NULL) = 0
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
        .execute(pool)
        .await
        .map_err(|e| format!("complete NAV write failed: {}", e))?;

        // A held asset without a valid price must make the whole basket
        // unavailable. A partial sum is worse than no displayed valuation.
        sqlx::query(
            "INSERT INTO basket_nav_observations (
               chain_id, basket_address, block_number, block_hash, block_timestamp,
               position_block_number, price_block_number, nav_usdc, kind, valuation_status, issue, observed_at
             )
             SELECT
               p.chain_id, p.basket_address, $2::bigint, $3::text, $4::timestamptz,
               MAX(p.block_number), $2::bigint, NULL, 'HOURLY', 'UNAVAILABLE',
               'MISSING_OR_INVALID_PRICE_AT_BLOCK', NOW()
             FROM (
               SELECT DISTINCT ON (chain_id, basket_address, asset_address)
                 chain_id, basket_address, asset_address, block_number, quantity_base_units
               FROM basket_positions
               WHERE chain_id = $1
               ORDER BY chain_id, basket_address, asset_address, block_number DESC
             ) p
             LEFT JOIN asset_price_observations apo
               ON apo.chain_id = p.chain_id
              AND apo.asset_address = p.asset_address
              AND apo.block_number = $2
             WHERE p.quantity_base_units > 0
             GROUP BY p.chain_id, p.basket_address
             HAVING COUNT(*) FILTER (WHERE apo.asset_address IS NULL) > 0
             ON CONFLICT (chain_id, basket_address, block_number, kind) DO UPDATE SET
               valuation_status = 'UNAVAILABLE', nav_usdc = NULL, issue = EXCLUDED.issue, observed_at = EXCLUDED.observed_at"
        )
        .bind(chain_id)
        .bind(price_block_number as i64)
        .bind(&block_hash)
        .bind(block_timestamp)
        .execute(pool)
        .await
        .map_err(|e| format!("unavailable NAV write failed: {}", e))?;

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
                     chain_id, basket_address, asset_address, block_number, quantity_base_units
                   FROM basket_positions
                   WHERE chain_id = $1
                   ORDER BY chain_id, basket_address, asset_address, block_number DESC
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
            .execute(pool)
            .await
            .map_err(|e| format!("unavailable asset NAV write failed: {}", e))?;
        }

        info!(
            "⏰ [Hourly Valuation Tick] Block {} evaluated: feeds_succeeded={}, nav_rows_written={}",
            price_block_number, feeds_succeeded, updated_rows.rows_affected()
        );

        Ok::<(), String>(())
    }.await;

    // Always release PostgreSQL advisory lock
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(chain_id)
        .execute(&mut *lock_connection)
        .await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(e.into()),
    }
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
    pool: &PgPool,
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
    if amount_in.is_zero() || amount_out.is_zero() || token_in == token_out || registry_addr == Address::zero() {
        return mark_route_incomplete(pool, chain_id, tx_hash, log_index, block_number, block_hash, basket, token_in, amount_in, token_out, amount_out, usdc, "invalid route receipt").await;
    }
    let block_id = BlockId::Number(BlockNumber::Number(U64::from(block_number)));
    let block = provider.get_block(block_id).await?.ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "route block unavailable"))?;
    let occurred_at = chrono::DateTime::from_timestamp(block.timestamp.as_u64() as i64, 0).unwrap_or_else(chrono::Utc::now);
    let client = Arc::new(provider.clone());
    let registry = OthelioAssetRegistry::new(registry_addr, client.clone());
    let (_, _, input_decimals, _, _) = registry.get_asset(U256::from(chain_id as u64), token_in).block(block_id).call().await?;
    let (_, _, output_decimals, _, _) = registry.get_asset(U256::from(chain_id as u64), token_out).block(block_id).call().await?;
    let mut mutations = Vec::new();
    if token_in != usdc {
        mutations.push(AccountingMutation { kind: "REDUCTION", asset: format!("{:#x}", token_in).to_lowercase(), quantity: amount_in, decimals: input_decimals, acquisition_basis_micro: None, valuation_source: "NONE" });
    }
    if token_out != usdc {
        let (basis, source) = if token_in == usdc {
            (amount_in, "USDC_RECEIPT")
        } else {
            (route_oracle_value_micro(&registry, client, chain_id, token_out, amount_out, block_id)
                .await
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?, "ORACLE_AT_EXECUTION")
        };
        mutations.push(AccountingMutation { kind: "ACQUISITION", asset: format!("{:#x}", token_out).to_lowercase(), quantity: amount_out, decimals: output_decimals, acquisition_basis_micro: Some(basis), valuation_source: source });
    }
    apply_accounting_mutations(pool, chain_id, tx_hash, log_index, block_number, block_hash, occurred_at, basket, mutations).await
}

async fn project_withdrawal_accounting(
    pool: &PgPool,
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
    let block = provider.get_block(block_id).await?.ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "withdrawal block unavailable"))?;
    let occurred_at = chrono::DateTime::from_timestamp(block.timestamp.as_u64() as i64, 0).unwrap_or_else(chrono::Utc::now);
    let mut mutations = Vec::new();
    for (asset, amount) in assets.iter().zip(amounts) {
        if *asset == usdc || amount.is_zero() { continue; }
        // The existing state is the source for token decimals; zero is only a
        // placeholder here and is replaced before application.
        mutations.push(AccountingMutation { kind: "TRANSFER_OUT", asset: format!("{:#x}", asset).to_lowercase(), quantity: *amount, decimals: 0, acquisition_basis_micro: None, valuation_source: "NONE" });
    }
    apply_accounting_mutations(pool, chain_id, tx_hash, log_index, block_number, block_hash, occurred_at, basket, mutations).await
}

async fn apply_accounting_mutations(
    pool: &PgPool,
    chain_id: i64,
    tx_hash: &str,
    log_index: i32,
    block_number: u64,
    block_hash: &str,
    occurred_at: chrono::DateTime<chrono::Utc>,
    basket: &str,
    mut mutations: Vec<AccountingMutation>,
) -> Result<(), Box<dyn std::error::Error>> {
    if mutations.is_empty() { return Ok(()); }
    let mut tx = pool.begin().await?;
    let exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM accounting_events WHERE chain_id=$1 AND tx_hash=$2 AND log_index=$3 LIMIT 1")
        .bind(chain_id).bind(tx_hash).bind(log_index).fetch_optional(&mut *tx).await?;
    if exists.is_some() { tx.commit().await?; return Ok(()); }

    let mut applied: Vec<(AccountingMutation, U256, String)> = Vec::new();
    let mut issue: Option<String> = None;
    for mutation in mutations.iter_mut() {
        let row: Option<(String, String, String, i16)> = sqlx::query_as(
            "SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status, decimals FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3 FOR UPDATE"
        ).bind(chain_id).bind(basket).bind(&mutation.asset).fetch_optional(&mut *tx).await?;
        if mutation.kind == "ACQUISITION" {
            let delta = mutation.acquisition_basis_micro.ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "acquisition missing basis"))?;
            applied.push((mutation.clone(), delta, String::new()));
            continue;
        }
        let Some((quantity, basis, status, decimals)) = row else {
            issue = Some(format!("missing prior accounting basis for {}", mutation.asset)); break;
        };
        if status != "COMPLETE" { issue = Some(format!("prior accounting state incomplete for {}", mutation.asset)); break; }
        let quantity = U256::from_dec_str(&quantity)?;
        let basis = U256::from_dec_str(&basis)?;
        if quantity.is_zero() || mutation.quantity > quantity { issue = Some(format!("reduction exceeds open quantity for {}", mutation.asset)); break; }
        mutation.decimals = decimals as u8;
        let basis_removed = basis.checked_mul(mutation.quantity).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "basis multiplication overflow"))? / quantity;
        applied.push((mutation.clone(), basis_removed, String::new()));
    }
    if let Some(issue) = issue {
        tx.rollback().await?;
        return record_incomplete_mutations(pool, chain_id, tx_hash, log_index, block_number, block_hash, occurred_at, basket, mutations, &issue).await;
    }
    for (mutation, basis, _) in applied {
        let (basis_delta, next_quantity, next_basis) = if mutation.kind == "ACQUISITION" {
            let current: Option<(String, String, String)> = sqlx::query_as("SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3 FOR UPDATE")
                .bind(chain_id).bind(basket).bind(&mutation.asset).fetch_optional(&mut *tx).await?;
            match current {
                Some((quantity, open_basis, status)) if status == "COMPLETE" => (
                    basis.to_string(), U256::from_dec_str(&quantity)?.checked_add(mutation.quantity).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "quantity overflow"))?, U256::from_dec_str(&open_basis)?.checked_add(basis).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "basis overflow"))?
                ),
                Some(_) => { tx.rollback().await?; return record_incomplete_mutations(pool, chain_id, tx_hash, log_index, block_number, block_hash, occurred_at, basket, mutations, "prior accounting state incomplete").await; },
                None => (basis.to_string(), mutation.quantity, basis),
            }
        } else {
            let (quantity, open_basis, _): (String, String, String) = sqlx::query_as("SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3 FOR UPDATE")
                .bind(chain_id).bind(basket).bind(&mutation.asset).fetch_one(&mut *tx).await?;
            let next_quantity = U256::from_dec_str(&quantity)? - mutation.quantity;
            let next_basis = U256::from_dec_str(&open_basis)? - basis;
            (format!("-{}", basis), next_quantity, next_basis)
        };
        let event_id: (String,) = sqlx::query_as(
            "INSERT INTO accounting_events (chain_id,basket_address,tx_hash,log_index,block_number,block_hash,occurred_at,kind,asset_address,quantity_base_units,decimals,basis_delta_usdc_micro,valuation_source,status,issue)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11,$12::numeric,$13,'COMPLETE',NULL) RETURNING id::text"
        ).bind(chain_id).bind(basket).bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).bind(occurred_at)
         .bind(mutation.kind).bind(&mutation.asset).bind(mutation.quantity.to_string()).bind(mutation.decimals as i16).bind(&basis_delta).bind(mutation.valuation_source)
         .fetch_one(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO asset_cost_basis (chain_id,basket_address,asset_address,quantity_base_units,decimals,open_basis_usdc_micro,accounting_status,issue,last_event_id,updated_at)
             VALUES ($1,$2,$3,$4::numeric,$5,$6::numeric,'COMPLETE',NULL,$7::uuid,NOW())
             ON CONFLICT (chain_id,basket_address,asset_address) DO UPDATE SET quantity_base_units=EXCLUDED.quantity_base_units, decimals=EXCLUDED.decimals, open_basis_usdc_micro=EXCLUDED.open_basis_usdc_micro, accounting_status='COMPLETE', issue=NULL, last_event_id=EXCLUDED.last_event_id, updated_at=NOW()"
        ).bind(chain_id).bind(basket).bind(&mutation.asset).bind(next_quantity.to_string()).bind(mutation.decimals as i16).bind(next_basis.to_string()).bind(event_id.0)
         .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn record_incomplete_mutations(pool: &PgPool, chain_id: i64, tx_hash: &str, log_index: i32, block_number: u64, block_hash: &str, occurred_at: chrono::DateTime<chrono::Utc>, basket: &str, mutations: Vec<AccountingMutation>, issue: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut tx = pool.begin().await?;
    for mutation in mutations {
        sqlx::query("INSERT INTO accounting_events (chain_id,basket_address,tx_hash,log_index,block_number,block_hash,occurred_at,kind,asset_address,quantity_base_units,decimals,basis_delta_usdc_micro,valuation_source,status,issue) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,$11,0,$12,'INCOMPLETE',$13) ON CONFLICT DO NOTHING")
            .bind(chain_id).bind(basket).bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).bind(occurred_at).bind(mutation.kind).bind(&mutation.asset).bind(mutation.quantity.to_string()).bind(mutation.decimals as i16).bind(mutation.valuation_source).bind(issue).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO asset_cost_basis (chain_id,basket_address,asset_address,quantity_base_units,decimals,open_basis_usdc_micro,accounting_status,issue,updated_at) VALUES ($1,$2,$3,0,$4,0,'INCOMPLETE',$5,NOW()) ON CONFLICT (chain_id,basket_address,asset_address) DO UPDATE SET accounting_status='INCOMPLETE', issue=EXCLUDED.issue, updated_at=NOW()")
            .bind(chain_id).bind(basket).bind(&mutation.asset).bind(mutation.decimals as i16).bind(issue).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn mark_route_incomplete(pool: &PgPool, chain_id: i64, tx_hash: &str, log_index: i32, block_number: u64, block_hash: &str, basket: &str, token_in: Address, amount_in: U256, token_out: Address, amount_out: U256, usdc: Address, issue: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut mutations = Vec::new();
    if token_in != usdc { mutations.push(AccountingMutation { kind: "REDUCTION", asset: format!("{:#x}", token_in).to_lowercase(), quantity: amount_in, decimals: 0, acquisition_basis_micro: None, valuation_source: "NONE" }); }
    if token_out != usdc { mutations.push(AccountingMutation { kind: "ACQUISITION", asset: format!("{:#x}", token_out).to_lowercase(), quantity: amount_out, decimals: 0, acquisition_basis_micro: None, valuation_source: "NONE" }); }
    record_incomplete_mutations(pool, chain_id, tx_hash, log_index, block_number, block_hash, chrono::Utc::now(), basket, mutations, issue).await
}

async fn reconcile_accounting_for_basket(pool: &PgPool, chain_id: i64, basket: &str) -> Result<(), sqlx::Error> {
    // A replayed receipt is trustworthy only if its derived open quantity equals
    // the latest exact checkpointed Safe balance. Unknown positive holdings are
    // inserted as INCOMPLETE instead of displaying a made-up zero basis.
    sqlx::query(
        "WITH latest_positions AS (
           SELECT DISTINCT ON (asset_address) asset_address, quantity_base_units, decimals
           FROM basket_positions WHERE chain_id=$1 AND basket_address=$2
           ORDER BY asset_address, block_number DESC
         )
         INSERT INTO asset_cost_basis (chain_id,basket_address,asset_address,quantity_base_units,decimals,open_basis_usdc_micro,accounting_status,issue,updated_at)
         SELECT $1,$2,lp.asset_address,0,lp.decimals,0,'INCOMPLETE','missing receipt-derived acquisition basis',NOW()
         FROM latest_positions lp LEFT JOIN asset_cost_basis acb ON acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=lp.asset_address
         WHERE lp.quantity_base_units > 0 AND acb.asset_address IS NULL
         ON CONFLICT (chain_id,basket_address,asset_address) DO NOTHING"
    ).bind(chain_id).bind(basket).execute(pool).await?;
    sqlx::query(
        "WITH latest_positions AS (
           SELECT DISTINCT ON (asset_address) asset_address, quantity_base_units
           FROM basket_positions WHERE chain_id=$1 AND basket_address=$2
           ORDER BY asset_address, block_number DESC
         )
         UPDATE asset_cost_basis acb SET accounting_status='INCOMPLETE', issue='accounting quantity does not reconcile to latest indexed balance', updated_at=NOW()
         FROM latest_positions lp WHERE acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=lp.asset_address
           AND acb.accounting_status='COMPLETE' AND acb.quantity_base_units <> lp.quantity_base_units"
    ).bind(chain_id).bind(basket).execute(pool).await?;
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
    let (_, _, input_decimals, _, _) = registry.get_asset(U256::from(chain_id as u64), token_in)
        .block(block_id).call().await.map_err(|error| format!("input asset config failed: {error}"))?;
    let (_, _, output_decimals, _, _) = registry.get_asset(U256::from(chain_id as u64), token_out)
        .block(block_id).call().await.map_err(|error| format!("output asset config failed: {error}"))?;
    let input_value = route_oracle_value_micro(&registry, client.clone(), chain_id, token_in, amount_in, block_id).await?;
    let output_value = route_oracle_value_micro(&registry, client, chain_id, token_out, amount_out, block_id).await?;
    let execution_rate_e18 = amount_out
        .checked_mul(U256::exp10(input_decimals as usize))
        .and_then(|value| value.checked_mul(U256::exp10(18usize)))
        .ok_or_else(|| "execution-rate overflow".to_string())?
        / (amount_in * U256::exp10(output_decimals as usize));
    let input_usdc = nav_micro_to_numeric_string(input_value).parse::<f64>().unwrap_or(0.0);
    let output_usdc = nav_micro_to_numeric_string(output_value).parse::<f64>().unwrap_or(0.0);
    let mut values = serde_json::Map::new();
    values.insert("executionPriceTokenOutPerTokenIn".to_string(), json!(execution_rate_e18.to_string()));
    values.insert("executionPriceScale".to_string(), json!("1e18"));
    values.insert("inputOracleValueUsdc".to_string(), json!(input_usdc));
    values.insert("outputOracleValueUsdc".to_string(), json!(output_usdc));
    values.insert("executionCostUsdc".to_string(), json!(input_usdc - output_usdc));
    values.insert("referenceValuationStatus".to_string(), json!("COMPLETE"));
    Ok(values)
}

async fn route_oracle_value_micro(
    registry: &OthelioAssetRegistry<Provider<Http>>,
    client: Arc<Provider<Http>>,
    chain_id: i64,
    token: Address,
    amount: U256,
    block_id: BlockId,
) -> Result<U256, String> {
    let (supported, feed, token_decimals, feed_decimals, _) = registry.get_asset(U256::from(chain_id as u64), token)
        .block(block_id).call().await.map_err(|error| format!("asset config failed: {error}"))?;
    if !supported || feed == Address::zero() { return Err(format!("unsupported route asset {token:#x}")); }
    let (_, answer, _, _, _) = SnapshotAggregator::new(feed, client).latest_round_data()
        .block(block_id).call().await.map_err(|error| format!("route price failed: {error}"))?;
    if answer.is_negative() || answer.is_zero() { return Err(format!("invalid route price {token:#x}")); }
    let denominator = U256::exp10(token_decimals as usize) * U256::exp10(feed_decimals as usize);
    amount.checked_mul(answer.into_raw()).and_then(|value| value.checked_mul(U256::from(1_000_000u64)))
        .map(|value| value / denominator).ok_or_else(|| "route value overflow".to_string())
}

async fn index_lending_event(
    pool: &PgPool,
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
    .bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).execute(pool).await?;

    sqlx::query(
        "UPDATE lending_transaction_lifecycles SET status='CONFIRMED_SUCCESS', confirmed_action=$3,
           confirmed_asset_address=LOWER($4), confirmed_amount=$5, confirmed_market_address=LOWER($6),
           receipt_log_index=$7, receipt_block_number=$8, receipt_block_hash=$9,
           reason=NULL, settled_at=NOW(), updated_at=NOW()
         WHERE chain_id=$1 AND tx_hash=$2 AND basket_address=LOWER($10)
           AND requested_action=$3 AND requested_asset_address=LOWER($4) AND requested_market_address=LOWER($6)"
    )
    .bind(chain_id).bind(tx_hash).bind(action).bind(&asset).bind(&amount).bind(&market)
    .bind(log_index).bind(block_number as i64).bind(block_hash).bind(&basket).execute(pool).await?;
    info!("[Rust Indexer] Indexed lending {}: basket={} market={} amount={}", action, basket, market, amount);
    Ok(())
}
