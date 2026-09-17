# Pass 1: Lean, normalized valuation history

## Implementation handoff — read first

This document is the accepted implementation specification for Gemini (or any
other implementer). Implement **only Pass 1**. Do not add lending refresh,
balance reconciliation, P&L accounting, a new protocol adapter, or a generic
job framework as part of this work.

### Product intent

Othelio needs a portfolio history graph that is truthful and scalable:

- a funding, withdrawal, or rebalance must appear immediately after it is
  confirmed and indexed;
- between transactions, the graph must move when oracle prices move;
- an hourly graph point must not require reading every basket's balances from
  RPC;
- missing data must remain missing, never become a synthetic $0 value or a
  fabricated smooth return curve.

### Fixed architectural choices

These are decisions, not implementation options:

1. The EVM chain is authoritative. Database state is a rebuildable read model
   and never authorizes a contract action.
2. An event checkpoint reads exact Safe balances and feeds at its event block.
3. An hourly run reads each configured asset feed once at one finalized block;
   it performs no Safe-balance RPC reads.
4. Current and historical quantities are represented as exact base-unit
   integers. Floating point must not be used for persisted quantities or NAV.
5. One normalized table exists for each fact: positions, prices, and NAV. Do
   not retain a compatibility table, compatibility view, dual writer, or JSON
   snapshot payload.
6. This is pre-production. Reset and replace the local database schema; do
   not preserve old local data.

### Definition of done

Pass 1 is complete only when all of the following are demonstrated:

- an Othelio event creates versioned positions, canonical prices, and an
  ‘EVENT’ NAV observation at one matching block;
- changing a mock feed without changing a Safe balance creates a later
  ‘HOURLY’ NAV observation with the same position version and a new price
  version;
- the 1D/7D/30D graph renders only those real observations;
- one hourly run's number of RPC feed reads scales with configured assets,
  not basket count;
- the migration leaves no unused legacy valuation table or legacy frontend
  reader behind;
- backend, indexer, and frontend checks pass.

### Required implementation order

Do these in order. Do not start the UI/API migration before the schema and
indexer writer have tested data.

1. Write the destructive schema-reset migration and update local bootstrap
   documentation/configuration.
2. Convert the event checkpoint writer and add indexer tests for the three
   canonical facts.
3. Add the hourly scheduler, locking, price writer, and set-based NAV writer.
4. Add API query/tests over the new NAV table.
5. Point the existing graph at the final API response and remove legacy
   cost-basis/P&L UI reads.
6. Run the end-to-end Anvil proof with a changed mock oracle price.

### Out of scope and prohibited shortcuts

- Do not calculate a graph series in React from current NAV, activity, or
  hard-coded price drift.
- Do not use the raw DEX execution price as portfolio NAV; NAV uses the
  configured oracle price at its pinned valuation block.
- Do not create a basket-by-basket hourly RPC loop.
- Do not store JSON holdings/prices merely to avoid writing normalized rows.
- Do not use `f64`, JavaScript `number`, or SQL `float` for the stored
  calculation. Use integer base units and SQL `numeric` / Rust decimal-safe
  arithmetic.
- Do not implement Aave state refresh in this pass. Baskets with future debt
  must not be presented as fully valued by this spot-only pipeline.

## Decision

Build one canonical data model for positions, prices, and NAV. Do not preserve
or add overlapping “history” tables merely because they already exist.

```text
raw confirmed events        -> basket_events
exact position version      -> basket_positions
one shared price per asset  -> asset_price_observations
one materialized NAV point  -> basket_nav_observations
```

The chain remains the source of truth. These tables are an indexed,
rebuildable read model for product UX and analytics; they never authorize
contract actions.

## Why this is the right shape

An hourly price update should not perform an RPC balance read for every
basket. Holdings do not change between portfolio-changing transactions, while
prices do. The hourly worker reads each configured oracle once at a pinned
block, then revalues indexed position versions in the database.

The model remains auditable:

- every position version identifies the chain block it came from;
- every price identifies the same valuation block and Chainlink round;
- every NAV point identifies both the position and price versions used;
- a later reconciliation can add a corrected position/NAV version without
  overwriting history.

## Existing-table cleanup

The current schema contains three partly overlapping legacy models:

- `basket_snapshots` stores NAV plus duplicate holdings/prices JSON;
- `asset_price_history` stores quote/symbol-oriented prices without full
  oracle provenance;
- `basket_positions` mixes quantities with optional cost-basis/P&L fields.

Only `basket_positions.total_cost_basis_usdc`, `avg_cost_usdc`, and
`realized_pnl_usdc` have frontend readers today. There is no canonical
writer for the legacy price-history table or cost-basis fields.

Because this deployment is still pre-production, Pass 1 should replace—not
extend—the legacy valuation schema:

