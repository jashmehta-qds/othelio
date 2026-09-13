# Portfolio security: cross-application implementation plan

## Purpose

This document turns the four-segment portfolio-security redesign into deliverable work across contracts, deployment, backend, frontend, indexer, data model, migration, and tests.

The intended end state is a constrained self-custody portfolio account: a basket can perform reviewed basket actions and protocol-specific position management, but it cannot execute owner-supplied arbitrary calldata or install arbitrary modules.

## Guiding rules

1. A user-selected address, selector, calldata blob, or module is not trusted execution authority.
2. Contracts enforce the same policy advertised by the UI and backend; UI feature flags alone are not controls.
3. Each protocol has its own adapter and position identity. No adapter receives generic protocol calldata.
4. Events and indexed state distinguish raw token amounts from USD-denominated NAV/equity.
5. A transaction hash means submitted, not confirmed. Receipts, logs, and reconciliation establish confirmed state.

## Delivery order

| Segment | Product outcome | Can ship alone? | Depends on |
| --- | --- | --- | --- |
| 1. Custody boundary | New baskets cannot be turned into arbitrary executors | Yes, with lending UI disabled | None |
| 2. Bounded spot basket operations | Funding, rebalance, and withdrawal use reviewed DEX routes only | Yes, after route configuration and indexer/UI compatibility work | Segment 1 |
| 3. Aave V3 adapter | Explicit Aave position management with verified risk controls | Yes | Segments 1–2 |
| 4. Adapter platform and reconciled accounting | Safe expansion to Morpho, Compound, and Moonwell | Incrementally, one venue at a time | Segment 3 |

---

## Segment 1 — Lock down the custody boundary

### Contract work

- Make the basket's constructor-selected module authority immutable for new accounts.
- Remove the production ability for an owner to enable an arbitrary new module or disable the required module.
- Retain only an explicit recovery method for **untracked** ERC-20 tokens; it must reject registry-supported assets, zero recipients, zero amounts, and non-contract token addresses.
- The custom account's immutable module authorization is the security boundary. Do not deploy or advertise a Safe-style guard unless the account is later migrated to a guard-aware Safe.
- Preserve the owner-transfer behavior only if transferring ownership is an intended transfer of all portfolio authority.

### Backend work

- Treat account/module configuration as immutable deployment metadata, not user-editable account state.
- Add a capability check for the deployed account/module version before preparing transactions.
- Reject requests that require a disabled capability, including generic execution or new lending exposure before Segment 3.
- Record whether an account is a legacy unrestricted basket, a constrained spot basket, or an adapter-enabled basket. Unknown/legacy must default to conservative behavior.

### Frontend work

- Remove all UI controls for module installation, arbitrary contract calls, and arbitrary recovery of tracked assets.
- Display a clear account capability state on basket pages: `constrained spot`, `Aave recovery`, `legacy/unknown`, etc.
- Keep an untracked-token recovery screen separate from ordinary withdrawals and explain that registered basket assets cannot use it.
- For existing/legacy baskets, do not claim portfolio-only protection until the account bytecode and module state are verified.

### Indexer/data work

- Index account creation/version/capability metadata where it is observable; otherwise reconcile it from chain reads.
- Treat ownership changes as a lifecycle event. Update owner-facing access projections without falsely implying that positions or factory history migrated.
- Add a migration status to basket records so downstream consumers can gate actions safely.

### Deployment and operations

- Publish exact bytecode hashes and addresses for constrained account and module versions per chain.
- Ensure the registry address is nonzero and chain-correct at factory deployment.
- Inventory existing baskets before rollout: owner, bytecode hash, enabled modules, direct holdings, supplied positions, and debt.
- Do not silently retrofit old accounts. Migrate only through an explicit, user-approved process.

### Tests and release gates

- Adversarial test: owner cannot enable an attacker module.
- Adversarial test: an unapproved module cannot call account execution functions.
- Adversarial test: tracked token recovery reverts; untracked recovery transfers exactly as expected.
- Compatibility test: owner transfer and factory registration behavior remain intentional.
- Fork/integration test: no account path permits arbitrary target/calldata execution.

### Current status and immediate collateral work

The account-side lock and untracked-token recovery are implemented in the working tree. Before deployment, complete the backend/UI capability gating and legacy-basket migration inventory above.

---

## Segment 2 — Consolidate bounded spot basket operations

### Contract work

