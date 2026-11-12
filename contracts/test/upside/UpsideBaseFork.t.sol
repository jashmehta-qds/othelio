// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UpsideFixingAdapter} from "../../src/upside/UpsideFixingAdapter.sol";
import {IUpsideFixingAdapter, AggregatorV3Interface} from "../../src/upside/interfaces/IUpsideFixingAdapter.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideFactory} from "../../src/upside/UpsideFactory.sol";
import {IUpsideFactory} from "../../src/upside/interfaces/IUpsideFactory.sol";
import {TokenizedAssetConstants} from "../../src/constants/TokenizedAssetConstants.sol";
import {MockAssetRegistry} from "./UpsidePayoff.t.sol";

contract UpsideBaseForkTest is Test {
    uint256 public constant BASE_FORK_BLOCK = 53_400_000;
    address public constant FEED_MSFT = TokenizedAssetConstants.FEED_MSFT; // 0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c
    address public constant MSFTc = TokenizedAssetConstants.MSFTc; // 0xB200000000000000000000Ab99cFa739E253872B

    UpsideFixingAdapter internal adapter;
    UpsideFactory internal factory;
    MockAssetRegistry internal registry;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        registry = new MockAssetRegistry();
        registry.setAsset(8453, MSFTc, true, FEED_MSFT, 8, 8);

        adapter = new UpsideFixingAdapter(FEED_MSFT, 7 days);
        factory = new UpsideFactory(address(registry));
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

        emit log_named_uint("Live MSFT Feed Latest Round", latestRound);
        emit log_named_int("Live MSFT Feed Latest Price ($E8)", latestPrice);
        emit log_named_uint("Live MSFT Feed Latest UpdatedAt", latestUpdated);
    }

    function test_Fork_LiveFixingVerificationAndProof() public {
        (uint80 latestRound, int256 latestPrice,, uint256 latestUpdated,) =
            AggregatorV3Interface(FEED_MSFT).latestRoundData();

        uint256 expiry = latestUpdated;

        // 1. Candidate latestRound is verified
        IUpsideFixingAdapter.FixingData memory fixing = adapter.verifyFixingRound(expiry, latestRound);
        assertEq(fixing.roundId, latestRound);
        assertEq(fixing.price, uint256(latestPrice));
        assertEq(fixing.updatedAt, latestUpdated);
        assertEq(fixing.decimals, 8);

        // 2. Predecessor round fails uniqueness check
        uint80 predecessorRound = latestRound - 1;
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        adapter.verifyFixingRound(expiry, predecessorRound);

        // 3. Post-expiry observation fails
        vm.expectRevert(IUpsideFixingAdapter.PostExpiryRound.selector);
        adapter.verifyFixingRound(latestUpdated - 1, latestRound);

        // 4. Discovery via getFixingRound
        IUpsideFixingAdapter.FixingData memory discovered = adapter.getFixingRound(expiry);
        assertEq(discovered.roundId, latestRound);
        assertEq(discovered.price, uint256(latestPrice));
    }

    function test_Fork_LiveSeriesSettlement() public {
        (uint80 latestRound, int256 latestPrice,, uint256 latestUpdated,) =
            AggregatorV3Interface(FEED_MSFT).latestRoundData();

        uint256 expiry = block.timestamp + 3600;
        uint256 strikePrice = 450e8;

        IUpsideFactory.RoundConfig memory cfg = IUpsideFactory.RoundConfig({
            underlying: MSFTc,
            feed: FEED_MSFT,
            adapter: address(adapter),
            referenceRoundId: latestRound,
            referencePrice: uint256(latestPrice),
            referenceTime: latestUpdated,
            roundStart: block.timestamp,
            expiryTimestamp: expiry,
            expectedMove: 20e8,
            provenanceHash: keccak256("fork-round-1"),
            strikeTick: 1e8,
            minStrike: 400e8,
            maxStrike: 600e8,
            publicCreationEnabled: false
        });

        uint256 roundId = factory.registerRound(cfg);
        address seriesAddr = factory.createMarket(roundId, strikePrice);
        UpsideSeries series = UpsideSeries(seriesAddr);

        // Warp past expiry
        vm.warp(expiry + 10);

        adapter.settleSeries(seriesAddr, latestRound);

        assertTrue(series.isSettled(), "Series must be settled");
        assertEq(series.settledPrice(), uint256(latestPrice), "Settled price must match feed");
        assertEq(series.settledRoundId(), latestRound, "Settled roundId must match feed");
        assertEq(series.settledTimestamp(), latestUpdated, "Settled timestamp must match feed");
    }
}
