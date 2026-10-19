// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {OthelioDeploymentAssets} from "./OthelioDeploymentAssets.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {OthelioAerodromeRouteRegistry, IAerodromeSlipstreamFactory} from "../src/dex/OthelioAerodromeRouteRegistry.sol";

/// @notice Governance script to enable newly reviewed Coinbase B20 assets on Base mainnet or fork.
/// @dev Enables verified B20 assets in OthelioAssetRegistry and registers their Slipstream route approvals.
contract ConfigureReviewedAssets is Script {
    address private constant DEFAULT_ASSET_REGISTRY = 0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC;
    address private constant DEFAULT_ROUTE_REGISTRY = 0xB4C098551643e73199DE76E2fb66290339a7Ca24;
    address private constant AERODROME_FACTORY = 0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef;
    address private constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        address assetRegistryAddr = vm.envOr("ASSET_REGISTRY_ADDRESS", DEFAULT_ASSET_REGISTRY);
        address routeRegistryAddr = vm.envOr("AERODROME_ROUTE_REGISTRY_ADDRESS", DEFAULT_ROUTE_REGISTRY);

        OthelioAssetRegistry registry = OthelioAssetRegistry(assetRegistryAddr);
        OthelioAerodromeRouteRegistry routeRegistry = OthelioAerodromeRouteRegistry(routeRegistryAddr);

        (address[] memory allTokens, address[] memory allFeeds) = OthelioDeploymentAssets.tokensAndBaseFeeds();
        uint256 total = allTokens.length;

        // Count unconfigured assets
        uint256 unconfiguredCount = 0;
        for (uint256 i = 0; i < total; i++) {
            if (!registry.isSupported(block.chainid, allTokens[i])) {
                unconfiguredCount++;
            }
        }

        if (unconfiguredCount == 0) {
            console.log("All reviewed assets are already enabled on chain", block.chainid);
            return;
        }

        address[] memory tokensToEnable = new address[](unconfiguredCount);
        address[] memory feedsToEnable = new address[](unconfiguredCount);
        bool[] memory supported = new bool[](unconfiguredCount);
        uint8[] memory tokenDecimals = new uint8[](unconfiguredCount);
        uint8[] memory feedDecimals = new uint8[](unconfiguredCount);
        bool[] memory isB20 = new bool[](unconfiguredCount);
        int24[] memory tickSpacings = new int24[](unconfiguredCount);

        uint256 targetIdx = 0;
        for (uint256 i = 0; i < total; i++) {
            address token = allTokens[i];
            if (!registry.isSupported(block.chainid, token)) {
                address feed = allFeeds[i];
                int24 tick = OthelioDeploymentAssets.baseUsdcTickSpacing(i);
                require(feed.code.length > 0, "MISSING_PRICE_FEED");

                address pool = IAerodromeSlipstreamFactory(AERODROME_FACTORY).getPool(BASE_USDC, token, tick);
                require(pool != address(0) && pool.code.length > 0, "MISSING_REQUIRED_AERODROME_ROUTE");

                tokensToEnable[targetIdx] = token;
                feedsToEnable[targetIdx] = feed;
                supported[targetIdx] = true;
                tokenDecimals[targetIdx] = OthelioDeploymentAssets.baseTokenDecimals(i);
                feedDecimals[targetIdx] = 8;
                isB20[targetIdx] = true;
                tickSpacings[targetIdx] = tick;
                targetIdx++;
            }
        }

        uint256 governanceKey = vm.envOr("GOVERNANCE_PRIVATE_KEY", uint256(0));
        if (governanceKey != 0) {
            vm.startBroadcast(governanceKey);
        } else {
            vm.startBroadcast();
        }

        for (uint256 j = 0; j < unconfiguredCount; j++) {
            routeRegistry.setPoolApproval(
                block.chainid,
                BASE_USDC,
                tokensToEnable[j],
                tickSpacings[j],
                AERODROME_FACTORY,
                true
            );
        }

        registry.configureBatch(
            block.chainid,
            tokensToEnable,
            feedsToEnable,
            supported,
            tokenDecimals,
            feedDecimals,
            isB20
        );

        vm.stopBroadcast();

        for (uint256 k = 0; k < unconfiguredCount; k++) {
            require(registry.isSupported(block.chainid, tokensToEnable[k]), "ASSET_ENABLEMENT_FAILED");
            console.log("Enabled asset:", tokensToEnable[k]);
        }
    }
}
