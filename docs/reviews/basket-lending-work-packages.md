# Basket remediation: subagent packages, UI plan, and staged launch

Date: 2026-09-09. Planning artifact; no agents have been dispatched to implement these changes, and no flags or application behavior have been changed.

Companion: [Gap review](/Users/jashmehta/Documents/Work/othelio/docs/reviews/basket-lending-gap-review.md). Issue IDs retain that document's evidence labels: C = source-confirmed, U = unconfirmed, D = design decision. A U item is an investigation task, not permission to implement a speculative fix.

## 1. Recommended approach

**Launch portfolio operations first; keep new lending exposure disabled.** Allow creation/funding, spot rebalance, and withdrawal only after their own correctness gates pass. Defer new supply, borrow-to-basket, borrow-to-wallet, reinvestment, and collateral migration. Keep position discovery and recovery available for existing positions.

This reduces the number of state combinations we need to support initially. It does **not** fix bad quotes, incorrect balance accounting, unconfirmed activity, price fallbacks, or account execution bypasses. It also does not remove existing debt.

The product brief in `fe/PRODUCT.md` already describes borrowing as later scope and excludes leverage/arbitrary protocols from the first live release. That is useful alignment, not proof the present contracts enforce the intended scope. The brief also describes basket shares, while the reviewed contracts currently fund a single-owner account: resolve D07 before making ownership/share claims in the UI.

## 2. Subagent grouping

There is no honest way to make every issue completely unrelated: the basket module is shared by trading, lending, and withdrawals. Instead, assign **one writer per implementation boundary**, agree the data contracts first, and integrate in waves. Do not put separate mint, repay, and rebalance workers in the same module concurrently.

| Agent | Responsibility | Primary issue ownership | Can work independently on |
| --- | --- | --- | --- |
| A — Contract execution | Basket/account/factory execution correctness, constrained actions, recovery | C01, C05, C06, C07, C08, C09, C13, C22, C23, C24, C25, C26; U02, U04, U10, U12, U15, U16, U20; D02, D03, D04 | Contract invariants and unit cases after shared interfaces are frozen |
| B — Positions and risk | Canonical positions, valuation, protocol adapters and eligibility | C10, C21, C32, C33; U01, U03, U06, U07, U11, U13, U19; D05, D06 | Position readers, oracle behavior and adapter tests |
| C — Trade planning | Correct current-to-target trades, route/calldata/spender binding | C02, C03, C04; U08, U09; D01 | Quote engine and route tests after extraction from shared service |
| D — Settlement and history | Receipt-confirmed transactions, canonical activity, reconciliation | C19, C20, C31; U05, U14, U17 | Indexer, receipt service, logging API and replay tests |
| E — Product UI | Truthful state, coherent actions, review/confirmation, capability-aware navigation | C11, C12, C14, C15, C16, C17, C18; U18; D07, D08 | UI against agreed fixtures; then integrate B/C/D outputs |
| F — Test infrastructure | Strict mocks, real fork isolation, reusable scenarios | C27, C28, C29, C30 | Mock/fork setup and test support; full lifecycle tests depend on A–D |
| G — Lead/integration | Shared schemas, launch capabilities, dependency control, end-to-end acceptance | Cross-package integration; no duplicate primary issue ownership | Interface decisions and extraction before workers start |

Every C01–C33, U01–U20 and D01–D08 has exactly one primary owner. Primary ownership means accountable for closure, not authority to edit another agent's files. For example, B owns C10's position model and oracle; A applies the agreed model inside module actions. D owns C19's API contract; E changes its frontend caller.

### File ownership and handoffs

Paths below are relative to the repository root, `/Users/jashmehta/Documents/Work/othelio`.

| Agent | Exclusive write scope during implementation | Must request a change from |
| --- | --- | --- |
| A | `contracts/src/safe/`, `contracts/src/factory/`, `contracts/src/interfaces/`; production action/policy contracts added alongside these; corresponding existing account/module/guard tests | B for oracle/registry; F for deployment/fixtures; E for ABIs used in UI |
| B | `contracts/src/oracle/`, `contracts/src/registry/`, their tests; `backend/src/lending/`; new `backend/src/positions/` | G for shared types; A for module consumers; D for persisted position schema |
| C | `backend/src/dex/`; new `backend/src/baskets/basket-trade-planner.service.ts` and planner tests | G for basket-service delegation; B for canonical snapshot inputs |
| D | `indexer/`, new receipt/reconciliation service files, lending event controller/service extracted from baskets, new database migrations | G for shared routing/wiring; E for client calls; B for position refresh semantics |
| E | `fe/src/`, frontend tests and app surface brief if needed | G for schemas/capability contract; A for onchain ABI; B/C/D for API behavior |
| F | `contracts/src/mock/`, `contracts/src/dex/MockDEXRouter.sol`, new `contracts/test/support/` and dedicated fork fixtures/tests, `contracts/script/DeployOthelio.s.sol` | A/B for public contracts; G for release test wiring |
| G | `packages/shared/`, integration wiring (`backend/src/app.module.ts`, baskets module/service/controller until handoff), root tooling and this plan | Receives worker changes through agreed interfaces |

