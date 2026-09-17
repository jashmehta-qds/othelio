// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";

/// @notice Shared, reviewed launch-asset manifest for Base and local simulation.
library OthelioDeploymentAssets {
    /// @dev The only Base assets approved for the initial release. Each has a
    /// executable USDC quote at the reviewed $100 release test size in the
    /// pinned Slipstream V3 factory at the release block.
    uint256 internal constant ASSET_COUNT = 7;

    function tokensAndBaseFeeds() internal pure returns (address[] memory tokens, address[] memory priceFeeds) {
        tokens = new address[](ASSET_COUNT);
        priceFeeds = new address[](ASSET_COUNT);
        tokens[0] = TokenizedAssetConstants.AAPLc; priceFeeds[0] = TokenizedAssetConstants.FEED_AAPL;
        tokens[1] = TokenizedAssetConstants.AMZNc; priceFeeds[1] = TokenizedAssetConstants.FEED_AMZN;
        tokens[2] = TokenizedAssetConstants.GOOGLc; priceFeeds[2] = TokenizedAssetConstants.FEED_GOOGL;
        tokens[3] = TokenizedAssetConstants.METAc; priceFeeds[3] = TokenizedAssetConstants.FEED_META;
        tokens[4] = TokenizedAssetConstants.MSFTc; priceFeeds[4] = TokenizedAssetConstants.FEED_MSFT;
        tokens[5] = TokenizedAssetConstants.MSTRc; priceFeeds[5] = TokenizedAssetConstants.FEED_MSTR;
        tokens[6] = TokenizedAssetConstants.NVDAc; priceFeeds[6] = TokenizedAssetConstants.FEED_NVDA;
    }

    /// @notice Sole reviewed direct USDC pool tick for each launch asset.
    function baseUsdcTickSpacing(uint256 index) internal pure returns (int24) {
        int24[ASSET_COUNT] memory ticks = [int24(10), int24(10), int24(10), int24(10), int24(10), int24(10), int24(200)];
        return ticks[index];
    }

    /// @notice B20 Asset decimals verified from the canonical Base contracts.
    function baseTokenDecimals(uint256 index) internal pure returns (uint8) {
        uint8[ASSET_COUNT] memory decimals = [uint8(8), uint8(8), uint8(8), uint8(8), uint8(8), uint8(8), uint8(8)];
        return decimals[index];
    }

    function localPriceUsdE8(uint256 index) internal pure returns (int256) {
        int256[ASSET_COUNT] memory prices = [
            int256(224_50e6), int256(180e8), int256(175e8), int256(500e8), int256(415_20e6), int256(135e8), int256(125_40e6)
        ];
        return prices[index];
    }
}
