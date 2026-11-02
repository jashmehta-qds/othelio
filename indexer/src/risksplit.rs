use crate::abis::{IRiskSplitEventsEvents, SnapshotErc20};
use crate::utils::fmt_addr;
use ethers::abi::RawLog;
use ethers::prelude::*;
use ethers::providers::{Http, Provider};
use ethers::types::{Address, Log, U256};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::{HashMap, HashSet};
use tracing::info;

#[derive(Debug, Clone)]
pub struct RiskSplitState {
    pub factory_address: Address,
    pub series: HashSet<Address>,
    pub protected_to_series: HashMap<Address, Address>,
    pub upside_to_series: HashMap<Address, Address>,
}

impl RiskSplitState {
    pub fn new(factory_address: Address) -> Self {
        Self {
            factory_address,
            series: HashSet::new(),
            protected_to_series: HashMap::new(),
            upside_to_series: HashMap::new(),
        }
    }

    pub async fn load_from_db(
        pool: &PgPool,
        chain_id: i64,
        factory_address: Address,
    ) -> Result<Self, sqlx::Error> {
        let mut state = Self::new(factory_address);
        let rows: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT series_address, protected_token_address, upside_token_address
             FROM risk_split_series
             WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_all(pool)
        .await?;

        for (series_str, prot_opt, up_opt) in rows {
            if let Ok(series_addr) = series_str.trim().parse::<Address>() {
                state.track_series(series_addr);
                if let (Some(p_str), Some(u_str)) = (prot_opt, up_opt) {
                    if let (Ok(p_addr), Ok(u_addr)) = (
                        p_str.trim().parse::<Address>(),
                        u_str.trim().parse::<Address>(),
                    ) {
                        state.track_claims(series_addr, p_addr, u_addr);
                    }
                }
            }
        }

        info!(
            series_count = state.series.len(),
            claims_count = state.protected_to_series.len() + state.upside_to_series.len(),
            "[RiskSplit] Loaded state from DB"
        );

        Ok(state)
    }

    pub fn track_series(&mut self, series: Address) {
        self.series.insert(series);
    }

    pub fn track_claims(&mut self, series: Address, protected: Address, upside: Address) {
        self.series.insert(series);
        if protected != Address::zero() {
            self.protected_to_series.insert(protected, series);
        }
        if upside != Address::zero() {
            self.upside_to_series.insert(upside, series);
        }
    }

    pub fn is_tracked_series(&self, addr: &Address) -> bool {
        self.series.contains(addr)
    }

    pub fn get_claim_series(&self, addr: &Address) -> Option<(Address, bool)> {
        if let Some(series) = self.protected_to_series.get(addr) {
            return Some((*series, true));
        }
        if let Some(series) = self.upside_to_series.get(addr) {
            return Some((*series, false));
        }
        None
    }

    pub fn filter_addresses(&self) -> Vec<Address> {
        let mut addrs = Vec::new();
        if self.factory_address != Address::zero() {
            addrs.push(self.factory_address);
        }
        addrs.extend(self.series.iter().copied());
        addrs.extend(self.protected_to_series.keys().copied());
        addrs.extend(self.upside_to_series.keys().copied());
        addrs.sort();
        addrs.dedup();
        addrs
    }
}

