// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UpsideFixingAdapter} from "../../src/upside/UpsideFixingAdapter.sol";
import {IUpsideFixingAdapter, AggregatorV3Interface} from "../../src/upside/interfaces/IUpsideFixingAdapter.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {IUpsideSeries} from "../../src/upside/interfaces/IUpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {MockUnderlyingToken, MockAssetRegistry} from "./UpsidePayoff.t.sol";

contract MultiRoundMockOracle is AggregatorV3Interface {
    uint8 public override decimals = 8;
    string public override description = "MultiRound Mock Feed";
    uint256 public override version = 1;

    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    mapping(uint80 => Round) public rounds;
    uint80 public latestRound;

    constructor(uint80 initialRoundId, int256 initialPrice, uint256 initialTimestamp) {
        setRound(initialRoundId, initialPrice, initialTimestamp, initialTimestamp, initialRoundId);
    }

    function setRound(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
        public
    {
        rounds[roundId] =
            Round({answer: answer, startedAt: startedAt, updatedAt: updatedAt, answeredInRound: answeredInRound});
        if (roundId > latestRound) {
            latestRound = roundId;
        }
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = rounds[_roundId];
        if (r.updatedAt == 0 && r.answer == 0) {
            revert("No round data");
        }
        return (_roundId, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        Round memory r = rounds[latestRound];
        return (latestRound, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }
}

contract UpsideFixingTest is Test {
    MultiRoundMockOracle internal oracle;
    UpsideFixingAdapter internal adapter;
    MockUnderlyingToken internal stock;
    MockAssetRegistry internal registry;
    UpsideSeries internal series;

    uint256 internal constant STRIKE = 200e8;
    uint256 internal constant MAX_STALENESS = 3600; // 1 hour
    uint256 internal expiry;

    function setUp() public {
        stock = new MockUnderlyingToken("Stock", "STK", 18);
        registry = new MockAssetRegistry();

        // Phase 1 round 10 at t=1000
        oracle = new MultiRoundMockOracle(10, 200e8, 1000);
        adapter = new UpsideFixingAdapter(address(oracle), MAX_STALENESS);

        registry.setAsset(block.chainid, address(stock), true, address(oracle), 18, 8);

        expiry = 2000;
        vm.warp(1000);

        series = new UpsideSeries(
            address(this),
            address(registry),
            address(stock),
            address(adapter),
            STRIKE,
            expiry,
            address(oracle),
            10,
            200e8,
            1
        );

        UpsideClaimToken up = new UpsideClaimToken("Upside", "UP", address(series), 18);
        UpsideClaimToken res = new UpsideClaimToken("Residual", "RES", address(series), 18);
        series.initializeTokens(address(up), address(res));
    }

    function test_Fixing_ExactlyExpiryReverts() public {
        vm.warp(expiry);
        vm.expectRevert(IUpsideFixingAdapter.ExpiryNotReached.selector);
        adapter.settleSeries(address(series), 10);
        vm.expectRevert(IUpsideFixingAdapter.ExpiryNotReached.selector);
        adapter.settleSeries(address(series));
        vm.prank(address(adapter));
        vm.expectRevert(IUpsideSeries.ExpiryNotReached.selector);
        series.settleWithFixing(200e8, 10, expiry);
    }

    function test_Fixing_PreExpiryCallReverts() public {
        vm.warp(expiry - 1);
        vm.expectRevert(IUpsideFixingAdapter.ExpiryNotReached.selector);
        adapter.settleSeries(address(series), 10);
    }

    function test_Fixing_DelayedCallProducesIdenticalPreExpiryFixing() public {
        // Pre-expiry observations:
        // Round 11: $210 at t=1500
        // Round 12: $215 at t=1950 (last pre-expiry round)
        oracle.setRound(11, 210e8, 1500, 1500, 11);
        oracle.setRound(12, 215e8, 1950, 1950, 12);

        // Post-expiry observations:
        // Round 13: $220 at t=2100
        // Round 14: $225 at t=2500
        oracle.setRound(13, 220e8, 2100, 2100, 13);
        oracle.setRound(14, 225e8, 2500, 2500, 14);

        // Delayed call at t=4000
        vm.warp(4000);

        (uint256 price, uint256 updated) = adapter.settleSeries(address(series));
        assertEq(price, 215e8, "Must settle with pre-expiry round 12");
        assertEq(updated, 1950, "Must have timestamp of pre-expiry round 12");
        assertEq(series.settledRoundId(), 12);
        assertTrue(series.isSettled());
    }

    function test_Fixing_CallerCannotSubstituteOlderRound() public {
        oracle.setRound(11, 210e8, 1500, 1500, 11);
        oracle.setRound(12, 215e8, 1950, 1950, 12);

        vm.warp(expiry + 10);

        // Trying to settle with older round 11 when 12 exists pre-expiry must revert
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        adapter.settleSeries(address(series), 11);
    }

    function test_Fixing_CallerCannotSubstitutePostExpiryRound() public {
        oracle.setRound(11, 210e8, 1500, 1500, 11);
        oracle.setRound(12, 220e8, 2050, 2050, 12); // post-expiry

        vm.warp(expiry + 10);

        vm.expectRevert(IUpsideFixingAdapter.PostExpiryRound.selector);
        adapter.settleSeries(address(series), 12);
    }

    function test_Fixing_StaleObservationReverts() public {
        // Only round 10 exists at t=1000. Expiry is t=5000 (delta = 4000 > maxStaleness 3600)
        UpsideSeries sStale = new UpsideSeries(
            address(this),
            address(registry),
            address(stock),
            address(adapter),
            STRIKE,
            5000,
            address(oracle),
            10,
            200e8,
            2
        );
        UpsideClaimToken up = new UpsideClaimToken("UP", "UP", address(sStale), 18);
        UpsideClaimToken res = new UpsideClaimToken("RES", "RES", address(sStale), 18);
        sStale.initializeTokens(address(up), address(res));

        vm.warp(5010);
        vm.expectRevert(IUpsideFixingAdapter.StalePrice.selector);
        adapter.settleSeries(address(sStale), 10);
    }

    function test_Fixing_IncompleteAndNegativeRoundsRevert() public {
        // Round with answer <= 0
        oracle.setRound(11, 0, 1500, 1500, 11);
        vm.warp(expiry + 1);
        vm.expectRevert(IUpsideFixingAdapter.ZeroPrice.selector);
        adapter.verifyFixingRound(expiry, 11);

        oracle.setRound(12, -100, 1500, 1500, 12);
        vm.expectRevert(IUpsideFixingAdapter.NegativePrice.selector);
        adapter.verifyFixingRound(expiry, 12);

        // Incomplete round: answeredInRound < roundId
        oracle.setRound(13, 210e8, 1500, 1500, 12);
        vm.expectRevert(IUpsideFixingAdapter.RoundNotComplete.selector);
        adapter.verifyFixingRound(expiry, 13);
    }

    function test_Fixing_PhaseTransitionVerification() public {
        // Phase 1 round 10
        oracle.setRound(10, 200e8, 1200, 1200, 10);

        // Phase 2 round 1 occurs before expiry
        uint80 phase2Round1 = (uint80(2) << 64) | 1;
        oracle.setRound(phase2Round1, 205e8, 1800, 1800, phase2Round1);

        vm.warp(expiry + 10);

        // Calling with phase 1 round 10 should detect phase 2 round 1 and revert
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        adapter.settleSeries(address(series), 10);

        // Calling with phase 2 round 1 succeeds
        (uint256 p, uint256 u) = adapter.settleSeries(address(series), phase2Round1);
        assertEq(p, 205e8);
        assertEq(u, 1800);
    }

    function test_Fixing_DuplicateSettlementRejected() public {
        vm.warp(expiry + 1);
        adapter.settleSeries(address(series), 10);

        vm.expectRevert(IUpsideFixingAdapter.AlreadySettled.selector);
        adapter.settleSeries(address(series), 10);
    }

    function test_Fixing_MismatchedFeedReverts() public {
        MultiRoundMockOracle otherOracle = new MultiRoundMockOracle(1, 100e8, 1000);
        UpsideFixingAdapter otherAdapter = new UpsideFixingAdapter(address(otherOracle), MAX_STALENESS);

        vm.warp(expiry + 1);
        vm.expectRevert(IUpsideFixingAdapter.MismatchedFeed.selector);
        otherAdapter.settleSeries(address(series), 10);
    }
}
