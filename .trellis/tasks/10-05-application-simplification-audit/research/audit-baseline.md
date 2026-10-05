# Application Simplification Audit Baseline

Date: 2026-10-05
Worktree: `.worktrees/application-simplification-audit`
Scope: tracked TypeScript sources under `backend/src`, `fe/src`, and `packages/shared/src`. Indexer excluded.
Initial worktree: branch `codex/application-simplification-audit`; clean before this task's documentation edits.

## Baseline checks

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | PASS | Backend and shared `tsc --noEmit` scripts both completed successfully. |
| `npm run test --workspace @othelio/backend` | PASS | 14 files, 82 tests. `basket-position.spec.ts` emitted a warning about an undefined `.rows` in the indexed snapshot read; test still passed and asserted the explicit unavailable result. |
| `npm run lint --workspace @othelio/fe` | NOT RUNNABLE | Script resolves to `eslint`, but shell reports `eslint: command not found` (exit 127). No ESLint findings were produced. |
| `npm run typecheck --workspace @othelio/fe` | NOT CONFIGURED | Workspace package has no `typecheck` script. |
| `npm run build --workspace @othelio/fe` | NOT RUNNABLE | Script resolves to `next build`, but shell reports `next: command not found` (exit 127). |

The stated pre-task report of frontend lint failures cannot be reproduced in this worktree: its configured lint executable is absent. Treat this as an environment/dependency availability limitation, not evidence of a clean lint run or a source regression.

## Structural measurements

Tracked `.ts` / `.tsx` source only (generated output and indexer excluded):

| Scope | Files | Lines |
|---|---:|---:|
| `backend/src` | 52 | 6,849 |
| `fe/src` | 76 | 12,191 |
| `packages/shared/src` | 4 | 519 |
| Total | 132 | 19,559 |

Largest named investigation files:

| File | Lines |
|---|---:|
| `fe/src/features/baskets/BasketDrawer.tsx` | 1,033 |
| `backend/src/baskets/basket-quote-planner.service.ts` | 980 |
| `backend/src/baskets/baskets.service.ts` | 882 |

### Dependencies

- Root workspaces: `fe`, `backend`, `packages/*`; root `build` runs shared, frontend, then backend builds; root `typecheck` runs workspace typecheck scripts.
- `@othelio/fe` dependencies: `@nivo/sankey`, `@othelio/shared`, `@tanstack/react-query`, `@types/three`, `framer-motion`, `lightweight-charts`, `next`, `react`, `react-dom`, `three`, `viem`, `wagmi`. Dev: Tailwind/PostCSS, Node/React types, ESLint/config, TypeScript. Optional platform binaries for Tailwind oxide and Lightning CSS.
- `@othelio/backend` dependencies: Nest common/core/platform-express, `@othelio/shared`, `pg`, `reflect-metadata`, `rxjs`, `viem`, `zod`. Dev: Express/Node/pg types, `tsx`, TypeScript, Vitest.
- `@othelio/shared` dependency: `zod`. Dev: TypeScript.
- Dependency boundaries observed: frontend and backend both consume `@othelio/shared`; shared has no application-workspace dependencies. Backend has runtime framework/database/RPC dependencies; frontend owns Next/React/UI dependencies.

### Route inventory

Frontend Next.js app-router file entry points (16 files: 14 page files and two layouts):

- `/` — `fe/src/app/page.tsx`
- `/app` — `fe/src/app/app/page.tsx`
- `/app/activity` — `fe/src/app/app/activity/page.tsx`
- `/app/agents` — `fe/src/app/app/agents/page.tsx`
- `/app/baskets` — `fe/src/app/app/baskets/page.tsx`
- `/app/baskets/create` — `fe/src/app/app/baskets/create/page.tsx`
- `/app/baskets/[basketId]` — `fe/src/app/app/baskets/[basketId]/page.tsx`
- `/app/baskets/[basketId]/borrow` — `fe/src/app/app/baskets/[basketId]/borrow/page.tsx`
- `/app/borrow` — `fe/src/app/app/borrow/page.tsx`
- `/app/borrow/[basketId]` — `fe/src/app/app/borrow/[basketId]/page.tsx`
- `/app/overview` — `fe/src/app/app/overview/page.tsx`
- `/app/settings` — `fe/src/app/app/settings/page.tsx`
- `/concepts/alloy` — `fe/src/app/concepts/alloy/page.tsx`
- `/concepts/lens` — `fe/src/app/concepts/lens/page.tsx`
- layouts: `fe/src/app/layout.tsx`, `fe/src/app/app/layout.tsx`.

Backend controller inventory: 7 controllers and 30 HTTP decorator declarations under `backend/src`:

