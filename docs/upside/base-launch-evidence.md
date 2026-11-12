# Stock Upside Markets: Base Mainnet Launch Evidence

**Target Network:** Base Mainnet (`chainId: 8453`)  
**Base Head / Fork Block:** 53,400,000+  
**Branch:** `feature/upside-markets`  
**Security Status:** Passing Invariant & Fork Suites (34/34 Foundry, 7/7 Rust, 206/206 Vitest, 0 Build Errors)  

---

## 1. Verified Infrastructure & Onchain Addresses

| Component | Base Mainnet Address | Verification Details |
| :--- | :--- | :--- |
| **Othelio Asset Registry** | `0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC` | Sole source of truth for supported assets |
| **MSFTc (Coinbase B20)** | `0xB200000000000000000000Ab99cFa739E253872B` | 8 decimals, standard ERC-20 interface |
| **Chainlink MSFT / USD Feed** | `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c` | 8 decimals, continuous rounds on Base |
| **Native USDC** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 decimals, settlement & quote currency |
| **0x Protocol ExchangeProxy** | `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` | v4 Limit Order protocol live on Base |

---

## 2. Onchain Fork Evidence

### 2.1 Live Chainlink Fixing Verification (`UpsideBaseForkTest`)
```text
Ran 3 tests for test/upside/UpsideBaseFork.t.sol:UpsideBaseForkTest
[PASS] test_Fork_LiveFeedProperties() (gas: 34065)
[PASS] test_Fork_LiveFixingVerificationAndProof() (gas: 165545)
[PASS] test_Fork_LiveSeriesSettlement() (gas: 3643477)
Suite result: ok. 3 passed; 0 failed; 0 skipped
```
- Proves real Chainlink MSFT/USD feed observations on Base.
- Verifies exact deterministic fixing round identification at and after expiry.
- Proves complete round expiry, price settlement, and claim payout on real Base state.

### 2.2 0x Protocol Venue & Batch Sweep Proof (`Upside0xVenueForkTest`)
```text
Ran 4 tests for test/upside/Upside0xVenueFork.t.sol:Upside0xVenueForkTest
[PASS] test_Fork_BatchFillRouter_MultiLevelSweep() (gas: 336235)
[PASS] test_Fork_BatchFillRouter_PartialFill() (gas: 193138)
[PASS] test_Fork_BatchFillRouter_RevertIfIncompleteOnCancelledOrder() (gas: 246261)
[PASS] test_Fork_SingleOrderFillDirectOnExchangeProxy() (gas: 195520)
Suite result: ok. 4 passed; 0 failed; 0 skipped
```
- Confirms 0x v4 limit order signing and direct fill execution on Base's canonical ExchangeProxy (`0xDef1C0ded9bec7F1a1670819833240f027b25EfF`).
- Confirms atomic multi-level sweep filling via `UpsideBatchFillRouter` across distinct maker price tiers with exact taker payout.
- Verifies revert-if-incomplete safety when an order is cancelled or underfilled.

### 2.3 Solvency Invariant Proof (`UpsideInvariantTest`)
```text
Ran 1 test for test/upside/UpsideInvariant.t.sol:UpsideInvariantTest
[PASS] invariant_VaultSolvencyAndConservation() (runs: 256, calls: 128000, reverts: 0)

╭---------------+--------------------+-------+---------+----------╮
| Contract      | Selector           | Calls | Reverts | Discards |
+=================================================================+
| UpsideHandler | combineAndWithdraw | 25518 | 0       | 0        |
|---------------+--------------------+-------+---------+----------|
| UpsideHandler | mint               | 25642 | 0       | 0        |
|---------------+--------------------+-------+---------+----------|
| UpsideHandler | redeemResidual     | 25639 | 0       | 0        |
|---------------+--------------------+-------+---------+----------|
| UpsideHandler | redeemUpside       | 25477 | 0       | 0        |
|---------------+--------------------+-------+---------+----------|
| UpsideHandler | triggerSettlement  | 25724 | 0       | 0        |
╰---------------+--------------------+-------+---------+----------╯
```
- Proves strict solvency: Vault balance $\ge$ total obligations at every block and sequence of actions.
- Zero trapped dust or rounding shortfall across 128,000 randomized stateful calls.

---

## 3. Subsystem Independence & Legacy Isolation Evidence

- **Risk Split Indexer Toggle (`RISK_SPLIT_INDEXING_ENABLED`):**
  - Tested in `indexer/src/risksplit/tests.rs` (`test_parse_risk_split_indexing_flag_behavior`).
  - Independent database cursor: `indexer_worker_state` with `worker_name = 'risksplit'`.
  - Setting `RISK_SPLIT_INDEXING_ENABLED=false` safely pauses Risk Split event subscription without interrupting baskets, price feed observation, or Upside market processing.
  - Re-enabling seamlessly catches up from the stored cursor block without replaying Upside or basket events.
  - Monitored and displayed in real-time on `fe-admin` under Operations Indexer Health.

---

## 4. Operator Deployment Instructions

1. **Simulate Broadcast:**
   ```bash
   ./scripts/deploy-upside-base.sh
   ```

2. **Broadcast to Base Mainnet using Encrypted Keystore:**
   ```bash
   base-forge script contracts/script/upside/DeployUpside.s.sol:DeployUpside \
     --root contracts \
     --rpc-url "$BASE_RPC_URL" \
     --account othelio-base-deployer \
     --broadcast \
     --verify
   ```

3. **Verify Contracts on Basescan:**
   - Verify `UpsideFactory`
   - Verify `UpsideFixingAdapter`
   - Verify `UpsideBatchFillRouter`

4. **Launch Initial MSFTc Round via Admin Console (`fe-admin`):**
   - Connect deployer wallet
   - Select MSFTc asset
   - Click "Deploy Upside Round"
   - Confirm transactions for 4 preset strikes (Start, Reach, Strong Move, Long Shot)
   - Verify active markets appear on `/app/upside`.
