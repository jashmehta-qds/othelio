# Task 3 report: duplicate application path

Date: 2026-10-05  
Worktree: `.worktrees/application-simplification-audit`  
Decision: **defer code consolidation; no safe duplicate path was proven**.

## Selected path and evidence

I traced the basket detail and execution area using the code graph and source inspection. The graph reports `userFacingExecutionError` in `fe/src/features/baskets/BasketDrawer.tsx` with fan-in 4; source shows it is already the one shared formatter for rebalance and amount-action error paths (including receipt and preparation failures). It special-cases quote expiry and otherwise returns an `Error.message` or the caller-specific fallback. These callers supply different, user-meaningful fallbacks, so moving this existing owner or changing its signature does not remove a second implementation.

The only nearby duplicated-looking parser was `BasketDetail.decimalStringParts` (two internal callers). The backend `BasketQuotePlannerService.parsePositiveAmount` handles a different contract: positive transaction amounts and validation errors. The frontend parser accepts trimmed signed decimal strings and returns a bigint plus fractional precision for display conversion. Their accepted inputs and failure behavior differ; sharing either implementation would change behavior or require a new abstraction. It was therefore rejected as a safe consolidation.

Other observations did not establish an identical transformation: repeated `toLocaleString` options are formatting call sites with different precision/sign/context, and similar basket/lending drawers correspond to distinct actions. The Task 1 audit also explicitly deferred error/payload projection candidates because it had not established exact symbols or data-flow equivalence. I found no evidence here that resolves that gap.

Graph trace results are incomplete for a full API → service → shared type → hook → component chain: the `BasketDetail` cross-service trace timed out in the graph tool, and a `getBasket` call trace resolved to a frontend `BasketPage`/`getCreatedBaskets` path rather than a backend chain. Source inspection confirms `BasketDetail` calls `useBasketDetails` and `useBasketActivity`, but this does not identify two equivalent owners. I treat the graph limitation as missing evidence, not proof of duplication or deadness.

## Behavior contract

No transformation was changed. The relevant preserved behavior observed in the candidate review is:

- Execution errors preserve the special quote-expired message when the error contains `quoteexpired` or selector `0x8727a7f9` (case-insensitive).
- Other `Error` instances expose their message; non-`Error` values use the caller-provided fallback.
- Frontend display parsing trims whitespace, accepts signed decimal strings, retains fractional digit count, and rejects other syntax with `null`.
- Backend positive-amount validation remains separate; its error and transaction-preparation contract is untouched.

Because no consolidation was safe, no focused behavior test was added. No API payload, route, transaction calldata/preparation, network, asset, or fallback/error behavior changed.

## Files changed

- `.superpowers/sdd/2026-10-05-application-simplification-audit/task-3-report.md` — this decision and evidence report only.
- No application source or test files changed.

## Tests and checks before/after

| Check | Before Task 3 | After Task 3 |
|---|---|---|
| Backend + shared typecheck (`npm run typecheck`) | PASS in Task 1 baseline | PASS |
| Backend tests (`npm run test --workspace @othelio/backend`) | PASS, 14 files / 82 tests in Task 1 baseline | PASS, 14 files / 82 tests |
| Frontend lint | Unavailable: `eslint` executable missing in baseline | Not rerun; no frontend source changed |
| Frontend typecheck | Not configured in `fe/package.json` | Not configured |
| Frontend build | Unavailable: `next` executable missing in baseline | Not rerun; no frontend source changed |

The basket-position test emits the previously recorded warning when an indexed snapshot read encounters undefined `.rows`; it still passes and asserts an explicit unavailable snapshot. The post-Task-3 checks match the prior results. Since no source or behavior check changed, there is no before/after behavior delta to report.

## Source and graph measurements

- Task 1 pre-deletion baseline: 132 tracked TypeScript/TSX files, 19,559 lines across backend, frontend, and shared.
- After the reviewed Task 2 deletion commit `b8edc4d`: 127 files, 18,805 lines (frontend: 71 files, 11,437 lines). This is 5 files / 754 lines below the original baseline.
- Task 3: unchanged from the post-Task-2 source counts; 0 application lines removed or added.
- Task 1 graph baseline: 6,513 nodes / 9,943 edges in the repository graph.
- Fresh Task 3 fast index: 6,483 nodes / 9,900 edges. The index is fresh; this broad graph reduction is consistent with the five Task 2 deletions and is not attributed to Task 3 code work.
- Focused graph candidate: `userFacingExecutionError` fan-in 4, out-degree 2; it remains the single existing owner. `decimalStringParts` has two internal callers and one owner. The indexed candidate count for safe cross-layer duplicate paths remains **zero proven**; this is a confidence decision, not a claim that no duplicate logic exists anywhere.

## Concerns and follow-up

The graph could not complete the requested cross-service trace in this run, and the Task 1 report says frontend error/payload projections were not systematically searched. A future slice can reopen that candidate with a targeted inventory and exact caller traces, then add normal, unavailable, and fallback/error behavior tests before changing an owner. Frontend lint/build remain unverified because the baseline environment lacks the executables; frontend typecheck has no configured script.
