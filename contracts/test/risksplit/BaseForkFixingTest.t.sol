// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {ISettlementAdapter, AggregatorV3Interface} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";

contract BaseForkFixingTest is Test {
    uint256 public constant BASE_FORK_BLOCK = 53_400_000;
    address public constant FEED_MSFT = TokenizedAssetConstants.FEED_MSFT; // 0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c
    address public constant MSFTc = TokenizedAssetConstants.MSFTc; // 0xB200000000000000000000Ab99cFa739E253872B

    SettlementAdapter internal adapter;
    SeriesFactory internal factory;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        // Max staleness covering multi-day spans (e.g. 7 days)
        adapter = new SettlementAdapter(FEED_MSFT, 7 days, address(this));
        factory = new SeriesFactory();
    }

    function test_Fork_LiveFeedProperties() public {
        assertEq(adapter.decimals(), 8, "MSFT feed decimals must be 8");
        assertEq(address(adapter.priceFeed()), FEED_MSFT, "Price feed address mismatch");

        (uint80 latestRound, int256 latestPrice,, uint256 latestUpdated, uint80 answeredIn) =
            AggregatorV3Interface(FEED_MSFT).latestRoundData();

        assertGt(latestRound, 0, "Invalid latest round");
        assertGt(latestPrice, 0, "Price must be positive");
        assertGt(latestUpdated, 0, "Updated timestamp must be positive");
        assertGe(answeredIn, latestRound, "Round not completed");

        emit log_named_uint("Live MSFTc Feed Latest Round", latestRound);
        emit log_named_int("Live MSFTc Feed Latest Price ($E8)", latestPrice);
        emit log_named_uint("Live MSFTc Feed Latest UpdatedAt", latestUpdated);
    }

    function test_Fork_LiveFixingVerificationAndProof() public {
        (uint80 latestRound, int256 latestPrice,, uint256 latestUpdated,) =
            AggregatorV3Interface(FEED_MSFT).latestRoundData();

        // Suppose series expiry is set exactly to the observation timestamp latestUpdated
        uint256 expiry = latestUpdated;

        // 1. Verify candidate latestRound is accepted as the exact pre-expiry fixing
        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(expiry, latestRound);
        assertEq(fixing.roundId, latestRound);
        assertEq(fixing.price, uint256(latestPrice));
        assertEq(fixing.updatedAt, latestUpdated);
        assertEq(fixing.decimals, 8);

        // 2. Proving uniqueness: caller attempting to submit predecessor round (latestRound - 1)
        // must revert because latestRound also exists at or before expiry
        uint80 predecessorRound = latestRound - 1;
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        adapter.verifyFixingRound(expiry, predecessorRound);

        // 3. Proving pre-expiry constraint: if expiry was 1 second before the observation,
        // candidate round must revert PostExpiryRound
        vm.expectRevert(ISettlementAdapter.PostExpiryRound.selector);
        adapter.verifyFixingRound(latestUpdated - 1, latestRound);

        // 4. Automatic discovery via getFixingRound discovers the exact latestRound
        ISettlementAdapter.FixingData memory discovered = adapter.getFixingRound(expiry);
        assertEq(discovered.roundId, latestRound);
        assertEq(discovered.price, uint256(latestPrice));
    }

    function test_Fork_LiveSeriesSettlement() public {
        (uint80 latestRound, int256 latestPrice,, uint256 latestUpdated,) =
            AggregatorV3Interface(FEED_MSFT).latestRoundData();

        uint256 floorPrice = 450e8; // $450
        uint256 capPrice = 550e8; // $550

        // Create series with expiry in the future relative to block.timestamp
        uint256 expiry = block.timestamp + 3600;
        factory.setApprovedExpiry(MSFTc, expiry, true);
        factory.setApprovedAdapter(MSFTc, address(adapter), true);

        address seriesAddr = factory.createSeries(MSFTc, floorPrice, capPrice, expiry, address(adapter));
        RiskSplitSeries series = RiskSplitSeries(seriesAddr);

        // Warp past series expiry
        vm.warp(expiry + 10);

        // Settle series with verified fixing round
        adapter.settleSeries(seriesAddr, latestRound);

        assertTrue(series.isSettled(), "Series must be settled");
        assertEq(series.settledPrice(), uint256(latestPrice), "Settled price must match live feed");
        assertEq(series.settledRoundId(), latestRound, "Settled roundId must match live feed");
        assertEq(series.settledTimestamp(), latestUpdated, "Settled timestamp must match live feed");
    }
}
