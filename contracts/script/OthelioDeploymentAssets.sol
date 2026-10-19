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
