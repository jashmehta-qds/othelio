# Stock Upside Markets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for contracts and cross-layer work) or `superpowers:executing-plans` task by task. Track each checkbox. Read the [design spec](../specs/2026-11-11-upside-markets-design.md) and the repository's `AGENTS.md`, `.trellis/workflow.md` and relevant `.trellis/spec/` before editing. The current working tree contains other people's work: never reset it, stage blindly, or overwrite their edits.

**Goal:** Ship a separately branded, fully stock-backed weekly Upside marketplace on Base while preserving and first pushing the existing Risk Split product.

**Architecture:** A new owner-configured weekly-round factory deploys immutable strike series, each holding underlying stock tokens and issuing continuous-payoff Upside/Residual ERC-20 claims. Versioned indexer/API/admin/public UI layers reuse reviewed 0x venue primitives for visible USDC books; the legacy Risk Split stack stays pinned and usable by direct URL.

**Tech Stack:** Solidity 0.8.24/Foundry/OpenZeppelin, Base + Chainlink, 0x limit orders, Rust/sqlx/Postgres indexer, NestJS/viem backend, Next.js 16/React/wagmi frontends.

**Spec:** `docs/superpowers/specs/2026-11-11-upside-markets-design.md`

## Global Constraints

- **Order is mandatory:** verify, document, commit and push `feature/risk-split` first; then create a new `feature/upside-markets` branch. Do not develop Upside on the unpushed V1 tree.
- Preserve deployed V1 contracts, `contracts/deployments/base-mainnet-risksplit.json`, ABI meaning, DB meaning, backend/admin direct access and public direct URLs. Keep its AppShell navigation item on by default alongside Upside; `NEXT_PUBLIC_RISK_SPLIT_NAV_ENABLED=false` may hide only that item later.
- Add `RISK_SPLIT_INDEXING_ENABLED` to the indexer on the Upside branch. Default `true` preserves V1; explicit `false` stops Risk Split scanning/projection without stopping baskets, prices or Upside. Re-enable must backfill from a separate Risk Split cursor, since the current shared event checkpoint advances while Risk Split is off. Never delete V1 rows or misrepresent paused data as current.
- Set both Risk Split switches explicitly `true` in the current Base development profile. Backend Risk Split routes remain available; verify fresh indexed data before restoring public visibility after any future indexing pause.
- First-release payoff is continuous `max(S-K,0)` Upside plus `min(S,K)` Residual, delivered in underlying tokens. No fixed-dollar YES tickets, cash promise, public expiry choice, or one-active-expiry rule.
- Admin approves every expiry/feed/underlying/round policy and chooses all strikes. Market creation is owner-only, inside approved min/max/tick bounds.
- Four default weekly targets are `P0 + {0, 0.5, 1, 2} × M`, rounded to the admin-approved tick; labels Starting price, Reach, Strong move, Long shot. Source `P0` from a verified feed round, `M` from recorded options IV or sourced manual input. Reject duplicate rounded strikes.
- Underlying discovery and eligibility use the **same Othelio basket asset registry** on the same chain: `getSupportedTokens`, `isSupported`, and `getAsset`. No separate Upside allowlist or static-catalog substitute. Disabled assets block new round/market/mint, while withdrawal/redemption remain available.
- No hidden key in browser, repository, logs or terminal history. Use connected deployer wallet and encrypted Foundry keystore. New mainnet deployment has its own manifest and start block.
- No synthetic live chart, fabricated quote or fabricated cost basis. Stale indexer/book and empty books are explicit states.
- Treat `.codex-visuals/stock-upside-marketplace.html` as an approximate user-journey and layout template. Public and admin UI use Othelio's existing colors, typography, spacing, surfaces and shell patterns; do not copy the HTML's CSS or fictional data.
- New contracts are immutable and separately deployed. Shared helper refactors need V1 regression tests. Independent review and no unresolved high/critical findings precede meaningful mainnet exposure.

## Review Focus

