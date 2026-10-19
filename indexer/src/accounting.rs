use crate::abis::{OthelioAssetRegistry, SnapshotAggregator};
use crate::utils::{nav_micro_to_numeric_string};
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, BlockId, BlockNumber, U64};
use serde_json::json;
use sqlx::{Postgres, Transaction};
use std::sync::Arc;

#[derive(Clone)]
pub struct AccountingMutation {
    pub kind: &'static str,
    pub asset: String,
    pub quantity: U256,
    pub decimals: u8,
    pub acquisition_basis_micro: Option<U256>,
    pub valuation_source: &'static str,
}

pub async fn project_route_accounting(
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

pub async fn project_withdrawal_accounting(
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

pub async fn apply_accounting_mutations(
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
            "SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status, decimals FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3",
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
            let current: Option<(String, String, String)> = sqlx::query_as("SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3")
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
            let (quantity, open_basis, _): (String, String, String) = sqlx::query_as("SELECT quantity_base_units::text, open_basis_usdc_micro::text, accounting_status FROM asset_cost_basis WHERE chain_id=$1 AND basket_address=$2 AND asset_address=$3")
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

pub async fn record_incomplete_mutations(
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

pub async fn mark_route_incomplete(
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

pub async fn reconcile_accounting_for_basket(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    basket: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "WITH latest_positions AS (
           SELECT DISTINCT ON (asset_address) asset_address, quantity_base_units, decimals
           FROM basket_positions WHERE chain_id=$1 AND basket_address=$2
           ORDER BY asset_address, block_number DESC, position_version DESC,
                    event_log_index DESC, event_tx_hash DESC
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
                    event_log_index DESC, event_tx_hash DESC
         )
         UPDATE asset_cost_basis acb SET accounting_status='INCOMPLETE', issue='accounting quantity does not reconcile to latest indexed balance', updated_at=NOW()
         FROM latest_positions lp WHERE acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=lp.asset_address
           AND acb.accounting_status='COMPLETE' AND acb.quantity_base_units <> lp.quantity_base_units"
    ).bind(chain_id).bind(basket).execute(&mut **tx).await?;
    sqlx::query(
        "WITH latest_positions AS (
           SELECT DISTINCT ON (asset_address) asset_address, quantity_base_units
           FROM basket_positions WHERE chain_id=$1 AND basket_address=$2
           ORDER BY asset_address, block_number DESC, position_version DESC,
                    event_log_index DESC, event_tx_hash DESC
         )
         UPDATE asset_cost_basis acb SET accounting_status='COMPLETE', issue=NULL, updated_at=NOW()
         FROM latest_positions lp WHERE acb.chain_id=$1 AND acb.basket_address=$2 AND acb.asset_address=lp.asset_address
           AND acb.accounting_status='INCOMPLETE' AND acb.issue='accounting quantity does not reconcile to latest indexed balance'
           AND acb.quantity_base_units = lp.quantity_base_units"
    ).bind(chain_id).bind(basket).execute(&mut **tx).await?;
    Ok(())
}

pub async fn route_execution_valuation(
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

pub async fn route_oracle_value_micro<M: Middleware + 'static>(
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
