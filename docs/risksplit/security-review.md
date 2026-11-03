# Risk Split Live Markets: Adversarial Threat Model & Security Review

**Date:** 2 November 2026  
**Status:** Complete  
**Scope:** `contracts/src/risksplit/`, `contracts/test/risksplit/`, `backend/src/orderbook/`, `backend/src/admin/`, `indexer/src/risksplit.rs`, `fe/`, `fe-admin/`  

---

## 1. Executive Summary

This security review documents the adversarial threat model, security boundaries, and defense-in-depth mechanisms for Othelio Risk Split live markets on Base. The system provides zero-custody tokenized equity risk-splitting through two orthogonal claims (`Protected` and `Upside`) settled via verified 0x v4 limit order books on Base, with Chainlink equity fixing round verification.

---

## 2. Threat Modeling Matrix

| Threat Category | Attack Vector / Failure Mode | Severity | Mitigating Controls | Verification Proof |
| :--- | :--- | :--- | :--- | :--- |
| **Factory Privileges** | Unauthorized market creation with malicious parameters | Critical | `publicCreationEnabled=false` by default; only `owner()` can create or approve expiries; 2-step ownership transfer (`transferOwnership` + `acceptOwnership`). | `contracts/test/risksplit/SeriesFactoryPermissionsTest.t.sol` |
| **Underlying Collateral** | Theft or draining of vault backing assets | Critical | Zero owner-withdrawal methods; series vault has no arbitrary `call`, transfer, or upgrade path; collateral is locked until claim redemption or pair combine. | `contracts/test/risksplit/RiskSplitSecurityTest.t.sol` |
| **B20 Token Semantics** | Reentrancy, fee-on-transfer, or non-standard precompile token behavior | High | Strict `balanceOf` delta tracking before and after transfers; `SafeERC20` used universally; `ReentrancyGuard` on all state-mutating functions; actual token decimals (8 for MSFTc) dynamically mirrored. | `contracts/test/risksplit/RiskSplitInvariantTest.t.sol`, `VenueBaseFork.t.sol` |
| **Oracle Fixing Timing** | Exploiting delayed calls to select post-expiry prices or stale rounds | High | SettlementAdapter enforces the **last eligible pre-expiry round**: observation timestamp <= expiry, round fresh within `maxStaleness`, and predecessor/successor check proves roundId + 1 timestamp > expiry. Round ID is immutable and emitted onchain. | `contracts/test/risksplit/RiskSplitFixingTest.t.sol`, `BaseForkFixingTest.t.sol` |
| **Oracle Feed Invalidation** | Wrong decimal scaling, inverted rounds, or negative oracle answers | High | Oracle answers must be positive (`answer > 0`); normalized into 8 decimals; feed address pinned and validated at creation against approved token feed registry. | `contracts/test/risksplit/RiskSplitSeriesTest.t.sol` |
| **Vault Invariants** | Fractional rounding dust stranding collateral or enabling over-claiming | High | Conservation invariant: sum of redeemed underlying across any sequence of claim redemptions <= deposited collateral; zero-price allocation defined to preserve underlying safety. | `contracts/test/risksplit/RiskSplitInvariantTest.t.sol` |
| **Order Relay & Signatures** | EIP-712 domain spoofing, replay attacks, or cross-chain signature reuse | High | Pinned `ZERO_EX_EIP712_DOMAIN` with explicit `chainId` (8453 on Base) and verifying contract (`0xDef1C0ded9bec7F1a1670819833240f027b25EfF`); unique salt tracking; onchain 0x status check. | `backend/src/orderbook/orderbook.spec.ts` |
| **Order Book Manipulations** | Self-matching or cross-account wash trading | Medium | Relay and fill builder enforce `makerAddress.toLowerCase() !== takerAddress.toLowerCase()`; self-matching orders rejected before transaction construction. | `backend/src/orderbook/orderbook.spec.ts` |
| **Order Expiry Bounds** | Order resting beyond series expiry or execution after market maturity | Medium | Relay enforces order expiry <= series expiry; expired orders pruned from depth and rejected onchain by 0x v4 ExchangeProxy. | `backend/src/orderbook/orderbook.spec.ts`, `fe/src/features/risksplit/orderbook.test.mjs` |
| **Indexer Reorganization** | Chain reorgs leading to phantom fills or stale series status | Medium | Indexer dynamic tracking commits blocks idempotently; rewinds state to common ancestor on reorg; backend exposes freshness block and flags lag. | `indexer/src/risksplit.rs` (Reorg test) |
| **Admin Authorization** | Non-owner access to draft creation or operational actions | High | EIP-712 challenge-signature authentication; challenge nonce expires in 5 minutes; backend queries onchain `SeriesFactory.owner()` on every privileged operation; no generic contract call endpoint. | `backend/src/admin/auth/admin-auth.service.spec.ts` |
| **UI Truthfulness** | Displaying false arbitrage or phantom liquidity | Medium | Frontend verifies both claim books have resting executable depth before displaying pair arb; indexer lag disables trading; no placeholder bids/asks. | `fe/src/features/risksplit/orderbook.test.mjs`, `fe/src/features/risksplit/RiskSplitDashboard.tsx` |

