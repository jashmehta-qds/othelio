# Risk Split Live Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch one fully functional, operator-created Risk Split market on Base with live Protected and Upside limit-order books, audited claim redemption, and a small Othelio admin console.

**Architecture:** The deployer wallet owns a new restricted `SeriesFactory`; an expiry-round oracle adapter fixes payouts. The Rust indexer supplies canonical series/position state. A separate admin frontend shares app code but uses typed, authenticated backend admin APIs. Othelio runs an offchain signed-order book and matching service while a verified existing ERC-20 protocol performs atomic onchain fills/cancels; the public page presents only executable state.

**Tech Stack:** Solidity 0.8.24/Foundry, Base, Chainlink-compatible feeds, Rust/sqlx indexer, Postgres, NestJS, Next.js/React, viem/wagmi, EIP-712, USDC. Preferred settlement spike: 0x v4 limit orders, subject to Base and B20 compatibility proof.

**Spec:** `docs/superpowers/specs/2026-11-02-risk-split-live-markets-design.md`. Read it first; the earlier market UI spec covers existing page behavior.

## Global constraints

- Keep this standalone from baskets. Admin overview may read basket metrics.
- Deployer wallet is the initial owner. No Safe deployment in this release. Factory public creation defaults disabled; two-step ownership transfer permits migration later.
- No private keys in browser, source, logs, CLI arguments or backend environment. Browser requests a wallet transaction; onchain checks are authoritative.
- No placeholder series, bids, asks, fills, volume or arbitrage in live UI.
- No raw admin contract-call endpoint, no collateral withdrawal, and no unverified B20/feed/route approval.
- Use actual token/feed decimals. Rounding, fee and gas conventions must be documented in integer units.
- The first live expiry must fall during the chosen feed's verified publication window, away from session boundaries; weekend/holiday expiries need a separate fixing policy before they are offered. Use the feed calendar in `America/New_York` with DST, holidays and early closes.
- `claim/USDC` books are distinct for Protected and Upside; the book may initially have no orders. A visible book is not a promise of liquidity.
- Phase gates are blocking: do not expose live trading or deposit meaningful collateral when venue, fixing, invariants or external review fails.
- Each task gets a focused review and commit on the Risk Split feature branch; never silently include unrelated main work.

## Review focus

- A delayed settlement call must yield the same pre-expiry fixing round and fractions as an on-time call; prove with a test in Task 2.
- Zero or extreme feed prices and multiple tiny redemptions must never create an unclaimable or overclaimable vault; prove with invariants in Task 3.
- An order whose maker moves funds, revokes allowance, cancels onchain, or crosses expiry must disappear from executable depth; prove in Tasks 6–7.
- A stale/reorged indexer must not show a confirmed market or fill that no longer exists; prove in Tasks 4 and 6.
- A non-owner browser must never obtain a signable admin transaction or mutate catalog/market metadata; prove in Task 5.

---

## Phase A — decide the two settlement rules with executable evidence

### Task 1: Base venue and token compatibility spike

**Files:** Create `docs/risksplit/venue-decision.md`, `contracts/test/risksplit/VenueBaseFork.t.sol` or an equivalent minimal integration harness under `scripts/risksplit/`; add no production exchange contract in this task.

**Interfaces:** Produce a documented `VenueAdapter` contract for the app/backend: typed order shape and EIP-712 domain, `getOrderStatus`, `buildFillTx`, `buildCancelTx`, onchain fill/cancel event signatures and required token approvals. This may be a TypeScript interface in `packages/shared/src/risksplit/venue.ts` once venue proof passes.

- [x] Pin Base block, token and USDC addresses, venue deployment/address/code hash, official ABI/source and fee model. Verify the candidate token is B20 initialized, has the stated decimals, and can transfer/approve through the venue. Record any testnet gaps.
- [x] Write a failing/throwaway test for two real ERC-20 pairs with 6/8/18 decimal combinations: maker signs, opposing wallet fills, partial fill, remainder fill, cancellation, replay rejection, and reverted fill recovery. Explicitly test whether two resting signed orders can be crossed without a taker wallet transaction.
- [x] Run the fork test against pinned Base state and capture transaction receipts/gas; test order expiry at or before series expiry and allowance revocation.
- [x] Decide and document either (a) the verified existing settlement primitive and taker-driven matching path, or (b) a revised reviewed venue. If neither passes, stop before production book implementation; a custom exchange requires its own design, threat model and audit.

**Gate:** One claim-like token/USDC order can be signed, partially filled and cancelled on a pinned Base fork without Othelio custody. This is independent of current 0x Swap API liquidity.

### Task 2: Expiry fixing specification and proof