1. retain `basket_events`, `baskets`, and `basket_assets`;
2. replace `basket_positions` with a normalized, versioned position table;
3. replace `asset_price_history` with canonical oracle observations;
4. replace `basket_snapshots` with compact NAV observations;
5. remove frontend reliance on unpopulated cost-basis/P&L fields until a
   separately designed accounting/tax-lot feature exists.

This is fewer concepts and eliminates JSON duplication. It is a clean reset;
there is no migration compatibility requirement for old local data.

## Target schema

### 1. `basket_positions`: exact versioned holdings

This is an append-only position history, not a mutable cost-basis row. The
latest record per `(chain, basket, asset)` is the current indexed balance.

```sql
CREATE TABLE basket_positions (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  asset_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  block_timestamp timestamptz NOT NULL,
  quantity_base_units numeric(78, 0) NOT NULL,
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  source text NOT NULL CHECK (source IN ('EVENT', 'RECONCILIATION')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, asset_address, block_number),
  FOREIGN KEY (chain_id, basket_address)
    REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);
CREATE INDEX basket_positions_latest_idx
  ON basket_positions (chain_id, basket_address, asset_address, block_number DESC);
```

At an event/reconciliation block, write one row for **every configured
supported asset**, including zero balances. This makes a zero balance explicit
and makes the latest version query correct without delete semantics.

### 2. `asset_price_observations`: shared canonical oracle facts

```sql
CREATE TABLE asset_price_observations (
  chain_id bigint NOT NULL,
  asset_address char(42) NOT NULL,
  feed_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  block_timestamp timestamptz NOT NULL,
  feed_round_id numeric(78, 0) NOT NULL,
  price_usd_e8 numeric(78, 0) NOT NULL,
  feed_updated_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, asset_address, block_number)
);
CREATE INDEX asset_price_observations_latest_idx
  ON asset_price_observations (chain_id, asset_address, block_number DESC);
```

One run selects one finalized block and writes one row per supported asset at
that block. The asset registry is metadata/configuration; neither symbol nor
quote-token fields are duplicated here.

### 3. `basket_nav_observations`: compact graph-ready values

```sql
CREATE TABLE basket_nav_observations (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  block_timestamp timestamptz NOT NULL,
  position_block_number bigint NOT NULL,
  price_block_number bigint NOT NULL,
  nav_usdc numeric(38, 6),
  kind text NOT NULL CHECK (kind IN ('EVENT', 'HOURLY', 'RECONCILIATION')),
  valuation_status text NOT NULL CHECK (valuation_status IN ('COMPLETE', 'UNAVAILABLE')),
  issue text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, block_number, kind),
  FOREIGN KEY (chain_id, basket_address)
    REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);
CREATE INDEX basket_nav_history_idx
  ON basket_nav_observations (chain_id, basket_address, block_timestamp DESC)
  WHERE valuation_status = 'COMPLETE';
```

NAV is intentionally stored. It is a small materialized fact for fast
historical graphs, not a substitute for holdings or an untraceable duplicate:
each row points to the exact position and price blocks used.

## Required migration

Create one destructive pre-production migration,
`011_replace_legacy_valuation_schema.sql`.

It must:

1. drop `basket_snapshots`, `asset_price_history`, and the legacy
   `basket_positions` after explicitly documenting this reset;
2. create the three target tables above and their indexes;
3. remove backend/frontend reads of legacy cost basis and P&L;
4. require a local DB reset in the deployment/runbook.

Do not keep nullable legacy columns, compatibility views, duplicate JSON
payloads, or dual writers. The user has explicitly accepted a clean local
reset; production has not launched.

## File-by-file implementation map

| Area | Files | Required change |
| --- | --- | --- |
| Database | `database/migrations/011_replace_legacy_valuation_schema.sql` | Drop the three legacy valuation tables and create exactly the three target tables and indexes. This migration is destructive by design. |
| Local operations | `contracts/script/bootstrap-local-anvil.sh`, `README.md`, `.env.example`, and/or `docker-compose.yml` where appropriate | Document that applying this migration requires the local database reset. Add `VALUATION_INTERVAL_SECS`; local default may be short for the proof, production default is 3600. |
| Event indexer | `indexer/src/main.rs` | Replace `write_canonical_spot_snapshot` with the normalized event checkpoint described below. Remove all writes to legacy `basket_snapshots`. |
| Hourly indexer | `indexer/src/main.rs` (or a small indexer-local module if it improves testability) | Add the bounded scheduler, advisory lock, shared feed reads, bulk price insert, and set-based NAV insert. Do not add a general background-job service. |
| Backend | `backend/src/baskets/baskets.service.ts`, `backend/src/baskets/baskets.controller.ts`, associated specs | Change valuation-history to read `basket_nav_observations`. Preserve its response contract unless a frontend change is made in the same change set. |
| Frontend | `fe/src/hooks/useBaskets.ts`, `fe/src/features/overview/PortfolioPerformanceGraph.tsx`, `fe/src/features/overview/OverviewDashboard.tsx`, plus current cost-basis readers in basket views | Continue to render actual API observations only. Remove reads of unpopulated legacy cost/P&L values; show unavailable/unknown rather than inventing a cost basis. |

