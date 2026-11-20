use crate::utils::fmt_addr;
use ethers::abi::{decode, ParamType, RawLog, Token};
use ethers::prelude::*;
use ethers::types::{Address, Log, U256};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};
use std::collections::{HashMap, HashSet};
use tracing::info;

pub const UPSIDE_ROUND_REGISTERED_SIGNATURE: &str =
    "RoundRegistered(uint256,address,address,(address,address,address,uint80,uint256,uint256,uint256,uint256,uint256,bytes32,uint256,uint256,uint256))";
pub const UPSIDE_MARKET_CREATED_SIGNATURE: &str =
    "MarketCreated(uint256,uint256,address,address,address,address)";
pub const UPSIDE_TOKENS_INITIALIZED_SIGNATURE: &str =
    "TokensInitialized(address,address)";
pub const UPSIDE_MINTED_SIGNATURE: &str =
    "Minted(address,uint256)";
pub const UPSIDE_PAIR_WITHDRAWN_SIGNATURE: &str =
    "PairWithdrawn(address,uint256)";
pub const UPSIDE_SETTLED_WITH_FIXING_SIGNATURE: &str =
    "SettledWithFixing(uint256,uint80,uint256,uint256,uint256)";
pub const UPSIDE_SETTLED_SIGNATURE: &str =
    "Settled(uint256,uint256,uint256)";
pub const UPSIDE_REDEEMED_SIGNATURE: &str =
    "UpsideRedeemed(address,uint256,uint256)";
pub const UPSIDE_RESIDUAL_REDEEMED_SIGNATURE: &str =
    "ResidualRedeemed(address,uint256,uint256)";
pub const ERC20_TRANSFER_SIGNATURE: &str =
    "Transfer(address,address,uint256)";

fn topic(signature: &str) -> H256 {
    ethers::utils::keccak256(signature.as_bytes()).into()
}

fn round_config_type() -> ParamType {
    ParamType::Tuple(vec![
        ParamType::Address,        // underlying
        ParamType::Address,        // feed
        ParamType::Address,        // adapter
        ParamType::Uint(80),       // referenceRoundId
        ParamType::Uint(256),      // referencePrice
        ParamType::Uint(256),      // referenceTime
        ParamType::Uint(256),      // roundStart
        ParamType::Uint(256),      // expiryTimestamp
        ParamType::Uint(256),      // expectedMove
        ParamType::FixedBytes(32), // provenanceHash
        ParamType::Uint(256),      // strikeTick
        ParamType::Uint(256),      // minStrike
        ParamType::Uint(256),      // maxStrike
    ])
}

fn indexed_address(raw_log: &RawLog, index: usize) -> Option<Address> {
    let value = raw_log.topics.get(index)?;
    Some(Address::from_slice(&value.as_bytes()[12..]))
}

fn indexed_uint(raw_log: &RawLog, index: usize) -> Option<U256> {
    let value = raw_log.topics.get(index)?;
    Some(U256::from_big_endian(value.as_bytes()))
}

fn address_token(tokens: &[Token], index: usize) -> Option<Address> {
    tokens.get(index)?.clone().into_address()
}

fn uint_token(tokens: &[Token], index: usize) -> Option<U256> {
    tokens.get(index)?.clone().into_uint()
}

fn bytes_token(tokens: &[Token], index: usize) -> Option<Vec<u8>> {
    tokens.get(index)?.clone().into_fixed_bytes()
}

fn u256_to_numeric_string(value: U256) -> String {
    value.to_string()
}

#[derive(Debug, Clone)]
pub struct UpsideState {
    pub factory_address: Address,
    pub markets: HashSet<Address>,
    pub upside_to_market: HashMap<Address, Address>,
    pub residual_to_market: HashMap<Address, Address>,
}

impl UpsideState {
    pub fn new(factory_address: Address) -> Self {
        Self {
            factory_address,
            markets: HashSet::new(),
            upside_to_market: HashMap::new(),
            residual_to_market: HashMap::new(),
        }
    }

    pub async fn load_from_db(
        pool: &PgPool,
        chain_id: i64,
        factory_address: Address,
    ) -> Result<Self, sqlx::Error> {
        let mut state = Self::new(factory_address);
        let rows: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT series_address, upside_token_address, residual_token_address
             FROM upside_markets
             WHERE chain_id = $1",
        )
        .bind(chain_id)
        .fetch_all(pool)
        .await?;

        for (market_str, up_opt, res_opt) in rows {
            if let Ok(market_addr) = market_str.trim().parse::<Address>() {
                state.track_market(market_addr);
                if let (Some(u_str), Some(r_str)) = (up_opt, res_opt) {
                    if let (Ok(u_addr), Ok(r_addr)) = (
                        u_str.trim().parse::<Address>(),
                        r_str.trim().parse::<Address>(),
                    ) {
                        state.track_claims(market_addr, u_addr, r_addr);
                    }
                }
            }
        }

        info!(
            markets_count = state.markets.len(),
            claims_count = state.upside_to_market.len() + state.residual_to_market.len(),
            "[Upside] Loaded state from DB"
        );

