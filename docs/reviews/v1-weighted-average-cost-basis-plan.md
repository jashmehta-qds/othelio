# V1 Weighted-Average Cost Basis Plan

## Decision and scope

V1 will show truthful **weighted-average cost**, **open cost basis**, and **unrealised P&L** for each basket asset. FIFO lots, realised P&L, lot-selection methods, and tax-specific reporting are deliberately deferred.

This keeps the production release focused: it provides a useful, explainable cost basis while avoiding the inventory-allocation and jurisdiction-policy surface required to make realised P&L trustworthy.

The label in product must be **"Weighted-average portfolio accounting — not tax advice."**

## In scope

- Receipt-derived accounting for all constrained Aerodrome route executions.
- USDC funding, asset sales, asset-to-asset rebalances, and in-kind withdrawals.
- Per-basket/per-asset open quantity, open basis, weighted-average cost, current spot value, and unrealised P&L.
- A normalized event ledger, idempotent replay, reconciliation with indexed balances, API, UI, and CSV export.
- Explicit incomplete/error states; never show invented zero basis or P&L.

## Deferred

- FIFO tax lots and lot-level sale matching.
- Realised P&L, realised gain/loss reports, and tax-lot exports.
- Country-specific rules, wash sales, tax forms, filing calculations, gas treatment, external wallet/CEX imports, and user-selected lots.

The immutable execution ledger added in V1 is intentionally sufficient for a later FIFO projector to replay history and create tax lots without changing the receipt source.

## Accounting policy

Process route receipts in `(chain_id, tx_hash, log_index)` order with fixed-point numeric arithmetic only.

| Route | Quantity effect | Basis effect |
| --- | --- | --- |
| USDC → asset | Add exact `amountOut` | Add exact USDC `amountIn` |
| asset → USDC | Subtract exact `amountIn` | Subtract `amountIn × prior weighted-average cost` |
| asset A → asset B | Subtract A exactly; add B exactly | Subtract A at prior weighted-average cost; add B at B's approved oracle USD value at the execution block |
| in-kind withdrawal | Subtract transferred amount | Subtract the same proportion of current open basis; no realised P&L |

For any asset:

`weighted_average_cost = open_basis_usdc / open_quantity`

`unrealised_pnl = current_spot_value_usdc - open_basis_usdc`

USDC values use the exact receipt amount. Asset-to-asset routes use the approved price observation at execution block for the acquired asset's basis, which is deterministic and preserves the actual received quantity after price impact and pool fees.

If the receipt, execution-block price, prior basis, or balance reconciliation is unavailable, mark the affected asset `INCOMPLETE`; do not update basis partially.

## Lean schema

Add one forward-only migration with only two accounting tables. Do not add cost fields to `basket_positions`, and do not duplicate NAV snapshots.

### `accounting_events`

Immutable receipt-derived facts.

- `id uuid` primary key
- `chain_id`, `basket_address`, `tx_hash`, `log_index`, `block_number`, `block_hash`, `occurred_at`
- `kind`: `ACQUISITION | REDUCTION | TRANSFER_OUT | ADJUSTMENT`
- `asset_address`, `quantity_base_units`, `decimals`, `basis_delta_usdc_micro`
- `valuation_source`: `USDC_RECEIPT | ORACLE_AT_EXECUTION | NONE`
- `status`: `COMPLETE | INCOMPLETE`, `issue`
- unique `(chain_id, tx_hash, log_index, kind, asset_address)`

One asset-to-asset route writes two events: reduction of input asset and acquisition of output asset. USDC never needs a synthetic inventory row.

### `asset_cost_basis`

Derived current state, one row per basket asset.

- composite primary key: `(chain_id, basket_address, asset_address)`
- `quantity_base_units`, `decimals`, `open_basis_usdc_micro`
- `accounting_status`: `COMPLETE | INCOMPLETE`, `issue`
- `last_event_id`, `updated_at`

This state can be rebuilt entirely from `accounting_events` during replay.

## Implementation work packages

### 1. Migration and accounting calculator

- Add the two tables, constraints, indexes, and foreign keys.
- Implement a fixed-point weighted-average projector.
- Enforce invariants: no negative quantity/basis; zero quantity implies zero basis; every route is atomic and idempotent.
- Unit-test repeated buys, partial sales, full exits, asset-to-asset rebalances, and in-kind withdrawals.

### 2. Indexer projection and reconciliation

- Project each existing `DEX_ROUTE_EXECUTED` receipt into accounting events.
- Resolve execution-block oracle observations before accounting non-USDC acquisitions.
- Apply withdrawals as proportional-basis transfers.
- Reconcile open accounting quantity to latest `basket_positions`; flag mismatches as incomplete.
- Support deterministic replay by rebuilding all dependent projections (`asset_cost_basis`, `accounting_events`, positions, price observations, and NAV observations) before resetting the indexer cursor. Resetting a cursor against later retained snapshots must be rejected operationally because it falsely flags early accounting state as incomplete.

### 3. Backend and export

- Add `GET /v1/baskets/:address/accounting-summary` for open basis, weighted average, spot value, unrealised P&L, and status.
- Add paginated `GET /v1/baskets/:address/accounting-events` and CSV export.
- Require controller ownership and serialize all monetary/base-unit values as strings.

### 4. Frontend and operations

- Replace hard-coded Avg Cost and P&L dashes only for `COMPLETE` assets.
- Add accounting status/caveat copy and a receipt-history/export action.
- Keep NAV history independent; it remains sourced by `basket_nav_observations`.
- Add monitoring for incomplete projections and position/basis reconciliation failures.
- Write migration, replay, validation, and rollback runbooks.

## Rollout and acceptance

1. Apply the migration in staging/local and replay the indexer from the configured start block.
2. Verify all supported route types against exact receipts and current indexed positions.
3. Enable backend read endpoints, then the UI after reconciliation is clean.

Release only when:

- USDC buys, partial sells, rebalances, and withdrawals update weighted basis correctly.
- Replay is idempotent: no duplicate events or basis changes.
- Every complete basis row reconciles to on-chain indexed quantity.
- Incomplete accounting is visibly unavailable, never zero.
- Backend tests/typecheck, indexer tests, and frontend build pass.

## Later FIFO upgrade

Add `tax_lots` and `tax_lot_disposals` later by replaying the immutable `accounting_events` source. That release can choose FIFO or another permitted method and compute realised P&L without changing V1's receipt ingestion or current-basis API.
