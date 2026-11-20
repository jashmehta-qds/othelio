# Original Risk Split (formula version 1)

**Source of truth:** `contracts/src/risksplit/{RiskSplitSeries,SeriesFactory,SettlementAdapter,ClaimToken}.sol` on `feature/risk-split`. This document records the **existing** product, not the proposed Stock Upside Markets. Update the operational verification section when the branch is committed and pushed.

## Deployed Base pins

`contracts/deployments/base-mainnet-risksplit.json` records Base chain `8453`, owner/deployer `0xECCEc5B076D97d455Ce9416012876BdACC97939a`, factory `0x18F2cBF92d7d54c26e36039f61880d6028FB4518`, MSFTc-specific fixing adapter `0xDf802E50C0d36E9cFFA2b3365cd931243450BEB2`, MSFTc underlying `0xB200000000000000000000Ab99cFa739E253872B`, and feed `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`. Verify addresses, code, owner, feed and deployment block onchain during the V1 checkpoint. Never reuse these addresses to imply the new Upside formula.

## Actual V1 mechanism

A series has immutable underlying, floor `F`, cap `C`, expiry, adapter, feed and creation reference. Depositing one underlying token mints one **PROT** and one **UP** ERC-20 (both use the underlying's decimals). Holding both and burning the pair retrieves one underlying token. The series is nonupgradeable. The factory currently has an owner, two-step owner transfer, owner-only creation and owner-approved exact expiries. The settlement adapter nominates a feed fixing; redemption is in the underlying token, not guaranteed USDC.

`RiskSplitSeries._applySettlement` computes claim fractions from settlement price `S`. Ignoring integer truncation, the **economic values per one deposited token** are:

| Fixing | PROT value | UP value |
| --- | ---: | ---: |
| `S = 0` | `0` | `0` |
| `0 < S < F` | `S` | `0` |
| `F ≤ S < 2F` | `F` | `S − F` |
| `2F ≤ S < 2C` | `S/2` | `S/2` |
| `S ≥ 2C` | `C` | `S − C` |

For positive `S`, the two values sum to `S` before raw-token rounding. **`F` is not a guaranteed cash floor**: if the stock fixes below `F`, PROT receives the stock's remaining value, which is below `F`. **`C` is not a cap on UP**: above `2C`, UP continues to receive stock gains while PROT is worth `C`. As an example with `F=$435.37`, `C=$653.05`, and `S=$660`, the actual V1 formula is in the `F ≤ S < 2F` region: PROT is worth `$435.37`, UP `$224.63`, total `$660` (before rounding). The name “Protected” is a label, not a statement of principal protection.

At `S=0`, V1 sets both settlement fractions to zero. A holder of **both** claims can still use `combineAndRedeem` to retrieve the raw underlying token; separate single-side redemptions at a zero fixing do not distribute it. This is a known semantic limitation to document and review, not a license to mutate deployed V1 bytecode. The V1 fixing adapter rejects zero latest/feed prices in its normal path. Integer truncation in independent single-side redemptions may leave residual dust; verify and document any material amount in the V1 checkpoint.

## Existing application surfaces

- Public: `/app/risk-split` and `/app/risk-split/[seriesAddress]` in `fe`; order books and mint/redeem controls are V1-specific. The new Upside branch hides this product's AppShell nav link only; these direct routes remain functional.
- Backend: `/v1/risksplit/*` and signed 0x order API `/v1/orders` in `backend`. The current fill builder handles one order per transaction.
- Indexer/database: `indexer/src/risksplit.rs`, `risk_split_series`, positions, orders and trades migrations. New Upside events/tables need their own product identity; historical V1 rows must remain interpretable.
- Admin: existing Risk Split market and asset operations remain available, including creating V1 floor/cap series where authorized.

## Operational Verification Record (V1 Checkpoint)

- **Test Suites Executed:**
  - `contracts` (Foundry via `base-forge` against Base mainnet): 45 tests passed across 7 test suites (`RiskSplitFixingTest`, `RiskSplitSecurityTest`, `SeriesFactoryPermissionsTest`, `RiskSplitSeriesTest`, `BaseForkFixingTest`, `VenueBaseForkTest`, `RiskSplitInvariantTest` with 128,000 calls).
  - `indexer` (Cargo test): 4 unit tests passed.
  - `backend` (Vitest): 28 test suites passed, 185 tests passed.
  - `build & typecheck`: Clean compilation across contracts, indexer, backend (`tsc`), public UI (`fe` Next.js 16 build), and admin UI (`fe-admin` Next.js 16 build).
- **Base Mainnet Verification (Chain ID 8453):**
  - Factory: `0x18F2cBF92d7d54c26e36039f61880d6028FB4518` (Owner: `0xECCEc5B076D97d455Ce9416012876BdACC97939a`, Block: `55448539`).
  - MSFTc Settlement Adapter: `0xDf802E50C0d36E9cFFA2b3365cd931243450BEB2` (Feed: `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`, Block: `55448549`).
  - Underlying: `0xB200000000000000000000Ab99cFa739E253872B` (MSFTc).
- **Direct Routes & Surfacing:**
  - Public routes `/app/risk-split` and `/app/risk-split/[seriesAddress]` remain fully functional.
  - Backend `/v1/risksplit/*` and `/v1/orders` remain active.
  - Admin portal operations for Risk Split remain operational.
- **Known Limitations & Dispositions:**
  - Piecewise 5-regime floor/cap is preserved as V1 behavior.
  - S=0 requires pair redemption (`combineAndRedeem`) to retrieve collateral.
  - Limit order venue uses 0x v4 signed limit orders with single-order atomic fills.

Do not describe V1 as security-audited or fully proven live until those checks produce evidence. The [Stock Upside Markets spec](../superpowers/specs/2026-11-11-upside-markets-design.md) defines an independent strike-based product and deployment.
