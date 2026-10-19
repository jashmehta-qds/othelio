# Coinbase B20 Asset Enablement & Catalog Gating Plan

> **Trellis Task:** `.trellis/tasks/10-16-b20-asset-enablement-and-gating`
> **Active Goal:** Enable verified B20 cohort (SNDKc, SPCXc, TSLAc) with Chainlink pricing, configure onchain registries on Base mainnet, make backend `/v1/assets` catalog truthful, and gate frontend UI selection.

## Context & Immediate Problem

Live onchain query on Base mainnet (`0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC`) confirms **only 7 B20 assets** (AAPLc, AMZNc, GOOGLc, METAc, MSFTc, MSTRc, NVDAc) are configured. The UI currently displays **13 assets as selectable** from a static array, meaning attempts to add unconfigured assets (SNDKc, SPCXc, TSLAc, COINc, CRCLc, INTCc) revert onchain.

- **SNDKc, SPCXc, TSLAc**: Ready for enablement (verified contracts, Chainlink total-return feeds, active Aerodrome USDC pools).
- **COINc, CRCLc, INTCc**: 0 supply / no pool on Base. Must remain visible but gated as untradeable.
- **Future 47 Candidates**: Will be onboarded in subsequent cohorts once compatible feeds are verified.

---

## 4-Step Technical Implementation Plan

### Step 1: Update `OthelioDeploymentAssets.sol` Manifest

**Files:** `contracts/script/OthelioDeploymentAssets.sol`, `contracts/test/DeployOthelioIsolation.t.sol`

- [x] Expand `OthelioDeploymentAssets.sol` to 10 assets (`ASSET_COUNT = 10`), appending `SNDKc`, `SPCXc`, and `TSLAc`.
- [x] Update `localPriceUsdE8(uint256 index)` with verified Chainlink round price snapshots for deterministic local simulation.
- [x] Add lean manifest consistency test in `contracts/test/DeployOthelioIsolation.t.sol` (validates matching array lengths, valid decimals, non-zero ticks).
- [ ] Verify with `forge test --match-contract DeployOthelioIsolationTest`.

### Step 2: Governance Enablement Script

**Files:** Create `contracts/script/ConfigureReviewedAssets.s.sol`

- [ ] Write `ConfigureReviewedAssets.s.sol` to import `OthelioDeploymentAssets`:
  - Target deployed `OthelioAssetRegistry` (`0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC`)
  - Filter and execute `configureBatch` only for new unconfigured assets (`SNDKc`, `SPCXc`, `TSLAc`)
  - Call `routeRegistry.setPoolApproval` for Aerodrome USDC pools (tick spacing 10)
- [ ] Run dry-run simulation on a Base fork to verify calldata, call ordering, and post-state without broadcasting.
- [ ] Produce interactive execution runner for governance execution.

### Step 3: Truthful Backend Catalog (`/v1/assets`)

**Files:** `backend/src/baskets/baskets.service.ts`, `backend/src/baskets/asset-catalog-metadata.spec.ts`

- [ ] Update `asset-catalog-metadata.spec.ts` to assert:
  - Catalog includes all known B20 identities
  - `tradeable: true` only when supported in onchain registry with valid price observation
  - `tradeable: false` for staged unconfigured assets (COINc, CRCLc, INTCc)
  - Nullable Coinbase NAV preserved
- [ ] In `baskets.service.ts`:
  - Remove unreachable legacy static price array
  - Compute `tradeable: boolean` dynamically based on onchain registry state and active price observations
- [ ] Run `npm test` on `asset-catalog-metadata.spec.ts` to ensure green.

### Step 4: Frontend Basket Drawer & Allocation Selection Gating

**Files:** `fe/src/components/BasketAllocationEditor.tsx`, `fe/src/features/baskets/BasketDrawer.tsx`, `fe/src/features/baskets/BasketDrawer.test.tsx`

