// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {ISettlementAdapter, AggregatorV3Interface} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {IRiskSplitSeries} from "../../src/risksplit/interfaces/IRiskSplitSeries.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";
import {MockStockToken} from "./RiskSplitSeriesTest.t.sol";

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

contract RiskSplitFixingTest is Test {
    MultiRoundMockOracle internal oracle;
    SettlementAdapter internal adapter;
    SeriesFactory internal factory;
    RiskSplitSeries internal series;
    MockStockToken internal stock;

    uint256 internal constant FLOOR_PRICE = 45e8;
    uint256 internal constant CAP_PRICE = 55e8;
    uint256 internal constant MAX_STALENESS = 3600; // 1 hour
    uint256 internal expiry;

    function setUp() public {
        stock = new MockStockToken();
        // Start with phase 1, round 10 at timestamp 1000
        oracle = new MultiRoundMockOracle(10, 50e8, 1000);
        adapter = new SettlementAdapter(address(oracle), MAX_STALENESS);
        factory = new SeriesFactory();

        expiry = 2000;
        vm.warp(1000);
        factory.setApprovedExpiry(address(stock), expiry, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);

        address seriesAddr = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        series = RiskSplitSeries(seriesAddr);
    }

    function test_Fixing_ExactlyExpiryReverts() public {
        vm.warp(expiry);
        vm.expectRevert(ISettlementAdapter.ExpiryNotReached.selector);
        adapter.settleSeries(address(series), 10);
        vm.expectRevert(ISettlementAdapter.ExpiryNotReached.selector);
        adapter.settleSeries(address(series));
        vm.startPrank(address(adapter));
        vm.expectRevert(IRiskSplitSeries.ExpiryNotReached.selector);
        series.settleWithFixing(50e8, 10, expiry);
        vm.expectRevert(IRiskSplitSeries.ExpiryNotReached.selector);
        series.settle(50e8);
        vm.stopPrank();
    }

    function test_Fixing_DelayedCallProducesIdenticalPreExpiryFixing() public {
        // Pre-expiry observations:
        // Round 10: $50 at t=1000
        // Round 11: $52 at t=1500
        // Round 12: $51 at t=1950 (last valid pre-expiry round)
        oracle.setRound(11, 52e8, 1500, 1500, 11);
        oracle.setRound(12, 51e8, 1950, 1950, 12);

        // Expiry arrives at t=2000.
        // Post-expiry observations (prices rally after expiry):
        // Round 13: $65 at t=2050
        // Round 14: $75 at t=2500
        // Round 15: $90 at t=5000
        oracle.setRound(13, 65e8, 2050, 2050, 13);
        oracle.setRound(14, 75e8, 2500, 2500, 14);
        oracle.setRound(15, 90e8, 5000, 5000, 15);

        // Settlement is delayed to t=10,000 (days later)
        vm.warp(10000);

        // Discovery via getFixingRound must return round 12 ($51)
        ISettlementAdapter.FixingData memory fixing = adapter.getFixingRound(expiry);
        assertEq(fixing.roundId, 12, "Should discover round 12");
        assertEq(fixing.price, 51e8, "Price must be $51, not delayed $90");
        assertEq(fixing.updatedAt, 1950, "Timestamp must be 1950");

        // Delayed settleSeries without args settles with round 12
        adapter.settleSeries(address(series));

        assertTrue(series.isSettled(), "Series should be settled");
        assertEq(series.settledPrice(), 51e8, "Settled price must be fixing price $51");
        assertEq(series.settledRoundId(), 12, "Settled round ID must be 12");
        assertEq(series.settledTimestamp(), 1950, "Settled timestamp must be 1950");
    }

    function test_Fixing_CallerCannotSubstitutePostExpiryRound() public {
        oracle.setRound(11, 52e8, 1900, 1900, 11);
        oracle.setRound(12, 80e8, 2010, 2010, 12); // after expiry (expiry = 2000)

        vm.warp(3000);

        // Caller attempts to nominate round 12 ($80)
        vm.expectRevert(ISettlementAdapter.PostExpiryRound.selector);
        adapter.settleSeries(address(series), 12);
    }

    function test_Fixing_CallerCannotSubstituteOlderRound() public {
        // Round 10: t=1000
        // Round 11: t=1500 (both before expiry=2000)
        // Round 12: t=2100 (after expiry)
        oracle.setRound(11, 52e8, 1500, 1500, 11);
        oracle.setRound(12, 60e8, 2100, 2100, 12);

        vm.warp(3000);

        // Round 11 is the true last pre-expiry round.
        // Caller tries to pass round 10 to manipulate price.
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        adapter.settleSeries(address(series), 10);

        // Passing round 11 succeeds
        adapter.settleSeries(address(series), 11);
        assertEq(series.settledRoundId(), 11);
    }

    function test_Fixing_StaleObservationReverts() public {
        // Round 10 is at t=500. Expiry = 2000.
        // MAX_STALENESS = 3600? Let's make round 10 older than max staleness:
        // updatedAt = 100, expiry = 5000 -> difference 4900 > 3600
        MultiRoundMockOracle staleOracle = new MultiRoundMockOracle(1, 50e8, 100);
        SettlementAdapter staleAdapter = new SettlementAdapter(address(staleOracle), 3600);

        vm.expectRevert(ISettlementAdapter.StalePrice.selector);
        staleAdapter.verifyFixingRound(5000, 1);
    }

    function test_Fixing_IncompleteAndNegativeRoundsRevert() public {
        // Zero price
        oracle.setRound(20, 0, 1500, 1500, 20);
        vm.expectRevert(ISettlementAdapter.ZeroPrice.selector);
        adapter.verifyFixingRound(expiry, 20);

        // Negative price
        oracle.setRound(21, -10e8, 1500, 1500, 21);
        vm.expectRevert(ISettlementAdapter.NegativePrice.selector);
        adapter.verifyFixingRound(expiry, 21);

        // Incomplete round (answeredInRound < roundId)
        oracle.setRound(22, 50e8, 1500, 1500, 20);
        vm.expectRevert(ISettlementAdapter.RoundNotComplete.selector);
        adapter.verifyFixingRound(expiry, 22);
    }

    function test_Fixing_PhaseTransitionVerification() public {
        // Phase 1 round 100: last round of phase 1 at t=1900
        uint80 phase1LastRound = (uint80(1) << 64) | 100;
        oracle.setRound(phase1LastRound, 48e8, 1900, 1900, phase1LastRound);

        // Phase 2 round 1: first round of phase 2 at t=2050 (post-expiry)
        uint80 phase2FirstRound = (uint80(2) << 64) | 1;
        oracle.setRound(phase2FirstRound, 55e8, 2050, 2050, phase2FirstRound);

        vm.warp(3000);

        // Verify phase 1 round 100 is recognized as the last pre-expiry round
        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(expiry, phase1LastRound);
        assertEq(fixing.roundId, phase1LastRound, "Phase 1 round 100 should be valid fixing");
        assertEq(fixing.price, 48e8);
    }
}