pub async fn process_risksplit_log(
    state: &mut RiskSplitState,
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    log: &Log,
) -> Result<bool, Box<dyn std::error::Error>> {
    let raw_log = RawLog {
        topics: log.topics.clone(),
        data: log.data.to_vec(),
    };

    let event = match IRiskSplitEventsEvents::decode_log(&raw_log) {
        Ok(ev) => ev,
        Err(_) => return Ok(false),
    };

    let emitter = log.address;
    let tx_hash = format!("{:#x}", log.transaction_hash.unwrap_or_default());
    let log_index = log.log_index.unwrap_or_default().as_u32() as i32;
    let block_number = log.block_number.unwrap_or_default().as_u64();

    // Check if event was already indexed (idempotency check)
    let already_indexed: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM risk_split_events WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3",
    )
    .bind(chain_id)
    .bind(&tx_hash)
    .bind(log_index)
    .fetch_optional(&mut **tx)
    .await?;

    if already_indexed.is_some() {
        return Ok(true);
    }

    match event {
        IRiskSplitEventsEvents::SeriesCreatedFilter(e) => {
            if state.factory_address != Address::zero() && emitter != state.factory_address {
                return Ok(false);
            }
            let series_str = fmt_addr(&e.series);
            let underlying_str = fmt_addr(&e.underlying);
            let adapter_str = fmt_addr(&e.settlement_adapter);
            let factory_str = fmt_addr(&emitter);

            sqlx::query(
                "INSERT INTO risk_split_series (
                    chain_id, series_address, underlying_address, settlement_adapter_address,
                    floor_price, cap_price, expiry_timestamp, created_block, created_tx,
                    factory_address, last_indexed_block
                ) VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10, $11)
                ON CONFLICT (chain_id, series_address) DO UPDATE SET
                    settlement_adapter_address = EXCLUDED.settlement_adapter_address,
                    last_indexed_block = EXCLUDED.last_indexed_block",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&underlying_str)
            .bind(&adapter_str)
            .bind(e.floor_price.to_string())
            .bind(e.cap_price.to_string())
            .bind(e.expiry.as_u64() as i64)
            .bind(block_number as i64)
            .bind(&tx_hash)
            .bind(&factory_str)
            .bind(block_number as i64)
            .execute(&mut **tx)
            .await?;

            let payload = json!({
                "floorPrice": e.floor_price.to_string(),
                "capPrice": e.cap_price.to_string(),
                "expiry": e.expiry.to_string(),
                "settlementAdapter": adapter_str,
            });

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, payload, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'SERIES_CREATED', $6, 0, $7, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&factory_str)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;

            state.track_series(e.series);
            info!(
                series = %series_str,
                underlying = %underlying_str,
                "[RiskSplit] Indexed SeriesCreated"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::SeriesCreatedWithReferenceFilter(e) => {
            if state.factory_address != Address::zero() && emitter != state.factory_address {
                return Ok(false);
            }
            let series_str = fmt_addr(&e.series);
            let underlying_str = fmt_addr(&e.underlying);
            let adapter_str = fmt_addr(&e.settlement_adapter);
            let factory_str = fmt_addr(&emitter);
            let feed_str = fmt_addr(&e.reference_feed);

            sqlx::query(
                "INSERT INTO risk_split_series (
                    chain_id, series_address, underlying_address, settlement_adapter_address,
                    floor_price, cap_price, expiry_timestamp, created_block, created_tx,
                    factory_address, creation_reference_price_usd_e8, creation_feed_address,
                    creation_feed_round_id, creation_reference_block, creation_reference_verified,
                    last_indexed_block
                ) VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10, $11::numeric, $12, $13::numeric, $14, true, $15)
                ON CONFLICT (chain_id, series_address) DO UPDATE SET
                    settlement_adapter_address = EXCLUDED.settlement_adapter_address,
                    creation_reference_price_usd_e8 = EXCLUDED.creation_reference_price_usd_e8,
                    creation_feed_address = EXCLUDED.creation_feed_address,
                    creation_feed_round_id = EXCLUDED.creation_feed_round_id,
                    creation_reference_block = EXCLUDED.creation_reference_block,
                    creation_reference_verified = true,
                    last_indexed_block = EXCLUDED.last_indexed_block",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&underlying_str)
            .bind(&adapter_str)
            .bind(e.floor_price.to_string())
            .bind(e.cap_price.to_string())
            .bind(e.expiry.as_u64() as i64)
            .bind(block_number as i64)
            .bind(&tx_hash)
            .bind(&factory_str)
            .bind(e.reference_price.to_string())
            .bind(&feed_str)
            .bind(e.reference_round_id.to_string())
            .bind(e.reference_block.as_u64() as i64)
            .bind(block_number as i64)
            .execute(&mut **tx)
            .await?;

            let payload = json!({
                "floorPrice": e.floor_price.to_string(),
                "capPrice": e.cap_price.to_string(),
                "expiry": e.expiry.to_string(),
                "settlementAdapter": adapter_str,
                "referenceFeed": feed_str,
                "referenceRoundId": e.reference_round_id.to_string(),
                "referencePrice": e.reference_price.to_string(),
                "referenceBlock": e.reference_block.to_string(),
            });

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, payload, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'SERIES_CREATED', $6, 0, $7, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&factory_str)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;

            state.track_series(e.series);
            info!(
                series = %series_str,
                underlying = %underlying_str,
                "[RiskSplit] Indexed SeriesCreatedWithReference"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::TokensInitializedFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);
            let prot_str = fmt_addr(&e.protected_token);
            let up_str = fmt_addr(&e.upside_token);

            sqlx::query(
                "UPDATE risk_split_series
                 SET protected_token_address = $1,
                     upside_token_address = $2,
                     last_indexed_block = $3
                 WHERE chain_id = $4 AND series_address = $5",
            )
            .bind(&prot_str)
            .bind(&up_str)
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            let payload = json!({
                "protectedToken": prot_str,
                "upsideToken": up_str,
            });

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, payload, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'TOKENS_INITIALIZED', $5, 0, $6, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;

            state.track_claims(emitter, e.protected_token, e.upside_token);
            info!(
                series = %series_str,
                protected = %prot_str,
                upside = %up_str,
                "[RiskSplit] Indexed TokensInitialized"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::MintedFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);
            let user_str = fmt_addr(&e.user);
            let amount_str = e.amount.to_string();

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'MINTED', $6, $7::numeric, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO risk_split_positions (
                    chain_id, series_address, user_address, protected_balance,
                    upside_balance, total_minted, updated_at
                ) VALUES ($1, $2, $3, $4::numeric, $4::numeric, $4::numeric, NOW())
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    protected_balance = risk_split_positions.protected_balance + EXCLUDED.protected_balance,
                    upside_balance = risk_split_positions.upside_balance + EXCLUDED.upside_balance,
                    total_minted = risk_split_positions.total_minted + EXCLUDED.total_minted,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "UPDATE risk_split_series SET last_indexed_block = $1 WHERE chain_id = $2 AND series_address = $3",
            )
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            info!(
                series = %series_str,
                user = %user_str,
                amount = %amount_str,
                "[RiskSplit] Indexed Minted"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::PairRedeemedFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);
            let user_str = fmt_addr(&e.user);
            let amount_str = e.amount.to_string();

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'PAIR_REDEEMED', $6, $7::numeric, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO risk_split_positions (
                    chain_id, series_address, user_address, protected_balance,
                    upside_balance, total_paired_redeemed, updated_at
                ) VALUES ($1, $2, $3, 0, 0, $4::numeric, NOW())
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    protected_balance = GREATEST(0, risk_split_positions.protected_balance - $4::numeric),
                    upside_balance = GREATEST(0, risk_split_positions.upside_balance - $4::numeric),
                    total_paired_redeemed = risk_split_positions.total_paired_redeemed + $4::numeric,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "UPDATE risk_split_series SET last_indexed_block = $1 WHERE chain_id = $2 AND series_address = $3",
            )
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            info!(
                series = %series_str,
                user = %user_str,
                amount = %amount_str,
                "[RiskSplit] Indexed PairRedeemed"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::SettledFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);

            sqlx::query(
                "UPDATE risk_split_series
                 SET is_settled = true,
                     settled_price = $1::numeric,
                     protected_fraction = $2::numeric,
                     upside_fraction = $3::numeric,
                     settled_at = NOW(),
                     last_indexed_block = $4
                 WHERE chain_id = $5 AND series_address = $6",
            )
            .bind(e.settlement_price.to_string())
            .bind(e.protected_fraction.to_string())
            .bind(e.upside_fraction.to_string())
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            let payload = json!({
                "settlementPrice": e.settlement_price.to_string(),
                "protectedFraction": e.protected_fraction.to_string(),
                "upsideFraction": e.upside_fraction.to_string(),
            });

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, payload, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'SETTLED', $5, 0, $6, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;

            info!(
                series = %series_str,
                price = %e.settlement_price,
                "[RiskSplit] Indexed Settled"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::SettledWithFixingFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);

            sqlx::query(
                "UPDATE risk_split_series
                 SET is_settled = true,
                     settled_price = $1::numeric,
                     settled_round_id = $2::numeric,
                     settled_feed_updated_at = to_timestamp($3),
                     protected_fraction = $4::numeric,
                     upside_fraction = $5::numeric,
                     settled_at = NOW(),
                     last_indexed_block = $6
                 WHERE chain_id = $7 AND series_address = $8",
            )
            .bind(e.settlement_price.to_string())
            .bind(e.round_id.to_string())
            .bind(e.observed_timestamp.as_u64() as f64)
            .bind(e.protected_fraction.to_string())
            .bind(e.upside_fraction.to_string())
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            let payload = json!({
                "settlementPrice": e.settlement_price.to_string(),
                "roundId": e.round_id.to_string(),
                "observedTimestamp": e.observed_timestamp.to_string(),
                "protectedFraction": e.protected_fraction.to_string(),
                "upsideFraction": e.upside_fraction.to_string(),
            });

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, payload, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'SETTLED', $5, 0, $6, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;

            info!(
                series = %series_str,
                price = %e.settlement_price,
                round = %e.round_id,
                "[RiskSplit] Indexed SettledWithFixing"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::ProtectedRedeemedFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);
            let user_str = fmt_addr(&e.user);
            let amount_str = e.amount.to_string();
            let returned_str = e.underlying_returned.to_string();

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, underlying_amount, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'PROTECTED_REDEEMED', $6, $7::numeric, $8::numeric, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .bind(&returned_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO risk_split_positions (
                    chain_id, series_address, user_address, protected_balance,
                    total_protected_redeemed, updated_at
                ) VALUES ($1, $2, $3, 0, $4::numeric, NOW())
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    protected_balance = GREATEST(0, risk_split_positions.protected_balance - $4::numeric),
                    total_protected_redeemed = risk_split_positions.total_protected_redeemed + $4::numeric,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "UPDATE risk_split_series SET last_indexed_block = $1 WHERE chain_id = $2 AND series_address = $3",
            )
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            info!(
                series = %series_str,
                user = %user_str,
                amount = %amount_str,
                underlying = %returned_str,
                "[RiskSplit] Indexed ProtectedRedeemed"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::UpsideRedeemedFilter(e) => {
            if !state.is_tracked_series(&emitter) {
                return Ok(false);
            }
            let series_str = fmt_addr(&emitter);
            let user_str = fmt_addr(&e.user);
            let amount_str = e.amount.to_string();
            let returned_str = e.underlying_returned.to_string();

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, underlying_amount, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'UPSIDE_REDEEMED', $6, $7::numeric, $8::numeric, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .bind(&returned_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO risk_split_positions (
                    chain_id, series_address, user_address, upside_balance,
                    total_upside_redeemed, updated_at
                ) VALUES ($1, $2, $3, 0, $4::numeric, NOW())
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    upside_balance = GREATEST(0, risk_split_positions.upside_balance - $4::numeric),
                    total_upside_redeemed = risk_split_positions.total_upside_redeemed + $4::numeric,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user_str)
            .bind(&amount_str)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "UPDATE risk_split_series SET last_indexed_block = $1 WHERE chain_id = $2 AND series_address = $3",
            )
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            info!(
                series = %series_str,
                user = %user_str,
                amount = %amount_str,
                underlying = %returned_str,
                "[RiskSplit] Indexed UpsideRedeemed"
            );
            Ok(true)
        }
        IRiskSplitEventsEvents::TransferFilter(e) => {
            // Secondary transfer of claim tokens
            if e.from == Address::zero() || e.to == Address::zero() {
                // Ignore mints/burns here because they are handled by Minted/Redeemed events
                return Ok(false);
            }
            let (series_addr, is_protected) = match state.get_claim_series(&emitter) {
                Some(res) => res,
                None => return Ok(false),
            };

            let series_str = fmt_addr(&series_addr);
            let from_str = fmt_addr(&e.from);
            let to_str = fmt_addr(&e.to);
            let value_str = e.value.to_string();
            let claim_type = if is_protected { "PROTECTED" } else { "UPSIDE" };

            let payload = json!({
                "token": claim_type,
                "from": from_str,
                "to": to_str,
            });

            sqlx::query(
                "INSERT INTO risk_split_events (
                    chain_id, tx_hash, log_index, block_number, series_address,
                    event_type, actor_address, amount, payload, occurred_at
                ) VALUES ($1, $2, $3, $4, $5, 'CLAIM_TRANSFER', $6, $7::numeric, $8, NOW())",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number as i64)
            .bind(&series_str)
            .bind(&from_str)
            .bind(&value_str)
            .bind(&payload)
            .execute(&mut **tx)
            .await?;

            if is_protected {
                // Sender decrease
                sqlx::query(
                    "UPDATE risk_split_positions
                     SET protected_balance = GREATEST(0, protected_balance - $1::numeric),
                         updated_at = NOW()
                     WHERE chain_id = $2 AND series_address = $3 AND user_address = $4",
                )
                .bind(&value_str)
                .bind(chain_id)
                .bind(&series_str)
                .bind(&from_str)
                .execute(&mut **tx)
                .await?;

                // Receiver increase
                sqlx::query(
                    "INSERT INTO risk_split_positions (
                        chain_id, series_address, user_address, protected_balance, updated_at
                    ) VALUES ($1, $2, $3, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        protected_balance = risk_split_positions.protected_balance + EXCLUDED.protected_balance,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&to_str)
                .bind(&value_str)
                .execute(&mut **tx)
                .await?;
            } else {
                // Sender decrease
                sqlx::query(
                    "UPDATE risk_split_positions
                     SET upside_balance = GREATEST(0, upside_balance - $1::numeric),
                         updated_at = NOW()
                     WHERE chain_id = $2 AND series_address = $3 AND user_address = $4",
                )
                .bind(&value_str)
                .bind(chain_id)
                .bind(&series_str)
                .bind(&from_str)
                .execute(&mut **tx)
                .await?;

                // Receiver increase
                sqlx::query(
                    "INSERT INTO risk_split_positions (
                        chain_id, series_address, user_address, upside_balance, updated_at
                    ) VALUES ($1, $2, $3, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        upside_balance = risk_split_positions.upside_balance + EXCLUDED.upside_balance,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&to_str)
                .bind(&value_str)
                .execute(&mut **tx)
                .await?;
            }

            sqlx::query(
                "UPDATE risk_split_series SET last_indexed_block = $1 WHERE chain_id = $2 AND series_address = $3",
            )
            .bind(block_number as i64)
            .bind(chain_id)
            .bind(&series_str)
            .execute(&mut **tx)
            .await?;

            info!(
                claim = %claim_type,
                from = %from_str,
                to = %to_str,
                value = %value_str,
                "[RiskSplit] Indexed Claim Transfer"
            );
            Ok(true)
        }
    }
}