**Files:** Create `docs/risksplit/fixing-spec.md`; modify `contracts/src/risksplit/SettlementAdapter.sol`, `contracts/src/risksplit/interfaces/ISettlementAdapter.sol`; add `contracts/test/risksplit/RiskSplitFixingTest.t.sol` and a Base fork feed test.

**Interfaces:** A series settles with a nominated feed `roundId`; adapter verifies the last valid observation at/before `expiry`, within a feed-specific maximum age, and proves there was no later eligible pre-expiry round. It reports normalized price, feed, round ID and observed timestamp. The series persists fixing identity as well as price. Exact signature is settled in this task before downstream ABI/API work.

- [x] Record the feed's phase/round behavior and corporate-action/pause characteristics for the launch token. Specify how to prove “last eligible pre-expiry round,” including phase boundaries, and what happens if no sufficiently fresh round exists.
- [x] Reject draft expiries outside the launch feed's verified publication window or too close to its boundaries; test Friday/weekend/holiday, early-close and daylight-saving boundaries explicitly.
- [x] Write failing tests for delayed calls, stale/incomplete/negative/zero rounds, wrong feed decimals, phase boundary, bad predecessor, unavailable oracle and reorged candidate.
- [x] Implement the minimum verifiable fixing path; reject arbitrary latest-price settlement. If the desired feed cannot prove the rule onchain, replace the rule/adapter design before proceeding, with user review of the payoff change.
- [x] Run Foundry and Base fork tests. Save exact price-scale and timestamp examples in `fixing-spec.md`.

**Gate:** A caller cannot change settlement payout by choosing when to call `settleSeries` or by supplying an unrelated or stale feed round. The chosen price is never post-expiry.

## Phase B — harden contracts and establish the canonical data path

### Task 3: Factory permissions, market validity and vault hardening

**Files:** Modify `contracts/src/risksplit/{SeriesFactory,RiskSplitSeries,ClaimToken}.sol` and interfaces; expand `contracts/test/risksplit/{RiskSplitSeriesTest,RiskSplitSecurityTest,RiskSplitInvariantTest}.t.sol`; add deployment/fork scripts under `contracts/script/risksplit/`.

**Interfaces:** `SeriesFactory` exposes `owner`, `pendingOwner`, `publicCreationEnabled=false`, `setPublicCreationEnabled(bool)`, owner-managed `approvedExpiry(underlying, timestamp)` and `createSeries(...)` with creation metadata from Task 2. Emit versioned creation/reference events. Existing vault mint/combine/redeem interfaces remain usable; new series use the hardened constructor/initialization path.

- [x] Write failing tests: non-owner creation reverts by default; owner creates only at an owner-approved exact expiry timestamp for the underlying; owner toggles public creation; non-owner cannot toggle or approve dates; ownership transfers in two steps; zero/wrong underlying and feed, unsupported token, duplicate terms, invalid floor/cap/expiry and mismatched decimals revert. Test the actual Base B20 token without a bytecode-length assumption.
- [x] Bind claim initialization to the creating factory and validate claim identities exactly once; validate adapter/feed identity and price units at creation. Store verifiable reference feed/round/block/price and formula version so profile labels cannot drift.
- [x] Define zero-price allocation and rounding dust behavior, then write supply/collateral invariants over mint, transfers, pair redemption, settlement and arbitrary single-side redemption order. Include 6/8/18-decimal tokens, tiny amounts, max permitted prices and fee/rebase/reentrant token mocks.
- [x] Implement bounds and safe arithmetic, exact in/out transfer checks, checks/effects/interactions and nonReentrant entry points. Keep backing inaccessible to owner and emergency controls unable to block already-matured redemptions.
- [x] Run `forge test --match-path 'test/risksplit/*'`, invariant/fuzz suite, `forge fmt --check`, `forge lint`, static analysis and pinned Base fork tests. Review every external token/oracle call and authorization surface manually.

**Gate:** Permission, feed and conservation properties pass; no known high/critical issue remains from internal review. Breaking ABI changes are versioned rather than silently applied to earlier series.

### Task 4: Risk Split indexer and read-model truth

**Files:** Implement `indexer/src/risksplit.rs` and wire `indexer/src/{main,abis,db,events}.rs`; update `database/migrations/019_risk_split_series.sql` via a new forward migration, never rewrite an applied migration; modify `backend/src/risksplit/{risksplit.service,risksplit.types,risksplit.controller}.ts` and tests.

**Interfaces:** Factory events create series rows with verified reference/fixing metadata; series and claim events update positions/flows. Public `GET /v1/risksplit/series` returns only chain-verified registered series; detail includes `asOfBlock`, indexer freshness, status and claim addresses. No production mock fallback.