- `v1/auth`: `GET nonce`, `POST verify` (2)
- `v1/baskets`: `DELETE reset`, `POST reset`, `GET /`, `POST /`, `GET activity/all`, `GET valuation-history`, `GET :address/accounting-summary`, `GET :address/accounting-events`, `GET :address/accounting-export.csv`, `GET :address`, `GET :address/positions`, `GET assets/supported`, `POST :address/quote-swaps`, `POST :address/lending-log`, `POST :address/lending-log/:txHash/reconcile` (15)
- `v1` portfolio controller: `GET portfolio/overview`, `GET assets`, `GET activity`, `GET baskets/:address/activity` (4)
- `v1/prepare`: `POST :operation` (1)
- `v1/lending`: `POST quote`, `POST basket-breakdown`, `GET adapters`, `GET summary` (4)
- `v1/settings`: `GET :address`, `PUT :address` (2)
- `v1/dex`: `GET providers`, `GET route-history` (2)

The codebase graph architecture index reported 21 `Route` graph nodes project-wide; that number represents graph route nodes, not a replacement for the 30 backend decorator methods plus frontend file routes above.

### Graph hotspots

Codebase-memory architecture scoped to this worktree's project index (`othelio-github`):

- Backend: 345 nodes / 763 edges. Highest fan-in: `DatabaseService.query` (20), `BasketQuotePlannerService.parseAddress` (7), `rpcUrlForChain` (6), `BasketsService.cached` (5), `verifyV3AndSimulate` (4), `BasketsService.iso` (4), `BasketsService.putCached` (4), `resolveRecoveryCapabilities` (4).
- Frontend: 538 nodes / 1,146 edges. Highest fan-in: `fetchApi` (13), `formatAddress` (11), `getCreatedBaskets` (6), `basketTargetTotal` (5), `formatCompactNumber` (5), `useBasketsList` (5), `useWalletRestoring` (5).
- Shared: 85 nodes / 123 edges. Top reported fan-in: `createPortfolioOnlyCapabilities` (2); portfolio capability helpers and `networkKindForChainId` (1 each).
- The graph API did not return zero/one-degree scoped symbol results via its attempted degree query/filter. Candidate confidence below is therefore based on graph hotspots plus explicit repository-wide reference searches, not treating missing graph edges as proof of deadness.

## Candidate inventory and decisions

Confidence/impact/value use High/Medium/Low. No application candidate was modified in this baseline task.

| Candidate | Evidence and entry-point check | Confidence | Behavior boundary / impact | Recommended action |
|---|---|---|---|---|
| `fe/src/components/ProductWorkbench.tsx` — `ProductWorkbench` | Repository-wide symbol search finds only its declaration (the plan mentions the filename in documentation). No app route imports it; no dynamic import references it; not a Next file-convention entry point. No barrel export found by source search. | High | Prototype UI component; removal should not affect routes or API. Check its internal CSS/assets/side effects in the deletion slice. | Delete after final consumer/asset check. |
| `fe/src/components/AddFundsModal.tsx` — `AddFundsModal` | No references outside its own declaration/props in repository-wide symbol search; no route or dynamic import points to it. | High | Legacy modal UI. Check styles/assets and ensure there is no external package consumer (package is private). | Delete after final consumer/asset check. |
| `fe/src/components/TransferModal.tsx` — `TransferModal` | Same repository-wide search outcome: declaration only; no dynamic import or route entry point. | High | Legacy transfer UI; presumed user interaction surface if mounted, but no in-repo mount found. | Delete after final consumer/asset check. |
| `fe/src/components/RedeemModal.tsx` — `RedeemModal` | Declaration only in repository-wide symbol scan; not a route entry point or dynamic import target. | High | Legacy redemption interaction surface; no current route/component consumer found. | Delete after final consumer/asset check. |
| `fe/src/components/RebalanceModal.tsx` — `RebalanceModal` | Declaration only in repository-wide symbol scan; no dynamic import or route references. Active `RebalanceDrawer` implementation in `BasketDrawer.tsx` is distinct and used by the basket flow. | High | Similar domain naming could tempt incorrect consolidation; preserve active `BasketDrawer` behavior. | Delete the unreferenced modal only; retain/defer active drawer. |
| `fe/src/components/LiveIndexCounter.tsx` — `LiveIndexCounter` | `HeroEmblem.tsx` imports and renders it; `HeroEmblem` is used by landing page. | High | Landing-page visible display. | Intentional/reachable; retain. |
| `fe/src/features/baskets/BasketDrawer.tsx` — `BasketDrawer` / inner drawers | 1,033 lines; imported by `BasketDetail`; graph/component references show a live path. | High | Mint, withdraw, rebalance actions and transaction semantics. | Simplify only after focused behavior mapping/tests; do not delete or split on size alone. |
| `backend/src/baskets/basket-quote-planner.service.ts` — `BasketQuotePlannerService` | 980 lines; active provider in basket flow; graph hotspot includes parser/simulation methods. | High | Quote routing, slippage, calldata/preparation and simulation outcomes. | Investigate duplicated branches; defer changes until equivalent output can be pinned. |
| `backend/src/baskets/baskets.service.ts` — `BasketsService` | 882 lines; active API service; graph reports several internal cache/date helpers with multiple callers. | High | API payloads, accounting, cache/fallback behavior. | Simplify locally only with response and fallback contracts pinned. |
| Frontend basket/lending drawers and modals as a family | Multiple legitimate, used components exist (`BorrowModal`, `AaveActionModal`, `BasketDrawer`, and `RebalanceDrawer`). Similar labels alone do not establish duplicate behavior. | Medium | Distinct borrow/repay/supply/withdraw/rebalance contracts. | Defer; compare actual state and transaction flows before consolidation. |
| **Deferred: repeated frontend error extraction / `any` payload reads** | No concrete file or symbol was identified in this baseline. The repository-wide `rg` pass was targeted at the named component candidates and dynamic imports; it did not systematically search for error extraction idioms (`catch`, `response.data`, error message projections), `as any` casts, or repeated untyped payload property reads. The graph query also did not yield scoped low-degree symbols, and no error-specific data-flow trace was run. | Low | Error messages and API payload handling can affect visible failure outcomes. | Defer until a targeted pattern search identifies exact files/symbols, then trace the shared owner and consumers before classifying. |