**Before parallel edits:** G extracts quote planning and lending-event handling from `baskets.service.ts` into their owned services. Preserve behavior in this extraction; fixes belong to C/D. G also coordinates moving mock classes embedded in `OthelioAaveIntegration.t.sol` into F's support files before A and F touch those tests. Record completed handoffs, then freeze ownership for the wave.

Database migrations must use distinct new filenames; do not edit another worker's migration or existing user changes. B must not silently modify the similarly named legacy `contracts/src/OthelioAssetRegistry.sol`; resolve any consumer migration with G first.

## 3. Deliverables and acceptance by agent

### A — Contract execution

- First release: correct fund/swap/withdraw deltas, ERC-20 return handling, input/output limits, factory initialization, and declared account policy. Preserve user recovery.
- Add/enforce action capability checks for fresh deployments. Audit alternate borrowing paths through generic execution, lending calldata, swap targets, enabled modules and approvals—not just named borrow wrappers.
- Coordinate with B on valuation semantics; do not invent a second position model.
- Later: explicit repay funding, debt-aware exits and collateral rebalance. Treat flash loans as optional later scope, not required first-release infrastructure.
- Acceptance: false-return token rejected; zero-output operation cannot silently count as expected execution; forbidden debt-opening action fails through every supported account path; owner/nonowner and recovery tests pass.

### B — Positions and risk

- A canonical same-block snapshot distinguishes liquid assets, supplied claims, debt including interest, and unknown data. Compute gross value and equity once.
- Pin market identity and supported action capabilities. Quotes are not proof of user eligibility.
- Remove $1-as-truth oracle fallback for critical accounting; define behavior for unpriced assets.
- First-release position work may be scoped to spot assets plus actual legacy lending deployments; do not build four complete protocol integrations merely because four adapters exist.
- Acceptance: supply/borrow/repay accounting invariants, fresh zero balances, six/eighteen decimals, per-market risk, explicit stale/error states. Real reserve eligibility remains U01 until checked at a recorded chain/block.

### C — Trade planning

- Compute net sells/buys from canonical holdings and chosen targets; never substitute a fixed input budget for a rebalance.
- Preserve each route's target, calldata, allowance spender, recipient, input maximum, output minimum, chain and expiry as one plan.
- Reject non-executable plans; do not fabricate mock-compatible calldata for a real router.
- Initial scope: spot-only plans. If a requested trade needs encumbered assets, return an explicit unsupported/recovery-required result.
- Acceptance: no-USDC basket can rebalance by selling overweight assets; sold/bought lists match net changes; real router execution passes; quote expiry and inadequate balance/approval are handled.

### D — Settlement and history

- Separate submitted transaction records from confirmed financial events; verify receipt status, chain, destination and decoded logs before recording execution facts.
- Reconcile passive/direct changes and update withdrawal snapshots. Define reorg/replay behavior.
- Fix the lending activity route contract with E. A hash is not confirmation, and a client-provided amount is not an executed amount.
- Acceptance: reverted, replaced, dropped and replayed transactions do not create false fills or duplicate accounting; successful external repayment is discovered; full withdrawal updates displayed state.

### E — Product UI

- Own the UI checklist in section 6, including all borrow entry points and alternate modals, not only `BasketBorrowManagement`.
- Consume shared position/quote/capability types; remove mock-only reads and local financial estimates as authoritative state.
- Build against fixtures while services land; do not compensate for missing backend contracts with hardcoded prices, debt or health factors.
- Acceptance: reload preserves true debt, zero versus unknown is clear, mixed liquid/supplied assets remain actionable, pending cannot look settled, off-flag deep links have a useful recovery route.

### F — Test infrastructure

