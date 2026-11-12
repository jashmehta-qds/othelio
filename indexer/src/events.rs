use crate::abis::IOthelioEventsEvents;
use crate::accounting::{
    project_route_accounting, project_withdrawal_accounting, reconcile_accounting_for_basket,
    route_execution_valuation,
};
use crate::lending::index_lending_event;
use crate::oracle::{save_indexed_target_weights, write_event_valuation_checkpoint};
use crate::risksplit::RiskSplitState;
use crate::utils::{configured_u64, fmt_addr};
use ethers::abi::RawLog;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, Filter, Log, U256};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::HashMap;
use tracing::info;

pub fn position_deltas_json(ordered: &[(String, (i8, U256))]) -> serde_json::Value {
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

pub fn parse_position_deltas(
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

pub async fn project_position_deltas(
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
    let mut aggregate: HashMap<String, (i8, U256)> = HashMap::new();
    for (asset, direction, amount) in deltas {
        if amount.is_zero() {
            continue;
        }
        let key = fmt_addr(&asset);
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
            if *direction > 0 {
                let decimals: i16 = if asset.to_lowercase() == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" {
                    6
                } else {
                    8
                };
                planned.push((asset.clone(), *amount, decimals));
                continue;
            }
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

pub async fn replay_pending_position_projections(
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

pub async fn retry_pending_position_projections(
    pool: &PgPool,
    chain_id: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut tx = pool.begin().await?;
    replay_pending_position_projections(&mut tx, chain_id, u64::MAX).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn insert_basket_event(
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
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (chain_id,tx_hash,log_index) DO NOTHING",
    ).bind(chain_id).bind(tx_hash).bind(log_index).bind(block_number as i64).bind(block_hash).bind(basket).bind(event_type).bind(actor).bind(payload).execute(&mut **tx).await?;
    Ok(())
}

pub struct FetchedBlockRange {
    pub from_block: u64,
    pub to_block: u64,
    pub logs: Vec<Log>,
    pub completed_hash: String,
}

pub fn event_filter_addresses(
    factory_addr: Address,
    module_addr: Address,
    lending_pool_addrs: &[Address],
    risksplit_addrs: &[Address],
    upside_addrs: &[Address],
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
    addresses.extend(
        risksplit_addrs
            .iter()
            .copied()
            .filter(|address| *address != Address::zero()),
    );
    addresses.extend(
        upside_addrs
            .iter()
            .copied()
            .filter(|address| *address != Address::zero()),
    );
    addresses.sort();
    addresses.dedup();
    addresses
}

pub async fn fetch_block_range(
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

pub async fn fetch_optional_block_range(
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

pub async fn fetch_block_ranges(
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

pub async fn fetch_and_process_ranges(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    registry_addr: Address,
    usdc_addr: Address,
    risk_split_enabled: bool,
    risk_split_state: &mut RiskSplitState,
    upside_state: &mut crate::upside::UpsideState,
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
            risk_split_enabled,
            risk_split_state,
            upside_state,
            range,
            owner,
        )
        .await?;
    }
    Ok(last_processed_block)
}

pub async fn process_block_range(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    registry_addr: Address,
    usdc_addr: Address,
    risk_split_enabled: bool,
    risk_split_state: &mut RiskSplitState,
    upside_state: &mut crate::upside::UpsideState,
    fetched: FetchedBlockRange,
    owner: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let FetchedBlockRange {
        from_block,
        to_block,
        logs,
        completed_hash,
    } = fetched;

    let mut range_tx = pool.begin().await?;
    replay_pending_position_projections(&mut range_tx, chain_id, from_block).await?;

    for log in logs {
        let tx_hash = format!("{:#x}", log.transaction_hash.unwrap_or_default());
        let block_hash = format!("{:#x}", log.block_hash.unwrap_or_default());
        let block_number = log.block_number.unwrap_or_default().as_u64();
        let log_index = log.log_index.unwrap_or_default().as_u32() as i32;

        if risk_split_enabled && crate::risksplit::process_risksplit_log(risk_split_state, &mut range_tx, chain_id, &log).await? {
            continue;
        }

        if crate::upside::process_upside_log(upside_state, &mut range_tx, chain_id, &log).await? {
            continue;
        }

        // Construct RawLog directly without cloning the full Log struct
        let raw_log = RawLog {
            topics: log.topics.clone(),
            data: log.data.to_vec(),
        };

        if let Ok(event) = IOthelioEventsEvents::decode_log(&raw_log) {
            match event {
                IOthelioEventsEvents::BasketCreatedFilter(e) => {
                    let safe = fmt_addr(&e.safe);
                    let owner = fmt_addr(&e.owner);
                    let name = e.name;

                    sqlx::query(
                        "INSERT INTO baskets (chain_id, address, controller, name, symbol, created_block, created_tx, created_at)
                         VALUES ($1, $2, $3, $4, 'OTH', $5, $6, NOW())
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
                         VALUES ($1, $2, $3, $4, $5, $6, 'CREATED', $7, $8, NOW())
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
                    let safe = fmt_addr(&e.safe);
                    let funder = fmt_addr(&e.funder);

                    let payload = json!({
                        "inputAsset": fmt_addr(&e.input_asset),
                        "inputAmount": e.input_amount.to_string(),
                        "boughtAssets": e.acquired_assets.iter().map(fmt_addr).collect::<Vec<_>>(),
                        "boughtAmounts": e.acquired_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "eventReportedAcquiredOutputNavUsdc": e.acquired_output_nav_usdc.to_string(),
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, $6, 'FUNDED', $7, $8, NOW())
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
                    let safe = fmt_addr(&e.safe);
                    let controller = fmt_addr(&e.controller);

                    let payload = json!({
                        "soldAssets": e.sold_assets.iter().map(fmt_addr).collect::<Vec<_>>(),
                        "soldAmounts": e.sold_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "boughtAssets": e.bought_assets.iter().map(fmt_addr).collect::<Vec<_>>(),
                        "boughtAmounts": e.bought_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "eventReportedTradedOutputNavUsdc": e.traded_output_nav_usdc.to_string(),
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, $6, 'WEIGHTS_UPDATED', $7, $8, NOW())
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
                    let safe = fmt_addr(&e.safe);
                    let owner = fmt_addr(&e.owner);

                    let payload = json!({
                        "navRedeemed": e.nav_redeemed.to_string(),
                        "outputAsset": fmt_addr(&e.output_asset),
                        "withdrawnAssets": e.withdrawn_assets.iter().map(fmt_addr).collect::<Vec<_>>(),
                        "withdrawnAmounts": e.withdrawn_amounts.iter().map(|a| a.to_string()).collect::<Vec<_>>(),
                        "eventReportedRemainingListedAssetsNavUsdc": e.remaining_listed_assets_nav_usdc.to_string(),
                    });

                    sqlx::query(
                        "INSERT INTO basket_events (chain_id, tx_hash, log_index, block_number, block_hash, basket_address, event_type, actor_address, payload, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, $6, 'WITHDRAWN', $7, $8, NOW())
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
                    let safe = fmt_addr(&e.safe);
                    let owner = fmt_addr(&e.owner);
                    let payload = json!({
                        "recipient": fmt_addr(&e.recipient), "outputAsset": fmt_addr(&e.output_asset),
                        "outputAmount": e.output_amount.to_string(),
                        "soldAssets": e.sold_assets.iter().map(fmt_addr).collect::<Vec<_>>(),
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
                    let safe = fmt_addr(&e.safe);
                    let owner = fmt_addr(&e.owner);
                    let payload = json!({ "token": fmt_addr(&e.token), "amount": e.amount.to_string() });
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
                    let safe = fmt_addr(&e.safe);
                    let actor = fmt_addr(&e.provider);
                    let payload = json!({ "asset": fmt_addr(&e.asset), "amount": e.amount.to_string(), "supplyApyBps": e.supply_apy_bps.to_string() });
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
                    let safe = fmt_addr(&e.safe);
                    let actor = fmt_addr(&e.provider);
                    let payload = json!({ "asset": fmt_addr(&e.asset), "amount": e.amount.to_string(), "borrowApyBps": e.borrow_apy_bps.to_string() });
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
                    let safe = fmt_addr(&e.safe);
                    let actor = fmt_addr(&e.provider);
                    let payload = json!({ "asset": fmt_addr(&e.asset), "amount": e.amount.to_string() });
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
                    let safe = fmt_addr(&e.safe);
                    let actor = fmt_addr(&e.provider);
                    let payload = json!({ "asset": fmt_addr(&e.asset), "amount": e.amount.to_string() });
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
                    let basket = fmt_addr(&e.basket);
                    let token_in = fmt_addr(&e.token_in);
                    let token_out = fmt_addr(&e.token_out);
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
                         VALUES ($1, $2, $3, $4, $5, $6, 'DEX_ROUTE_EXECUTED', $6, $7, NOW())
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

    sqlx::query(
        "INSERT INTO indexer_block_checkpoints (chain_id,block_number,block_hash) VALUES ($1,$2,$3)
         ON CONFLICT (chain_id,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash,processed_at=NOW()",
    )
    .bind(chain_id)
    .bind(to_block as i64)
    .bind(&completed_hash)
    .execute(&mut *range_tx)
    .await?;

    let retention = configured_u64("CHECKPOINT_RETENTION_BLOCKS", 2000);
    let prune_interval = configured_u64("CHECKPOINT_PRUNE_INTERVAL_BLOCKS", 100);
    if prune_interval > 0 && retention > 0 && to_block % prune_interval == 0 && to_block > retention {
        let prune_cutoff = (to_block - retention) as i64;
        sqlx::query(
            "DELETE FROM indexer_block_checkpoints WHERE chain_id = $1 AND block_number < $2",
        )
        .bind(chain_id)
        .bind(prune_cutoff)
        .execute(&mut *range_tx)
        .await?;
    }
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

    if risk_split_enabled {
        sqlx::query(
            "INSERT INTO indexer_worker_state (chain_id, worker_name, next_block, last_success_block, last_success_hash, last_attempt_at, last_success_at, consecutive_failures, last_error, updated_at)
             VALUES ($1, 'risksplit', $2, $3, $4, NOW(), NOW(), 0, NULL, NOW())
             ON CONFLICT (chain_id, worker_name) DO UPDATE SET
                next_block = GREATEST(indexer_worker_state.next_block, EXCLUDED.next_block),
                last_success_block = EXCLUDED.last_success_block,
                last_success_hash = EXCLUDED.last_success_hash,
                last_attempt_at = NOW(),
                last_success_at = NOW(),
                consecutive_failures = 0,
                last_error = NULL,
                updated_at = NOW()",
        )
        .bind(chain_id)
        .bind(to_block as i64 + 1)
        .bind(to_block as i64)
        .bind(&completed_hash)
        .execute(&mut *range_tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO indexer_worker_state (chain_id, worker_name, next_block, last_success_block, last_success_hash, last_attempt_at, last_success_at, consecutive_failures, last_error, updated_at)
         VALUES ($1, 'upside', $2, $3, $4, NOW(), NOW(), 0, NULL, NOW())
         ON CONFLICT (chain_id, worker_name) DO UPDATE SET
            next_block = GREATEST(indexer_worker_state.next_block, EXCLUDED.next_block),
            last_success_block = EXCLUDED.last_success_block,
            last_success_hash = EXCLUDED.last_success_hash,
            last_attempt_at = NOW(),
            last_success_at = NOW(),
            consecutive_failures = 0,
            last_error = NULL,
            updated_at = NOW()",
    )
    .bind(chain_id)
    .bind(to_block as i64 + 1)
    .bind(to_block as i64)
    .bind(&completed_hash)
    .execute(&mut *range_tx)
    .await?;

    range_tx.commit().await?;

    Ok(())
}
