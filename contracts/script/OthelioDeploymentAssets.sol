// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";

/// @notice Shared, reviewed launch-asset manifest for Base and local simulation.
library OthelioDeploymentAssets {
    uint256 internal constant ASSET_COUNT = 13;

    function tokensAndBaseFeeds() internal pure returns (address[] memory tokens, address[] memory priceFeeds) {
        tokens = new address[](ASSET_COUNT);
        priceFeeds = new address[](ASSET_COUNT);
        tokens[0] = TokenizedAssetConstants.AAPLc; priceFeeds[0] = TokenizedAssetConstants.FEED_AAPL;
        tokens[1] = TokenizedAssetConstants.AMZNc; priceFeeds[1] = TokenizedAssetConstants.FEED_AMZN;
        tokens[2] = TokenizedAssetConstants.COINc; priceFeeds[2] = TokenizedAssetConstants.FEED_COIN;
        tokens[3] = TokenizedAssetConstants.CRCLc; priceFeeds[3] = TokenizedAssetConstants.FEED_CRCL;
        tokens[4] = TokenizedAssetConstants.GOOGLc; priceFeeds[4] = TokenizedAssetConstants.FEED_GOOGL;
        tokens[5] = TokenizedAssetConstants.INTCc; priceFeeds[5] = TokenizedAssetConstants.FEED_INTC;
        tokens[6] = TokenizedAssetConstants.METAc; priceFeeds[6] = TokenizedAssetConstants.FEED_META;
        tokens[7] = TokenizedAssetConstants.MSFTc; priceFeeds[7] = TokenizedAssetConstants.FEED_MSFT;
        tokens[8] = TokenizedAssetConstants.MSTRc; priceFeeds[8] = TokenizedAssetConstants.FEED_MSTR;
        tokens[9] = TokenizedAssetConstants.NVDAc; priceFeeds[9] = TokenizedAssetConstants.FEED_NVDA;
        tokens[10] = TokenizedAssetConstants.SNDKc; priceFeeds[10] = TokenizedAssetConstants.FEED_SNDK;
        tokens[11] = TokenizedAssetConstants.SPCXc; priceFeeds[11] = TokenizedAssetConstants.FEED_SPCX;
        tokens[12] = TokenizedAssetConstants.TSLAc; priceFeeds[12] = TokenizedAssetConstants.FEED_TSLA;
    }

    function localPriceUsdE8(uint256 index) internal pure returns (int256) {
        int256[ASSET_COUNT] memory prices = [
            int256(224_50e6), int256(180e8), int256(200e8), int256(28_50e6), int256(175e8),
            int256(31_20e6), int256(500e8), int256(415_20e6), int256(135e8), int256(125_40e6),
            int256(65e8), int256(42e8), int256(250e8)
        ];
        return prices[index];
    }
}