- Strict DEX fixtures must conserve input/output and reject failed input transfers. Lending fixtures must not imply real collateral safety unless modeled.
- Isolate local mock deployments from pinned real-pool fork fixtures; assert target bytecode is not a mock before fork suites run.
- Fix local health-factor scaling/underflow and receipt lifecycle where those fixtures claim to model them.
- Own integration tests in separate files so A/B can own unit tests without conflicts. Record fork block and pool version; failure to obtain RPC access is “not verified,” never a pass.
- Acceptance: old permissive-mock false positives fail in strict fixtures; no 31337 code replacement contaminates a real-Aave test.

### G — Lead/integration

- Freeze the small shared contracts below, perform preparatory extractions, and maintain file ownership.
- Resolve D decisions with the user before changes that alter custody/control or product promises. The recommendations in this artifact are not approval to deploy them.
- Review combined outcomes, not only individual test results. Own feature-mode acceptance and documentation of what is actually enforced.

## 4. Shared contracts to freeze before parallel work

These are proposed contracts, not existing API definitions.

| Contract | Required fields / semantics |
| --- | --- |
| Position snapshot | Chain, basket, block number/hash, observation time, per-token decimals/balances/prices; per-pool/market supply and accrued debt; gross/equity; read completeness and valuation status. Unknown is not zero. |
| Action capabilities | Per chain and deployment version; funding, spot rebalance, withdrawal, new supply, borrowing, reinvestment, repayment, collateral release. Include availability reason and authoritative policy source. |
| Execution plan | Action, account, chain, snapshot reference, ordered calls, approvals/spenders, max inputs, min outputs, expiry, expected after-state, simulation result. Backend preview does not replace onchain bounds. |
| Transaction lifecycle | Awaiting approval/signature → submitted → confirmed success or confirmed revert; support replaced/dropped/unknown and reorg invalidation. Canonical results derive from receipts/positions. |
| Position identity | Chain + basket + protocol + exact pool/market + collateral/debt token. A recommendation never changes the identity of an existing obligation. |

For contract amounts use integer base units; display formatting belongs at the edge. G owns shared types, but B/C/D define the semantics in their domain before consumers implement.

## 5. Parallel execution schedule

With one lead and three active worker slots, use staggered waves. Seven roles do not imply seven simultaneously running agents.

| Wave | Active workers | Exit condition |
| --- | --- | --- |
| 0 | G locally | Agree provisional launch mode, inventory actual existing positions/deployments, freeze shared contracts, extract shared files and test mocks |
| 1 | A, B, F | Contract/position foundations and trustworthy test support; use agreed stubs while integrations are unavailable |
| 2 | C, D, E | Real spot planner, settlement/reconciliation, and UI built against frozen schemas; E integrates services as they become ready |
| 3 | F plus targeted A/B/C/D/E follow-ups within slot limit | End-to-end launch matrix, bypass tests, legacy recovery, screenshot/keyboard checks; close P1 launch blockers |
| Later | A/B/F, then E | Add Aave borrowing behind separate verified gates; other protocols follow independently |

G performs integration while workers run. At any interface change, notify consumers before editing their code. If a wave-1 foundation changes during wave 2, pause affected integration only, not unrelated work.

### Reusable dispatch brief

> Active task: `<activated Trellis task path, when implementation is authorized>`.
> You own package `<A–F>` in this plan and only its listed files for this wave. You are not alone in the codebase: preserve existing user/agent edits, do not revert others, and accommodate agreed interface changes. Read the gap review and package acceptance criteria. Prove or dismiss U items before fixing them. Implement only the selected launch scope; borrowing remains disabled unless explicitly enabled in the task. Ask the lead for changes outside your ownership. Report issue IDs, changed files, tests and their limits, unresolved assumptions, and required handoffs. Do not deploy or claim a flag is enforced without bypass evidence.

## 6. UI improvements needed

Audience and mode: users operating their own baskets; **Operate**. Preserve the current app design language while making financial state and action outcomes dependable. This is a behavior/layout brief, not a new visual redesign or a claim of completed browser QA.

### Launch navigation and hierarchy

- First release: basket list → basket detail → funding/rebalance/withdrawal drawers. Remove Borrow from primary navigation and promotional actions when new borrowing is disabled.
- Enforce route and action availability for direct URLs, API entry points and alternate modals. A hidden navigation link alone is insufficient.
- If an existing position is detected, show **“Manage existing position”** with debt, repayment and safe collateral-release actions. Do not hide the obligation because the new-borrow flag is off.
- Portfolio-only basket header: basket value, valuation freshness, available actions. Do not show fake zero debt, synthetic APY, borrowing capacity, or an infinite “safe” health factor.
- Existing lending position header: **assets, debt, equity**, then per-market health and actionable liquidity. Keep borrowed cash received by the wallet separate from investment returns.