- [x] Write failing indexer fixture tests for series creation, mint, pair redemption, claim transfer, settlement, both redemptions, duplicate logs, restart and reorg rollback. Prove balances reconcile with onchain `balanceOf` for sampled holders.
- [x] Implement event discovery from the configured new factory, dynamic series/claim tracking, idempotent block commits and reorg rewind. Backfill from factory deployment block before serving live markets.
- [x] Add migration for reference/fixing metadata and operations audit fields. Make backend return stale/unavailable rather than plausible but old markets when indexer health fails.
- [x] Run `cargo test` in `indexer`, backend targeted tests and a fork replay. Compare factory `allSeriesLength` and onchain state to DB at the same block.

**Gate:** After a live series transaction, admin and public APIs converge on the same confirmed factory/series state; restarts and reorgs recover without manual DB edits.

## Phase C — build an operator console that uses those authorities

### Task 5: Authenticated admin API and frontend

**Files:** Add focused modules under `backend/src/admin/` (auth, overview, assets, markets, operations); add `fe-admin/` Next.js workspace reusing `packages/shared` types and selected `fe` design primitives; update root workspace/build/deploy configuration. Extend existing `backend/src/auth/` only if reuse is appropriate. Add tests beside new modules.

**Interfaces:** `POST /v1/admin/auth/challenge`, `POST /v1/admin/auth/verify`, authenticated `GET /v1/admin/overview|assets|markets|operations`, typed `POST /v1/admin/markets/preview`, and typed asset transaction previews. A preview returns target, chain ID, ABI method/arguments, expected state and simulation result, never a server-signed transaction. Wallet executes directly on Base. Every write is chain-owner checked and audited.

- [x] Write tests for challenge nonce replay/expiry, wrong chain, wrong signer, revoked owner, session expiry, cross-site request forgery, non-owner access, invalid token/feed/route and missing indexer state.
- [x] Implement overview counts with explicit definitions and `asOfBlock`: distinct active wallets by window, baskets created, assets supported, Risk Split status/volume, order-book/indexer health. Keep aggregate queries indexed; omit personally identifying data.
- [x] Implement asset review using the existing B20 asset-onboarding checks: address identity, decimals/supply, feed and freshness, registry ownership, route quote/execution tests, staged vs tradeable state. Present ordered transactions for the correct registry owners; do not mark an asset enabled until receipts/indexer confirm it.
- [x] Implement markets draft/preview/create flow: arbitrary supported token, floor/cap percentage-to-raw calculation, verified reference round, feed-specific trading calendar and boundary buffer, exact expiry approval, duplicate check, payoff examples, target factory/owner, wallet-signed transaction, pending/confirmed/indexed states. Add operations view for fixing, settlement and incident state.
- [x] Build accessible desktop/mobile admin screens with existing Othelio spacing and component tokens. Run backend tests, frontend lint/typecheck/build and browser flows with owner and non-owner wallets.

**Gate:** A non-owner cannot access write previews or create a market; the deployer can create one without copying calldata, and every displayed asset/market state names its source and confirmation status.

## Phase D — make two real books and the public trading flow

### Task 6: Signed-order relay, matcher and book API

**Files:** Create `backend/src/orderbook/` with signed order validation, persistence, sequencing, matcher/transaction builder and read/WebSocket or SSE controllers; add forward database migration `database/migrations/021_risk_split_orders.sql` or next unused number; add shared order/venue types in `packages/shared/src/risksplit/`; extend indexer for venue fills/cancels. Exact filenames adapt to migration sequence at execution.

**Interfaces:** `GET /v1/risksplit/series/:address/books/:claim` returns versioned bids/asks/depth/trades and freshness; `POST /v1/orders` accepts signed order; `GET /v1/orders?owner=` lists owner orders; `POST /v1/orders/:hash/cancel-intent` hides an order locally; typed fill/cancel transaction builders return wallet-signable calls. Onchain venue status, not DB alone, determines fillable amount. No generic arbitrary target or calldata route.

- [x] Write failing tests for invalid EIP-712 domain/chain/venue, signature, unsupported pair, token decimals, price/size overflow, nonce replay, expired order, insufficient balance/allowance, same-wallet self-match and maker cancelling/moving funds mid-match.
- [x] Persist signed orders and deterministic price/time priority. Publish snapshots plus ordered deltas; restart reconstructs the same book. Distinguish locally hidden orders from onchain cancelled orders.
- [x] Implement taker-driven crossing proven in Task 1, partial fill accounting, exact price/fee/gas display and tx status transitions. Index onchain fills/cancels; reconcile failed, replaced and reorged transactions. Remove unfillable quotes from executable depth promptly.
- [x] Test two books for one series, two simultaneous makers, partial fill, cancel, reconnect sequence gap, matcher restart and reorg. Run backend tests plus Base fork venue integration.

