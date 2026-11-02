# Risk Split Market Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-stock Risk Split dashboard into an honest multi-asset market browser and selected-series trading page.

**Architecture:** The API returns only registered series and nullable verified creation metadata. The frontend joins those series to the existing asset catalog, reads wallet balances onchain, and renders profile-filtered rows. A selected-series route owns minting and payoff details; order-book controls remain disabled until a venue supplies executable data.

**Tech Stack:** Solidity/Foundry; NestJS/Postgres; Next.js/React/TypeScript; wagmi/viem; CSS modules.

**Spec:** `docs/superpowers/specs/2026-10-31-risk-split-market-ui-design.md`.

## Global Constraints

- Only real open series; no placeholder contracts or fabricated live prices.
- Named profiles require verified creation reference metadata; missing metadata is Other.
- New claim tokens mirror underlying ERC-20 decimals.
- No order-book venue is chosen or integrated here.
- Keep existing payout formula and vault raw-unit conservation.

## Review Focus

- Empty registry: show a real empty state, never a fallback sample.
- API outage: show an error and recovery, never a fake market.
- Non-18-decimal asset: display and transact one whole token as one whole claim on each side.
- Expired/settled series: exclude from open list; detail remains readable for redemption when directly linked.
- Missing or stale price/book data: show unavailable state and no arbitrage label.

---

### Task 1: Decimal-correct claims

**Files:** `contracts/src/risksplit/ClaimToken.sol`, `contracts/src/risksplit/SeriesFactory.sol`, `contracts/test/risksplit/RiskSplitSeriesTest.t.sol`.

**Interfaces:** `ClaimToken(..., address seriesVault, uint8 decimals)` exposes `decimals()` matching `IERC20Metadata(underlying).decimals()`; the factory passes the verified value to both claims.

- [ ] Add failing tests for 6-, 8-, and 18-decimal underlying mint and pair redemption with displayed whole units.
- [ ] Run targeted Foundry suite; confirm the new tests fail.
- [ ] Implement mirrored claim decimals and exact raw-unit factory construction.
- [ ] Run targeted Foundry suite and confirm all pass.

### Task 2: Real series and profile metadata

**Files:** `backend/src/risksplit/risksplit.service.ts`, `backend/src/risksplit/risksplit.types.ts`, `backend/src/risksplit/risksplit.spec.ts`, `database/migrations/020_risk_split_reference_price.sql`.

**Interfaces:** Series API returns nullable `creationReferencePriceUsdE8`, source feed/round/block, and `profileKey`. `getSeriesList()` returns only DB-backed series; no seeded fallback.

- [ ] Add tests for empty DB, API error, open-series filtering, and Other classification when metadata is absent.
- [ ] Run backend targeted tests and confirm failures.
- [ ] Add metadata schema mapping and remove sample fallback from production reads.
- [ ] Run backend tests and confirm pass.

### Task 3: Market read model and wallet balances

**Files:** `fe/src/features/risksplit/useRiskSplitMarkets.ts`, `fe/src/features/risksplit/riskSplitMarket.ts`, `fe/src/features/risksplit/riskSplitMarket.test.ts`.

**Interfaces:** `useRiskSplitMarkets()` returns verified open series joined to catalog and wallet balances; `profileForSeries(series)` returns named profile or Other; quote/arb fields remain nullable.

- [ ] Add pure tests for three profile pairs, absent metadata, expiry, and missing executable quotes.
- [ ] Run tests and confirm failure.
- [ ] Implement read model using existing catalog hook, series API, and wagmi batched ERC-20 balance reads with actual decimals.
- [ ] Run tests and confirm pass.

### Task 4: Market list and selected series page

**Files:** `fe/src/features/risksplit/RiskSplitDashboard.tsx`, `fe/src/features/risksplit/RiskSplitDashboard.module.css`, `fe/src/app/app/risk-split/[seriesAddress]/page.tsx`, `fe/src/features/risksplit/RiskSplitMarketDetail.tsx`, `fe/src/features/risksplit/RiskSplitActionPanel.tsx`, `fe/src/features/risksplit/useRiskSplit.ts`, `fe/src/features/risksplit/PayoffVisualizer.tsx`.

**Interfaces:** List links to `/app/risk-split/[seriesAddress]`; detail passes the address through every selected-series read/write; action panel formats and parses selected underlying decimals.

- [ ] Add UI tests for empty/error/list/detail states and no enabled book order action.
- [ ] Run tests and confirm failure.
- [ ] Build responsive list, profile tabs, wallet tokens and detail hierarchy; move payoff below trading area.
- [ ] Wire mint, combine and redeem to selected series; keep book ticket disabled with clear reason.
- [ ] Run frontend tests, lint, type-check and build.

### Task 5: End-to-end review

**Files:** changed targets above.

- [ ] Run Foundry Risk Split tests and backend/frontend targeted tests.
- [ ] Inspect desktop and mobile page renders in one browser round; fix material defects, confirm once.
- [ ] Run Impeccable detector once on changed UI targets.
- [ ] Report shipped behavior, unavailable trading capability, and any launch blockers.