        Ok(state)
    }

    pub fn track_market(&mut self, market: Address) {
        self.markets.insert(market);
    }

    pub fn track_claims(&mut self, market: Address, upside: Address, residual: Address) {
        self.markets.insert(market);
        if upside != Address::zero() {
            self.upside_to_market.insert(upside, market);
        }
        if residual != Address::zero() {
            self.residual_to_market.insert(residual, market);
        }
    }

    pub fn is_tracked_market(&self, addr: &Address) -> bool {
        self.markets.contains(addr)
    }

    pub fn get_claim_market(&self, addr: &Address) -> Option<(Address, bool)> {
        if let Some(market) = self.upside_to_market.get(addr) {
            return Some((*market, true)); // true = upside
        }
        if let Some(market) = self.residual_to_market.get(addr) {
            return Some((*market, false)); // false = residual
        }
        None
    }

    pub fn filter_addresses(&self) -> Vec<Address> {
        let mut addrs = Vec::new();
        if self.factory_address != Address::zero() {
            addrs.push(self.factory_address);
        }
        addrs.extend(self.markets.iter().copied());
        addrs.extend(self.upside_to_market.keys().copied());
        addrs.extend(self.residual_to_market.keys().copied());
        addrs.sort();
        addrs.dedup();
        addrs
    }
}