1. **Admin bypass:** a public caller or admin direct call creates a strike outside approved policy. Task 4 tests both roles through the same validator.
2. **Collateral/rounding:** mixed decimal tokens and redemption order let claims withdraw more than deposited or strand material dust. Tasks 3 and 5 fuzz cumulative allocation and malicious tokens.
3. **Wrong fixing:** delayed settlement or feed phase transition changes the expiry price. Task 5 verifies the exact pre-expiry observation, successor and stale failures on a pinned Base fork.
4. **Quote race:** one maker order is filled/cancelled between preview and click; Task 8 tests atomic all-or-revert batch fill and exact total USDC.
5. **Legacy regression:** hiding the nav breaks old Risk Split URLs, pins, indexer or admin. Tasks 1 and 10 verify V1 before/after the new UI.

## File map and dependency order

The following paths are the intended owners; add narrowly scoped supporting files when required. Do not append V2 behavior to V1 Solidity classes.

| Work | New/modified paths | Deliverable |
| --- | --- | --- |
| V1 checkpoint | `docs/risksplit/original-v1.md`, existing dirty V1 files, `contracts/deployments/base-mainnet-risksplit.json` | Audited git scope and pushed V1 baseline |
| Contracts | `contracts/src/upside/{UpsideFactory,UpsideSeries,UpsideClaimToken,UpsideFixingAdapter}.sol`, `contracts/test/upside/*` | Immutable rounds/series and payoff |
| Shared/deploy | `packages/shared/src/upside/*`, `contracts/script/upside/*`, `scripts/*upside*`, `contracts/deployments/base-mainnet-upside.json` | ABIs, addresses and safe deployments |
| Data/indexer | `database/migrations/024_upside_*.sql`, `indexer/src/upside.rs`, `indexer/src/{main,events,abis,risksplit,db}.rs`, `.env.base.example`, `docker-compose.yml` | Replayable Upside state and independently resumable Risk Split flag |
| API/venue | `backend/src/upside/*`, shared 0x helpers extracted from `backend/src/orderbook/*` only with regression coverage | Markets, book, quote, trades, positions, history |
| Admin | `backend/src/admin/upside/*`, `fe-admin/src/components/*Upside*` | Config, review, creation, operations |
| Public UI | `fe/src/features/upside/*`, `fe/src/app/app/upside/*`, `fe/src/components/app-shell/AppShell.tsx` | HTML-inspired live user journey |

## Phase 0: publish and preserve original Risk Split

### Task 1: Verify, document, commit and push V1

**Files:** Verify/update `docs/risksplit/original-v1.md` and the design/plan documents; review each currently changed Risk Split contract/backend/indexer/admin/FE/script/migration file and `contracts/deployments/base-mainnet-risksplit.json`; include only the chosen HTML visual reference `.codex-visuals/stock-upside-marketplace.html` in a deliberate docs commit so the next agent can see it. Do not commit `fe-admin/tsconfig.tsbuildinfo`, keystores, sensitive `contracts/cache`, private `.env`, or unreviewed broadcast artifacts.

**Interfaces:** Existing V1 `SeriesFactory`, `RiskSplitSeries`, `/v1/risksplit/*`, `/app/risk-split`, admin routes and Base pins stay byte-for-byte semantically compatible.

- [ ] Inventory `git status --short`, `git diff --stat`, untracked files and `git diff --check`; write an explicit stage allowlist. Check for secrets and build artifacts before staging. No `git add .`.
- [ ] Document the **actual** V1 five-regime floor/cap formula from `RiskSplitSeries._applySettlement`, its `formulaVersion=1`, Base addresses/feed, mint/combine/redemption behavior, order venue, and known operational limits; distinguish this from the new Upside formula.
- [ ] Run `cd contracts && forge test --match-path 'test/risksplit/*'`; `cargo test --manifest-path indexer/Cargo.toml`; `npm run test -w @othelio/backend`; `npm run typecheck`; `npm run build`. Fix in-scope failures or document a concrete blocker before claiming V1 complete.
- [ ] Verify the public Base manifest against onchain code/owner/feed and confirm V1 direct market/admin API smoke tests. Inspect generated output for sensitive values.
- [ ] Commit scoped V1 files (possibly a separate commit for the HTML reference and docs), push `feature/risk-split` to `origin`, and record commit SHA/remote branch in the V1 document. Confirm `git status` and remote commit. **Do not begin Task 2 until the push succeeds.**

