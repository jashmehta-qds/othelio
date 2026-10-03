use ethers::types::Address;
use ethers::types::U256;
use sqlx::{Postgres, Transaction};
use tracing::info;

pub async fn index_lending_event(
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
