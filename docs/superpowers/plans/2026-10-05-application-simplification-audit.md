# Application Codebase Simplification Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce accidental complexity and source size in the backend, frontend, and shared package by deleting confirmed dead code and collapsing duplicate implementation paths while preserving supported behavior.

**Architecture:** Start with a measured, framework-aware reachability audit. Apply small deletion and consolidation slices, keeping existing route, service, shared type, and transaction boundaries unless a simplification removes a redundant path without changing the contract. Re-index after structural changes and compare the same metrics after each slice.

**Tech Stack:** TypeScript, Next.js, React, NestJS, Vitest, ESLint, Zod, codebase-memory graph, npm workspaces.

**Spec:** `.trellis/tasks/10-05-application-simplification-audit/design.md`

## Global Constraints

- Audit and modify only `backend`, `fe`, and `packages/shared`; the `indexer` is out of scope.
- Preserve user visible flows, API routes and response shapes, transaction preparation semantics, supported networks/assets, contract call behavior, and error outcomes.
- Prefer deletion or reuse of an existing owner over adding a new abstraction.
- Do not split a file unless the split removes a responsibility, duplicate path, or second source of truth.
- Every deletion must have a framework-aware entry point and consumer check.

## Review Focus

- Framework routes and Next.js file based entry points must remain reachable after component cleanup; verify with route inventory and production build.
- Transaction preparation and calldata must remain equivalent after backend/frontend consolidation; verify existing quote/prepare tests and decoded outputs.
- Local fallback and indexed data paths must preserve the same availability semantics; verify existing basket and portfolio tests.
- Dynamic dependency injection and Nest module registration must remain intact; verify backend typecheck, tests, and app startup compilation.
- Shared schemas and frontend aliases must agree at API boundaries; verify package builds and frontend typecheck.

### Task 1: Establish the audit baseline

**Files:**
- Create: `.trellis/tasks/10-05-application-simplification-audit/research/audit-baseline.md`
- Modify: `.trellis/tasks/10-05-application-simplification-audit/implement.md`

**Interfaces:**
- Produces the candidate inventory, baseline command results, and size/graph measurements used by every later task.

- [ ] **Step 1: Capture current checks**

  Run `npm run typecheck`, `npm run test --workspace @othelio/backend`, `npm run lint --workspace @othelio/fe`, and the frontend production build if the environment supports it. Record pass/fail output and known warnings in `audit-baseline.md`.

- [ ] **Step 2: Capture structural measurements**

  Record source line counts, package dependency lists, API route inventory, graph hotspots, and functions/components with zero or low inbound references. Exclude `indexer` paths from candidate tables.

- [ ] **Step 3: Classify candidates**

  For every candidate, record file, symbol, evidence, confidence, likely behavior boundary, and recommended action: delete, consolidate, simplify, defer, or intentional complexity.

- [ ] **Step 4: Review the candidate list**

  Reject candidates that are framework entry points, dynamic imports, dependency injection providers, route files, test fixtures, or supported compatibility paths unless a separate consumer check proves otherwise.

### Task 2: Remove confirmed dead frontend code

**Files:**
- Modify or delete only the frontend files confirmed by Task 1, initially expected around `fe/src/components/ProductWorkbench.tsx`, unused modal variants, and `fe/src/components/LiveIndexCounter.tsx`.
- Modify: affected frontend imports, route files, and tests only when required by the confirmed deletion.

**Interfaces:**
- Consumes Task 1's confirmed dead-code table.
- Produces the same reachable frontend route/component surface minus deleted symbols.

- [ ] **Step 1: Prove each deletion candidate**

  Search imports, JSX references, route entry points, dynamic references, package exports, and documentation references. For each candidate, add the evidence to `audit-baseline.md` before deleting it.

- [ ] **Step 2: Delete the smallest safe slice**

  Remove only candidates with no supported consumer, then remove stale imports, styles, and assets made unreachable by that deletion.

- [ ] **Step 3: Run frontend checks**

  Run `npm run typecheck --workspace @othelio/fe`, `npm run lint --workspace @othelio/fe`, and `npm run build --workspace @othelio/fe`. Expected result: no route disappears and the checks do not gain new failures.