### Holdings and valuation

| Current problem | UI behavior to build | Acceptance example |
| --- | --- | --- |
| Supplied/liquid holdings collapse into one category | One asset row with liquid, supplied and total exposure; expand by market | Partially supplied ETH shows both amounts and valid actions |
| Read failures look like zero/default holdings | Explicit Loading / Unavailable / Stale / Verified states with retry and observation time | RPC failure never becomes “No debt” |
| Unpriced tokens appear to have $1 value | “Value unavailable” with excluded exposure disclosed; constrain affected previews | Basket total identifies incomplete valuation |
| Gross assets and equity are conflated | Use “Basket value” only for verified debt-free positions; show gross/debt/equity for lending positions | Borrow into basket does not display an investment gain |
| Current weights confused with targets | Separate current weight, proposed target, and expected post-trade weight | Fees/residual USDC explain a small difference from target |

### Action previews

- **Fund:** input amount, actual spending budget, expected acquired assets, minimum outputs, fees and residual cash. Use “Add funds,” not “Mint shares,” until shares exist.
- **Rebalance:** before/after allocation, explicit sells and buys, total costs, minimum received, quote expiry and any unavailable leg. Disable submission with a precise reason when the requested scope requires supplied collateral.
- **Withdraw:** choose an amount and destination explicitly. Distinguish “Withdraw available assets” from “Close position.” Never infer “sweep everything” from a zero swap delta.
- **Repay existing debt:** name the exact market, current debt including interest, and source of funds. If funds are in the wallet, explain and preview the funding step. “Repay all” must use verified protocol semantics and show residual debt after confirmation.
- **Release collateral:** show currently withdrawable amount and expected market health where verifiable. Do not offer a full supplied balance as though it is always available.

### Transaction feedback and recovery

Use one transaction component across funding, trading and lending. Show approval and execution as separate steps where needed; distinguish wallet rejection, transaction submission, confirmed revert, replacement, unknown status, and confirmed success. Keep the transaction link available. Refresh canonical positions after settlement rather than subtracting UI estimates.

Prevent duplicate submission while an action is pending; invalidate quotes when account, chain, amount or holdings change. Scope all asynchronous responses to the current basket and chain. A flag change before signing must invalidate the preview; after submission, retain the transaction status and recovery path.

### Accessibility and compact layout

- Review drawer: action summary first, token amounts and costs next, expandable technical details last. Put the final action near the reviewed amounts.
- On narrow screens, stack position rows with clear labels; preserve essential amounts and action reasons rather than forcing wide tables.
- Keyboard-operable dialogs, focus return, explicit labels and inline errors, announced pending/result states. Do not communicate risk or transaction status through color alone.
- Use token decimals correctly and preserve meaningful precision; avoid displaying tiny nonzero debt as zero. Explain rounding in the full-amount detail.

### UI test states

Empty basket; funded spot basket; mixed liquid/supplied asset; existing debt with flag off; no wallet repayment funds; unknown positions; stale quote; insufficient liquidity; wallet rejection; reverted/replaced/dropped transaction; zero debt after external repayment; chain switch during a read; six/eighteen-decimal balances; tiny debt; mobile and keyboard flows.

## 7. Is disabling borrowing safer?

**Yes, as a reduction in supported launch scope—provided the restriction is real and existing positions remain manageable.** It does not establish overall safety by itself.

| Option | Removes | Leaves unresolved | Recommendation |
| --- | --- | --- | --- |
| Hide borrowing UI only | Accidental use through visible buttons | Direct module calls, generic calls, enabled modules and external clients can still open debt | Useful presentation flag, not a security boundary |
| Disable new borrowing, allow supply | Product-created debt if all call paths enforce it | Supplied-position valuation, collateral redemption, reserve liquidity, adapter and history defects | Later yield-only stage after supply/withdraw gates pass |
| Portfolio-only, no new supply/borrow/reinvestment | New product lending lifecycle and leverage exposure | Core trading/accounting bugs and any pre-existing external positions | Recommended first-release scope |

### Proposed capability matrix