### Task 2: Isolate the Upside branch and pin the baseline

**Files:** Create/update `.trellis/tasks/<upside-task>/` planning manifests if Trellis is active; no product code yet.

**Interfaces:** Base commit is the pushed V1 SHA from Task 1. Existing V1 deploy manifest is read-only in this branch.

- [ ] Create `feature/upside-markets` from the pushed V1 commit, preferably in an isolated worktree; leave unrelated user edits untouched. Record exact base SHA.
- [ ] Read package/layer `.trellis/spec/` guidelines and `fe-admin/AGENTS.md` before implementation. Run baseline V1 contract and FE smoke tests on the new branch.
- [ ] Commit only task metadata if used; do not combine it with contract deployment or credentials.

## Phase 1: prove the financial and onchain core

### Task 3: Lock payoff and raw-unit allocation with tests

**Files:** Create `contracts/test/upside/UpsidePayoff.t.sol`, `UpsideInvariant.t.sol`, `UpsideMaliciousToken.t.sol`; create `contracts/src/upside/UpsideSeries.sol`, `UpsideClaimToken.sol` and their focused interfaces.

**Interfaces:** `mint(uint256 rawUnderlying)`, `combineAndWithdraw(uint256 rawClaims)`, `settleWithFixing(uint256 price,uint80 roundId,uint256 observedAt)`, `redeemUpside(uint256)`, `redeemResidual(uint256)`; immutable `underlying`, `strikePrice`, `expiry`, `feed`, `adapter`, `formulaVersion=2` (product name/namespace still Upside); emitted raw amounts and fixing metadata.

- [ ] Write failing tests for `K=205,S=190/205/230`, fractional `0.4` supply, 0/6/8/18/38-decimal underlyings (or an explicit compatibility rejection), zero/very large fixing, last-redeemer dust, pair burn, expiry boundary, fee-on-transfer and reentrant token. Check `U+R=S` and total raw outgoing `<=` deposited on every sequence.
- [ ] Run `cd contracts && forge test --match-path 'test/upside/*'`; confirm each new behavior test fails for the expected missing interface or assertion.
- [ ] Implement immutable series/claim contracts and cumulative `mulDiv` allocations exactly as the spec. Keep V1 classes untouched. Reject incompatible underlying semantics and unauthorized mint/burn/fixing.
- [ ] Rerun the Upside tests plus `forge test --match-path 'test/risksplit/*'`; require pass, then commit only Task 3 files.

### Task 4: Onchain weekly policy and owner-only creation

**Files:** Create `contracts/src/upside/UpsideFactory.sol`, `contracts/test/upside/UpsideFactory.t.sol`; update new interfaces as needed.

**Interfaces:** constructor pins `OthelioAssetRegistry`; owner-only `registerRound(config)`, `createMarket(roundId,strikePrice) -> seriesAddress`, `marketByRoundAndStrike(roundId,strikePrice)`. `RoundConfig` stores a registry-supported underlying and the registry's feed/decimals, compatible adapter, reference round/price/time, start/expiry, expected move and provenance hash, min/max strike and tick. The caller cannot supply or change expiry in `createMarket`.

- [ ] Write failing tests: owner can register a verified reference and approved expiry for a registry-supported asset; registry-disabled, wrong chain/feed/decimals and nonregistered assets fail even for owner; other caller cannot register; default public flag is false; admin-created custom strike must obey bounds/tick; public flag-on permits in-bounds strike and rejects off-grid/out-of-bounds/duplicate; expired round rejects creation. Two approved expiries for one stock coexist. Disabling the registry asset blocks new exposure but leaves pair withdrawal and redemption available.
- [ ] Run targeted `forge test --match-contract UpsideFactoryTest` and confirm failure.
- [ ] Implement one shared `_validateMarket` path for owner and public calls, two-step ownership transfer, round/market events with all indexer fields, registry-backed feed/decimals and exact approved expiry. The admin's four preset strikes are computed in the preview and instantiated by the same path; the contract stores their approved values and rejects duplicate rounding. Pin the registry address; do not add another asset allowlist.
- [ ] Rerun targeted tests, then all Upside and V1 Foundry tests; commit Task 4 files.