No smart-contract change is required for Pass 1.

## Calculation contract

For every position row, the value in USDC micro-units is:

```text
quantity_base_units * price_usd_e8 * 1_000_000
------------------------------------------------
10^decimals * 100_000_000
```

Sum those values per basket, then store the resulting NAV with six decimal
places. Implement this with exact database `numeric` arithmetic or exact
integer arithmetic; do not convert through binary floating point.

An hourly NAV observation must reference:

- `position_block_number`: the latest indexed balance checkpoint for that
  basket/asset set;
- `price_block_number`: the one finalized block selected by the hourly run;
- `block_number` / `block_hash`: the price/valuation block for the observation.

For an event NAV observation, all three block numbers must be the event block.

## Scheduler and idempotency details

The indexer already owns the block-poll loop. Add a monotonic “next valuation
due” check there; do not use a second process or cron job in Pass 1.

- `VALUATION_INTERVAL_SECS=0` disables the tick.
- Before a tick, ensure `current_block > target_block` so normal event
  indexing has processed the selected block.
- Use `pg_try_advisory_lock(chain_id)` and release it in a `finally` path.
- If the lock is unavailable, log a single structured skip and return.
- If the selected price block already exists for an asset, use conflict-safe
  insert semantics. A repeated run must not create extra observations.
- A failure for one feed may not be silently replaced with its previous price.
  Mark dependent basket NAV rows `UNAVAILABLE` with a useful issue, then
  continue valuing independent baskets where safe to do so.
- Bound one run at a time. If a run takes longer than the interval, do not run
  another concurrently; the next due run begins after completion.

## Indexer implementation

### Event checkpoint

Change `write_canonical_spot_snapshot` in `indexer/src/main.rs` into an
event valuation checkpoint:

1. select the event block and read its timestamp/hash;
2. read supported-asset Safe balances and configured feeds at that block;
3. validate every required oracle price;
4. insert a versioned row for every supported asset into
   `basket_positions`;
5. insert the corresponding oracle rows into
   `asset_price_observations` if this block has not already been observed;
6. calculate NAV with exact integer/decimal arithmetic;
7. insert `basket_nav_observations(kind = 'EVENT')`.

The position/price/NAV writes must be one database transaction. A failed
price read writes an `UNAVAILABLE` NAV row with an issue; it must never
write $0.

### Hourly price tick

Add a single scheduler to the existing indexer loop:

- `VALUATION_INTERVAL_SECS=3600` in production; `0` disables it;
- acquire a PostgreSQL advisory lock per chain;
- wait until normal event indexing has caught up;
- choose one finalized block and fetch its timestamp/hash;
- read every configured oracle at that exact block once;
- bulk insert `asset_price_observations`;
- use a set-based SQL query to choose each asset's latest position version
  and calculate each active basket's NAV against the just-inserted prices;
- bulk insert `basket_nav_observations(kind = 'HOURLY')`;
- release the lock and record duration, basket count, price count, and
  unavailable valuations.

The hourly path does **zero basket-balance RPC calls**.

## API and UI

Replace the current implementation of:

```text
GET /v1/baskets/valuation-history?chainId=&controller=&timeframe=
```

to query `basket_nav_observations`.

It must:

- accept only `1D`, `7D`, and `30D`;
- include only `COMPLETE` observations;
- use the latest point before the cutoff as the opening baseline;
- calculate an as-of aggregate: at each observation timestamp, include each
  basket's latest completed NAV rather than treating inactive baskets as zero;
- return real timestamps only—no hourly zero-fill, interpolation, or
  synthetic drift.

The existing graph remains a direct renderer of returned points. It should
continue to show observed coverage when a fresh environment has insufficient
history.

## Explicitly deferred

- on-chain rotating balance reconciliation;
- Aave collateral/debt accrual and health-factor refresh;
- tax lots, realized P&L, and average-cost accounting;
- retention/downsampling policy after the initial launch window;
- use of indexed data for any on-chain authorization.

## Validation and rollout

1. Reset local DB and run the migration.
2. Event test: fund/rebalance/withdraw and assert exact versioned balances,
   price facts, and event NAV provenance.
3. Hourly test: move a mock oracle price without changing balances; assert a
   new hourly NAV row and unchanged latest position version.
4. Scale test: create many baskets and assert one hourly run reads every
   configured feed once, not each basket balance.
5. API test: 1D/7D/30D differ only when actual observations differ; inactive
   baskets are carried forward in the aggregate.
6. Lock/idempotency test: concurrent hourly invocations create no duplicate
   rows.
7. Enable Anvil at a short interval, staging at one hour, then production
   only after oracle-freshness and lag alerts are wired.