| Action | Fresh portfolio-only deployment | Existing lending position with new borrowing off |
| --- | --- | --- |
| Create / fund | Enabled after spot gates | Funding allowed for repayment/recovery; validate the specific action |
| Spot rebalance | Enabled for verified liquid positions after spot gates | Only a verified plan compatible with existing obligations; otherwise block with recovery guidance |
| Liquid withdrawal | Enabled after spot gates | Explicit available-balance action; do not call it complete exit |
| New supply | Disabled | Disabled as a general investment action; a separately reviewed add-collateral rescue path may be allowed if supported |
| New borrow / sweep / reinvest | Disabled | Disabled |
| Read debt / supplied positions | Available | Always available where supported; unknown must remain visible |
| Repay | No debt normally; do not pretend success | Remains available with correct funding and protocol handling |
| Release collateral | No position normally | Only within actual protocol limits; never a blind full-withdraw button |
| Generic execution / enable module | Restricted to the declared account policy | Cannot be silently restricted on immutable old accounts; assess per deployment |

### Enforcement requirements

1. **UI:** hide new-exposure entry points and guard routes/handlers. Keep legacy position management accessible. No “coming soon” clutter is necessary in normal portfolio flows.
2. **Backend/API:** reject preparation of disabled actions with structured reasons. Check chain, deployment version and basket capability; do not rely on a client-supplied flag. Future MCP/agent clients must use the same policy.
3. **Contracts:** if we claim borrowing is disabled for the basket itself, enforce that policy through every account execution route. Gating only `borrowFromAave`/`borrowToSafe` is bypassable through `executeLending`, `executeTransaction`, arbitrary swap targets or newly enabled modules. Approved targets also need constrained operations; a pool address allowlist permits its borrow selector unless checked.
4. **Deployment:** scope defaults to chain and account/module version; missing/unknown configuration does not enable new exposure. Separate operator rollout permission from the account's enforced capability. A frontend environment variable is not an onchain switch.
5. **Existing accounts:** reviewed accounts/modules are not shown to be upgradeable and their module permissions are not fully revocable. Do not promise a global retrofit. Inventory bytecode, enabled modules and debt, then decide new deployment versus explicit migration. Never transfer a debt-bearing position under the assumption debt follows ordinary token transfers.

If retaining unrestricted owner execution is the product decision (D03), say **“Borrowing is not offered in this release”**, not **“This basket cannot borrow.”** Users can invoke external protocols through that authority. The UI must still detect external positions and avoid debt-free assumptions. If enforceable portfolio-only accounts are desired, their execution boundary must be designed and tested accordingly.

### Turning flags off and later on

- Turning off means stopping new exposure, not freezing repayment or hiding liabilities. A global lending pause that also blocks repayment would defeat recovery.
- A disabled feature can stay in source for development; production exports/targets must still enforce the selected capability. Do not expose untested providers just because their adapter code exists.
- Begin on a verified deployment with no product-created debt. For unknown/legacy accounts, conservative UI state and recovery are required before allowing potentially conflicting actions.
- Re-enable Aave separately from other protocols, only after position readers, live eligibility, interest-aware repayment, collateral withdrawal, per-market health, settlement/reorg handling and real-fork lifecycle tests pass. Borrow-to-wallet and reinvestment get separate capability gates because their recovery paths differ.

## 8. Release gates and deferred work

### Still required for portfolio-only launch

- C02–C08: real quote and funding/withdrawal correctness; reject no-op/invalid routes.
- C10/C21: trustworthy liquid valuation, duplicate handling and explicit unpriced state. Debt-free status must follow enforced capabilities or verified position knowledge—not a hidden screen.
- C18–C20/C31: settlement-aware UI and canonical event/snapshot updates; disable or remove unsupported logging paths rather than representing submissions as fills.
- C22–C26: declared authority boundary, transfer return handling, initialization and registration integrity, and a documented module recovery decision.
- C27–C30: test infrastructure that does not manufacture success. Run spot routes against real execution dependencies.
- Capability-off bypass tests for fresh accounts; existing-position management tests if any old accounts are supported.

### Can be deferred only behind effective scope boundaries

New leveraged rebalance, reinvestment, flash-loan migration, new multi-protocol lending, venue migration and yield recommendations. Complete four-protocol recovery is not automatically required if only verified Aave legacy positions are admitted; unsupported accounts must be clearly identified, not shown as empty.

The safest release order is **verified spot operations → verified supply/withdraw if wanted → verified Aave borrow/repay → leveraged rebalance → additional protocols**. Each stage retains the prior stage's checks.

## 9. Next concrete execution step

Use this as the parent implementation plan. Before dispatch, G should record the chosen launch scope, real deployment/legacy-position inventory, and D03's authority policy, then create/activate the implementation tasks under the project's workflow. The issue register remains the evidence source; each worker returns test links or an explicit unresolved status for its IDs.

No visual redesign, production migration, feature-flag activation, or contract deployment was performed in preparing this artifact.
