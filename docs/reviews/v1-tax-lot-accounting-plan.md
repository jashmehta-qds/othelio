# Superseded: V1 Tax-Lot, Realised P&L, and Average-Cost Accounting Plan

> This was the original full-scope proposal. The approved planning direction is now the smaller weighted-average-only V1 in `v1-weighted-average-cost-basis-plan.md`. FIFO tax lots and realised P&L are deferred.

## Goal

Give every basket an auditable, receipt-derived accounting history in USD:

- a true weighted-average cost for each currently held asset;
- realised gain/loss when an asset is exchanged or sold;
- immutable acquisition lots and their FIFO consumption history; and
- exportable transaction and lot data.

This is **jurisdiction-neutral portfolio accounting**, not tax filing advice or a jurisdiction-specific return. The accounting engine must never create a cost basis from a current price or silently fabricate a missing lot.

## Confirmed inputs and constraints

The constrained portfolio module emits `AerodromeRouteExecuted` with exact `tokenIn`, `amountIn`, `tokenOut`, and `amountOut`. The indexer persists that receipt in `basket_events` as `DEX_ROUTE_EXECUTED`. It also persists the basket-level funding, rebalance, and withdrawal events.

The Pass 1 valuation model already persists exact position quantities and shared oracle observations. It deliberately does not persist acquisition basis, so the current UI displays `—` for Avg Cost and unrealised P&L. This work adds accounting facts without changing the authoritative spot-NAV model.

V1 assumptions:

- Funding is USDC-only.
- USD is the reporting currency; USDC is valued at its exact received/spent amount in USD.
- FIFO determines realised P&L. Weighted average is a display-only metric, never the lot-disposal method.
- Gas costs, external wallets, CEX activity, tax-loss harvesting, wash-sale rules, and jurisdiction-specific filings are out of scope.

## Accounting policy

### Acquisition and disposal

Process on-chain execution receipts in `(chain_id, tx_hash, log_index)` order.

| Executed route | Disposal proceeds | New acquisition basis | Valuation source |
| --- | --- | --- | --- |
| USDC → asset | None | Exact USDC `amountIn` | Receipt |
| asset → USDC | Exact USDC `amountOut` | None | Receipt |
| asset A → asset B | USD fair market value of `amountOut` of B | The same USD fair market value | Approved oracle at the execution block |

The asset-to-asset rule is intentionally symmetric: it records both the sale and the new lot at the same contemporaneous USD value. The received amount incorporates realised pool fees and price impact, while the oracle establishes a reproducible USD reporting value.

Every asset disposal consumes open lots FIFO. For each consumed fragment:

`realised_gain_usdc = allocated_proceeds_usdc - allocated_remaining_basis_usdc`

For an open asset position:

`weighted_average_cost_usdc = sum(open_lot_remaining_basis_usdc) / sum(open_lot_remaining_quantity)`

`unrealised_pnl_usdc = current_spot_value_usdc - sum(open_lot_remaining_basis_usdc)`

Amounts and basis are fixed-point integers/numerics; no JavaScript floating-point calculation participates in accounting.

### Rebalances and withdrawals

- A rebalance is the ordered set of its underlying route receipts. The aggregate `BasketRebalanced` event is a UI/activity summary only and must not create duplicate accounting entries.
- An in-kind withdrawal is a `TRANSFER_OUT`, not a sale. It carries FIFO-selected lots and their remaining basis out of the basket without realised P&L.
- USDC withdrawn is a transfer of cash, not realised P&L.
- If a reconciliation finds a non-zero balance change without an accountable receipt, mark the asset/basket `ACCOUNTING_INCOMPLETE`. Do not show a made-up average cost or P&L.

## Lean normalized data model

Add one forward-only migration. Do not add snapshots, duplicate NAV, or denormalized basis columns to `basket_positions`.

### `accounting_events`

Canonical, idempotent source rows derived from indexed on-chain receipts.

Key fields:

- `id uuid` primary key
- `chain_id`, `basket_address`, `tx_hash`, `log_index`, `block_number`, `block_hash`, `occurred_at`
- `kind`: `ACQUISITION | DISPOSAL | TRANSFER_OUT | ADJUSTMENT`
- `asset_address`, `quantity_base_units`, `decimals`
- `value_usdc_micro` nullable only when accounting is incomplete
- `valuation_source`: `USDC_RECEIPT | ORACLE_AT_EXECUTION | NONE`
- unique `(chain_id, tx_hash, log_index, kind, asset_address)`

One asset-to-asset route creates two accounting events: a disposal for token in and an acquisition for token out. A USDC → asset route creates only the acquisition; asset → USDC creates only the disposal. This avoids storing a synthetic USDC inventory in V1.

### `tax_lots`

Immutable acquisition identity plus mutable remaining inventory.

- `id uuid` primary key; `acquisition_event_id` unique foreign key
- `chain_id`, `basket_address`, `asset_address`, `acquired_at`, `acquired_block_number`
- `original_quantity_base_units`, `remaining_quantity_base_units`
- `original_basis_usdc_micro`, `remaining_basis_usdc_micro`
- `status`: `OPEN | CLOSED | TRANSFERRED | INCOMPLETE`

The row represents a single acquisition receipt. The original fields never change; only the remaining fields and status change inside the same transaction that records a disposal allocation.

### `tax_lot_disposals`

Auditable FIFO allocation between a disposal and one source lot.

- `id uuid` primary key
- `disposal_event_id`, `tax_lot_id` foreign keys
- `quantity_base_units`, `cost_basis_usdc_micro`, `proceeds_usdc_micro`, `realised_gain_usdc_micro`
- unique `(disposal_event_id, tax_lot_id)`