pub async fn process_upside_log(
    state: &mut UpsideState,
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    log: &Log,
) -> Result<bool, Box<dyn std::error::Error>> {
    let raw_log = RawLog {
        topics: log.topics.clone(),
        data: log.data.to_vec(),
    };

    let log_topic = match raw_log.topics.first() {
        Some(t) => *t,
        None => return Ok(false),
    };

    let tx_hash = format!("{:#x}", log.transaction_hash.unwrap_or_default());
    let block_number = log.block_number.unwrap_or_default().as_u64() as i64;
    let log_index = log.log_index.unwrap_or_default().as_u32() as i32;

    // 1. Factory Events
    if log.address == state.factory_address || state.factory_address == Address::zero() {
        if log_topic == topic(UPSIDE_ROUND_REGISTERED_SIGNATURE) {
            let round_id = indexed_uint(&raw_log, 1).ok_or("missing round_id")?.as_u64() as i64;
            let underlying = fmt_addr(&indexed_address(&raw_log, 2).ok_or("missing underlying")?);
            let feed = fmt_addr(&indexed_address(&raw_log, 3).ok_or("missing feed")?);

            let round_tuple = round_config_type();

            let decoded = decode(&[round_tuple], &raw_log.data)?;
            let tuple = match decoded.first() {
                Some(Token::Tuple(fields)) => fields,
                _ => return Err("invalid RoundRegistered tuple payload".into()),
            };

            let adapter = fmt_addr(&address_token(tuple, 2).ok_or("missing adapter")?);
            let ref_round_id = u256_to_numeric_string(uint_token(tuple, 3).ok_or("missing refRoundId")?);
            let ref_price = u256_to_numeric_string(uint_token(tuple, 4).ok_or("missing refPrice")?);
            let ref_time = uint_token(tuple, 5).ok_or("missing refTime")?.as_u64() as i64;
            let round_start = uint_token(tuple, 6).ok_or("missing roundStart")?.as_u64() as i64;
            let expiry = uint_token(tuple, 7).ok_or("missing expiry")?.as_u64() as i64;
            let expected_move = u256_to_numeric_string(uint_token(tuple, 8).ok_or("missing expectedMove")?);
            let provenance = format!("0x{}", ethers::utils::hex::encode(bytes_token(tuple, 9).ok_or("missing provenance")?));
            let strike_tick = u256_to_numeric_string(uint_token(tuple, 10).ok_or("missing strikeTick")?);
            let min_strike = u256_to_numeric_string(uint_token(tuple, 11).ok_or("missing minStrike")?);
            let max_strike = u256_to_numeric_string(uint_token(tuple, 12).ok_or("missing maxStrike")?);
            let factory_addr = fmt_addr(&log.address);

            sqlx::query(
                "INSERT INTO upside_rounds (
                    chain_id, round_id, factory_address, underlying_address, feed_address, adapter_address,
                    reference_round_id, reference_price, reference_time, round_start, expiry_timestamp,
                    expected_move, provenance_hash, strike_tick, min_strike, max_strike,
                    created_block, created_tx
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7::numeric, $8::numeric, $9, $10, $11,
                    $12::numeric, $13, $14::numeric, $15::numeric, $16::numeric,
                    $17, $18
                )
                ON CONFLICT (chain_id, round_id) DO NOTHING",
            )
            .bind(chain_id)
            .bind(round_id)
            .bind(&factory_addr)
            .bind(&underlying)
            .bind(&feed)
            .bind(&adapter)
            .bind(&ref_round_id)
            .bind(&ref_price)
            .bind(ref_time)
            .bind(round_start)
            .bind(expiry)
            .bind(&expected_move)
            .bind(&provenance)
            .bind(&strike_tick)
            .bind(&min_strike)
            .bind(&max_strike)
            .bind(block_number)
            .bind(&tx_hash)
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_MARKET_CREATED_SIGNATURE) {
            let round_id = indexed_uint(&raw_log, 1).ok_or("missing round_id")?.as_u64() as i64;
            let strike_price = u256_to_numeric_string(indexed_uint(&raw_log, 2).ok_or("missing strike")?);
            let series_address = indexed_address(&raw_log, 3).ok_or("missing series")?;

            let decoded = decode(
                &[ParamType::Address, ParamType::Address, ParamType::Address],
                &raw_log.data,
            )?;
            let up_addr = address_token(&decoded, 0).ok_or("missing up token")?;
            let res_addr = address_token(&decoded, 1).ok_or("missing res token")?;
            let creator = address_token(&decoded, 2).ok_or("missing creator")?;

            state.track_claims(series_address, up_addr, res_addr);

            let series_str = fmt_addr(&series_address);
            let up_str = fmt_addr(&up_addr);
            let res_str = fmt_addr(&res_addr);
            let creator_str = fmt_addr(&creator);
            let factory_str = fmt_addr(&log.address);

            // Fetch underlying and expiry from upside_rounds
            let round_row: Option<(String, i64)> = sqlx::query_as(
                "SELECT underlying_address, expiry_timestamp
                 FROM upside_rounds
                 WHERE chain_id = $1 AND round_id = $2",
            )
            .bind(chain_id)
            .bind(round_id)
            .fetch_optional(&mut **tx)
            .await?;

            let (underlying_str, expiry_ts) = round_row.unwrap_or((
                "0x0000000000000000000000000000000000000000".to_string(),
                0,
            ));

            sqlx::query(
                "INSERT INTO upside_markets (
                    chain_id, series_address, round_id, factory_address, underlying_address,
                    upside_token_address, residual_token_address, strike_price, expiry_timestamp,
                    creator_address, created_block, created_tx
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8::numeric, $9,
                    $10, $11, $12
                )
                ON CONFLICT (chain_id, series_address) DO UPDATE SET
                    upside_token_address = EXCLUDED.upside_token_address,
                    residual_token_address = EXCLUDED.residual_token_address",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(round_id)
            .bind(&factory_str)
            .bind(&underlying_str)
            .bind(&up_str)
            .bind(&res_str)
            .bind(&strike_price)
            .bind(expiry_ts)
            .bind(&creator_str)
            .bind(block_number)
            .bind(&tx_hash)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'MARKET_CREATED', $7, $8::numeric, $9
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&creator_str)
            .bind(&strike_price)
            .bind(json!({
                "upsideToken": up_str,
                "residualToken": res_str,
                "strikePrice": strike_price
            }))
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }
    }

    // 2. Series Vault Events
    if state.is_tracked_market(&log.address) {
        let series_str = fmt_addr(&log.address);

        if log_topic == topic(UPSIDE_TOKENS_INITIALIZED_SIGNATURE) {
            let decoded = decode(&[ParamType::Address, ParamType::Address], &raw_log.data)?;
            let up_addr = address_token(&decoded, 0).ok_or("missing up")?;
            let res_addr = address_token(&decoded, 1).ok_or("missing res")?;

            state.track_claims(log.address, up_addr, res_addr);

            sqlx::query(
                "UPDATE upside_markets
                 SET upside_token_address = $3, residual_token_address = $4
                 WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(fmt_addr(&up_addr))
            .bind(fmt_addr(&res_addr))
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_MINTED_SIGNATURE) {
            let user = fmt_addr(&indexed_address(&raw_log, 1).ok_or("missing user")?);
            let decoded = decode(&[ParamType::Uint(256)], &raw_log.data)?;
            let amount = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing amount")?);

            let round_id: i64 = sqlx::query_scalar(
                "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .fetch_one(&mut **tx)
            .await
            .unwrap_or(0);

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'MINTED', $7, $8::numeric, $9
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&user)
            .bind(&amount)
            .bind(json!({ "amount": amount }))
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO upside_positions (
                    chain_id, series_address, user_address,
                    upside_balance, residual_balance, total_minted, updated_at
                ) VALUES (
                    $1, $2, $3,
                    $4::numeric, $4::numeric, $4::numeric, NOW()
                )
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    upside_balance = upside_positions.upside_balance + EXCLUDED.upside_balance,
                    residual_balance = upside_positions.residual_balance + EXCLUDED.residual_balance,
                    total_minted = upside_positions.total_minted + EXCLUDED.total_minted,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user)
            .bind(&amount)
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_PAIR_WITHDRAWN_SIGNATURE) {
            let user = fmt_addr(&indexed_address(&raw_log, 1).ok_or("missing user")?);
            let decoded = decode(&[ParamType::Uint(256)], &raw_log.data)?;
            let amount = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing amount")?);

            let round_id: i64 = sqlx::query_scalar(
                "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .fetch_one(&mut **tx)
            .await
            .unwrap_or(0);

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'PAIR_WITHDRAWN', $7, $8::numeric, $9
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&user)
            .bind(&amount)
            .bind(json!({ "amount": amount }))
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO upside_positions (
                    chain_id, series_address, user_address,
                    upside_balance, residual_balance, total_pair_withdrawn, updated_at
                ) VALUES (
                    $1, $2, $3,
                    -$4::numeric, -$4::numeric, $4::numeric, NOW()
                )
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    upside_balance = GREATEST(0, upside_positions.upside_balance - $4::numeric),
                    residual_balance = GREATEST(0, upside_positions.residual_balance - $4::numeric),
                    total_pair_withdrawn = upside_positions.total_pair_withdrawn + $4::numeric,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user)
            .bind(&amount)
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_SETTLED_WITH_FIXING_SIGNATURE) {
            let decoded = decode(
                &[
                    ParamType::Uint(256),
                    ParamType::Uint(80),
                    ParamType::Uint(256),
                    ParamType::Uint(256),
                    ParamType::Uint(256),
                ],
                &raw_log.data,
            )?;
            let price = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing price")?);
            let round_id_val = u256_to_numeric_string(uint_token(&decoded, 1).ok_or("missing roundId")?);
            let timestamp = uint_token(&decoded, 2).ok_or("missing timestamp")?.as_u64() as i64;
            let u_alloc = u256_to_numeric_string(uint_token(&decoded, 3).ok_or("missing uAlloc")?);
            let r_alloc = u256_to_numeric_string(uint_token(&decoded, 4).ok_or("missing rAlloc")?);

            sqlx::query(
                "UPDATE upside_markets SET
                    is_settled = true,
                    settled_price = $3::numeric,
                    settled_round_id = $4::numeric,
                    settled_timestamp = $5,
                    upside_allocation = $6::numeric,
                    residual_allocation = $7::numeric,
                    settled_at = NOW()
                 WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&price)
            .bind(&round_id_val)
            .bind(timestamp)
            .bind(&u_alloc)
            .bind(&r_alloc)
            .execute(&mut **tx)
            .await?;

            let round_id: i64 = sqlx::query_scalar(
                "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .fetch_one(&mut **tx)
            .await
            .unwrap_or(0);

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'SETTLED', $7, $8::numeric, $9
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&series_str)
            .bind(&price)
            .bind(json!({
                "price": price,
                "roundId": round_id_val,
                "timestamp": timestamp,
                "upsideAllocation": u_alloc,
                "residualAllocation": r_alloc
            }))
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_SETTLED_SIGNATURE) {
            let decoded = decode(
                &[ParamType::Uint(256), ParamType::Uint(256), ParamType::Uint(256)],
                &raw_log.data,
            )?;
            let price = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing price")?);
            let u_alloc = u256_to_numeric_string(uint_token(&decoded, 1).ok_or("missing uAlloc")?);
            let r_alloc = u256_to_numeric_string(uint_token(&decoded, 2).ok_or("missing rAlloc")?);

            sqlx::query(
                "UPDATE upside_markets SET
                    is_settled = true,
                    settled_price = $3::numeric,
                    upside_allocation = $4::numeric,
                    residual_allocation = $5::numeric,
                    settled_at = NOW()
                 WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&price)
            .bind(&u_alloc)
            .bind(&r_alloc)
            .execute(&mut **tx)
            .await?;

            let round_id: i64 = sqlx::query_scalar(
                "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .fetch_one(&mut **tx)
            .await
            .unwrap_or(0);

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'SETTLED', $7, $8::numeric, $9
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&series_str)
            .bind(&price)
            .bind(json!({
                "price": price,
                "upsideAllocation": u_alloc,
                "residualAllocation": r_alloc
            }))
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_REDEEMED_SIGNATURE) {
            let user = fmt_addr(&indexed_address(&raw_log, 1).ok_or("missing user")?);
            let decoded = decode(&[ParamType::Uint(256), ParamType::Uint(256)], &raw_log.data)?;
            let amount = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing amount")?);
            let underlying_returned = u256_to_numeric_string(uint_token(&decoded, 1).ok_or("missing return")?);

            let round_id: i64 = sqlx::query_scalar(
                "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .fetch_one(&mut **tx)
            .await
            .unwrap_or(0);

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, underlying_amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'UPSIDE_REDEEMED', $7, $8::numeric, $9::numeric, $10
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&user)
            .bind(&amount)
            .bind(&underlying_returned)
            .bind(json!({ "claimAmount": amount, "underlyingReturned": underlying_returned }))
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO upside_positions (
                    chain_id, series_address, user_address,
                    upside_balance, residual_balance, total_upside_redeemed, updated_at
                ) VALUES (
                    $1, $2, $3,
                    -$4::numeric, 0, $4::numeric, NOW()
                )
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    upside_balance = GREATEST(0, upside_positions.upside_balance - $4::numeric),
                    total_upside_redeemed = upside_positions.total_upside_redeemed + $4::numeric,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user)
            .bind(&amount)
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }

        if log_topic == topic(UPSIDE_RESIDUAL_REDEEMED_SIGNATURE) {
            let user = fmt_addr(&indexed_address(&raw_log, 1).ok_or("missing user")?);
            let decoded = decode(&[ParamType::Uint(256), ParamType::Uint(256)], &raw_log.data)?;
            let amount = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing amount")?);
            let underlying_returned = u256_to_numeric_string(uint_token(&decoded, 1).ok_or("missing return")?);

            let round_id: i64 = sqlx::query_scalar(
                "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
            )
            .bind(chain_id)
            .bind(&series_str)
            .fetch_one(&mut **tx)
            .await
            .unwrap_or(0);

            sqlx::query(
                "INSERT INTO upside_events (
                    chain_id, tx_hash, log_index, block_number, series_address, round_id,
                    event_type, actor_address, amount, underlying_amount, payload
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    'RESIDUAL_REDEEMED', $7, $8::numeric, $9::numeric, $10
                )
                ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
            )
            .bind(chain_id)
            .bind(&tx_hash)
            .bind(log_index)
            .bind(block_number)
            .bind(&series_str)
            .bind(round_id)
            .bind(&user)
            .bind(&amount)
            .bind(&underlying_returned)
            .bind(json!({ "claimAmount": amount, "underlyingReturned": underlying_returned }))
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO upside_positions (
                    chain_id, series_address, user_address,
                    upside_balance, residual_balance, total_residual_redeemed, updated_at
                ) VALUES (
                    $1, $2, $3,
                    0, -$4::numeric, $4::numeric, NOW()
                )
                ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                    residual_balance = GREATEST(0, upside_positions.residual_balance - $4::numeric),
                    total_residual_redeemed = upside_positions.total_residual_redeemed + $4::numeric,
                    updated_at = NOW()",
            )
            .bind(chain_id)
            .bind(&series_str)
            .bind(&user)
            .bind(&amount)
            .execute(&mut **tx)
            .await?;

            return Ok(true);
        }
    }

    // 3. Claim Token Transfer Events
    if let Some((series, is_upside)) = state.get_claim_market(&log.address) {
        if log_topic == topic(ERC20_TRANSFER_SIGNATURE) {
            let from = indexed_address(&raw_log, 1).ok_or("missing from")?;
            let to = indexed_address(&raw_log, 2).ok_or("missing to")?;
            let decoded = decode(&[ParamType::Uint(256)], &raw_log.data)?;
            let amount = u256_to_numeric_string(uint_token(&decoded, 0).ok_or("missing amount")?);

            let series_str = fmt_addr(&series);

            // Ignore mint (from=0) and burn (to=0) as they are handled in Minted/PairWithdrawn/Redeemed
            if from != Address::zero() && to != Address::zero() {
                let from_str = fmt_addr(&from);
                let to_str = fmt_addr(&to);

                if is_upside {
                    sqlx::query(
                        "INSERT INTO upside_positions (chain_id, series_address, user_address, upside_balance, updated_at)
                         VALUES ($1, $2, $3, -$4::numeric, NOW())
                         ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                             upside_balance = GREATEST(0, upside_positions.upside_balance - $4::numeric),
                             updated_at = NOW()",
                    )
                    .bind(chain_id)
                    .bind(&series_str)
                    .bind(&from_str)
                    .bind(&amount)
                    .execute(&mut **tx)
                    .await?;

                    sqlx::query(
                        "INSERT INTO upside_positions (chain_id, series_address, user_address, upside_balance, updated_at)
                         VALUES ($1, $2, $3, $4::numeric, NOW())
                         ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                             upside_balance = upside_positions.upside_balance + $4::numeric,
                             updated_at = NOW()",
                    )
                    .bind(chain_id)
                    .bind(&series_str)
                    .bind(&to_str)
                    .bind(&amount)
                    .execute(&mut **tx)
                    .await?;
                } else {
                    sqlx::query(
                        "INSERT INTO upside_positions (chain_id, series_address, user_address, residual_balance, updated_at)
                         VALUES ($1, $2, $3, -$4::numeric, NOW())
                         ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                             residual_balance = GREATEST(0, upside_positions.residual_balance - $4::numeric),
                             updated_at = NOW()",
                    )
                    .bind(chain_id)
                    .bind(&series_str)
                    .bind(&from_str)
                    .bind(&amount)
                    .execute(&mut **tx)
                    .await?;

                    sqlx::query(
                        "INSERT INTO upside_positions (chain_id, series_address, user_address, residual_balance, updated_at)
                         VALUES ($1, $2, $3, $4::numeric, NOW())
                         ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                             residual_balance = upside_positions.residual_balance + $4::numeric,
                             updated_at = NOW()",
                    )
                    .bind(chain_id)
                    .bind(&series_str)
                    .bind(&to_str)
                    .bind(&amount)
                    .execute(&mut **tx)
                    .await?;
                }

                let round_id: i64 = sqlx::query_scalar(
                    "SELECT round_id FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
                )
                .bind(chain_id)
                .bind(&series_str)
                .fetch_one(&mut **tx)
                .await
                .unwrap_or(0);

                sqlx::query(
                    "INSERT INTO upside_events (
                        chain_id, tx_hash, log_index, block_number, series_address, round_id,
                        event_type, actor_address, amount, payload
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6,
                        'CLAIM_TRANSFER', $7, $8::numeric, $9
                    )
                    ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING",
                )
                .bind(chain_id)
                .bind(&tx_hash)
                .bind(log_index)
                .bind(block_number)
                .bind(&series_str)
                .bind(round_id)
                .bind(&from_str)
                .bind(&amount)
                .bind(json!({
                    "tokenType": if is_upside { "UPSIDE" } else { "RESIDUAL" },
                    "from": from_str,
                    "to": to_str,
                    "amount": amount
                }))
                .execute(&mut **tx)
                .await?;
            }
            return Ok(true);
        }
    }

    Ok(false)
}