- [ ] Replace hardcoded `supportedAssets` selection list with dynamic tradeable assets from `/v1/assets`.
- [ ] In `BasketAllocationEditor.tsx` and `BasketDrawer.tsx`:
  - Show untradeable assets as disabled with an explanatory badge (e.g. "Unavailable" / "Coming Soon").
  - Prevent adding untradeable tokens to allocations so users cannot trigger reverting transactions.
- [ ] Add lean component test in `BasketDrawer.test.tsx` verifying non-tradeable assets cannot be added.
- [ ] Validate `npm run build` in `fe/`.

---

## Technical Specification

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";

/// @notice Shared, reviewed launch-asset manifest for Base and local simulation.
library OthelioDeploymentAssets {
    uint256 internal constant ASSET_COUNT = 10;

    function tokensAndBaseFeeds() internal pure returns (address[] memory tokens, address[] memory priceFeeds) {
        tokens = new address[](ASSET_COUNT);
        priceFeeds = new address[](ASSET_COUNT);
        // Initial Launch Assets (7)
        tokens[0] = TokenizedAssetConstants.AAPLc; priceFeeds[0] = TokenizedAssetConstants.FEED_AAPL;
        tokens[1] = TokenizedAssetConstants.AMZNc; priceFeeds[1] = TokenizedAssetConstants.FEED_AMZN;
        tokens[2] = TokenizedAssetConstants.GOOGLc; priceFeeds[2] = TokenizedAssetConstants.FEED_GOOGL;
        tokens[3] = TokenizedAssetConstants.METAc; priceFeeds[3] = TokenizedAssetConstants.FEED_META;
        tokens[4] = TokenizedAssetConstants.MSFTc; priceFeeds[4] = TokenizedAssetConstants.FEED_MSFT;
        tokens[5] = TokenizedAssetConstants.MSTRc; priceFeeds[5] = TokenizedAssetConstants.FEED_MSTR;
        tokens[6] = TokenizedAssetConstants.NVDAc; priceFeeds[6] = TokenizedAssetConstants.FEED_NVDA;
        // First Expansion Cohort (3)
        tokens[7] = TokenizedAssetConstants.SNDKc; priceFeeds[7] = TokenizedAssetConstants.FEED_SNDK;
        tokens[8] = TokenizedAssetConstants.SPCXc; priceFeeds[8] = TokenizedAssetConstants.FEED_SPCX;
        tokens[9] = TokenizedAssetConstants.TSLAc; priceFeeds[9] = TokenizedAssetConstants.FEED_TSLA;
    }

    /// @notice Sole reviewed direct USDC pool tick for each asset.
    function baseUsdcTickSpacing(uint256 index) internal pure returns (int24) {
        int24[ASSET_COUNT] memory ticks = [
            int24(10), int24(10), int24(10), int24(10), int24(10),
            int24(10), int24(10), int24(10), int24(10), int24(10)
        ];
        return ticks[index];
    }

    /// @notice B20 Asset decimals verified from the canonical Base contracts.
    function baseTokenDecimals(uint256 index) internal pure returns (uint8) {
        uint8[ASSET_COUNT] memory decimals = [
            uint8(8), uint8(8), uint8(8), uint8(8), uint8(8),
            uint8(8), uint8(8), uint8(8), uint8(8), uint8(8)
        ];
        return decimals[index];
    }

    /// @notice Verified Chainlink last-round price snapshot ($E8 precision) for local mock simulation.
    function localPriceUsdE8(uint256 index) internal pure returns (int256) {
        int256[ASSET_COUNT] memory prices = [
            int256(343_71e6),  // AAPLc  (~$343.71)
            int256(252_47e6),  // AMZNc  (~$252.47)
            int256(343_39e6),  // GOOGLc (~$343.39)
            int256(719_01e6),  // METAc  (~$719.01)
            int256(530_32e6),  // MSFTc  (~$530.32)
            int256(137_89e6),  // MSTRc  (~$137.89)
            int256(217_40e6),  // NVDAc  (~$217.40)
            int256(1331_66e6), // SNDKc  (~$1331.66)
            int256(146_33e6),  // SPCXc  (~$146.33)
            int256(356_74e6)   // TSLAc  (~$356.74)
        ];
        return prices[index];
    }
}
```

