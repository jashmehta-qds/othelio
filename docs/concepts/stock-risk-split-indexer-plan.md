# Stock Risk-Split: Indexer Architecture Plan & Ingestion Specification

**Technical Specification · October 2026**
*Companion documents:* [Architecture Proposal](stock-risk-split-architecture.md) · [Payoff Research Paper](stock-risk-split-research-paper.md) · [Migration Schema](../../database/migrations/019_risk_split_series.sql)

---

## 1. Executive Summary & Purpose

The Othelio Standalone Stock Risk-Split Protocol partitions a single transferable tokenized stock (such as Coinbase B20 MSFTc or AAPLc) into two complementary ERC-20 claims per series:
1. **Protected Claim Token (`PROT`)**: Absorbs initial downside up to Floor $F$, and caps at Cap $C$.
2. **Upside Claim Token (`UP`)**: Captures leveraged participation when underlying price exceeds Floor $F$, and uncapped upside above $2C$.

The onchain protocol is executed by two smart contracts:
- `SeriesFactory.sol`: Deploys individual series vaults and initializes their two associated `ClaimToken` ERC-20 contracts.
- `RiskSplitSeries.sol`: Holds the raw underlying token collateral in escrow, coordinates 1:1 pair minting and burns (`combineAndRedeem`), processes single expiry settlement via `SettlementAdapter.sol`, and pays out underlying upon single claim redemption.

To provide instant UI/API queries without querying Base RPC nodes for historical logs on every request, the **Rust Indexer** (`indexer/`) continuously polls the Base chain, tracks block headers, processes event logs, maintains worker lease checkpoints, and writes canonical data into Postgres tables:
- `risk_split_series`
- `risk_split_events`
- `risk_split_positions`

This document defines the ingestion lifecycle, event topics, database write semantics, block reorg rollback handling, and state reconciliation.

---

## 2. Ingestion Pipeline Architecture

```mermaid
flowchart TD
    subgraph Base L2
        RPC[Base RPC Node]
        SF[SeriesFactory]
        RS[RiskSplitSeries Vaults]
        CT[ClaimTokens]
    end

    subgraph Rust Indexer ("indexer/")
        Poller[Block & Log Poller Loop]
        ReorgDetector[Reorg & Parent Hash Detector]
        Dispatcher[RiskSplit Event Dispatcher]
        Reconciler[Balance Reconciler Task]
    end

    subgraph PostgreSQL Database
        TSeries[(risk_split_series)]
        TEvents[(risk_split_events)]
        TPositions[(risk_split_positions)]
        TWorker[(indexer_worker_state)]
    end

    subgraph NestJS Backend ("backend/")
        API[RiskSplitService / Controller]
    end

    SF -->|SeriesCreated| Poller
    RS -->|Minted, PairRedeemed, Settled, Redeemed| Poller
    CT -->|Transfer| Poller
    RPC -->|Block Headers| Poller

    Poller --> ReorgDetector
    ReorgDetector -->|Valid Range| Dispatcher
    ReorgDetector -->|Fork Detected| Dispatcher

    Dispatcher -->|Upsert Series| TSeries
    Dispatcher -->|Append Deduplicated Logs| TEvents
    Dispatcher -->|Update Balances| TPositions
    Dispatcher -->|Commit Safe Head| TWorker

    Reconciler -.->|Periodic Onchain Audit| RS
    Reconciler -.->|Audit Diff| TPositions

    TSeries --> API
    TEvents --> API
    TPositions --> API
```

---

## 3. Monitored Contracts & Event Signatures

### 3.1 SeriesFactory Events

| Event Name | Signature & Topic0 | Indexed Parameters | Unindexed Parameters |
| :--- | :--- | :--- | :--- |
| `SeriesCreated` | `SeriesCreated(address,address,uint256,uint256,uint256,address)` | `address indexed seriesAddress`<br>`address indexed underlying` | `uint256 floorPrice`<br>`uint256 capPrice`<br>`uint256 expiry`<br>`address settlementAdapter` |

#### Ingestion Flow:
1. Parse log data:
   - `series_address = format_address(log.topics[1])`
   - `underlying_address = format_address(log.topics[2])`
   - `(floor_price, cap_price, expiry) = decode(log.data)`
2. Query the newly deployed series via multicall on the same block:
   - `RiskSplitSeries(series_address).settlementAdapter()`
   - `RiskSplitSeries(series_address).protectedToken()`
   - `RiskSplitSeries(series_address).upsideToken()`
