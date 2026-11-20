// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ISettlementAdapter} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";

contract CreateMsftcSeries is Script {
    function run() external returns (address seriesAddress) {
        address factoryAddr = vm.envAddress("RISK_SPLIT_FACTORY_ADDRESS");
        address adapterAddr = vm.envAddress("RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS");
        address deployer = vm.envAddress("RISK_SPLIT_DEPLOYER_ADDRESS");
        uint256 floorPrice = vm.envUint("RISK_SPLIT_FLOOR_PRICE_E8");
        uint256 capPrice = vm.envUint("RISK_SPLIT_CAP_PRICE_E8");
        uint256 expiry = vm.envUint("RISK_SPLIT_EXPIRY_TIMESTAMP");
        address underlying = TokenizedAssetConstants.MSFTc;
        address expectedFeed = TokenizedAssetConstants.FEED_MSFT;

        SeriesFactory factory = SeriesFactory(factoryAddr);
        require(factory.owner() == deployer, "Signer is not factory owner");
        require(address(ISettlementAdapter(adapterAddr).priceFeed()) == expectedFeed, "Adapter feed mismatch");
        require(floorPrice > 0 && floorPrice < capPrice, "Invalid floor/cap");
        require(expiry > block.timestamp, "Expiry must be in the future");

        vm.startBroadcast();
        factory.setApprovedExpiry(underlying, expiry, true);
        factory.setApprovedAdapter(underlying, adapterAddr, true);
        seriesAddress = factory.createSeries(underlying, floorPrice, capPrice, expiry, adapterAddr);
        vm.stopBroadcast();

        console2.log("Series deployed at:", seriesAddress);
        console2.log("MSFTc:", underlying);
        console2.log("Floor price (feed decimals):", floorPrice);
        console2.log("Cap price (feed decimals):", capPrice);
        console2.log("Expiry timestamp:", expiry);
        console2.log("Settlement adapter:", adapterAddr);
    }
}