- Keep `fundWithSwaps`, `rebalance`, `withdrawWithSwaps`, and `withdrawInKind` as the spot execution surface.
- Remove `executeTransaction` and all duplicate lending/generic execution methods from `OthelioBasketModule`.
- Require every DEX `target` + `allowanceSpender` pair to be approved by the deployment authority before it can receive a temporary allowance or call.
- Preserve and test input caps, aggregate sell caps, output minimums, deadlines, balance-delta accounting, zero-first approvals, and allowance reset.
- Emit `BasketSwapWithdrawn` for swap withdrawals so raw `outputAmount` cannot be confused with USD NAV. Retain `BasketWithdrawn` for in-kind withdrawals, where `navRedeemed` is actually NAV.
- Bound arrays at a practical maximum to avoid gas-denial routes; validate every token/route against the supported asset and route policy.

### Backend work

- Base production route selection is Aerodrome-only for the initial release. Do not rank 0x, 1inch, Uniswap, or fallback quotes for chain `8453`; adding another venue requires an explicit reviewed manifest and contract release.
- Maintain a per-chain reviewed DEX-route manifest: provider, router target, allowance spender, deployment status, supported assets, and deprecation status.
- Add `approvedDexRoutes(target, spender)` to the contract ABI used by the quote planner.
- Before returning a funding/rebalance/withdraw quote, read the on-chain route approval and reject unapproved pairs with a structured error. Do not make the user sign a transaction that will revert with `UNAPPROVED_DEX_ROUTE`.
- Add a deployment/admin operation that calls `setApprovedDexRoute(target, spender, true)` for each manifest entry; revocation must be supported operationally.
- Ensure quote adapters cannot substitute their target, spender, recipient, sell token, buy token, or amount after quote validation.
- Update contract ABI artifacts and remove any backend path that prepares the removed generic/lending selectors.

### Frontend work

- Remove stale basket-module ABI entries for `executeTransaction`, `executeLending`, and the old basket-module Aave methods.
- Disable/hide lending controls until Segment 3 is live. This includes `BorrowModal`, `AaveActionModal`, and lending recovery actions that call removed selectors.
- Surface a deterministic message when a quote's route is unapproved; do not show it as wallet/signature failure.
- Update withdrawal activity presentation to understand `BasketSwapWithdrawn`, including output asset, raw output amount, recipient, sold assets, sold amounts, and remaining NAV.
- Preserve `BasketWithdrawn` presentation for in-kind withdrawals and label its NAV correctly.

### Indexer/data work

- Add `BasketSwapWithdrawn` to the indexer ABI and decoding match.
- Insert a `WITHDRAWN` event payload containing `recipient`, `outputAsset`, raw `outputAmount`, `soldAssets`, `soldAmounts`, and `remainingNAV`.
- Continue to insert an invalidation/refresh marker and snapshot using `remainingNAV`; never store raw output tokens as USD NAV.
- Keep old `BasketWithdrawn` decoding for in-kind withdrawals; event-version handling must support historical logs.
- Update shared/event ABI definitions only after comparing them to the deployed Solidity event signatures.

### Deployment and operations

- Route approval is a release prerequisite. New contract code without configured DEX routes will make all swap paths revert.
- Configure and verify approved route pairs independently on each supported chain; local Anvil addresses do not authorize Base mainnet routes.
- Publish a route-change runbook: proposal, review, simulation, on-chain approval, monitoring, and emergency revocation.

### Tests and release gates

- Contract tests: unapproved router/spender pair reverts before approval/call; approved pair works; revoked pair reverts.
- Backend tests: quote planner refuses an unapproved pair and preserves approved route data exactly.
- Indexer test: fixture log for `BasketSwapWithdrawn` is decoded, stored, and schedules position refresh.
- UI test: lending controls are absent/disabled for constrained spot baskets; swap withdrawal renders raw units and remaining NAV correctly.
- End-to-end fork test: a reviewed route funds, rebalances, and withdraws with no lingering allowance.

### Current status and immediate collateral work

The contract/module changes are implemented in the working tree. The backend now limits Base production selection to Aerodrome and preflights `approvedDexRoutes(router, spender)` before it prepares a quote. A reviewed per-chain manifest, route-registration operation, ABI-specific Aerodrome calldata validation, and the indexer/UI changes remain mandatory before release.

---

## Segment 3 — Ship a constrained Aave V3 adapter

### Contract work