**Pre-deletion baseline:** five high-confidence component deletion candidates were identified (ProductWorkbench plus four modal variants, 754 lines total by then-current file line count). At that point, this was a candidate reduction opportunity, not yet a completed reduction. `LiveIndexCounter` was specifically rejected as a dead-code candidate because it was consumed. No API, framework route, DI provider, test fixture, or compatibility shim was recommended for deletion.

### Task 2 pre-deletion confirmation

The five candidates were rechecked in the isolated Task 2 worktree immediately before deletion:

- A repository-wide `rg` over hidden files (excluding dependencies, `.next`, and `indexer`) found `ProductWorkbench`, `AddFundsModal`, `TransferModal`, `RedeemModal`, and `RebalanceModal` only in their own declaration/prop files. The sole additional exact candidate symbol matches were the plan's filename mention in documentation; there are no imports, JSX mount sites, dynamic imports, tests, barrels, or app-route references.
- The same scan found `LiveIndexCounter` imported and rendered by `HeroEmblem`; the landing route uses `HeroEmblem`. It remains supported and is retained.
- Codebase-memory graph search reported in-degree 0 for each of the five candidates. Its `is_entry_point: true` flag is based on exported functions and does not establish a Next route: none is under `fe/src/app`, and the Next app's route inventory is unchanged. The graph also returned in-degree 0 for `LiveIndexCounter`, which the direct source scan disproves as a use graph limitation.
- `fe/package.json` declares `@othelio/fe` private and no export map. No public package export path or supported external consumer is configured.
- The candidates have no co-located CSS modules, image assets, or side-effect imports. `ProductWorkbench` uses global stylesheet class names, but classes such as `.allocation-list` and `.allocation-row` are shared with active views; the global stylesheet is retained. Other candidate modal styling is utility classes.
- Rechecked actual file line counts with `wc -l`: 106 (`ProductWorkbench`), 150 (`AddFundsModal`), 139 (`TransferModal`), 179 (`RedeemModal`), and 180 (`RebalanceModal`), 754 total.

Decision: delete only these five unconsumed component files. Keep `LiveIndexCounter`, `HeroEmblem`, all route files, and shared CSS/assets. No stale import or asset cleanup is required.

**Completed Task 2 measurement:** all five candidates were deleted, reducing tracked frontend TypeScript/TSX source by 754 lines (from 12,191 lines across 76 files to 11,437 lines across 71 files). The earlier 754-line figure described the pre-deletion candidate size; this later figure records the completed reduction.

## Commands and results

- `git status --short --branch` — initially clean; branch `codex/application-simplification-audit`.
- `npm run typecheck` — pass, backend + shared.
- `npm run test --workspace @othelio/backend` — pass, 14 files / 82 tests; warning detailed above.
- `npm run lint --workspace @othelio/fe` — unavailable, exit 127 (`eslint: command not found`).
- `npm run typecheck --workspace @othelio/fe` — unavailable, package script missing.
- `npm run build --workspace @othelio/fe` — unavailable, exit 127 (`next: command not found`).
- `git ls-files` + Python line counter scoped to the three source trees — 132 TS/TSX files, 19,559 lines.
- `rg` source-wide references for prototype/modal symbols and dynamic imports — identified the five declaration-only candidates and disproved `LiveIndexCounter` deadness.
- `rg` on `@Controller` and HTTP decorators — 7 controller bases / 30 backend route handlers inventoried (2 + 15 + 4 + 1 + 4 + 2 + 2 = 30, matching the controller list above).
- Codebase-memory `get_architecture` by scope — hotspots and node/edge measurements above. Graph no/low-degree attempts returned no usable scoped matches; this is documented as an evidence limitation.

