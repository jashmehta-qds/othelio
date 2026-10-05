# Implementation plan: Application codebase simplification audit

## Phase 1: Baseline and inventory

- [x] Record git status and existing worktree assumptions.
- [x] Capture backend/shared typecheck, backend tests, frontend typecheck, and frontend lint output.
- [x] Record routes, package dependencies, source line counts, graph hotspots, and zero/low fan in candidates.
- [x] Create a scoped audit report with confidence and behavior risk for each candidate.

## Phase 2: High confidence deletion

- [x] Verify framework entry points and all imports for the strongest dead-code candidates.
- [x] Remove five confirmed dead components; no associated asset or stale-import cleanup was needed.
- [x] Run frontend typecheck/lint/build checks and confirm route inventory; record tool availability constraints.

## Phase 3: Duplicate path simplification

- [x] Trace the candidate basket/execution paths and their behavior boundaries.
- [x] Review candidate overlaps; no additional safe duplicate path was proven, so defer consolidation.
- [x] Preserve existing owners and contracts; no Task 3 behavior change or new test was warranted.
- [x] Re-run graph and size measurements.

## Phase 4: Complexity reduction in large files

- [x] Review the named large files for proven duplicated transformations/state and behavior boundaries.
- [x] Consolidate accounting-event timestamp normalization through the existing `BasketsService.iso` helper.
- [x] Keep the change local and verify ISO output / invalid timestamp behavior with a focused regression test.

## Phase 5: Quality gate and handoff

- [x] Run backend/shared typechecks and backend tests.
- [x] Run frontend typecheck, lint, and production build where the environment permits; record unavailable tooling accurately.
- [x] Confirm no indexer files changed.
- [x] Update the audit report with completed work, deferred candidates, measurements, and remaining risks.
- [x] Run the scoped final quality review; no durable project convention was introduced, so no spec update is warranted.

## Stop conditions

- Stop and split the work if a candidate changes an API, contract call, database schema, or user flow.
- Stop a deletion if a dynamic/framework entry point cannot be ruled out.
- Reject refactors that increase abstraction or file count without reducing implementation paths or maintenance cost.