### Task 5: Fixing security, fuzzing and fork proof

**Files:** Create `contracts/src/upside/UpsideFixingAdapter.sol`, `contracts/test/upside/UpsideFixing.t.sol`, `UpsideBaseFork.t.sol`; include static-analysis configuration only if already available in repo.

**Interfaces:** permissionless `settleSeries(series,roundId)` verifies the nominated feed round is the unique last valid sufficiently fresh observation at/before expiry, then calls only that series. No direct user/admin `settle(price)` bypass.

- [ ] Write failing tests for pre-expiry call, post-expiry price substitution, wrong feed, stale/incomplete/negative/zero round, duplicate settlement, Chainlink phase rollover and successor proof; assert delayed execution fixes the same price. Fork test the launch feed's real round behavior.
- [ ] Run target tests and record failures. If a successor cannot be proved with the chosen feed interface, **stop deployment design** and specify a reviewable fixing oracle before proceeding; do not weaken the assertion.
- [ ] Implement verified adapter; run `forge test --match-path 'test/upside/*'`, `forge test --match-path 'test/risksplit/*'`, `forge fmt --check`, `forge lint`, fuzz/invariant suites and available static analysis. Commit only after all required checks pass.
- [ ] Obtain independent contract/security review and track findings to closure. This is a mainnet gate, not an optional polish task.

## Phase 2: make chain state and order execution live

### Task 6: Deployment scripts, shared types and fork deployment

**Files:** Create `packages/shared/src/upside/{contracts,types,deployment}.ts`, `contracts/script/upside/DeployUpside.s.sol`, `scripts/deploy-upside-base.sh`, `scripts/create-upside-round-base.sh`, `docs/upside/base-launch-runbook.md`; update package exports.

**Interfaces:** typed deployment manifest includes chain, owner, factory, feed/adapter registry, start block and tx hashes; no V1 addresses are overwritten.

- [ ] Write failing shared ABI/address parsing tests and script dry-run checks for wrong chain, missing token/feed, decimals mismatch, bad reference, expiry outside verified session, wrong owner and secret leakage.
- [ ] Run targeted shared tests/dry-run; implement scripts using encrypted keystore or connected wallet; require preview, simulation and explicit signed broadcast. Fork-deploy and compare runtime code/hash to artifacts.
- [ ] Rerun checks and `npm run build -w @othelio/shared`; commit scripts/types/runbook without private material.

### Task 7: Database, indexer and legacy Risk Split switch

**Files:** Create `database/migrations/024_upside_markets.sql`, `025_upside_orders.sql` and a Risk Split cursor migration if needed; create `indexer/src/upside.rs`, tests; modify `indexer/src/{abis,main,events,risksplit,db}.rs` only for event routing, the legacy flag and independent cursor. Document `RISK_SPLIT_INDEXING_ENABLED` in `.env.base.example`, `docker-compose.yml` and indexer runbook/config docs.

**Interfaces:** versioned `upside_rounds`, `upside_markets`, `upside_positions`, `upside_orders`, `upside_trades`; keys include chain and factory/series. Indexer uses new factory deployment block and exposes as-of/freshness. `RISK_SPLIT_INDEXING_ENABLED` defaults to `true`; `false` avoids Risk Split state load, filter addresses, log decoding, projection, reconciliation and RPC requests while other streams advance. An independent Risk Split cursor preserves catch-up history and cannot mutate the basket cursor.

- [ ] Write failing migration and Rust event tests for round/config toggles, market creation, mint, transfers, combine, fixing, both redemptions, 0x partial/full fill, idempotent replay, reorg removal and restart from persisted checkpoint.
- [ ] Write failing flag tests: unset/`true` retains current Risk Split behavior; explicit `false` makes no Risk Split filter, state load, decode, projection writes or Risk Split RPC calls, leaves historical rows intact and still indexes baskets/prices/Upside; invalid values fail at startup. Bootstrap the separate cursor from a provable V1 checkpoint or replay from the pinned factory deployment block. Run with flag off across new Risk Split onchain events, then re-enable and prove exactly-once catch-up, including reorg and restart. Do not solve this by rewinding the shared basket checkpoint.
- [ ] Run migration in disposable DB and `cargo test --manifest-path indexer/Cargo.toml`; confirm new assertions fail.
- [ ] Implement decoder/materialization, the explicit config switch, independently persisted Risk Split progress/status and reorg-safe writes. Run tests, migration upgrade on a copy of persistent DB, and pinned Base fork replay. Verify V1 rows and basket checkpoints unchanged; commit.