- Use `OthelioPortfolioModule` as the sole module authorized by a basket account. It owns bounded token approvals and execution.
- Add `OthelioAaveV3Adapter` as a non-module call builder/post-condition reader. It pins the Aave pool and prepares only typed supply, repay, and withdraw-to-basket calls; it never has authority to execute a basket call.
- Pin the Aave adapter and the new-supply capability immutably in the portfolio module. Production deployment starts with new supply disabled; repayment and collateral-release recovery remain available.
- The adapter must use a configured Aave V3 Pool per chain and validate assets against supported reserve/collateral/debt policy.
- No generic target/data fields and no borrow-to-wallet at initial launch.
- Make the central portfolio module the sole basket executor. It should call the adapter's reviewed action path rather than give the adapter broad account authority.
- Use bounded temporary approvals; decode relevant return data; verify post-operation balances, debt, and Aave account data.
- Enforce a protocol-derived per-market health-factor floor. A UI-estimated portfolio ratio is not a substitute.
- Decide and enforce a policy for tokens that are approved basket assets but unsupported as Aave collateral.

### Backend work

- Add typed Aave action-preparation endpoints/commands rather than raw calldata passthrough.
- Before preparing a transaction, read reserve configuration, liquidity/caps, collateral eligibility, user account data, debt mode, and price/block metadata.
- Keep position identity immutable: `chainId + basket + AAVE_V3 + pool + reserve`.
- Provide explicit states: `available`, `unavailable`, `unknown`, `pending`, and `confirmed`; failed reads must not be treated as zero debt or zero collateral.
- Add receipt/log reconciliation for Aave supply, borrow, repay, and withdraw events.

### Frontend work

- Replace old basket-module lending ABIs with the new adapter/module ABI.
- Initially expose only approved actions. If new borrowing is not enabled, show recovery-only repay and collateral release for verified existing positions.
- Show per-Aave-market health, debt, supplied collateral, data block/timestamp, and any unavailable/unknown state.
- Require transaction receipt success before presenting balances as updated; submitted transactions remain pending.
- Make asset decimals, rate units, and maximum values come from verified backend/on-chain data rather than fixed USDC assumptions.

### Indexer/data work

- Decode canonical Aave pool events for the configured pools and reconcile them to basket positions.
- Store supplied, debt, liquidity, and health/risk readings by exact position identity and block.
- Reconcile passive changes such as interest accrual; do not rely solely on Othelio-module events.
- Mark reorged, replaced, or failed transactions appropriately and ensure repeated logs are idempotent.

### Deployment and operations

- Configure a versioned Aave adapter, pool address, allowed assets, action capabilities, and health-factor floor per chain.
- Launch in recovery-only mode unless product explicitly approves new supply/borrow after fork-test sign-off.
- Include a pause/kill-switch policy that blocks new exposure but keeps repay and safety-preserving recovery available.

### Tests and release gates

- Base fork lifecycle: supply → borrow → accrue interest → partial repay → full repay → withdraw.
- Negative cases: insufficient health, reserve pause/freeze, caps, insufficient pool liquidity, wrong pool, wrong asset, and stale/failed RPC state.
- Test that borrowed funds cannot leave to a user wallet and cannot enter an arbitrary reinvestment route in the initial release.
- Backend/UI integration test: receipt success is required before confirmed position state changes.

### Current contract implementation and required follow-up

The contract implementation uses `OthelioPortfolioModule` as the only module authorized by new basket accounts. `OthelioAaveV3Adapter` is deliberately not a module: it pins the pool and builds typed Aave calls, while the portfolio module grants bounded approval, executes the call, and checks the health factor. The production deployment sets `newAaveSupplyEnabled` to `false` and no longer pre-approves Compound, Moonwell, or Morpho as generic lending targets.

This is an ABI and deployment-version change. Before deployment, backend/frontend/indexer work must: (1) use the new typed portfolio-module Aave ABI and configured module address, (2) gate all new lending UI/actions while `newAaveSupplyEnabled` is false, (3) consume `BasketAaveAction` plus canonical Aave events, and (4) distinguish legacy basket-module deployments from the new portfolio-module deployment. A Base fork lifecycle test remains a release requirement; local mocks are not evidence of live Aave compatibility.

---

## Segment 4 — Adapter platform, multi-protocol support, and reconciled equity

### Architecture invariant

`OthelioPortfolioModule` remains the **only** module enabled on a basket account. Every new protocol integration is a non-module adapter registered or pinned by the portfolio module. An adapter may validate typed parameters, build a protocol call, and read protocol-specific post-state; it must never call `execTransactionFromModule`, receive a basket allowance directly, or become owner-configurable execution authority.

```text
OthelioBasketAccount
  └─ OthelioPortfolioModule  (sole execution authority)
       ├─ OthelioAaveV3Adapter       (typed Aave calls / health reader)
       ├─ OthelioMorphoBlueAdapter   (future typed Morpho calls / market reader)
       └─ OthelioCompoundV3Adapter   (future typed Compound calls / market reader)
```

