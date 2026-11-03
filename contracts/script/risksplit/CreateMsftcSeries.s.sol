// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {AggregatorV3Interface} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";

contract CreateMsftcSeries is Script {
    function run() external returns (address seriesAddress) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address factoryAddr = vm.envAddress("SERIES_FACTORY");
        address adapterAddr = vm.envAddress("SETTLEMENT_ADAPTER");

        address msftc = TokenizedAssetConstants.MSFTc;
        address feedMsft = TokenizedAssetConstants.FEED_MSFT;

        SeriesFactory factory = SeriesFactory(factoryAddr);
        require(factory.owner() == deployer, "Signer is not factory owner");

        // Fetch live reference round from Chainlink
        (, int256 refPrice,, uint256 refTimestamp,) =
            AggregatorV3Interface(feedMsft).latestRoundData();

        require(refPrice > 0, "Non-positive reference price");

        // Target Friday 4:00 PM ET (20:00 UTC) at least 7 days out
        uint256 nextFridayUtc = ((refTimestamp + 7 days + 4 days) / 7 days) * 7 days + 20 hours;

        // Floor: 85% of spot; Cap: 125% of spot
        uint256 floorPrice = (uint256(refPrice) * 85) / 100;
        uint256 capPrice = (uint256(refPrice) * 125) / 100;

        vm.startBroadcast(deployerPrivateKey);

        // 1. Approve exact expiry on factory
        factory.setApprovedExpiry(msftc, nextFridayUtc, true);
        console2.log("Approved expiry timestamp:", nextFridayUtc);

        // 2. Create the series
        seriesAddress = factory.createSeries(
            msftc,
            floorPrice,
            capPrice,
            nextFridayUtc,
            adapterAddr
        );

        console2.log("MSFTc Risk Split Series created at:", seriesAddress);
        console2.log("Floor Price ($E8):", floorPrice);
        console2.log("Cap Price ($E8):", capPrice);
        console2.log("Reference Price ($E8):", uint256(refPrice));

        vm.stopBroadcast();
    }
}