### Task 8: Executable books and multi-level sweep

**Files:** Create `backend/src/upside/{upside-orderbook.service,upside-orderbook.controller,upside-orderbook.types,upside-orderbook.spec}.ts`; extract reviewed common EIP-712/0x utilities from `backend/src/orderbook/*` only with V1 regression tests; extend `packages/shared/src/upside/venue.ts`.

**Interfaces:** `GET /v1/upside/markets/:series/book`, `POST /v1/upside/orders`, `GET /v1/upside/orders?owner=`, `POST .../cancel-intent`, `POST /v1/upside/markets/:series/sweep-quote` returning ordered hashes, exact raw fill amounts, cost, expiry, block/sequence and transaction data. Build final wallet tx from reverified quote.

- [ ] Write failing tests for EIP-712 domain/chain, order token pair, allowance/balance/onchain remaining, duplicate/replay, self-match, price-time ordering, 6-vs-underlying decimals, ask sweep `0.5@$4.10+0.7@$4.20=$4.99`, a sell sweep across two bids, no-liquidity and stale-book states.
- [ ] Fork-spike Base proxy `batchFillLimitOrders` with two actual mock claim makers, partial quantities, cancellation and `revertIfIncomplete=true`. Record function availability, gas and receipt; if unavailable, revise venue design before implementation.
- [ ] Implement all-or-revert fill construction and quote expiry/max-total checks; simulate with taker address, then test raced fill/cancel reverts with no partial debit. Distinguish local hide from onchain cancel. Run backend tests and V1 orderbook regressions; commit.

### Task 9: Market summaries, wallet positions and honest charts

**Files:** Create `backend/src/upside/{upside.service,upside.controller,upside.types,upside.spec}.ts`; add a focused real stock-history query/service rather than synthetic data; register module in backend.

**Interfaces:** `GET /v1/upside/assets` enumerates the basket registry's supported tokens with explicit Upside compatibility reasons; `GET /v1/upside/rounds`, `GET /v1/upside/markets` (batched best executable bid/ask+size and freshness), `GET /v1/upside/markets/:series`, `GET /v1/upside/positions/:wallet`, `GET /v1/upside/stocks/:asset/history` with source/as-of/gaps. Responses include chain, product, decimals and version.

- [ ] Write failing API tests proving `/assets` mirrors the basket registry after enable/disable, including a token absent from the static catalog; two stocks, two expiries, four labels, empty/stale book exclusion from promoted tiles, no N+1 book verification, unknown transferred cost basis, 6/18-decimal positions, missing/gapped chart history and V1 endpoint isolation.
- [ ] Run targeted `vitest`, implement queries and pure payoff/quote helpers, then rerun backend suite/typecheck; commit.

## Phase 3: operator controls and public journey

### Task 10: Admin round and strike management; preserve V1 navigation

**Files:** Create `backend/src/admin/upside/*`, `fe-admin/src/components/{UpsideRoundsView,UpsideRoundModal,UpsideMarketsView}.tsx` and tests; modify `fe/src/components/app-shell/AppShell.tsx` and its nav test; keep `fe/src/app/app/risk-split/*`.

**Interfaces:** Admin Overview shows chain/owner, registry and worker health, Risk Split indexing status/last block/lag, pending actions and settlement queue. Assets shows the same basket registry. Round creation guides asset → reference/calendar/expected move → exact four-strike review → simulation/signature → receipt/indexed reconciliation. Markets lists active/empty/expired/settled series and opens a detail with supply, collateral, bids/asks, trades, fixing and redemption. Operations exposes indexed failure states. Owner writes require the right chain; nonowners can inspect. Legacy Risk Split admin tools remain accessible.