## Baseline decision / concerns

Proceed to a focused deletion slice for the five declaration-only components, after checking their styles/assets and repeating the global consumer scan in that slice. Keep all route files and the indexer out of scope. For complexity work, select a specific repeated transformation/branch in one of the three large files and establish a contract-level check before editing. Frontend lint/build and frontend typecheck are not verifiable in this worktree until dependencies are installed and/or a typecheck script is added; report their actual baseline limits rather than attributing unseen failures to regressions.

## Final quality-gate measurements (2026-10-05)

The final inventory was run against tracked TypeScript/TSX files in the three scoped source trees after Tasks 2–4:

| Scope | Baseline files / lines | Final files / lines | Net change |
|---|---:|---:|---:|
| `backend/src` | 52 / 6,849 | 52 / 6,875 | +26 lines (the timestamp behavior regression test) |
| `fe/src` | 76 / 12,191 | 71 / 11,437 | -5 files / 754 lines |
| `packages/shared/src` | 4 / 519 | 4 / 519 | no change |
| **Total** | **132 / 19,559** | **127 / 18,831** | **-5 files / 728 lines** |

The backend service consolidation itself shortened the serializer expression by 22 characters without changing the 882-line service size. The test addition accounts for the 26-line backend source increase. The completed simplifications therefore reduced net scoped source by 728 lines, with the five confirmed dead components accounting for the 754-line deletion.

The app-router inventory remains 16 page/layout files, and the backend controller inventory remains 7 controllers / 30 HTTP handlers. No route or package dependency boundary changed. Fresh fast graph indexing of the isolated worktree produced 6,486 nodes / 9,901 edges overall and 345 nodes / 764 edges under `backend/src`. The prior Task 3 fast index recorded 6,483 / 9,900 overall; the fresh index reflects the current worktree and the graph delta is small. Backend hotspot fan-in remains headed by `DatabaseService.query` (20), `BasketQuotePlannerService.parseAddress` (7), `rpcUrlForChain` (6), and `BasketsService.iso` / `BasketsService.cached` (5 each). The consolidated ISO helper now has five callers, compared with four before Task 4.

### Final candidate decisions

- **Accepted and completed, high confidence:** deleted five repository-private, declaration-only frontend components after framework/import/asset checks: `ProductWorkbench`, `AddFundsModal`, `TransferModal`, `RedeemModal`, and `RebalanceModal`. `LiveIndexCounter`, the active drawer flows, and all routes remain reachable and retained.
- **Accepted and completed, narrow duplicate:** accounting-event timestamp serialization now uses the existing `BasketsService.iso` owner. The public ISO output and invalid-date `RangeError` behavior were pinned by the focused regression test.
- **Deferred, no safe duplicate proven:** no frontend/backend error extraction, decimal parsing, drawer, or transaction path was consolidated. The reviewed implementations have distinct accepted input/fallback/action contracts, or the candidate inventory lacks complete cross-layer trace evidence. Reopen only with concrete caller/equivalence evidence and behavior coverage.
- **Deferred, intentional complexity:** the large basket drawer and quote-planner/service files remain live owners of user actions, transaction preparation, quote behavior, API shapes, and cache/fallback behavior. File size or graph fan-in alone did not establish safe removals.

The package dependency boundaries and route counts in the baseline remain unchanged. No indexer path appears in the task diff. Remaining review risk is limited to undocumented out-of-repository imports of the removed files and unverified frontend lint/build due to missing executables; the private package has no export map or supported external component export path.

### Final scoped check results

| Command | Final result |
|---|---|
| `npm run typecheck` | PASS — backend and shared TypeScript checks completed. |
| `npm run test --workspace @othelio/backend` | PASS — 14 files / 83 tests. The existing indexed-snapshot test emitted its known `.rows` warning and passed its unavailable-result assertion. |
| `npm run typecheck --workspace @othelio/fe` | NOT CONFIGURED — the workspace has no `typecheck` script. |
| `npm run lint --workspace @othelio/fe` | NOT RUNNABLE — `eslint: command not found` (exit 127); no lint result was produced. |
| `npm run build --workspace @othelio/fe` | NOT RUNNABLE — `next: command not found` (exit 127); no build result was produced. |

No dependencies were installed or modified. Frontend limitations match the initial baseline and cannot be classified as passing checks or regressions. The handoff report records summarized command results and indexer scope verification; it does not include full command outputs.