3. Write to Postgres `risk_split_series`:
   ```sql
   INSERT INTO risk_split_series (
     chain_id,
     series_address,
     underlying_address,
     protected_token_address,
     upside_token_address,
     settlement_adapter_address,
     floor_price,
     cap_price,
     expiry_timestamp,
     created_block,
     created_tx,
     is_settled,
     created_at
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, now())
   ON CONFLICT (chain_id, series_address) DO UPDATE SET
     protected_token_address = COALESCE(risk_split_series.protected_token_address, EXCLUDED.protected_token_address),
     upside_token_address = COALESCE(risk_split_series.upside_token_address, EXCLUDED.upside_token_address);
   ```
4. Register `series_address` into the indexer's in-memory dynamic filter watchlist so subsequent vault events are monitored automatically.

---

### 3.2 RiskSplitSeries Vault Events

| Event Name | Event Signature | Purpose |
| :--- | :--- | :--- |
| `Minted` | `Minted(address indexed caller, uint256 amount)` | Escrows underlying, mints equal Protected & Upside tokens 1:1 |
| `PairRedeemed` | `PairRedeemed(address indexed caller, uint256 amount)` | Burns equal pair of Protected & Upside tokens, unlocks underlying 1:1 |
| `Settled` | `Settled(uint256 settlementPrice, uint256 protectedFraction, uint256 upsideFraction)` | Fixes final settlement price and fractions at or after expiry |
| `ProtectedRedeemed` | `ProtectedRedeemed(address indexed caller, uint256 amount, uint256 underlyingOut)` | Burns Protected claim token, releases calculated underlying |
| `UpsideRedeemed` | `UpsideRedeemed(address indexed caller, uint256 amount, uint256 underlyingOut)` | Burns Upside claim token, releases calculated underlying |

---

## 4. Database Mutations & Event Processing

All database writes for an event block execute within an explicit `sqlx::Transaction`.

### 4.1 Ingesting `Minted`
1. Append to `risk_split_events`:
   ```sql
   INSERT INTO risk_split_events (
     chain_id, tx_hash, log_index, block_number, series_address,
     event_type, actor_address, amount, underlying_amount, payload, occurred_at
   ) VALUES (
     $1, $2, $3, $4, $5,
     'MINTED', $6, $7, $7,
     jsonb_build_object('type', 'mint', 'shares', $7::text),
     $8
   ) ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING;
   ```
2. Upsert user position in `risk_split_positions`:
   ```sql
   INSERT INTO risk_split_positions (
     chain_id, series_address, user_address,
     protected_balance, upside_balance, total_minted,
     total_paired_redeemed, total_protected_redeemed, total_upside_redeemed,
     updated_at
   ) VALUES ($1, $2, $3, $4, $4, $4, 0, 0, 0, now())
   ON CONFLICT (chain_id, series_address, user_address) DO UPDATE SET
     protected_balance = risk_split_positions.protected_balance + EXCLUDED.protected_balance,
     upside_balance = risk_split_positions.upside_balance + EXCLUDED.upside_balance,
     total_minted = risk_split_positions.total_minted + EXCLUDED.total_minted,
     updated_at = now();
   ```

### 4.2 Ingesting `PairRedeemed`
1. Append to `risk_split_events`:
   ```sql
   INSERT INTO risk_split_events (
     chain_id, tx_hash, log_index, block_number, series_address,
     event_type, actor_address, amount, underlying_amount, payload, occurred_at
   ) VALUES (
     $1, $2, $3, $4, $5,
     'PAIR_REDEEMED', $6, $7, $7,
     jsonb_build_object('type', 'pair_redeemed', 'shares', $7::text),
     $8
   ) ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING;
   ```
2. Update user position:
   ```sql
   UPDATE risk_split_positions SET
     protected_balance = GREATEST(0, protected_balance - $4),
     upside_balance = GREATEST(0, upside_balance - $4),
     total_paired_redeemed = total_paired_redeemed + $4,
     updated_at = now()
   WHERE chain_id = $1 AND series_address = $2 AND user_address = $3;
   ```

### 4.3 Ingesting `Settled`
1. Append to `risk_split_events`:
   ```sql
   INSERT INTO risk_split_events (
     chain_id, tx_hash, log_index, block_number, series_address,
     event_type, actor_address, amount, underlying_amount, payload, occurred_at
   ) VALUES (
     $1, $2, $3, $4, $5,
     'SETTLED', $5, 0, NULL,
     jsonb_build_object(
       'settlementPrice', $6::text,
       'protectedFraction', $7::text,
       'upsideFraction', $8::text
     ),
     $9
   ) ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING;
   ```