pub async fn rollback_risksplit_reorg(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    ancestor_block: u64,
) -> Result<(), sqlx::Error> {
    // 1. Delete events created past ancestor
    sqlx::query("DELETE FROM risk_split_events WHERE chain_id=$1 AND block_number > $2")
        .bind(chain_id)
        .bind(ancestor_block as i64)
        .execute(&mut **tx)
        .await?;

    // 2. Delete series created past ancestor
    sqlx::query("DELETE FROM risk_split_series WHERE chain_id=$1 AND created_block > $2")
        .bind(chain_id)
        .bind(ancestor_block as i64)
        .execute(&mut **tx)
        .await?;

    // 3. Reset settlement for any remaining series that settled after ancestor
    sqlx::query(
        "UPDATE risk_split_series
         SET is_settled = false,
             settled_price = NULL,
             protected_fraction = NULL,
             upside_fraction = NULL,
             settled_round_id = NULL,
             settled_feed_updated_at = NULL,
             settled_at = NULL
         WHERE chain_id=$1 AND is_settled = true
           AND series_address NOT IN (
             SELECT series_address FROM risk_split_events
             WHERE chain_id=$1 AND event_type IN ('SETTLED', 'SETTLED_WITH_FIXING')
           )",
    )
    .bind(chain_id)
    .execute(&mut **tx)
    .await?;

    // 4. Reconstruct positions from the surviving risk_split_events
    sqlx::query("DELETE FROM risk_split_positions WHERE chain_id=$1")
        .bind(chain_id)
        .execute(&mut **tx)
        .await?;

    // Replay remaining events in order
    let events: Vec<(String, String, String, String, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT event_type, series_address, actor_address, amount::text, payload
         FROM risk_split_events
         WHERE chain_id = $1
         ORDER BY block_number ASC, log_index ASC",
    )
    .bind(chain_id)
    .fetch_all(&mut **tx)
    .await?;

    for (ev_type, series_str, actor_str, amount_str, payload_opt) in events {
        match ev_type.as_str() {
            "MINTED" => {
                sqlx::query(
                    "INSERT INTO risk_split_positions (
                        chain_id, series_address, user_address, protected_balance,
                        upside_balance, total_minted, updated_at
                    ) VALUES ($1, $2, $3, $4::numeric, $4::numeric, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        protected_balance = risk_split_positions.protected_balance + EXCLUDED.protected_balance,
                        upside_balance = risk_split_positions.upside_balance + EXCLUDED.upside_balance,
                        total_minted = risk_split_positions.total_minted + EXCLUDED.total_minted,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&actor_str)
                .bind(&amount_str)
                .execute(&mut **tx)
                .await?;
            }
            "PAIR_REDEEMED" => {
                sqlx::query(
                    "INSERT INTO risk_split_positions (
                        chain_id, series_address, user_address, protected_balance,
                        upside_balance, total_paired_redeemed, updated_at
                    ) VALUES ($1, $2, $3, 0, 0, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        protected_balance = GREATEST(0, risk_split_positions.protected_balance - $4::numeric),
                        upside_balance = GREATEST(0, risk_split_positions.upside_balance - $4::numeric),
                        total_paired_redeemed = risk_split_positions.total_paired_redeemed + $4::numeric,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&actor_str)
                .bind(&amount_str)
                .execute(&mut **tx)
                .await?;
            }
            "PROTECTED_REDEEMED" => {
                sqlx::query(
                    "INSERT INTO risk_split_positions (
                        chain_id, series_address, user_address, protected_balance,
                        total_protected_redeemed, updated_at
                    ) VALUES ($1, $2, $3, 0, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        protected_balance = GREATEST(0, risk_split_positions.protected_balance - $4::numeric),
                        total_protected_redeemed = risk_split_positions.total_protected_redeemed + $4::numeric,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&actor_str)
                .bind(&amount_str)
                .execute(&mut **tx)
                .await?;
            }
            "UPSIDE_REDEEMED" => {
                sqlx::query(
                    "INSERT INTO risk_split_positions (
                        chain_id, series_address, user_address, upside_balance,
                        total_upside_redeemed, updated_at
                    ) VALUES ($1, $2, $3, 0, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        upside_balance = GREATEST(0, risk_split_positions.upside_balance - $4::numeric),
                        total_upside_redeemed = risk_split_positions.total_upside_redeemed + $4::numeric,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&actor_str)
                .bind(&amount_str)
                .execute(&mut **tx)
                .await?;
            }
            "CLAIM_TRANSFER" => {
                if let Some(payload) = payload_opt {
                    let token_type = payload.get("token").and_then(|v| v.as_str()).unwrap_or("");
                    let from_str = payload.get("from").and_then(|v| v.as_str()).unwrap_or("");
                    let to_str = payload.get("to").and_then(|v| v.as_str()).unwrap_or("");
                    if token_type == "PROTECTED" {
                        sqlx::query(
                            "UPDATE risk_split_positions
                             SET protected_balance = GREATEST(0, protected_balance - $1::numeric),
                                 updated_at = NOW()
                             WHERE chain_id = $2 AND series_address = $3 AND user_address = $4",
                        )
                        .bind(&amount_str)
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(from_str)
                        .execute(&mut **tx)
                        .await?;

                        sqlx::query(
                            "INSERT INTO risk_split_positions (
                                chain_id, series_address, user_address, protected_balance, updated_at
                            ) VALUES ($1, $2, $3, $4::numeric, NOW())
                            ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                                protected_balance = risk_split_positions.protected_balance + EXCLUDED.protected_balance,
                                updated_at = NOW()",
                        )
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(to_str)
                        .bind(&amount_str)
                        .execute(&mut **tx)
                        .await?;
                    } else if token_type == "UPSIDE" {
                        sqlx::query(
                            "UPDATE risk_split_positions
                             SET upside_balance = GREATEST(0, upside_balance - $1::numeric),
                                 updated_at = NOW()
                             WHERE chain_id = $2 AND series_address = $3 AND user_address = $4",
                        )
                        .bind(&amount_str)
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(from_str)
                        .execute(&mut **tx)
                        .await?;

                        sqlx::query(
                            "INSERT INTO risk_split_positions (
                                chain_id, series_address, user_address, upside_balance, updated_at
                            ) VALUES ($1, $2, $3, $4::numeric, NOW())
                            ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                                upside_balance = risk_split_positions.upside_balance + EXCLUDED.upside_balance,
                                updated_at = NOW()",
                        )
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(to_str)
                        .bind(&amount_str)
                        .execute(&mut **tx)
                        .await?;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(())
}

#[allow(dead_code)]
pub async fn reconcile_sample_positions(
    pool: &PgPool,
    provider: &Provider<Http>,
    chain_id: i64,
    series_address: Address,
    sample_users: &[Address],
) -> Result<(), Box<dyn std::error::Error>> {
    let series_str = fmt_addr(&series_address);
    let series_tokens: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT protected_token_address, upside_token_address
         FROM risk_split_series
         WHERE chain_id = $1 AND series_address = $2",
    )
    .bind(chain_id)
    .bind(&series_str)
    .fetch_optional(pool)
    .await?;

    let Some((Some(prot_str), Some(up_str))) = series_tokens else {
        return Err(format!("series {} tokens not registered", series_str).into());
    };

    let prot_token: Address = prot_str.trim().parse()?;
    let up_token: Address = up_str.trim().parse()?;
    let prot_contract = SnapshotErc20::new(prot_token, provider.clone().into());
    let up_contract = SnapshotErc20::new(up_token, provider.clone().into());

    for &user in sample_users {
        let user_str = fmt_addr(&user);
        let onchain_prot: U256 = prot_contract.balance_of(user).call().await?;
        let onchain_up: U256 = up_contract.balance_of(user).call().await?;

        let db_pos: Option<(String, String)> = sqlx::query_as(
            "SELECT protected_balance::text, upside_balance::text
             FROM risk_split_positions
             WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(&series_str)
        .bind(&user_str)
        .fetch_optional(pool)
        .await?;

        let (db_prot_str, db_up_str) = db_pos.unwrap_or(("0".to_string(), "0".to_string()));
        let db_prot = U256::from_dec_str(&db_prot_str)?;
        let db_up = U256::from_dec_str(&db_up_str)?;

        if onchain_prot != db_prot {
            return Err(format!(
                "Reconciliation mismatch for user {} protected balance: onchain={}, db={}",
                user_str, onchain_prot, db_prot
            )
            .into());
        }
        if onchain_up != db_up {
            return Err(format!(
                "Reconciliation mismatch for user {} upside balance: onchain={}, db={}",
                user_str, onchain_up, db_up
            )
            .into());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abis::*;
    use ethers::abi::Token;
    use ethers::contract::EthEvent;
    use sqlx::postgres::PgPoolOptions;

    fn addr_to_h256(addr: Address) -> H256 {
        let mut bytes = [0u8; 32];
        bytes[12..32].copy_from_slice(addr.as_bytes());
        H256(bytes)
    }

    fn make_raw_log(emitter: Address, topics: Vec<H256>, data: Vec<u8>, block_number: u64, tx_hash: H256, log_index: u64) -> Log {
        Log {
            address: emitter,
            topics,
            data: data.into(),
            block_number: Some(block_number.into()),
            transaction_hash: Some(tx_hash),
            log_index: Some(log_index.into()),
            block_hash: Some(H256::zero()),
            ..Default::default()
        }
    }

    fn log_series_created_with_reference(
        emitter: Address,
        series: Address,
        underlying: Address,
        floor_price: U256,
        cap_price: U256,
        expiry: U256,
        adapter: Address,
        feed: Address,
        round_id: u64,
        price: U256,
        block: U256,
        block_number: u64,
        tx_hash: H256,
    ) -> Log {
        let topics = vec![
            SeriesCreatedWithReferenceFilter::signature(),
            addr_to_h256(series),
            addr_to_h256(underlying),
        ];
        let data = ethers::abi::encode(&[
            Token::Uint(floor_price),
            Token::Uint(cap_price),
            Token::Uint(expiry),
            Token::Address(adapter),
            Token::Address(feed),
            Token::Uint(round_id.into()),
            Token::Uint(price),
            Token::Uint(block),
        ]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    fn log_tokens_initialized(emitter: Address, prot: Address, up: Address, block_number: u64, tx_hash: H256) -> Log {
        let topics = vec![TokensInitializedFilter::signature()];
        let data = ethers::abi::encode(&[Token::Address(prot), Token::Address(up)]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    fn log_minted(emitter: Address, user: Address, amount: U256, block_number: u64, tx_hash: H256) -> Log {
        let topics = vec![MintedFilter::signature(), addr_to_h256(user)];
        let data = ethers::abi::encode(&[Token::Uint(amount)]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    fn log_pair_redeemed(emitter: Address, user: Address, amount: U256, block_number: u64, tx_hash: H256) -> Log {
        let topics = vec![PairRedeemedFilter::signature(), addr_to_h256(user)];
        let data = ethers::abi::encode(&[Token::Uint(amount)]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    fn log_transfer(emitter: Address, from: Address, to: Address, value: U256, block_number: u64, tx_hash: H256) -> Log {
        let topics = vec![TransferFilter::signature(), addr_to_h256(from), addr_to_h256(to)];
        let data = ethers::abi::encode(&[Token::Uint(value)]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    fn log_settled_with_fixing(
        emitter: Address,
        price: U256,
        round_id: u64,
        timestamp: U256,
        prot_fraction: U256,
        up_fraction: U256,
        block_number: u64,
        tx_hash: H256,
    ) -> Log {
        let topics = vec![SettledWithFixingFilter::signature()];
        let data = ethers::abi::encode(&[
            Token::Uint(price),
            Token::Uint(round_id.into()),
            Token::Uint(timestamp),
            Token::Uint(prot_fraction),
            Token::Uint(up_fraction),
        ]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    fn log_protected_redeemed(
        emitter: Address,
        user: Address,
        amount: U256,
        returned: U256,
        block_number: u64,
        tx_hash: H256,
    ) -> Log {
        let topics = vec![ProtectedRedeemedFilter::signature(), addr_to_h256(user)];
        let data = ethers::abi::encode(&[Token::Uint(amount), Token::Uint(returned)]);
        make_raw_log(emitter, topics, data, block_number, tx_hash, 0)
    }

    async fn get_test_pool() -> Option<PgPool> {
        let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://othelio:othelio@localhost:5434/othelio".to_string()
        });
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&db_url)
            .await
            .ok()
    }

    #[test]
    fn test_tracker_address_collection() {
        let factory = "0x1111111111111111111111111111111111111111".parse().unwrap();
        let series = "0x2222222222222222222222222222222222222222".parse().unwrap();
        let prot = "0x3333333333333333333333333333333333333333".parse().unwrap();
        let up = "0x4444444444444444444444444444444444444444".parse().unwrap();

        let mut state = RiskSplitState::new(factory);
        state.track_claims(series, prot, up);

        assert!(state.is_tracked_series(&series));
        assert_eq!(state.get_claim_series(&prot), Some((series, true)));
        assert_eq!(state.get_claim_series(&up), Some((series, false)));

        let addrs = state.filter_addresses();
        assert_eq!(addrs.len(), 4);
        assert!(addrs.contains(&factory));
        assert!(addrs.contains(&series));
        assert!(addrs.contains(&prot));
        assert!(addrs.contains(&up));
    }

    #[tokio::test]
    async fn test_full_lifecycle_and_reorg_fixtures() {
        let Some(pool) = get_test_pool().await else {
            eprintln!("Skipping DB-backed risksplit test; DB unavailable");
            return;
        };

        let chain_id = 99999_i64; // Isolated test chain ID

        // Clean previous test data for this chain ID
        sqlx::query("DELETE FROM risk_split_events WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM risk_split_positions WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM risk_split_series WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();

        let factory: Address = "0x9999000000000000000000000000000000000001".parse().unwrap();
        let series: Address = "0x9999000000000000000000000000000000000002".parse().unwrap();
        let underlying: Address = "0x9999000000000000000000000000000000000003".parse().unwrap();
        let adapter: Address = "0x9999000000000000000000000000000000000004".parse().unwrap();
        let feed: Address = "0x9999000000000000000000000000000000000005".parse().unwrap();
        let prot_token: Address = "0x9999000000000000000000000000000000000006".parse().unwrap();
        let up_token: Address = "0x9999000000000000000000000000000000000007".parse().unwrap();
        let user_a: Address = "0x999900000000000000000000000000000000000a".parse().unwrap();
        let user_b: Address = "0x999900000000000000000000000000000000000b".parse().unwrap();

        let mut state = RiskSplitState::new(factory);

        // 1. SeriesCreatedWithReference at block 100
        let tx1 = H256::from_low_u64_be(1);
        let log_created = log_series_created_with_reference(
            factory,
            series,
            underlying,
            U256::from(400_00000000u64),
            U256::from(600_00000000u64),
            U256::from(1750000000u64),
            adapter,
            feed,
            1001,
            U256::from(500_00000000u64),
            U256::from(99u64),
            100,
            tx1,
        );

        let mut tx = pool.begin().await.unwrap();
        let processed = process_risksplit_log(&mut state, &mut tx, chain_id, &log_created)
            .await
            .unwrap();
        assert!(processed);
        tx.commit().await.unwrap();

        assert!(state.is_tracked_series(&series));

        // Verify series in DB
        let row_series: (String, bool, String) = sqlx::query_as(
            "SELECT underlying_address, creation_reference_verified, creation_reference_price_usd_e8::text
             FROM risk_split_series
             WHERE chain_id = $1 AND series_address = $2",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row_series.0.trim(), fmt_addr(&underlying));
        assert!(row_series.1);
        assert_eq!(row_series.2.trim(), "50000000000");

        // 2. TokensInitialized at block 101
        let tx2 = H256::from_low_u64_be(2);
        let log_tokens = log_tokens_initialized(series, prot_token, up_token, 101, tx2);
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_tokens).await.unwrap());
        tx.commit().await.unwrap();

        assert_eq!(state.get_claim_series(&prot_token), Some((series, true)));
        assert_eq!(state.get_claim_series(&up_token), Some((series, false)));

        // 3. User A Mints 100e8 at block 102
        let tx3 = H256::from_low_u64_be(3);
        let log_mint = log_minted(series, user_a, U256::from(100_00000000u64), 102, tx3);
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_mint).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a: (String, String, String) = sqlx::query_as(
            "SELECT protected_balance::text, upside_balance::text, total_minted::text
             FROM risk_split_positions
             WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_a.0.trim(), "10000000000");
        assert_eq!(pos_a.1.trim(), "10000000000");
        assert_eq!(pos_a.2.trim(), "10000000000");

        // Duplicate log delivers no additional balance
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_mint).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a_dup: (String,) = sqlx::query_as(
            "SELECT total_minted::text FROM risk_split_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_a_dup.0.trim(), "10000000000");

        // 4. User A PairRedeems 20e8 at block 103
        let tx4 = H256::from_low_u64_be(4);
        let log_pair = log_pair_redeemed(series, user_a, U256::from(20_00000000u64), 103, tx4);
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_pair).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a_after_pair: (String, String, String) = sqlx::query_as(
            "SELECT protected_balance::text, upside_balance::text, total_paired_redeemed::text
             FROM risk_split_positions
             WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_a_after_pair.0.trim(), "8000000000");
        assert_eq!(pos_a_after_pair.1.trim(), "8000000000");
        assert_eq!(pos_a_after_pair.2.trim(), "2000000000");

        // 5. User A transfers 30e8 Protected Token to User B at block 104
        let tx5 = H256::from_low_u64_be(5);
        let log_transfer = log_transfer(prot_token, user_a, user_b, U256::from(30_00000000u64), 104, tx5);
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_transfer).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a_prot: (String,) = sqlx::query_as(
            "SELECT protected_balance::text FROM risk_split_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_a_prot.0.trim(), "5000000000"); // 80 - 30 = 50

        let pos_b_prot: (String,) = sqlx::query_as(
            "SELECT protected_balance::text FROM risk_split_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_b))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_b_prot.0.trim(), "3000000000");

        // 6. SettledWithFixing at block 105
        let tx6 = H256::from_low_u64_be(6);
        let log_settle = log_settled_with_fixing(
            series,
            U256::from(550_00000000u64),
            2002,
            U256::from(1750000100u64),
            U256::from(500000000000000000u64), // 0.5e18
            U256::from(500000000000000000u64), // 0.5e18
            105,
            tx6,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_settle).await.unwrap());
        tx.commit().await.unwrap();

        let series_settled: (bool, String, String) = sqlx::query_as(
            "SELECT is_settled, settled_price::text, settled_round_id::text
             FROM risk_split_series
             WHERE chain_id = $1 AND series_address = $2",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(series_settled.0);
        assert_eq!(series_settled.1.trim(), "55000000000");
        assert_eq!(series_settled.2.trim(), "2002");

        // 7. ProtectedRedeemed for User B at block 106
        let tx7 = H256::from_low_u64_be(7);
        let log_prot_red = log_protected_redeemed(
            series,
            user_b,
            U256::from(30_00000000u64),
            U256::from(15_00000000u64),
            106,
            tx7,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_risksplit_log(&mut state, &mut tx, chain_id, &log_prot_red).await.unwrap());
        tx.commit().await.unwrap();

        let pos_b_after_red: (String, String) = sqlx::query_as(
            "SELECT protected_balance::text, total_protected_redeemed::text
             FROM risk_split_positions
             WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_b))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_b_after_red.0.trim(), "0");
        assert_eq!(pos_b_after_red.1.trim(), "3000000000");

        // 8. Test reload state from DB
        let reloaded = RiskSplitState::load_from_db(&pool, chain_id, factory)
            .await
            .unwrap();
        assert!(reloaded.is_tracked_series(&series));
        assert_eq!(reloaded.get_claim_series(&prot_token), Some((series, true)));
        assert_eq!(reloaded.get_claim_series(&up_token), Some((series, false)));

        // 9. Reorg rollback test: Rollback to block 104 (before settlement at 105 and redemption at 106)
        let mut tx = pool.begin().await.unwrap();
        rollback_risksplit_reorg(&mut tx, chain_id, 104).await.unwrap();
        tx.commit().await.unwrap();

        // Series settlement must be rolled back to false
        let series_rolled_back: (bool, Option<String>) = sqlx::query_as(
            "SELECT is_settled, settled_price::text
             FROM risk_split_series
             WHERE chain_id = $1 AND series_address = $2",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!series_rolled_back.0);
        assert_eq!(series_rolled_back.1, None);

        // User B's protected balance must be restored to 30e8 and total_protected_redeemed restored to 0
        let pos_b_restored: (String, String) = sqlx::query_as(
            "SELECT protected_balance::text, total_protected_redeemed::text
             FROM risk_split_positions
             WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_b))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_b_restored.0.trim(), "3000000000");
        assert_eq!(pos_b_restored.1.trim(), "0");

        // Clean up test data
        sqlx::query("DELETE FROM risk_split_events WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM risk_split_positions WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM risk_split_series WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
    }
}