This is the minimum table needed to explain exactly how each realised P&L value was produced. It also supports later reporting methods without rewriting history.

## Indexer and reorg-safe processing

1. Extract receipt handling from the current `DEX_ROUTE_EXECUTED` indexer branch into an accounting projector.
2. Read exact token decimals and the execution-block oracle observation. Persist the observation first if it is absent; reject the accounting event if it cannot be read or is invalid.
3. Write `accounting_events`, create lots for acquisitions, and FIFO-consume lots for disposals in one PostgreSQL transaction. Lock eligible lots with `FOR UPDATE` ordered by `(acquired_block_number, acquired_at, id)`.
4. Store an `ACCOUNTING_INCOMPLETE` status/reason when required data is unavailable or inventory is insufficient. Do not partially realise a disposal.
5. Make the projector idempotent through the event uniqueness constraint. On a local reset or deployment migration, reset only the indexer cursor and replay chain events; never manually seed lots.
6. Reorg policy: process only the same finalized block threshold as the indexer. Before production, add a rollback/replay procedure for events above the finality checkpoint; do not assume an Anvil-only chain has reorg protection.

## Backend contract

Add read-only endpoints scoped to controller ownership:

- `GET /v1/baskets/:address/accounting-summary?chainId=`: open quantity, basis, weighted average cost, spot value, unrealised P&L, accounting status.
- `GET /v1/baskets/:address/realized-pnl?chainId=&from=&to=`: chronological disposals and total realised P&L.
- `GET /v1/baskets/:address/tax-lots?chainId=&status=`: paginated lots and their allocations.
- `GET /v1/baskets/:address/accounting-export.csv?chainId=&from=&to=`: receipts, lots, and disposal allocations with the policy/version header.

The basket detail endpoint may include a compact accounting summary, but it must not calculate it by joining raw positions in application memory. The database query is the source for basis and P&L; `basket_nav_observations` remains the source for the graph.

## Frontend behavior

1. Replace the current hard-coded Avg Cost and unrealised P&L dashes only when accounting status is `COMPLETE`.
2. Render Avg Cost from weighted remaining basis, not from current price or target weights.
3. Add a small "FIFO accounting" disclosure and an accounting status indicator. If incomplete, show `—` with the actionable reason; never a zero.
4. Add a realised-P&L activity view and CSV export. Label all values "portfolio accounting estimate; not tax advice".
5. Do not alter the NAV chart, holdings quantity, or route-fee display as part of this project.

## Migration and rollout

1. Ship the migration before enabling UI fields.
2. Deploy the indexer projector and replay from `START_BLOCK` on the target chain to construct lots from immutable receipts.
3. Reconcile latest open-lot quantities against the latest on-chain `basket_positions`. Any mismatch blocks `COMPLETE` accounting for that asset/basket and creates an operations alert.
4. Run the backend and frontend in read-only accounting mode against the replayed data.
5. Enable the UI only after reconciliation, route coverage, and export checks pass.

For the local pre-production environment, migration plus indexer-cursor reset is sufficient. For production, take a database backup and execute the migration/replay runbook in a staging fork first.

## Work packages

### 1. Schema and deterministic calculator

- Add the three tables, enums/check constraints, indexes, and foreign keys.
- Implement a fixed-point FIFO allocator with conservation checks:
  - sum allocations equals disposal quantity;
  - allocated cost equals lot basis decrement;
  - remaining quantity/basis never becomes negative;
  - closed lots have both remaining fields equal to zero.
- Add SQL/unit tests for partial-lot sales and multiple lots.

### 2. Receipt projector and reconciliation

- Build idempotent route-to-accounting projection in the indexer.
- Implement USDC and non-USDC valuation policy above.
- Add incomplete-state handling, finalized-block behavior, replay tooling, and latest-balance reconciliation.
- Test fund → rebalance → partial sale → in-kind withdrawal → replay twice produces identical rows.

### 3. Backend and export

- Add ownership-authorized summary, realised-P&L, lot, and CSV endpoints.
- Use numeric-string serialization; never coerce accounting values to JavaScript numbers before formatting.
- Test pagination, date filtering, no-data, incomplete data, and controller authorization.

### 4. Frontend and operational readiness

- Wire holdings Avg Cost and P&L to the new summary endpoint.
- Build realised-P&L and export affordances with explicit status/caveat copy.
- Add monitoring for failed projections, incomplete accounting, and reconciliation mismatches.
- Write production replay, rollback, and support runbooks.

## Acceptance criteria

- A USDC-funded buy produces an open lot whose quantity matches the on-chain receipt and whose basis equals actual USDC spent.
- A partial sale consumes the oldest available lot fragments FIFO and persists an explainable realised P&L calculation.
- An asset-to-asset rebalance creates exactly one disposal and one acquisition, with a reproducible execution-block oracle valuation.
- Replaying the same chain events is idempotent and produces no duplicate lots or allocations.
- Open lots reconcile to indexed on-chain positions; discrepancies are explicitly incomplete, never displayed as zero.
- Avg Cost, unrealised P&L, realised P&L, and CSV output use the accounting ledger; the NAV graph remains unchanged.
- Full database migration, indexer replay, backend tests/typecheck, and frontend build pass before enablement.

## Deferred deliberately

- Tax filing calculations, country-specific methods/rules, wash-sale treatment, tax forms, and tax advice.
- Gas-fee allocation and external-wallet/CEX transaction ingestion.
- Specific-lot user selection; the lot-allocation model keeps the option open for a later release.