The portfolio module is responsible for selecting a reviewed adapter, granting a bounded temporary approval to the adapter's declared protocol target, executing the exact returned call, clearing approval, and enforcing generic basket/account invariants. Each adapter is responsible only for the protocol facts that cannot be safely generalized.

### Contract work

- Extend `OthelioPortfolioModule` with a governance-controlled, versioned adapter registry. Adapter upgrades require multisig + timelock; baskets opt in to material behavior changes. The registry must not create additional account modules.
- Implement independent non-module adapters for Morpho Blue, Compound V3, and Moonwell. Do not assume Aave method names, receipt units, collateral rules, error semantics, or health calculations apply.
- Each adapter accepts typed parameters and exact protocol/market identifiers—not user-supplied protocol calldata—and returns only its configured protocol target plus a call matching that typed action.
- Keep protocol dispatch explicit in the portfolio module. Do not add a public `executeAdapter(adapter, bytes)` escape hatch; each enabled action must select a known adapter/action pair and validate the returned target, approval asset, approval amount, and post-condition.
- For Morpho Blue, bind the full market definition (loan token, collateral token, oracle, IRM, LLTV, market ID) and distinguish collateral supply from loan supply.
- For Compound/Moonwell, encode their actual return/error conventions and receipt/exchange-rate rules.
- Harden oracle arithmetic with `Math.mulDiv`, verified decimal configuration, stale-feed handling, and explicit unsupported/unpriceable outcomes.

### Backend work

- Add a protocol-adapter capability registry mirroring the on-chain portfolio-module registry: chain, portfolio-module version, adapter version, protocol, market, enabled actions, supported assets, and rollout state.
- Build protocol-specific position readers and transaction simulations. Never aggregate positions across markets then choose a new venue to repay or withdraw from.
- Calculate equity as direct assets + supplied/receipt claims − accrued debt, preserving liquid versus supplied balance separately.
- Model risk per lending domain/market. A healthy position in one pool does not secure debt elsewhere.
- Provide a controlled adapter onboarding process: research, market configuration, simulation, fork tests, governance approval, deployment, monitoring.

### Frontend work

- Present positions grouped by protocol and exact market; do not display a blended health factor as a safety promise. The UI must never describe an adapter as an independently authorized basket module.
- Add adapter availability states and clear recovery guidance for unsupported/legacy positions.
- Use a common action UI only for shared user concepts; route execution and explanation through the protocol-specific adapter capability.
- Surface known risk data, freshness, transaction lifecycle, and per-market limitations such as caps/liquidity.

### Indexer/data work

- Add protocol-specific event readers and position reconciliation jobs for each enabled adapter/market.
- Maintain historical snapshots of raw balances, claims, debt, prices, equity, and data completeness.
- Handle reorgs, replay, pagination/backfill, and event idempotency across every protocol source.
- Do not create confirmed financial activity from user-submitted metadata or transaction hash alone.

### Deployment and operations

- Release one protocol at a time behind explicit per-chain/per-market capability switches in the portfolio module and adapter registry. No release may add a second account module.
- Maintain an adapter emergency response: disable new exposure, revoke future route use, preserve repay/withdraw recovery as safely possible, and communicate legacy-account limitations.
- Conduct independent security review and fork-test evidence for each adapter before enabling it for users.

### Tests and release gates

- Each adapter has unit, invariant, adversarial, and real-fork lifecycle tests.
- Cross-market test: assets/debt from pool A cannot be accidentally operated against pool B.
- Accounting test: partial liquid + supplied balances, accrued interest, repayment, liquidation/reorg, and price-feed failure produce correct explicit states.
- Security regression: no adapter or registry path restores arbitrary module installation, arbitrary target execution, generic protocol calldata, direct adapter account execution, or residual adapter/pool allowance.

---

## Cross-segment migration and release checklist

- [ ] Classify every deployed basket by account/module bytecode and enabled modules.
- [ ] Do not send old ABI calls to new deployments or new ABI calls to legacy deployments.
- [ ] Version contract ABIs and event decoders in frontend, backend, shared package, and indexer.
- [ ] Require deployment configuration verification in CI: factory, registry, module, adapter, route pairs, lending pool, chain ID, and code hashes.
- [ ] Run Base fork integration tests for each release candidate.
- [ ] Backfill/index historical and new event signatures independently.
- [ ] Add a production monitoring dashboard for failed quotes, `UNAPPROVED_DEX_ROUTE`, denied action capabilities, pending transactions, and position-refresh failures.
- [ ] Obtain a dedicated external audit before enabling lending or multi-protocol support with user funds.