- [ ] **Step 4: Measure the result**

  Re-run scoped line counts and route/component inventory. Record deleted files, lines removed, and any lint errors fixed as part of the same slice.

### Task 3: Collapse one duplicated application path

**Files:**
- Modify the specific frontend/backend/shared files identified by Task 1 after tracing the basket or lending flow.
- Test: the closest existing backend or frontend test file for the selected contract; add a focused test only if the current suite does not pin the preserved behavior.

**Interfaces:**
- Consumes existing API/shared types and service/component boundaries.
- Produces one owner for the selected duplicated transformation, validation, state transition, or payload projection with the existing public signature preserved.

- [ ] **Step 1: Trace the duplicated path**

  Use graph callers/callees and source inspection to map `API → service → shared type → hook/lib → component`. Identify the two implementations and write the preserved input/output behavior in the audit report.

- [ ] **Step 2: Add or strengthen a behavior check**

  Pin the relevant normal case, empty/unavailable case, and error/fallback case using the existing test style. Run it before the refactor and confirm it passes.

- [ ] **Step 3: Consolidate on the existing owner**

  Move consumers to the existing implementation or extend it with the smallest typed parameter needed. Delete the redundant helper, branch, cast, or local state copy after all consumers migrate.

- [ ] **Step 4: Verify cross-layer equivalence**

  Run the focused tests, backend/shared typechecks, frontend typecheck, and any relevant frontend lint. Compare API payload shape or decoded transaction data before and after when applicable.

- [ ] **Step 5: Re-index and measure**

  Re-run the codebase index and compare graph fan in/fan out, source lines, and candidate count. Record why the remaining duplicated paths are intentional or defer them with evidence.

### Task 4: Reduce complexity in one large file

**Files:**
- Modify one of `fe/src/features/baskets/BasketDrawer.tsx`, `backend/src/baskets/basket-quote-planner.service.ts`, or `backend/src/baskets/baskets.service.ts`, selected by measured duplication and risk.
- Test: the owning existing test file, plus a focused regression test if a behavior boundary is currently untested.

**Interfaces:**
- Preserves the file's existing exported component/service methods and external response/call shapes.

- [ ] **Step 1: Identify a concrete complexity source**

  Select repeated state transitions, duplicated validation, repeated payload conversion, or parallel fallback branches. Do not refactor based on line count alone.

- [ ] **Step 2: Pin behavior at the boundary**

  Add or strengthen tests for the affected success, unavailable, and failure paths before changing implementation.

- [ ] **Step 3: Simplify in place**

  Make one local change that removes duplicate logic or a second source of truth. Preserve public names and contracts unless the candidate is fully internal.

- [ ] **Step 4: Verify and compare size**

  Run focused tests and typechecks, then compare cognitive complexity and source lines. Revert or defer the change if it only moves code or adds abstraction without reducing maintenance cost.

### Task 5: Final quality gate and handoff

**Files:**
- Modify: `.trellis/tasks/10-05-application-simplification-audit/research/audit-baseline.md`
- Modify: `.trellis/tasks/10-05-application-simplification-audit/implement.md`
- Modify: `.trellis/tasks/10-05-application-simplification-audit/check.jsonl` only if check context is needed by the selected execution mode.

- [ ] **Step 1: Run the full scoped checks**

  Run backend/shared typechecks, backend tests, frontend typecheck, frontend lint, and frontend build. Record exact results and distinguish pre-existing failures from regressions.

- [ ] **Step 2: Confirm scope**

  Run `git diff --name-only` and verify no `indexer` file changed.

- [ ] **Step 3: Re-run measurements**

  Compare source lines, candidate count, graph hotspots, and dependency boundaries to the baseline. Document reductions and deferred debt.

- [ ] **Step 4: Complete the quality review**

  Run the Trellis quality check, update relevant project guidance only when the audit reveals a durable convention, and prepare the final review summary.

- [ ] **Step 5: Commit reviewable slices**

  Commit deletion and simplification slices separately with messages that state the behavior preserved and the code removed.
