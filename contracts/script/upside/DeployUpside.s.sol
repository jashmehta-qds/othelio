// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {UpsideFactory} from "../../src/upside/UpsideFactory.sol";
import {UpsideFixingAdapter} from "../../src/upside/UpsideFixingAdapter.sol";
import {UpsideBatchFillRouter} from "../../src/upside/UpsideBatchFillRouter.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";

contract DeployUpside is Script {
    address private constant BASE_MAINNET_REGISTRY = 0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC;
    address private constant ZERO_EX_EXCHANGE_PROXY_BASE = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;

    function run() external returns (address factoryAddr, address adapterAddr, address routerAddr) {
        vm.startBroadcast();

        address registryAddr = vm.envOr("ASSET_REGISTRY_ADDRESS", BASE_MAINNET_REGISTRY);
        require(registryAddr != address(0), "ZERO_REGISTRY_ADDRESS");

        // 1. Deploy UpsideFactory pinning OthelioAssetRegistry
        UpsideFactory factory = new UpsideFactory(registryAddr);
        factoryAddr = address(factory);

        // 2. Deploy UpsideFixingAdapter for MSFTc feed
        address feedMsft = vm.envOr("UPSIDE_FEED_ADDRESS", TokenizedAssetConstants.FEED_MSFT);
        uint256 maxStaleness = vm.envOr("UPSIDE_MAX_STALENESS_SECONDS", uint256(86400)); // 24 hours
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(feedMsft, maxStaleness);
        adapterAddr = address(adapter);

        // 3. Deploy UpsideBatchFillRouter wrapping 0x ExchangeProxy
        address exchangeProxy = vm.envOr("ZERO_EX_EXCHANGE_PROXY", ZERO_EX_EXCHANGE_PROXY_BASE);
        UpsideBatchFillRouter router = new UpsideBatchFillRouter(exchangeProxy);
        routerAddr = address(router);

        console2.log("=== Upside Deployment Result ===");
        console2.log("UpsideFactory deployed at:", factoryAddr);
        console2.log("UpsideFixingAdapter deployed at:", adapterAddr);
        console2.log("UpsideBatchFillRouter deployed at:", routerAddr);
        console2.log("Pinned Asset Registry:", registryAddr);
        console2.log("Initial Owner:", factory.owner());
        console2.log("Block Number:", block.number);

        vm.stopBroadcast();
    }
}
