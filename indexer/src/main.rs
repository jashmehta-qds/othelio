use std::sync::Arc;
use std::time::Duration;
use dotenvy::dotenv;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, Filter};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

// Event Signatures
// BasketCreated(address indexed safe, address indexed owner, string name, uint256 createdAt)
// BasketRebalanced(address indexed safe, address indexed controller, address[] soldAssets, uint256[] soldAmounts, address[] boughtAssets, uint256[] boughtAmounts, uint256 totalNAV)
// BasketWithdrawn(address indexed safe, address indexed owner, address outputAsset, uint256 navRedeemed, address[] withdrawnAssets, uint256[] withdrawnAmounts, uint256 remainingNAV)

abigen!(
    IOthelioEvents,
    r#"[
        event BasketCreated(address indexed safe, address indexed owner, string name, uint256 createdAt)
        event BasketFunded(address indexed safe, address indexed funder, address inputAsset, uint256 inputAmount, address[] acquiredAssets, uint256[] acquiredAmounts, uint256 totalNAVAfter)
        event BasketRebalanced(address indexed safe, address indexed controller, address[] soldAssets, uint256[] soldAmounts, address[] boughtAssets, uint256[] boughtAmounts, uint256 totalNAV)
        event BasketWithdrawn(address indexed safe, address indexed owner, address outputAsset, uint256 navRedeemed, address[] withdrawnAssets, uint256[] withdrawnAmounts, uint256 remainingNAV)
        event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)
        event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)
        event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)
        event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)
    ]"#
);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://othelio:othelio@localhost:5432/othelio".to_string());
    let rpc_url = std::env::var("RPC_URL").unwrap_or_else(|_| "https://mainnet.base.org".to_string());
    let chain_id: i64 = std::env::var("CHAIN_ID").unwrap_or_else(|_| "8453".to_string()).parse()?;
    let factory_addr_str = std::env::var("FACTORY_ADDRESS").unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let module_addr_str = std::env::var("MODULE_ADDRESS").unwrap_or_else(|_| "0x0000000000000000000000000000000000000000".to_string());
    let lending_pool_addrs: Vec<Address> = std::env::var("LENDING_POOL_ADDRESSES")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().parse())
        .collect::<Result<_, _>>()?;
    let batch_size: u64 = std::env::var("BATCH_SIZE").unwrap_or_else(|_| "2000".to_string()).parse()?;

    let factory_addr: Address = factory_addr_str.parse()?;
    let module_addr: Address = module_addr_str.parse()?;

    info!("🚀 [Rust Othelio Indexer] Initializing on Chain ID {}...", chain_id);

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
    let default_start = if latest_block > 5000 { latest_block - 1000 } else { 0 };

    let mut current_block = get_next_block(&pool, chain_id, default_start).await?;

    loop {
        match provider.get_block_number().await {
            Ok(latest_block) => {
                let latest_block = latest_block.as_u64();

                if latest_block > current_block + 50000 {
                    let target_block = latest_block.saturating_sub(100);
                    info!("[Rust Indexer] Fast-forwarding indexer from block {} to latest block {}...", current_block, target_block);
                    current_block = target_block;
                    let _ = update_next_block(&pool, chain_id, current_block).await;
                }

                if current_block <= latest_block {
                    let to_block = (current_block + batch_size).min(latest_block);
                    info!("[Rust Indexer] Scanning blocks {} -> {}", current_block, to_block);

                    process_block_range(&pool, &provider, chain_id, factory_addr, module_addr, &lending_pool_addrs, current_block, to_block).await?;
                    update_next_block(&pool, chain_id, to_block + 1).await?;
                    current_block = to_block + 1;
                } else {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            }
            Err(e) => {
                error!("[RPC Error] Failed to get latest block number: {:?}", e);
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        }
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
    lending_pool_addrs: &[Address],
    from_block: u64,
    to_block: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut addresses = vec![factory_addr, module_addr];
    addresses.extend_from_slice(lending_pool_addrs);
    let filter = Filter::new()
        .address(addresses)
        .from_block(from_block)
        .to_block(to_block);

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

                    info!("[Rust Indexer] Indexed BasketCreated: safe={} owner={}", safe, owner);
                }
                IOthelioEventsEvents::BasketFundedFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let funder = format!("{:#x}", e.funder);
                    let nav_usdc = (e.total_nav_after.as_u128() as f64) / 1_000_000.0;

                    let payload = json!({
                        "inputAsset": format!("{:#x}", e.input_asset),
                        "inputAmount": e.input_amount.to_string(),
                        "boughtAssets": e.acquired_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "boughtAmounts": e.acquired_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "totalNAV": e.total_nav_after.to_string(),
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

                    sqlx::query(
                        "INSERT INTO basket_snapshots (chain_id, basket_address, block_number, block_hash, total_nav_usdc, shares_outstanding, holdings, prices, priced_at)
                         VALUES ($1, LOWER($2), $3, $4, $5, 0, $6, '{}', NOW())
                         ON CONFLICT (chain_id, basket_address, block_number) DO UPDATE SET total_nav_usdc = EXCLUDED.total_nav_usdc"
                    )
                    .bind(chain_id)
                    .bind(&safe)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(nav_usdc)
                    .bind(&payload)
                    .execute(pool)
                    .await?;

                    info!("[Rust Indexer] Indexed BasketFunded: safe={} funder={} totalNAV=${:.2}", safe, funder, nav_usdc);
                }
                IOthelioEventsEvents::BasketRebalancedFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let controller = format!("{:#x}", e.controller);
                    let nav_usdc = (e.total_nav.as_u128() as f64) / 1_000_000.0;

                    let payload = json!({
                        "soldAssets": e.sold_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "soldAmounts": e.sold_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "boughtAssets": e.bought_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "boughtAmounts": e.bought_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "totalNAV": e.total_nav.to_string(),
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

                    sqlx::query(
                        "INSERT INTO basket_snapshots (chain_id, basket_address, block_number, block_hash, total_nav_usdc, shares_outstanding, holdings, prices, priced_at)
                         VALUES ($1, LOWER($2), $3, $4, $5, 0, $6, '{}', NOW())
                         ON CONFLICT (chain_id, basket_address, block_number) DO UPDATE SET total_nav_usdc = EXCLUDED.total_nav_usdc"
                    )
                    .bind(chain_id)
                    .bind(&safe)
                    .bind(block_number as i64)
                    .bind(&block_hash)
                    .bind(nav_usdc)
                    .bind(&payload)
                    .execute(pool)
                    .await?;

                    info!("[Rust Indexer] Indexed BasketRebalanced: safe={} totalNAV=${:.2}", safe, nav_usdc);
                }
                IOthelioEventsEvents::BasketWithdrawnFilter(e) => {
                    let safe = format!("{:#x}", e.safe);
                    let owner = format!("{:#x}", e.owner);
                    let remaining_nav_usdc = (e.remaining_nav.as_u128() as f64) / 1_000_000.0;

                    let payload = json!({
                        "navRedeemed": e.nav_redeemed.to_string(),
                        "withdrawnAssets": e.withdrawn_assets.iter().map(|a| format!("{:#x}", a)).collect::<Vec<_>>(),
                        "withdrawnAmounts": e.withdrawn_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "remainingNAV": e.remaining_nav.to_string(),
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

                    let refresh_marker = json!({
                        "readCompleteness": "UNAVAILABLE",
                        "issues": ["WITHDRAWAL_REQUIRES_POSITION_REFRESH"],
                    });
                    sqlx::query(
                        "INSERT INTO basket_snapshots (chain_id, basket_address, block_number, block_hash, total_nav_usdc, shares_outstanding, holdings, prices, priced_at)
                         VALUES ($1, LOWER($2), $3, $4, $5, 0, $6, '{}', NULL)
                         ON CONFLICT (chain_id, basket_address, block_number) DO UPDATE
                           SET total_nav_usdc=EXCLUDED.total_nav_usdc, holdings=EXCLUDED.holdings, priced_at=NULL"
                    )
                    .bind(chain_id).bind(&safe).bind(block_number as i64).bind(&block_hash)
                    .bind(remaining_nav_usdc).bind(&refresh_marker).execute(pool).await?;
                    sqlx::query(
                        "INSERT INTO basket_position_refresh_requests (chain_id, basket_address, block_number, reason)
                         VALUES ($1, LOWER($2), $3, 'WITHDRAWAL_CONFIRMED')
                         ON CONFLICT (chain_id, basket_address, block_number) DO NOTHING"
                    )
                    .bind(chain_id).bind(&safe).bind(block_number as i64).execute(pool).await?;

                    info!("[Rust Indexer] Indexed BasketWithdrawn: safe={} remainingNAV=${:.2}", safe, remaining_nav_usdc);
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