2. Transition series state in `risk_split_series`:
   ```sql
   UPDATE risk_split_series SET
     is_settled = true,
     settled_price = $3,
     protected_fraction = $4,
     upside_fraction = $5,
     settled_at = now()
   WHERE chain_id = $1 AND series_address = $2;
   ```

### 4.4 Ingesting `ProtectedRedeemed` & `UpsideRedeemed`
1. Append to `risk_split_events` with `event_type = 'PROTECTED_REDEEMED'` or `'UPSIDE_REDEEMED'`.
2. Deduct redeemed token balance and increment cumulative redemption counter:
   - For `ProtectedRedeemed`: deduct `amount` from `protected_balance`, add `amount` to `total_protected_redeemed`.
   - For `UpsideRedeemed`: deduct `amount` from `upside_balance`, add `amount` to `total_upside_redeemed`.

---

## 5. Secondary Market Transfers (`ClaimToken.sol`)

Holders may transfer or trade individual claim tokens on secondary AMMs (such as Aerodrome Slipstream or Uniswap pools) without interacting with the vault directly.

To maintain 100% position accuracy:
1. Indexer tracks standard ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)` for all known `protected_token_address` and `upside_token_address` contracts.
2. If `from != address(0)` (not a mint) and `from != series_address` and `to != series_address` (not a vault burn):
   - Deduct `value` from sender's `protected_balance` or `upside_balance`.
   - Add `value` to recipient's `protected_balance` or `upside_balance`.

---

## 6. Block Reorg Handling & Idempotency Strategy

Base L2 uses OP Stack block production with deterministic sequencer batches, but short-lived reorganizations can occur during sequencer failovers or L1 state transitions. The indexer guarantees resilience through a three-stage defense:

### 6.1 Parent Hash Verification Loop
The indexer tracks a sliding window of the last 64 processed block headers `(block_number, block_hash, parent_hash)`:
```rust
if current_block.parent_hash != cached_header.block_hash {
    warn!("Reorganization detected at block {}", current_block.number);
    handle_reorg(pool, chain_id, current_block.number.as_u64()).await?;
}
```

### 6.2 Rollback Execution
When a reorganization of depth $k$ is detected at block $N$:
1. **Rollback Events**:
   ```sql
   DELETE FROM risk_split_events
   WHERE chain_id = $1 AND block_number >= $2;
   ```
2. **Recompute State**:
   - For `risk_split_series`: If `created_block >= $2`, delete the series row; if a settlement occurred at or after `$2`, reset `is_settled = false`, `settled_price = null`, `protected_fraction = null`, `upside_fraction = null`.
   - For `risk_split_positions`: Positions affected by rolled-back events are re-derived by aggregating remaining events in `risk_split_events`, or refreshed via onchain `balanceOf` multicalls.
3. **Reset Worker Checkpoint**:
   ```sql
   UPDATE indexer_worker_state
   SET next_block = $2, last_success_block = $2 - 1, updated_at = now()
   WHERE chain_id = $1 AND worker_name = 'risk_split';
   ```

### 6.3 Finality Depth and Safe Head Tracking
- Unsettled blocks are processed with a standard 2-block confirmation delay on Base to filter micro-forks.
- Critical settlement transactions (`Settled`) require L1 finality or 12 Base blocks before setting irreversible flags in frontend caches.

---

## 7. Periodic Onchain Reconciliation

Even with reorg protection, network RPC dropouts could miss a Transfer log. An independent async reconciliation worker runs every 10 minutes:
1. Selects all active series and accounts with non-zero claim balances from `risk_split_positions`.
2. Executes a batched `eth_call` multicall reading:
   - `protectedToken.balanceOf(user)`
   - `upsideToken.balanceOf(user)`
   - `underlying.balanceOf(series)`
3. Corrects any discrepancy in `risk_split_positions` and logs an audit record if a drift is detected.

---

## 8. Integration with Backend NestJS API

The backend module (`backend/src/risksplit/`):
- Reads directly from Postgres using indexed queries on `(chain_id, series_address)` and `(chain_id, series_address, user_address)`.
- Falls back transparently to in-memory/mock models during local development or when the database connection is interrupted.
- Uses exact BigInt payoff calculations mirroring `RiskSplitSeries.sol` across all 5 price regimes for live quote previews and interactive charts.
