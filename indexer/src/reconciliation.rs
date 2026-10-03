use crate::abis::{SnapshotErc20, SnapshotMulticall3, Call3};
use crate::utils::MULTICALL3_ADDRESS;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, BlockId, BlockNumber, U64};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;

pub async fn run_reconciliation_tick(
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