pub async fn rollback_upside_reorg(
    tx: &mut Transaction<'_, Postgres>,
    chain_id: i64,
    ancestor_block: u64,
) -> Result<(), sqlx::Error> {
    // 1. Delete events past ancestor
    sqlx::query(
        "DELETE FROM upside_events
         WHERE chain_id = $1 AND block_number > $2",
    )
    .bind(chain_id)
    .bind(ancestor_block as i64)
    .execute(&mut **tx)
    .await?;

    // 2. Delete markets created past ancestor
    sqlx::query(
        "DELETE FROM upside_markets
         WHERE chain_id = $1 AND created_block > $2",
    )
    .bind(chain_id)
    .bind(ancestor_block as i64)
    .execute(&mut **tx)
    .await?;

    // 3. Delete rounds created past ancestor
    sqlx::query(
        "DELETE FROM upside_rounds
         WHERE chain_id = $1 AND created_block > $2",
    )
    .bind(chain_id)
    .bind(ancestor_block as i64)
    .execute(&mut **tx)
    .await?;

    // 4. Reset settlement for any remaining markets that settled after ancestor
    sqlx::query(
        "UPDATE upside_markets
         SET is_settled = false,
             settled_price = NULL,
             settled_round_id = NULL,
             settled_timestamp = NULL,
             upside_allocation = NULL,
             residual_allocation = NULL,
             settled_at = NULL
         WHERE chain_id = $1 AND is_settled = true
           AND series_address NOT IN (
             SELECT series_address FROM upside_events
             WHERE chain_id = $1 AND event_type = 'SETTLED'
           )",
    )
    .bind(chain_id)
    .execute(&mut **tx)
    .await?;

    // 5. Reconstruct positions from surviving events
    sqlx::query("DELETE FROM upside_positions WHERE chain_id = $1")
        .bind(chain_id)
        .execute(&mut **tx)
        .await?;

    let events: Vec<(String, String, String, String, Option<String>, Option<serde_json::Value>)> = sqlx::query_as(
        "SELECT event_type, series_address, actor_address, amount::text, underlying_amount::text, payload
         FROM upside_events
         WHERE chain_id = $1
         ORDER BY block_number ASC, log_index ASC",
    )
    .bind(chain_id)
    .fetch_all(&mut **tx)
    .await?;

    for (ev_type, series_str, actor_str, amount_str, _underlying_str, payload_opt) in events {
        match ev_type.as_str() {
            "MINTED" => {
                sqlx::query(
                    "INSERT INTO upside_positions (
                        chain_id, series_address, user_address,
                        upside_balance, residual_balance, total_minted, updated_at
                    ) VALUES ($1, $2, $3, $4::numeric, $4::numeric, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        upside_balance = upside_positions.upside_balance + EXCLUDED.upside_balance,
                        residual_balance = upside_positions.residual_balance + EXCLUDED.residual_balance,
                        total_minted = upside_positions.total_minted + EXCLUDED.total_minted,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&actor_str)
                .bind(&amount_str)
                .execute(&mut **tx)
                .await?;
            }
            "PAIR_WITHDRAWN" => {
                sqlx::query(
                    "INSERT INTO upside_positions (
                        chain_id, series_address, user_address,
                        upside_balance, residual_balance, total_pair_withdrawn, updated_at
                    ) VALUES ($1, $2, $3, -$4::numeric, -$4::numeric, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        upside_balance = GREATEST(0, upside_positions.upside_balance - $4::numeric),
                        residual_balance = GREATEST(0, upside_positions.residual_balance - $4::numeric),
                        total_pair_withdrawn = upside_positions.total_pair_withdrawn + $4::numeric,
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
                    "INSERT INTO upside_positions (
                        chain_id, series_address, user_address,
                        upside_balance, residual_balance, total_upside_redeemed, updated_at
                    ) VALUES ($1, $2, $3, -$4::numeric, 0, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        upside_balance = GREATEST(0, upside_positions.upside_balance - $4::numeric),
                        total_upside_redeemed = upside_positions.total_upside_redeemed + $4::numeric,
                        updated_at = NOW()",
                )
                .bind(chain_id)
                .bind(&series_str)
                .bind(&actor_str)
                .bind(&amount_str)
                .execute(&mut **tx)
                .await?;
            }
            "RESIDUAL_REDEEMED" => {
                sqlx::query(
                    "INSERT INTO upside_positions (
                        chain_id, series_address, user_address,
                        upside_balance, residual_balance, total_residual_redeemed, updated_at
                    ) VALUES ($1, $2, $3, 0, -$4::numeric, $4::numeric, NOW())
                    ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                        residual_balance = GREATEST(0, upside_positions.residual_balance - $4::numeric),
                        total_residual_redeemed = upside_positions.total_residual_redeemed + $4::numeric,
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
                    let token_type = payload.get("tokenType").and_then(|v| v.as_str()).unwrap_or("");
                    let from_str = payload.get("from").and_then(|v| v.as_str()).unwrap_or("");
                    let to_str = payload.get("to").and_then(|v| v.as_str()).unwrap_or("");
                    if token_type == "UPSIDE" {
                        sqlx::query(
                            "UPDATE upside_positions
                             SET upside_balance = GREATEST(0, upside_balance - $1::numeric), updated_at = NOW()
                             WHERE chain_id = $2 AND series_address = $3 AND user_address = $4",
                        )
                        .bind(&amount_str)
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(from_str)
                        .execute(&mut **tx)
                        .await?;

                        sqlx::query(
                            "INSERT INTO upside_positions (chain_id, series_address, user_address, upside_balance, updated_at)
                             VALUES ($1, $2, $3, $4::numeric, NOW())
                             ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                                 upside_balance = upside_positions.upside_balance + EXCLUDED.upside_balance,
                                 updated_at = NOW()",
                        )
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(to_str)
                        .bind(&amount_str)
                        .execute(&mut **tx)
                        .await?;
                    } else if token_type == "RESIDUAL" {
                        sqlx::query(
                            "UPDATE upside_positions
                             SET residual_balance = GREATEST(0, residual_balance - $1::numeric), updated_at = NOW()
                             WHERE chain_id = $2 AND series_address = $3 AND user_address = $4",
                        )
                        .bind(&amount_str)
                        .bind(chain_id)
                        .bind(&series_str)
                        .bind(from_str)
                        .execute(&mut **tx)
                        .await?;

                        sqlx::query(
                            "INSERT INTO upside_positions (chain_id, series_address, user_address, residual_balance, updated_at)
                             VALUES ($1, $2, $3, $4::numeric, NOW())
                             ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
                                 residual_balance = upside_positions.residual_balance + EXCLUDED.residual_balance,
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

#[cfg(test)]
mod tests {
    use super::*;
    use ethers::abi::Token;
    use sqlx::postgres::PgPoolOptions;

    fn addr_to_h256(addr: Address) -> H256 {
        let mut bytes = [0u8; 32];
        bytes[12..32].copy_from_slice(addr.as_bytes());
        H256(bytes)
    }

    fn uint_to_h256(val: U256) -> H256 {
        let mut bytes = [0u8; 32];
        val.to_big_endian(&mut bytes);
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
    fn test_round_registered_config_abi() {
        let config_type = round_config_type();
        assert_eq!(
            UPSIDE_ROUND_REGISTERED_SIGNATURE,
            format!("RoundRegistered(uint256,address,address,{})", config_type)
        );
        let fields = match &config_type {
            ParamType::Tuple(fields) => fields,
            _ => panic!("expected tuple"),
        };
        assert_eq!(fields.len(), 13);
        let config: Vec<Token> = fields
            .iter()
            .map(|kind| match kind {
                ParamType::Address => Token::Address(Address::from_low_u64_be(1)),
                ParamType::Uint(_) => Token::Uint(42.into()),
                ParamType::FixedBytes(size) => Token::FixedBytes(vec![0xAA; *size]),
                _ => panic!("unexpected round field"),
            })
            .collect();
        let token = Token::Tuple(config);
        let encoded = ethers::abi::encode(&[token.clone()]);
        assert_eq!(decode(&[config_type.clone()], &encoded).unwrap(), vec![token]);
        assert!(decode(&[config_type], &[]).is_err());
    }

    #[test]
    fn test_upside_tracker_address_collection() {
        let factory = "0x1111111111111111111111111111111111111111".parse().unwrap();
        let series = "0x2222222222222222222222222222222222222222".parse().unwrap();
        let upside = "0x3333333333333333333333333333333333333333".parse().unwrap();
        let residual = "0x4444444444444444444444444444444444444444".parse().unwrap();

        let mut state = UpsideState::new(factory);
        state.track_claims(series, upside, residual);

        assert!(state.is_tracked_market(&series));
        assert_eq!(state.get_claim_market(&upside), Some((series, true)));
        assert_eq!(state.get_claim_market(&residual), Some((series, false)));

        let addrs = state.filter_addresses();
        assert_eq!(addrs.len(), 4);
        assert!(addrs.contains(&factory));
        assert!(addrs.contains(&series));
        assert!(addrs.contains(&upside));
        assert!(addrs.contains(&residual));
    }

    #[tokio::test]
    async fn test_upside_full_lifecycle_and_reorg_fixtures() {
        let Some(pool) = get_test_pool().await else {
            eprintln!("Skipping DB-backed upside test; DB unavailable");
            return;
        };

        let chain_id = 99998_i64; // Isolated test chain ID

        // Clean previous test data
        sqlx::query("DELETE FROM upside_events WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM upside_positions WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM upside_markets WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM upside_rounds WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();

        let factory: Address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".parse().unwrap();
        let underlying: Address = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".parse().unwrap();
        let feed: Address = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC".parse().unwrap();
        let adapter: Address = "0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD".parse().unwrap();
        let series: Address = "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE".parse().unwrap();
        let up_token: Address = "0x1111111111111111111111111111111111111111".parse().unwrap();
        let res_token: Address = "0x2222222222222222222222222222222222222222".parse().unwrap();
        let creator: Address = "0x3333333333333333333333333333333333333333".parse().unwrap();
        let user_a: Address = "0x4444444444444444444444444444444444444444".parse().unwrap();
        let user_b: Address = "0x5555555555555555555555555555555555555555".parse().unwrap();

        let mut state = UpsideState::new(factory);

        // 1. RoundRegistered at block 100
        let tx1 = H256::from_low_u64_be(1);
        let round_tuple = Token::Tuple(vec![
            Token::Address(underlying),
            Token::Address(feed),
            Token::Address(adapter),
            Token::Uint(1001.into()), // referenceRoundId
            Token::Uint(500_00000000u64.into()), // referencePrice = $500
            Token::Uint(1750000000u64.into()), // referenceTime
            Token::Uint(1750000000u64.into()), // roundStart
            Token::Uint(1750604800u64.into()), // expiryTimestamp
            Token::Uint(25_00000000u64.into()), // expectedMove = $25
            Token::FixedBytes(vec![0xAA; 32]), // provenanceHash
            Token::Uint(1_00000000u64.into()), // strikeTick = $1
            Token::Uint(400_00000000u64.into()), // minStrike = $400
            Token::Uint(600_00000000u64.into()), // maxStrike = $600
        ]);
        let round_data = ethers::abi::encode(&[round_tuple]);
        let log_round = make_raw_log(
            factory,
            vec![
                topic(UPSIDE_ROUND_REGISTERED_SIGNATURE),
                uint_to_h256(1.into()), // roundId = 1
                addr_to_h256(underlying),
                addr_to_h256(feed),
            ],
            round_data,
            100,
            tx1,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_round).await.unwrap());
        tx.commit().await.unwrap();

        let round_id: i64 = sqlx::query_scalar(
            "SELECT round_id FROM upside_rounds WHERE chain_id = $1 AND round_id = 1",
        )
        .bind(chain_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(round_id, 1);

        // 3. MarketCreated at block 102
        let tx3 = H256::from_low_u64_be(3);
        let market_data = ethers::abi::encode(&[
            Token::Address(up_token),
            Token::Address(res_token),
            Token::Address(creator),
        ]);
        let log_market = make_raw_log(
            factory,
            vec![
                topic(UPSIDE_MARKET_CREATED_SIGNATURE),
                uint_to_h256(1.into()), // roundId = 1
                uint_to_h256(525_00000000u64.into()), // strike = $525
                addr_to_h256(series),
            ],
            market_data,
            102,
            tx3,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_market).await.unwrap());
        tx.commit().await.unwrap();

        assert!(state.is_tracked_market(&series));
        assert_eq!(state.get_claim_market(&up_token), Some((series, true)));
        assert_eq!(state.get_claim_market(&res_token), Some((series, false)));

        let market_row: (String, bool) = sqlx::query_as(
            "SELECT strike_price::text, is_settled FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(market_row.0.trim(), "52500000000");
        assert!(!market_row.1);

        // 4. Minted for User A at block 103: 100 shares
        let tx4 = H256::from_low_u64_be(4);
        let log_mint = make_raw_log(
            series,
            vec![
                topic(UPSIDE_MINTED_SIGNATURE),
                addr_to_h256(user_a),
            ],
            ethers::abi::encode(&[Token::Uint(100_00000000u64.into())]),
            103,
            tx4,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_mint).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a: (String, String, String) = sqlx::query_as(
            "SELECT upside_balance::text, residual_balance::text, total_minted::text
             FROM upside_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
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

        // 5. PairWithdrawn for User A at block 104: 20 shares
        let tx5 = H256::from_low_u64_be(5);
        let log_withdraw = make_raw_log(
            series,
            vec![
                topic(UPSIDE_PAIR_WITHDRAWN_SIGNATURE),
                addr_to_h256(user_a),
            ],
            ethers::abi::encode(&[Token::Uint(20_00000000u64.into())]),
            104,
            tx5,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_withdraw).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a_withdrawn: (String, String, String) = sqlx::query_as(
            "SELECT upside_balance::text, residual_balance::text, total_pair_withdrawn::text
             FROM upside_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_a_withdrawn.0.trim(), "8000000000");
        assert_eq!(pos_a_withdrawn.1.trim(), "8000000000");
        assert_eq!(pos_a_withdrawn.2.trim(), "2000000000");

        // 6. User A transfers 30 upside tokens to User B at block 105
        let tx6 = H256::from_low_u64_be(6);
        let log_transfer = make_raw_log(
            up_token,
            vec![
                topic(ERC20_TRANSFER_SIGNATURE),
                addr_to_h256(user_a),
                addr_to_h256(user_b),
            ],
            ethers::abi::encode(&[Token::Uint(30_00000000u64.into())]),
            105,
            tx6,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_transfer).await.unwrap());
        tx.commit().await.unwrap();

        let pos_a_up: (String,) = sqlx::query_as(
            "SELECT upside_balance::text FROM upside_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_a_up.0.trim(), "5000000000"); // 80 - 30 = 50

        let pos_b_up: (String,) = sqlx::query_as(
            "SELECT upside_balance::text FROM upside_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_b))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_b_up.0.trim(), "3000000000");

        // 7. SettledWithFixing at block 106: price = $550, roundId = 2002
        let tx7 = H256::from_low_u64_be(7);
        let settle_data = ethers::abi::encode(&[
            Token::Uint(550_00000000u64.into()), // price = $550
            Token::Uint(2002.into()), // roundId = 2002
            Token::Uint(1750604850u64.into()), // timestamp
            Token::Uint(25_00000000u64.into()), // uAlloc
            Token::Uint(525_00000000u64.into()), // rAlloc
        ]);
        let log_settle = make_raw_log(
            series,
            vec![topic(UPSIDE_SETTLED_WITH_FIXING_SIGNATURE)],
            settle_data,
            106,
            tx7,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_settle).await.unwrap());
        tx.commit().await.unwrap();

        let settled_row: (bool, String, String) = sqlx::query_as(
            "SELECT is_settled, settled_price::text, settled_round_id::text
             FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(settled_row.0);
        assert_eq!(settled_row.1.trim(), "55000000000");
        assert_eq!(settled_row.2.trim(), "2002");

        // 8. UpsideRedeemed for User B at block 107: 30 shares
        let tx8 = H256::from_low_u64_be(8);
        let log_redeem = make_raw_log(
            series,
            vec![
                topic(UPSIDE_REDEEMED_SIGNATURE),
                addr_to_h256(user_b),
            ],
            ethers::abi::encode(&[
                Token::Uint(30_00000000u64.into()), // claimAmount
                Token::Uint(1_36363636u64.into()), // underlyingReturned
            ]),
            107,
            tx8,
            0,
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(process_upside_log(&mut state, &mut tx, chain_id, &log_redeem).await.unwrap());
        tx.commit().await.unwrap();

        let pos_b_after_red: (String, String) = sqlx::query_as(
            "SELECT upside_balance::text, total_upside_redeemed::text
             FROM upside_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .bind(fmt_addr(&user_b))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(pos_b_after_red.0.trim(), "0");
        assert_eq!(pos_b_after_red.1.trim(), "3000000000");

        // 9. Test reload state from DB
        let reloaded = UpsideState::load_from_db(&pool, chain_id, factory)
            .await
            .unwrap();
        assert!(reloaded.is_tracked_market(&series));
        assert_eq!(reloaded.get_claim_market(&up_token), Some((series, true)));
        assert_eq!(reloaded.get_claim_market(&res_token), Some((series, false)));

        // 10. Reorg rollback test: Rollback to block 105 (before settlement at 106 and redemption at 107)
        let mut tx = pool.begin().await.unwrap();
        rollback_upside_reorg(&mut tx, chain_id, 105).await.unwrap();
        tx.commit().await.unwrap();

        // Market must be reset to unsettled
        let market_rolled_back: (bool, Option<String>) = sqlx::query_as(
            "SELECT is_settled, settled_price::text
             FROM upside_markets WHERE chain_id = $1 AND series_address = $2",
        )
        .bind(chain_id)
        .bind(fmt_addr(&series))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!market_rolled_back.0);
        assert_eq!(market_rolled_back.1, None);

        // User B's upside balance restored to 30 shares and total_upside_redeemed restored to 0
        let pos_b_restored: (String, String) = sqlx::query_as(
            "SELECT upside_balance::text, total_upside_redeemed::text
             FROM upside_positions WHERE chain_id = $1 AND series_address = $2 AND user_address = $3",
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
        sqlx::query("DELETE FROM upside_events WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM upside_positions WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM upside_markets WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM upside_rounds WHERE chain_id = $1")
            .bind(chain_id)
            .execute(&pool)
            .await
            .unwrap();
    }
}
