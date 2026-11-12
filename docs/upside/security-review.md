# Stock Upside Markets: Security Review & Threat Model

**Date:** November 2026  
**Status:** Completed & Passing Invariant Gated Verification  
**Target Platform:** Base Mainnet (`chainId: 8453`)  
**Components:**
- `UpsideFactory.sol` (`contracts/src/upside/UpsideFactory.sol`)
- `UpsideSeries.sol` (`contracts/src/upside/UpsideSeries.sol`)
- `UpsideClaimToken.sol` (`contracts/src/upside/UpsideClaimToken.sol`)
- `UpsideFixingAdapter.sol` (`contracts/src/upside/UpsideFixingAdapter.sol`)
- `UpsideBatchFillRouter.sol` (`contracts/src/upside/UpsideBatchFillRouter.sol`)

---

## 1. Executive Summary

Stock Upside Markets enable continuous upside and residual value decomposition on tokenized stocks (Coinbase B20 tokens, e.g., MSFTc) deposited in segregated vaults. 

Across 34 comprehensive Foundry tests, including a 128,000-call stateful invariant campaign (`UpsideInvariantTest`), live Base fork fixing verifications (`UpsideBaseForkTest`), and multi-level 0x fill sweeps (`Upside0xVenueForkTest`), no solvency, reentrancy, or oracle manipulation vulnerabilities were found.

---

## 2. Core Invariants & Conservation Laws

### Invariant 1: Continuous Collateral Conservation
$$\forall t < T_{\text{expiry}}: \quad \text{Vault Collateral} = \text{Total Upside Supply} = \text{Total Residual Supply}$$
- Depositing $N$ underlying tokens mints exactly $N$ Upside Claims and $N$ Residual Claims.
- Burning $M$ Upside Claims together with $M$ Residual Claims releases exactly $M$ underlying tokens back to the caller.

### Invariant 2: Settlement Value Conservation
$$\forall S_{\text{settled}}, K: \quad V_{\text{upside}} + V_{\text{residual}} = S_{\text{settled}}$$
- When $S_{\text{settled}} \ge K$:
  $$V_{\text{upside}} = S_{\text{settled}} - K, \quad V_{\text{residual}} = K$$
  $$\text{Upside Fraction} = \frac{S_{\text{settled}} - K}{S_{\text{settled}}}, \quad \text{Residual Fraction} = \frac{K}{S_{\text{settled}}}$$
- When $S_{\text{settled}} < K$:
  $$V_{\text{upside}} = 0, \quad V_{\text{residual}} = S_{\text{settled}}$$
  $$\text{Upside Fraction} = 0, \quad \text{Residual Fraction} = 1.0$$
- In all states, the sum of payouts to claim holders equals 100% of the collateral held at settlement. No collateral deficit or trapped dust can occur.

---

## 3. Threat Model & Mitigations

### 3.1 Oracle Fixing Manipulation & Timing Attacks
- **Threat:** An attacker or frontrunner triggers settlement using an unfavorable or manipulated oracle observation, or attempts to substitute an older or post-expiry observation to alter payout ratios.
- **Mitigation:**
  - `UpsideFixingAdapter.sol` strictly enforces:
    1. Caller cannot settle before `expiryTimestamp`.
    2. The selected Chainlink round must be the first observation with `updatedAt >= expiryTimestamp`.
    3. Caller cannot submit an older round (`updatedAt < expiryTimestamp`).
    4. Rounds must have `answeredInRound >= roundId`, positive price (`answer > 0`), and fresh timestamp.
    5. Settlement is idempotent: once settled, the fixing price, round ID, and timestamp are permanently frozen.
  - Verified by `test/upside/UpsideFixing.t.sol` (9/9 passed).

### 3.2 Malicious Token Behaviors (Fee-on-Transfer, Reentrancy)
- **Threat:** Underlyings with transfer fees, hooks, or reentrancy vectors compromise vault solvency.
- **Mitigation:**
  - Balance checks before and after transfer verify exact amounts received (`balanceAfter - balanceBefore == amount`). Any fee-on-transfer token immediately reverts on deposit.
  - All state transitions and token transfers follow the Checks-Effects-Interactions pattern guarded by OpenZeppelin's `ReentrancyGuard`.
  - Reentrant attempts to re-enter `mint`, `combineAndWithdraw`, or `redeem` are rejected (`test_Malicious_ReentrancyBlocked`).

### 3.3 Authorization & Minting Controls
- **Threat:** Unauthorized minting of Upside or Residual claim tokens.
- **Mitigation:**
  - `UpsideClaimToken` specifies an immutable `series` address set upon initialization.
  - Only the `series` contract can call `mint` or `burn`.
  - Public users cannot mint claim tokens directly without depositing real underlying stock into `UpsideSeries`.

### 3.4 0x Protocol Batch Fill Execution
- **Threat:** Frontrunning or partial fill exploitation during multi-order sweeps.
- **Mitigation:**
  - `UpsideBatchFillRouter.sol` wraps 0x v4 limit order fills into an atomic single-transaction execution.
  - If `revertIfIncomplete == true`, the router verifies that 100% of requested units were filled; otherwise, the entire transaction reverts.
  - Pre-approved allowance to 0x `ExchangeProxy` is pulled directly from the taker, eliminating escrow risk in the router.
  - Verified by `test/upside/Upside0xVenueFork.t.sol` (4/4 passed).

### 3.5 Registry Governance Decoupling
- **Threat:** A token is delisted or compromised in the protocol registry while users have funds in active Upside vaults.
- **Mitigation:**
  - The series queries `IOthelioAssetRegistry.isAssetSupported(underlying)` on new deposits.
  - If the asset is disabled in the registry:
    - New `mint` calls revert (preventing further exposure).
    - Existing users can still call `combineAndWithdraw` before expiry or `redeemUpside`/`redeemResidual` after expiry to safely retrieve their funds.

---

## 4. Test Verification Summary

| Test Suite | File | Tests | Status |
| :--- | :--- | :--- | :--- |
| **Fixing Adapter** | `contracts/test/upside/UpsideFixing.t.sol` | 9 | PASS |
| **Payoff Math** | `contracts/test/upside/UpsidePayoff.t.sol` | 9 | PASS |
| **Factory & Admin** | `contracts/test/upside/UpsideFactory.t.sol` | 6 | PASS |
| **Token Defenses** | `contracts/test/upside/UpsideMaliciousToken.t.sol` | 2 | PASS |
| **0x Venue Fork** | `contracts/test/upside/Upside0xVenueFork.t.sol` | 4 | PASS |
| **Base Mainnet Fork** | `contracts/test/upside/UpsideBaseFork.t.sol` | 3 | PASS |
| **Stateful Invariant** | `contracts/test/upside/UpsideInvariant.t.sol` | 1 (128k calls) | PASS |
| **Rust Indexer** | `indexer/src/upside/mod.rs` | 7 | PASS |
| **Backend API & Book** | `backend/src/upside/*.spec.ts` | 21 | PASS |
| **Full Vitest Suite** | `backend/src/**/*.spec.ts` | 206 | PASS |
| **Frontend Builds** | `fe` and `fe-admin` | Next.js 16 | PASS |

---

## 5. Security Conclusions

The Stock Upside Markets implementation satisfies all required financial, invariant, and authorization criteria for Base Mainnet. No critical or high severity issues remain.
