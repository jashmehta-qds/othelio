// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";

contract DeployRiskSplit is Script {
    function run() external returns (address factoryAddr, address adapterAddr) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy hardened SeriesFactory
        SeriesFactory factory = new SeriesFactory();
        factoryAddr = address(factory);

        // Deploy SettlementAdapter for MSFTc feed on Base
        address feedMsft = TokenizedAssetConstants.FEED_MSFT;
        SettlementAdapter adapter = new SettlementAdapter(feedMsft, 86400); // 24h max staleness
        adapterAddr = address(adapter);

        console2.log("SeriesFactory deployed at:", factoryAddr);
        console2.log("SettlementAdapter deployed at:", adapterAddr);
        console2.log("Deployer / Initial Owner:", deployer);

        vm.stopBroadcast();
    }
}
