# Risk Split Base Mainnet Launch Runbook

**Version:** 1.0.0  
**Target Chain:** Base Mainnet (`chainId: 8453`)  
**Launch Token:** Coinbase B20 MSFTc (`0xB200000000000000000000Ab99cFa739E253872B`)  
**Quote Token:** Native USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)  
**Settlement Venue:** 0x v4 ExchangeProxy (`0xDef1C0ded9bec7F1a1670819833240f027b25EfF`)  
**Pilot Cap:** $5,000 USDC / 50 claims  

---

## 1. Overview & Operational Principles

This runbook guides operators through the mainnet launch of the first Risk Split series on Base. All actions obey the core system invariants:
- **Zero Custody:** Neither Othelio nor the operator holds custody of collateral or resting orders.
- **Authoritative Chains:** No private keys in browsers, CLI scripts, or backend servers. Operator transactions are signed via connected wallet or audited Foundry broadcasts.
- **Truthful Read Models:** Never fabricate quotes or display mock data in production.

---

## 2. Pre-Flight Verification Checklist

Before initiating deployment, verify:
- [ ] **Base Node Health:** RPC endpoint responds to `eth_blockNumber` and `eth_chainId` (8453).
- [ ] **Deployer Balance:** Operator wallet has at least 0.05 ETH on Base for contract deployments.
- [ ] **MSFTc Token State:** Verify token address `0xB200000000000000000000Ab99cFa739E253872B` has 8 decimals and is transferrable.
- [ ] **Chainlink Feed Status:** Query `latestRoundData()` on `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`:
  - `roundId > 0`
  - `price > 0`
  - `updatedAt > block.timestamp - 86400`
- [ ] **0x ExchangeProxy:** Verify contract code exists at `0xDef1C0ded9bec7F1a1670819833240f027b25EfF` on Base.

---

## 3. Step 1: Deploy Core Contracts

Run the deployment script using Foundry:

```bash
# 1. Dry run simulation
forge script contracts/script/risksplit/DeployRiskSplit.s.sol \
  --rpc-url $BASE_RPC_URL \
  --sender $DEPLOYER_ADDRESS

# 2. Broadcast onchain (authorized operator only)
forge script contracts/script/risksplit/DeployRiskSplit.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

**Output Artifacts to Record:**
- `SERIES_FACTORY_ADDRESS`
- `SETTLEMENT_ADAPTER_ADDRESS`
- Deployment Block Number (`FACTORY_DEPLOY_BLOCK`)
- Transaction Hashes

---

## 4. Step 2: Configure Indexer & Backend

Update the production environment configuration with the verified addresses:

```env
# indexer/.env & backend/.env
RISK_SPLIT_FACTORY_ADDRESS=0x<deployed_factory_address>
RISK_SPLIT_FACTORY_START_BLOCK=<factory_deploy_block>
RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS=0x<deployed_adapter_address>
```

Restart the indexer service to backfill from the deployment block:
```bash
docker compose -f docker-compose.prod.yml up -d indexer backend
```

Verify indexer catchup:
```bash
curl -s http://localhost:3000/v1/risksplit/series?chainId=8453
```
Expected response: `[]` (empty list, not error, freshness matching latest block).

---

## 5. Step 3: Operator Console & Market Launch

1. **Access Operator Console:** Navigate to `https://admin.othelio.fi`.
2. **Authenticate:** Connect deployer wallet; sign the EIP-712 challenge nonce.
3. **Inspect Assets View:** Verify MSFTc shows `READY` with green checkmarks for Feed, Decimals, Registry, and Routes.
4. **Markets Tab -> Create Market:**
   - Underlying: `MSFTc`
   - Floor: 85% of spot reference
   - Cap: 125% of spot reference
   - Expiry: Select Friday 4:00 PM ET (20:00 UTC) at least 7 days ahead
   - Review payoff simulation and signable preview
5. **Wallet Execution:**
   - Approve expiry: `SeriesFactory.setApprovedExpiry(MSFTc, expiryTimestamp, true)`
   - Create series: `SeriesFactory.createSeries(...)`
6. **Confirmation:** The new series appears in the operator console as `CONFIRMED` and `INDEXED`.

---

## 6. Step 4: Public Page & Order Book Validation

1. **Market Discovery:** Open `https://app.othelio.fi/app/risk-split`. Verify the MSFTc market is listed with correct floor, cap, and stock reference.
2. **Open Market Workspace:** Click `Open` to enter `/app/risk-split/[seriesAddress]`.
3. **Rehearsal Flow:**
   - **Mint Pair:** Deposit 1 MSFTc to mint 1 Protected + 1 Upside claim.
   - **Post Limit Order:**
     - Select `Protected / USDC` book.
     - Choose `Limit Order` -> `Sell 1 Protected at $120.00 USDC`.
     - Sign EIP-712 typed order in wallet.
     - Verify order appears in Asks depth ladder with green spread.
   - **Fill Order (Taker):**
     - Switch to secondary wallet.
     - Select the resting Ask order in the book.
     - Click `Fill Order onchain`.
     - Confirm 0x `fillLimitOrder` transaction in wallet.
     - Verify trade appears in `Recent Confirmed Trades` and remaining depth updates.
   - **Cancel Order:**
     - Click `Cancel` on any remaining order in `Open Limit Orders`.
     - Sign cancel intent and confirm onchain `cancelLimitOrder`.
     - Verify order immediately disappears from depth.

---

## 7. Step 5: Expiry & Settlement Execution

When the market reaches its expiry timestamp:
1. **Order Expiry:** All orders expiring at or before market expiry become unfillable.
2. **Fixing Round Selection:**
   - In Operator Console `Operations` view, inspect the fixing candidate round from Chainlink.
   - Confirm observation timestamp <= series expiry and that roundId + 1 timestamp > expiry.
3. **Execute Settlement:**
   - Operator clicks `Settle Market` or any user calls `RiskSplitSeries.settleSeries(candidateRoundId)`.
   - Contract computes `settledPrice`, `protectedFraction`, and `upsideFraction`.
4. **Claim Redemption:**
   - Users redeem `Protected` and `Upside` claims for their exact calculated fractions of underlying MSFTc.
   - Verify vault balances drain conservation-wise without stranded collateral.

---

## 8. Incident Response & Outage Playbooks

### Playbook A: Indexer Lag / Disconnection
- **Symptom:** Backend reports `indexer_stale = true` or block lag > 50.
- **Action:**
  1. Frontend automatically displays `Market data unavailable / reconnecting`.
  2. Order submission and fill actions display warning banner.
  3. Operator restarts indexer container: `docker compose restart indexer`.
  4. Once caught up, normal trading state resumes.

### Playbook B: Chainlink Oracle Feed Pause / Failure
- **Symptom:** No feed observations published within `maxStaleness` (24h).
- **Action:**
  1. Series settlement reverts under `StaleRound()`.
  2. Pair combine (`combineClaims`) remains active so users can retrieve 1:1 underlying collateral without settling.
  3. If feed permanently freezes, operator uses `recoverUnfixedSeries` governance mechanism as specified in `fixing-spec.md`.

### Playbook C: Order Book Sequence Gap / Relayer Restart
- **Symptom:** WebSocket reconnects or sequence number skips.
- **Action:**
  1. Frontend client re-queries full snapshot `/v1/risksplit/series/:address/books/:claim`.
  2. Sequence numbers resynchronize to latest database commit.
  3. No trades or orders are lost because onchain state is authoritative.
