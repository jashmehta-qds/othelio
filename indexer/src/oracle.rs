use crate::abis::{Call3, OthelioAssetRegistry, SnapshotAggregator, SnapshotMulticall3};
use crate::utils::{configured_u64, fmt_addr, nav_micro_to_numeric_string, MULTICALL3_ADDRESS};
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, BlockId, BlockNumber, U64};
use futures::future::join_all;
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tracing::info;

#[derive(Clone, Debug)]
pub struct FeedMetadata {
    pub token: Address,
    pub feed: Address,
    pub token_decimals: u8,
    pub feed_decimals: u8,
}

#[derive(Clone, Debug)]
pub struct RegistryCache {
    pub chain_id: i64,
    pub registry: Address,
    pub loaded_at: std::time::Instant,
    pub feeds: Vec<FeedMetadata>,
    pub token_fingerprint: u64,
}

static REGISTRY_CACHE: OnceLock<tokio::sync::RwLock<Option<RegistryCache>>> = OnceLock::new();

fn registry_cache() -> &'static tokio::sync::RwLock<Option<RegistryCache>> {
    REGISTRY_CACHE.get_or_init(|| tokio::sync::RwLock::new(None))
}

pub async fn cached_registry_metadata(
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
        let futures = chunk.iter().copied().map(|token| {
            let registry = registry.clone();
            async move {
                registry
                    .get_asset(U256::from(chain_id as u64), token)
                    .block(block_id)
                    .call()
                    .await
                    .map(|(supported, feed, token_decimals, feed_decimals, _)| {
                        (token, supported, feed, token_decimals, feed_decimals)
                    })
            }
        });
        let results = join_all(futures).await;
        for result in results {
            let (token, supported, feed, token_decimals, feed_decimals) = result?;
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
        let cache = registry_cache().read().await;
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
    let mut cache = registry_cache().write().await;
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

pub struct PriceRead {
    pub metadata: FeedMetadata,
    pub round_id: U256,
    pub price_usd_e8: U256,
    pub feed_updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn read_price_chunk(
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
                .map(|feed| (fmt_addr(&feed.token), "multicall request failed".to_string()))
                .collect(),
        );
    };
    // Match the deployed BasketOracle's seven-day hard ceiling. References
    // older than the UI freshness threshold remain usable and are surfaced as
    // warnings by the quote API; invalid rounds are still rejected here.
    let max_age = configured_u64("PRICE_MAX_SOURCE_AGE_SECS", 604_800);
    let mut good = Vec::new();
    let mut failed = Vec::new();
    for (metadata, res) in feeds.into_iter().zip(results.into_iter()) {
        let (success, data) = (res.0, res.1);
        let token_name = fmt_addr(&metadata.token);
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

pub async fn run_hourly_valuation_tick(
    pool: &PgPool,
    provider: &Provider<Http>,
    registry_addr: Address,
    chain_id: i64,
    latest_block: u64,
    owner: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if registry_addr == Address::zero() || latest_block == 0 {
        return Ok(());
    }

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
        let futures = feeds[offset..end].chunks(chunk_size).map(|chunk| {
            read_price_chunk(Arc::new(provider.clone()), multicall, chunk.to_vec(), block_id, block_timestamp)
        });
        let chunk_results = join_all(futures).await;
        for (reads, failures) in chunk_results {
            failed_assets.extend(failures);
            for price in reads {
                let token_addr_str = fmt_addr(&price.metadata.token);
                sqlx::query(
                    "INSERT INTO asset_price_observations (chain_id, asset_address, feed_address, block_number, block_hash, block_timestamp, feed_round_id, price_usd_e8, feed_updated_at, observed_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9,NOW())"
                )
                .bind(chain_id).bind(&token_addr_str).bind(&fmt_addr(&price.metadata.feed))
                .bind(price_block_number as i64).bind(&block_hash).bind(block_timestamp)
                .bind(price.round_id.to_string()).bind(price.price_usd_e8.to_string()).bind(price.feed_updated_at)
                .execute(&mut *write_tx).await.map_err(|e| format!("price observation write failed: {}", e))?;
                feeds_succeeded += 1;
            }
        }
        offset = end;
    }

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

pub async fn save_indexed_target_weights(
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

pub async fn record_unavailable_event_nav(
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

pub async fn write_event_valuation_checkpoint(
    tx: &mut Transaction<'_, Postgres>,
    _provider: &Provider<Http>,
    _registry_addr: Address,
    chain_id: i64,
    safe: Address,
    block_number: u64,
    block_hash: &str,
) -> Result<Option<Vec<(String, u32)>>, Box<dyn std::error::Error>> {
    let basket = fmt_addr(&safe);
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