- [ ] Write failing tests for onchain registry token enumeration (including an asset absent from static `TOKEN_FEED_REGISTRY`), registry disable/reenable, owner check, wrong chain/RPC, stale feed/IV snapshot, holiday/early close, duplicate rounded strikes, admin strike out of bounds, flag-on/off behavior, visible Risk Split indexing-paused/last-block status and V1 navigation on by default with its direct route still loading when navigation is off.
- [ ] Run backend/admin/FE target tests; implement preview/sign/reconcile flow and nav flag. Use Othelio's existing app/admin colors, typography, spacing and surfaces. Verify clear transaction states, specific fetch/RPC errors, read-only nonowner views, old Risk Split address pin, direct route and admin functionality. Commit.

### Task 11: Public Upside marketplace and stockholder flow

**Files:** Create `fe/src/app/app/upside/{page.tsx,[seriesAddress]/page.tsx}`, `fe/src/features/upside/*` and focused tests; use `.codex-visuals/stock-upside-marketplace.html` for approximate layout and journey only; use the existing AppShell palette, typography, padding, spacing, surfaces and responsive conventions.

**Interfaces:** Explore/search tiles; stock detail with four actual target labels and unobtrusive expiry selector, real stock chart above right Buy/Sell ticket, visible order book, live sweep estimate, user order placement/cancel, stockholder mint/list, multi-asset My Positions, in-kind redemption. Separate strike `K` from premium input. Do not render fictional values from HTML.

- [ ] Write failing tests for target switch/expiry, empty bid/ask, visible best size, two-level `1.2` unit sweep with `$4.99` total, price race, limit order/cancel, fractional balance, breakeven/payout, no synthetic chart, lost RPC/indexer, wallet network mismatch and transferred position with unknown basis.
- [ ] Run focused FE tests; implement mobile/desktop journey using the existing design system. Verify keyboard/ARIA, loading/empty/error states, large and small decimals, and that no user can create custom strike while flag off. Do not copy the HTML's sample prices or CSS literally.
- [ ] Run FE lint/build and live browser clickthrough against fork services. Validate every visible price and balance against API/onchain receipt; commit.

## Phase 4: security and live proof

### Task 12: End-to-end verification, review and Base launch

**Files:** Create `docs/upside/security-review.md`, `docs/upside/base-launch-evidence.md`, runnable E2E/fork scripts under `scripts/upside/`; amend runbook based on evidence.

**Interfaces:** Evidence includes chain/head, commit SHA, manifest, signer/owner, contract verification, token/feed identity, reference/fixing round, receipts, DB rows and UI screenshots. No private key or secret in evidence.

- [ ] On a pinned Base fork, deploy two stocks/two overlapping expiries. Complete admin creation, flag-off and flag-on role tests, four preset strikes and custom strike, mint/list, two-maker batch buy, partial fill, sell, cancel, combine, expiry and delayed settlement. Reconcile all balances, book depth, positions, payout and zero collateral shortfall.
- [ ] Restart indexer/backend, replay from deployment block, simulate reorg and stale book/RPC; switch Risk Split indexing off and back on across real events, checking independent catch-up and paused admin status. Verify no V1 regression. Run `forge test`, `forge fmt --check`, `forge lint`, `cargo test --manifest-path indexer/Cargo.toml`, `npm run test`, `npm run typecheck`, `npm run build` and available static/security tools. Document concrete outputs and review findings.
- [ ] Have an independent reviewer audit contracts, fixing and 0x batch route. Resolve critical/high findings; disposition medium findings. Review asset issuer eligibility, token receipt/redeem restrictions and corporate actions before mainnet.
- [ ] Operator signs a tiny Base mainnet deployment and end-to-end trade with encrypted keystore/wallet. Verify source on Basescan, record separate Upside pins and indexer start block, then prove post-expiry redemption. Do not mark complete on deploy alone. Push the Upside branch and hand off verified evidence.

## Handoff decisions and non-goals

The key user decisions are recorded in the spec: continuous Upside first, V1 preserved, weekly four-target UI, expiry admin-approved, admin-only Base launch, future public custom strike within onchain bounds, no exclusivity across expiries. If market data licensing, Base batch-fill support or the feed fixing proof fails, stop at that gate and revise the corresponding design before presenting a live trading UI. Fixed-dollar prediction tickets and price-spectrum claims remain separate research proposals.
