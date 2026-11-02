use crate::utils::{lease_duration_secs, lease_owner, BASE_FORK_CHAIN_ID};
use ethers::providers::{Http, Middleware, Provider};
use sqlx::PgPool;
use tracing::warn;

pub async fn resolve_start_block(pool: &PgPool, chain_id: i64, latest_block: u64) -> u64 {
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

pub async fn worker_last_success_block(
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

pub async fn record_observed_head(
    pool: &PgPool,
    chain_id: i64,
    block: u64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO indexer_worker_state (chain_id,worker_name,next_block,observed_head_block,observed_head_at)
         VALUES ($1,'events',COALESCE((SELECT next_block FROM indexer_state WHERE chain_id=$1),0),$2,NOW())
         ON CONFLICT (chain_id,worker_name) DO UPDATE SET observed_head_block=EXCLUDED.observed_head_block,observed_head_at=NOW()",
    )
    .bind(chain_id)
    .bind(block as i64)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn release_worker_lease(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<(), sqlx::Error> {
    let owner = lease_owner(worker);
    sqlx::query("UPDATE indexer_worker_state SET lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE chain_id=$1 AND worker_name=$2 AND lease_owner=$3")
        .bind(chain_id).bind(worker).bind(owner).execute(pool).await?;
    Ok(())
}

pub async fn renew_worker_lease(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<bool, sqlx::Error> {
    let owner = lease_owner(worker);
    let changed = sqlx::query("UPDATE indexer_worker_state SET lease_expires_at=NOW()+($4 * INTERVAL '1 second'), updated_at=NOW() WHERE chain_id=$1 AND worker_name=$2 AND lease_owner=$3 AND lease_expires_at > NOW()")
        .bind(chain_id).bind(worker).bind(owner).bind(lease_duration_secs()).execute(pool).await?.rows_affected();
    Ok(changed == 1)
}

pub async fn validate_or_rollback_checkpoint(
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
    crate::risksplit::rollback_risksplit_reorg(&mut tx, chain_id, ancestor).await?;
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

pub async fn record_worker_success(
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

pub async fn record_worker_failure(
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

pub async fn acquire_worker_lease(
    pool: &PgPool,
    chain_id: i64,
    worker: &str,
) -> Result<bool, sqlx::Error> {
    let owner = lease_owner(worker);
    let row: Option<(bool,)> = sqlx::query_as("INSERT INTO indexer_worker_state (chain_id,worker_name,lease_owner,lease_expires_at) VALUES ($1,$2,$3,NOW()+($4 * INTERVAL '1 second')) ON CONFLICT (chain_id,worker_name) DO UPDATE SET lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=NOW() WHERE indexer_worker_state.lease_expires_at IS NULL OR indexer_worker_state.lease_expires_at < NOW() OR indexer_worker_state.lease_owner=$3 RETURNING true")
        .bind(chain_id).bind(worker).bind(&owner).bind(lease_duration_secs()).fetch_optional(pool).await?;
    Ok(row.map(|_| true).unwrap_or(false))
}

pub async fn get_next_block(
    pool: &PgPool,
    chain_id: i64,
    default_start: u64,
) -> Result<u64, sqlx::Error> {
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

pub async fn update_next_block(
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
