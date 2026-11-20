// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";

contract DeployRiskSplit is Script {
    function run() external returns (address factoryAddr, address adapterAddr) {
        vm.startBroadcast();

        // Deploy hardened SeriesFactory
        SeriesFactory factory = new SeriesFactory();
        factoryAddr = address(factory);

        // Deploy SettlementAdapter for MSFTc feed on Base
        address feedMsft = vm.envOr("RISK_SPLIT_FEED_ADDRESS", TokenizedAssetConstants.FEED_MSFT);
        uint256 maxStaleness = vm.envOr("RISK_SPLIT_MAX_STALENESS_SECONDS", uint256(86400));
        SettlementAdapter adapter = new SettlementAdapter(feedMsft, maxStaleness, factory.owner());
        adapterAddr = address(adapter);
        factory.setApprovedAdapter(TokenizedAssetConstants.MSFTc, adapterAddr, true);

        console2.log("SeriesFactory deployed at:", factoryAddr);
        console2.log("SettlementAdapter deployed at:", adapterAddr);
        console2.log("Deployer / Initial Owner:", factory.owner());

        vm.stopBroadcast();
    }
}