---

## 3. Invariant Guarantees

### Invariant 1: Vault Collateral Conservation
For any sequence of pair mints, pair combines, and individual claim redemptions:
$$\sum \text{Underlying Redeemed} \le \text{Total Underlying Deposited}$$
No sequence of redemptions can ever extract more than the vault's actual balance. Any fractional dust remains in the vault rather than causing a revert or shortfall.

### Invariant 2: Time-Invariant Expiry Fixing
For any two calls to `settleSeries(seriesAddress, nominatedRoundId)` where `nominatedRoundId` satisfies the fixing proof:
$$\text{settledPrice}(t_1) = \text{settledPrice}(t_2) \quad \forall \; t_1, t_2 > \text{expiry}$$
Delaying the settlement transaction by minutes, days, or months produces the exact same pre-expiry fixing round and fraction distribution.

### Invariant 3: Zero Custody
Neither Othelio, the SeriesFactory owner, nor any backend service has custody of user assets:
- Collateral is held by the immutable `RiskSplitSeries` contract.
- Unfilled orders rest in user wallets until an onchain 0x v4 `fillLimitOrder` transaction executes.
- Cancellations can be performed directly onchain via `cancelLimitOrder` without backend cooperation.

---

## 4. Test Suite Matrix & Verification Evidence

All test suites verify these guarantees across the full stack:

1. **Foundry Smart Contract Tests:**
   - `test/risksplit/SeriesFactoryPermissionsTest.t.sol`: Factory permissions, 2-step ownership, approved expiries.
   - `test/risksplit/RiskSplitFixingTest.t.sol`: Expiry round verification, staleness, phase transition proof.
   - `test/risksplit/RiskSplitSeriesTest.t.sol`: Mint, combine, settle, single claim redemptions.
   - `test/risksplit/RiskSplitSecurityTest.t.sol`: Malicious token, reentrancy, re-initialization rejection.
   - `test/risksplit/RiskSplitInvariantTest.t.sol`: Conservation of collateral under fuzzing and tiny amounts.
   - `test/risksplit/BaseForkFixingTest.t.sol`: Fork proof against real Base Chainlink feeds.
   - `test/risksplit/VenueBaseFork.t.sol`: Fork proof of 0x v4 limit order settlement with 6/8 decimal tokens.

2. **Rust Indexer Tests (`indexer/src/risksplit.rs`):**
   - 10-stage lifecycle fixture: factory creation -> mint -> transfer -> combine -> settle -> redeem.
   - 3-block reorg test: rollback of settlements and balance reconciliation.

3. **Backend Service Tests (`backend/src/`):**
   - `admin/auth/`: Nonce replay, signature verification, onchain ownership check, session expiry (10/10 passing).
   - `admin/markets/`: NY equity market calendar validation, holiday/weekend rejection, signable preview generation (6/6 passing).
   - `admin/assets/`: B20 asset onboarding checks, feed and registry verification (3/3 passing).
   - `admin/operations/`: Settlement queue and candidate verification (2/2 passing).
   - `orderbook/`: Order signature validation, self-match rejection, depth ladder, cancel intent, fill transaction builder, onchain fill reconciliation (7/7 passing).

4. **Frontend Unit Tests (`fe/src/features/risksplit/`):**
   - `orderbook.test.mjs`: Token decimal conversion (6/8/18), 0x price normalization, spread calculation, pair arbitrage, order expiry, partial fill arithmetic (6/6 passing).
   - `riskSplitMarket.test.mjs`: Named profiles, open series criteria, missing price handling (3/3 passing).

---

## 5. Deployment Safety Controls

- **No Unattended Broadcasts:** Deployment and administrative scripts output exact calldata, target addresses, and simulation results for wallet verification.
- **Circuit Breakers & Emergency Handling:** If an oracle feed ceases publication or freezes before expiry, settlement halts and requires owner recovery under `recoverUnfixedSeries`, while pair combines (`combineClaims`) remain functional so users can retrieve backing collateral.
