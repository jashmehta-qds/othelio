# Risk Split Expiry Fixing Specification & Verification Proof

**Date:** 2 November 2026  
**Status:** Approved & Verified on Base Mainnet  
**Target Oracle Feed:** Chainlink MSFT / USD Feed on Base (`0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`)  
**Feed Decimals:** 8  
**Contracts:** `SettlementAdapter.sol`, `ISettlementAdapter.sol`, `RiskSplitSeries.sol`  
**Test Suites:**  
- `contracts/test/risksplit/RiskSplitFixingTest.t.sol` (6 unit tests, all passed)  
- `contracts/test/risksplit/BaseForkFixingTest.t.sol` (3 live Base fork tests, all passed)  

---

## 1. Problem Statement & Fixing Invariants

In earlier drafts, series settlement read `priceFeed.latestRoundData()` at the moment `settleSeries` was called. This allowed a caller to deliberately delay settlement execution and substitute a post-expiry price, violating fair payoff terms.

### Invariants Established
1. **Never Post-Expiry:** The settlement price must be the **last valid observation recorded at or before series expiry** (`updatedAt <= expiry`).
2. **Uniqueness & Immutability:** There exists exactly one round in the feed that qualifies. Calling `settleSeries` 1 minute, 1 day, or 1 year after expiry produces the exact same fixing price and round.
3. **No Cherry-Picking:** A caller cannot nominate an older round. If round $R$ is nominated, the contract proves that $R+1$ (the next round in the same phase or first round of next phase) either does not exist yet or occurred strictly after expiry (`nextUpdatedAt > expiry`).
4. **Staleness Guard:** The observation timestamp must be within `maxStaleness` of series expiry (`expiry - updatedAt <= maxStaleness`). If the feed halted or no round was published within this window, settlement reverts and enters documented governance recovery.
5. **Decimals & Sign Validation:** The price must be strictly positive (`answer > 0`), the round must be complete (`answeredInRound >= roundId`), and feed decimals must match target specifications.

---

## 2. Mathematical Definition of the Fixing Round

Let:
- $T_{\text{expiry}}$ be the immutable series expiry timestamp.
- $\Delta_{\text{max}}$ be `maxStaleness` (e.g., 24 hours for daily heartbeat).
- Round $R$ have phase ID $P = \lfloor R / 2^{64} \rfloor$ and aggregator round index $k = R \pmod{2^{64}}$.
- Round $R$ provide $(answer_R, startedAt_R, updatedAt_R, answeredInRound_R)$.

Round $R$ is the valid fixing round if and only if all of the following hold:
1. $R > 0$ and $answeredInRound_R \ge R$
2. $answer_R > 0$
3. $updatedAt_R \le T_{\text{expiry}}$
4. $T_{\text{expiry}} - updatedAt_R \le \Delta_{\text{max}}$
5. **Last pre-expiry condition:**
   - Case A (Next round in same phase exists): Let $R_{\text{next}} = (P \ll 64) \mid (k + 1)$. If $R_{\text{next}}$ has been answered, then $updatedAt_{R_{\text{next}}} > T_{\text{expiry}}$.
   - Case B (Phase boundary): If $R_{\text{next}}$ does not exist, let $R_{\text{phaseNext}} = ((P + 1) \ll 64) \mid 1$. If $R_{\text{phaseNext}}$ has been answered, then $updatedAt_{R_{\text{phaseNext}}} > T_{\text{expiry}}$.
   - Case C (Latest round): If neither next round exists yet, $R$ must be the current latest round returned by `priceFeed.latestRoundData()`.

---

## 3. Real Base Feed Evidence (MSFT / USD)

Captured at pinned Base block `53,400,000` from contract `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`:

| Metric | Captured Value | Description |
| :--- | :--- | :--- |
| **Decimals** | `8` | USD standard precision ($1 = 10^8$) |
| **Latest Round ID** | `36893488147419103790` | Phase 2, Round 6190 (`0x2000000000000182e`) |
| **Latest Price ($E8)** | `52330349196` | **$523.30349196** per share |
| **Latest Observation (`updatedAt`)** | `1793581225` | Unix timestamp of Chainlink update |
| **Predecessor Round ID** | `36893488147419103789` | Phase 2, Round 6189 |
| **Predecessor Price ($E8)** | `52192442500` | $521.92442500 |
| **Predecessor `updatedAt`** | `1793387777` | Weekend gap: `1793581225 - 1793387777 = 193,448s` (~53.7h) |

### Test Verification Results
- `adapter.verifyFixingRound(1793581225, 36893488147419103790)`: **PASS**
- Settle series with `36893488147419103789` (predecessor): **Reverts `NotLastPreExpiryRound`**
- Settle with timestamp `1793581225 - 1` (post-expiry attempt): **Reverts `PostExpiryRound`**
- `getFixingRound(1793581225)`: Discovers round `36893488147419103790` with exact price `52330349196`.

---

## 4. Market Hours & Calendar Policy (`America/New_York`)

US Equities trade in `America/New_York`:
- **Regular Hours:** Monday – Friday, 09:30 AM to 04:00 PM Eastern Time.
- **Scheduled Early Closes:** 01:00 PM Eastern Time (e.g. day after Thanksgiving, Christmas Eve when applicable).
- **Holidays:** NYSE official calendar (New Year's Day, MLK Day, Washington's Birthday, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas).

### Expiry Approval Policy
1. Series expiry timestamps are restricted to **valid trading sessions** during market hours plus a **15-minute buffer** away from market open (09:45 AM ET or later) and market close (03:45 PM ET or earlier).
2. The initial pilot launch permits only verified weekday expiries (e.g. 15:30 ET).
3. Weekend and holiday expiries are explicitly disallowed until separate continuous feed or fixing rules are deployed.