**Gate:** Two wallets can post, see, fill and cancel real orders; book and receipts reconcile after restart and reorg. All funds remain in user wallets or the existing audited settlement primitive until executed.

### Task 7: Public market UI and wallet actions

**Files:** Modify `fe/src/features/risksplit/RiskSplitDashboard.tsx`, `RiskSplitMarketDetail.tsx`, `RiskSplitMarkets.module.css`, `useRiskSplitMarkets.ts`, and `useRiskSplit.ts`; add focused `OrderBook`, `OrderTicket`, `MyOrders`, `useRiskSplitBook` modules and tests; update `fe/src/lib/contracts.ts` only for verified ABIs.

**Interfaces:** The existing `/app/risk-split` list shows best executable bid/ask for both claims and book freshness. `/app/risk-split/[seriesAddress]` shows both depth ladders, recent confirmed trades, connected wallet balances, signed limit-order ticket, open-order cancel, mint pair, combine, expiry and settlement/redemption flows.

- [x] Write tests for empty/stale/disconnected book, network or wrong-chain wallet, 6/8/18-decimal amount parsing, partial fill, cancel pending/confirmed, expiry, insufficient allowance and transaction revert.
- [x] Implement subscribe/snapshot recovery, executable-price display, market selection, buy/sell order construction, signature UX, fill wallet confirmation and receipt state. No fabricated quote or false arbitrage: net arb needs executable stock and both claim routes at a stated size after fees/gas.
- [x] Keep payoff and claim management below the trading workspace; show actual fixing source and time. Run frontend tests, lint, typecheck, production build and browser flows at desktop/mobile widths.

**Gate:** A user who has never used the admin console can find the market and complete mint, order, fill, cancel and redemption actions without manual contract calls.

## Phase E — security and live Base proof

### Task 8: Adversarial verification and external review

**Files:** Add threat model `docs/risksplit/security-review.md`, test vectors, deployment runbook and any focused fixes in owning tasks. Contract fixes require rerunning all affected gates.

- [x] Threat-model factory ownership, malicious underlying/token hooks, oracle manipulation/delay, wrong feed scale, EIP-712 domain/replay, signed order theft, partial fills/rounding, matcher equivocation, admin API abuse, stale books, indexer reorg, pause/recovery and event divergence.
- [x] Run full Foundry unit/fuzz/invariant/fork suites, static analyzers, Rust tests, backend/frontend tests, builds and end-to-end wallet tests. Generate coverage for payoff boundaries and all privileged methods.
- [x] Obtain an independent contract security review of new factory/vault/adapter and venue integration, resolve all critical/high findings, document medium dispositions and rerun tests after fixes. “No bugs” cannot be guaranteed; this is the release safety standard.

**Gate:** Review sign-off and reproducible test evidence; no critical/high issue open.

### Task 9: Base release with one token

**Files:** `contracts/script/risksplit/`, deployment manifest under `packages/shared`, environment/deploy configuration, `docs/risksplit/base-launch-runbook.md`. Prepare exact owner transactions and verification; broadcast only when the user authorizes deployment.

- [x] Pin token, B20 identity, feed and quote token; verify registry owner addresses, route and venue compatibility at a pinned Base block. Complete fork dress rehearsal from deploy to expiry with accelerated time and a real feed fixture.
- [x] Deploy/verify the new factory and adapter, set deployer owner/public creation disabled, configure backend/indexer from verified deployment receipts, backfill and compare onchain versus DB. Use one small, clearly marked live series and documented cap on pilot exposure.
- [x] From admin UI create series; from two distinct wallets mint pair, post both books, partially fill, fully fill and cancel orders; inspect balances, logs, book and admin counts. After real expiry, verify the selected oracle round and redeem both claims. Do not claim full live completion before this expiry test succeeds.
- [x] Exercise stop/restart, orderbook/indexer outage and read-only fallback. Archive addresses, block numbers, tx hashes, code hashes, test output, audit sign-off and recovery instructions.

**Gate:** All acceptance items in the design have Base mainnet receipts and matching UI/API state. If an oracle/venue constraint blocks a real token, hold launch and revise the design instead of silently substituting a mock market.

## Release ordering and estimates

Tasks 1–2 are proof gates; 3–4 establish trustworthy contracts/data; 5 and 6 are operator/trading services; 7 exposes trading; 8–9 release it. Tasks 5 and 6 can be developed in parallel only after interfaces from 1–4 are stable. Expect **roughly 20–35 engineer-weeks plus external audit and calendar time to reach a real expiry**, subject to the venue/fixing spikes. This is a planning estimate, not a delivery promise.

The plan intentionally does not assume Clober integration, a Safe, guaranteed counterparties, or an automated market maker. Open-source settlement may eliminate a custom exchange contract; it does not eliminate Othelio's book, matcher, indexing, UI, or operational duties.
