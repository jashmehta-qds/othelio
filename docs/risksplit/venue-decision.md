# Risk Split Settlement Venue Decision & Spike Report

**Date:** 2 November 2026  
**Status:** Completed & Verified  
**Target Chain:** Base Mainnet (`chainId: 8453`)  
**Pinned Fork Block:** `53,400,000`  
**Test File:** `contracts/test/risksplit/VenueBaseFork.t.sol`  

---

## 1. Executive Summary

Othelio's Risk Split markets require non-custodial limit orders for Protected and Upside claims quoted in USDC (`claim/USDC`). To avoid deploying and auditing a bespoke order settlement contract, we evaluated existing verified settlement primitives on Base.

**Decision:** Adopt **0x Protocol v4 (ZeroEx ExchangeProxy)** as the onchain settlement primitive, operating with **Othelio-hosted offchain order book relay and taker-driven matching**.

- **ExchangeProxy Contract:** `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`
- **EIP-712 Domain:**
  - `name`: `"ZeroEx"`
  - `version`: `"1.0.0"`
  - `chainId`: `8453`
  - `verifyingContract`: `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`
- **Matching Model:** Taker-driven atomic fills (`fillLimitOrder`). When a user places an incoming marketable order, their wallet signs and submits an onchain fill transaction against resting maker orders. Any remaining uncrossed volume rests on Othelio's offchain book as a maker-signed limit order.

---

## 2. Pinned Addresses & Verified Code Hashes

| Component | Base Mainnet Address | Decimals / Type | Verification Status |
| :--- | :--- | :--- | :--- |
| **0x ExchangeProxy** | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | Core Router | Verified on BaseScan, deployed bytecode present |
| **USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | FiatTokenV2_2 proxy |
| **MSFTc (Candidate B20)** | `0xB200000000000000000000Ab99cFa739E253872B` | 8 | Native Base precompile (`0xef`) |
| **ClaimToken (Series Vault)** | Dynamic (deployed per series) | Matches underlying (e.g. 8) | Standard ERC-20, non-custodial |
| **Aerodrome Slipstream Router** | `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F` | AMM Router | Used for underlying acquisition |

---

## 3. Fork Simulation & Test Results

Run with `base-forge test --match-path test/risksplit/VenueBaseFork.t.sol -vv`:

1. **Token Verification & Decimals (`test_Fork_TokenVerificationAndDecimals`):**  
   - USDC = 6 decimals, MSFTc = 8 decimals, ClaimToken = 8 decimals.  
   - 0x ExchangeProxy contract code verified on Base.  
   - **Result: PASS**

2. **Full Fill Execution (`test_Fork_ZeroEx_ClaimTokenUsdc_FullFill`):**  
   - Maker signs 100 PROT for 50 USDC (0.50 USDC/PROT).  
   - Taker calls `fillLimitOrder(...)`.  
   - Maker receives 50 USDC; Taker receives 100 PROT.  
   - Gas consumed: **~95,581 gas**.  
   - **Result: PASS**

3. **Partial & Remainder Fills (`test_Fork_ZeroEx_PartialFill_And_RemainderFill`):**  
   - Maker sells 200 PROT for 100 USDC.  
   - Fill 1: 40 USDC (40% partial fill => 80 PROT transferred). Gas: **~106,486 gas**.  
   - Onchain status remains `FILLABLE` with `takerTokenFilledAmount = 40e6`.  
   - Fill 2: 60 USDC (60% remainder fill => 120 PROT transferred).  
   - Onchain status transitions to `FILLED`.  
   - **Result: PASS**

4. **Onchain Cancellation (`test_Fork_ZeroEx_Cancellation`):**  
   - Maker calls `cancelLimitOrder(order)`.  
   - Gas consumed: **~37,609 gas**.  
   - Status updates immediately to `CANCELLED`. Subsequent fills revert.  
   - **Result: PASS**

5. **Replay Protection (`test_Fork_ZeroEx_ReplayRejection`):**  
   - Attempting to fill an already filled order reverts onchain.  
   - **Result: PASS**

6. **Allowance Revocation (`test_Fork_ZeroEx_AllowanceRevocation_RevertsFill`):**  
   - When maker revokes token allowance to `ExchangeProxy`, fill reverts onchain.  
   - **Result: PASS**

7. **Order Expiry (`test_Fork_ZeroEx_ExpiredOrder_RevertsFill`):**  
   - When block timestamp surpasses order `expiry`, status becomes `EXPIRED` and fill reverts.  
   - **Result: PASS**

8. **Direct B20 Token Execution (`test_Fork_ZeroEx_B20CandidateTokenDirectExecution`):**  
   - Real MSFTc acquired via Aerodrome Slipstream swap into maker wallet.  
   - Maker approves 0x ExchangeProxy and signs order selling MSFTc for USDC.  
   - Taker executes `fillLimitOrder`.  
   - Exact balances verified. Native B20 transfers and approvals succeed without issues.  
   - **Result: PASS**

9. **Two Resting Orders Crossing Constraint (`test_Fork_TwoRestingOrdersCannotCrossWithoutTakerTransaction`):**  
   - 0x v4 ExchangeProxy does not expose a parameterless 2-maker cross function.  
   - Verified that one party must act as the onchain transaction sender (taker).  
   - **Result: PASS**

---

## 4. Fee & Gas Model

- **Protocol Fees:** 0x v4 charges **0 protocol fee** for limit orders (`takerTokenFeeAmount = 0`).
- **L1 Data / L2 Execution Cost on Base:**
  - Fill Limit Order: ~95,000 – 105,000 gas (~$0.001 – $0.003 at typical Base gas prices).
  - Cancel Limit Order: ~37,000 gas (< $0.001).
- **Offchain Soft Cancel:** Othelio backend supports instant offchain order hiding (`cancel-intent`), but UI makes clear that true onchain cancellation requires calling `cancelLimitOrder`.

---

## 5. Architectural Interface

Defined in `packages/shared/src/risksplit/venue.ts`:
- `ZeroExLimitOrder` struct & EIP-712 typing
- `buildFillLimitOrderTx(order, signature, takerTokenFillAmount)`
- `buildCancelLimitOrderTx(order)`
- Event ABIs for `LimitOrderFilled` and `OrderCancelled` to be indexed by the Rust indexer.
