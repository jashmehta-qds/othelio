// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISettlementAdapter, AggregatorV3Interface} from "./interfaces/ISettlementAdapter.sol";
import {IRiskSplitSeries} from "./interfaces/IRiskSplitSeries.sol";

contract SettlementAdapter is ISettlementAdapter {
    AggregatorV3Interface public immutable override priceFeed;
    uint256 public immutable override maxStaleness;
    uint8 public immutable override decimals;

    constructor(address priceFeed_, uint256 maxStaleness_) {
        if (priceFeed_ == address(0)) revert ZeroAddress();
        if (maxStaleness_ == 0) revert InvalidParameters();
        priceFeed = AggregatorV3Interface(priceFeed_);
        maxStaleness = maxStaleness_;
        decimals = AggregatorV3Interface(priceFeed_).decimals();
        if (decimals == 0) revert InvalidDecimals();
    }

    /// @notice Returns the validated current price and timestamp from the feed (spot check)
    function getSettlementPrice() public view override returns (uint256 price, uint256 updatedAt) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 roundUpdatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        if (roundId == 0) revert RoundNotComplete();
        if (answer == 0) revert ZeroPrice();
        if (answer < 0) revert NegativePrice();
        if (roundUpdatedAt == 0 || block.timestamp < roundUpdatedAt) revert StalePrice();
        if (block.timestamp - roundUpdatedAt > maxStaleness) revert StalePrice();
        if (answeredInRound < roundId) revert RoundNotComplete();

        return (uint256(answer), roundUpdatedAt);
    }

    /// @notice Verifies that a specific round is the unique last valid pre-expiry observation
    function verifyFixingRound(uint256 expiry, uint80 roundId) public view override returns (FixingData memory fixing) {
        if (roundId == 0) revert RoundNotComplete();

        (
            uint80 rId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.getRoundData(roundId);

        if (rId == 0) revert RoundNotComplete();
        if (answer == 0) revert ZeroPrice();
        if (answer < 0) revert NegativePrice();
        if (updatedAt == 0 || startedAt > updatedAt) revert StalePrice();
        if (answeredInRound < roundId) revert RoundNotComplete();

        // Observation must be at or before expiry
        if (updatedAt > expiry) revert PostExpiryRound();

        // Observation cannot be staler than maxStaleness relative to expiry
        if (expiry - updatedAt > maxStaleness) revert StalePrice();

        // Prove no later eligible observation exists before or at expiry
        uint16 phaseId = uint16(roundId >> 64);
        uint64 aggRoundId = uint64(roundId);

        bool nextFound = false;

        // 1. Try the next round in the same phase
        uint80 nextInPhase = (uint80(phaseId) << 64) | (aggRoundId + 1);
        try priceFeed.getRoundData(nextInPhase) returns (
            uint80,
            int256,
            uint256,
            uint256 nextUpdated,
            uint80 nextAnswered
        ) {
            if (nextUpdated > 0 && nextAnswered >= nextInPhase) {
                nextFound = true;
                if (nextUpdated <= expiry) revert NotLastPreExpiryRound();
            }
        } catch {}

        // 2. If not found in the same phase, check if a new phase started
        if (!nextFound) {
            uint80 nextPhaseFirst = (uint80(phaseId + 1) << 64) | 1;
            try priceFeed.getRoundData(nextPhaseFirst) returns (
                uint80,
                int256,
                uint256,
                uint256 nextPhaseUpdated,
                uint80 nextPhaseAnswered
            ) {
                if (nextPhaseUpdated > 0 && nextPhaseAnswered >= nextPhaseFirst) {
                    nextFound = true;
                    if (nextPhaseUpdated <= expiry) revert NotLastPreExpiryRound();
                }
            } catch {}
        }

        // 3. If neither next round exists yet, verify candidate is currently the latest round in the feed
        if (!nextFound) {
            (uint80 latestRoundId, , , , ) = priceFeed.latestRoundData();
            if (latestRoundId != roundId) revert NotLastPreExpiryRound();
        }

        return FixingData({
            roundId: roundId,
            price: uint256(answer),
            updatedAt: updatedAt,
            feed: address(priceFeed),
            decimals: decimals
        });
    }

    /// @notice Discovers the unique last pre-expiry round from the feed
    function getFixingRound(uint256 expiry) public view override returns (FixingData memory fixing) {
        (
            uint80 currentRoundId,
            ,
            ,
            uint256 currentUpdatedAt,

        ) = priceFeed.latestRoundData();

        if (currentRoundId == 0) revert RoundNotComplete();

        // If the latest round is already at or before expiry, verify it directly
        if (currentUpdatedAt <= expiry) {
            return verifyFixingRound(expiry, currentRoundId);
        }

        // Otherwise walk backwards from currentRoundId to find the last pre-expiry round
        uint16 phaseId = uint16(currentRoundId >> 64);
        uint64 aggRoundId = uint64(currentRoundId);

        for (uint256 i = 0; i < 100; i++) {
            if (aggRoundId == 0) {
                // Check if previous phase exists
                if (phaseId <= 1) break;
                phaseId--;
                // Walk back from maximum feasible round or 1
                aggRoundId = 1000; // standard search bound
            } else {
                aggRoundId--;
            }

            uint80 candidate = (uint80(phaseId) << 64) | aggRoundId;
            try priceFeed.getRoundData(candidate) returns (
                uint80,
                int256,
                uint256,
                uint256 candidateUpdated,
                uint80 candidateAnswered
            ) {
                if (candidateUpdated > 0 && candidateAnswered >= candidate && candidateUpdated <= expiry) {
                    return verifyFixingRound(expiry, candidate);
                }
            } catch {}
        }

        revert StalePrice();
    }

    /// @notice Settles a series using a nominated, verifiable roundId
    function settleSeries(address series, uint80 roundId) external override {
        IRiskSplitSeries seriesContract = IRiskSplitSeries(series);
        uint256 expiry = seriesContract.expiry();
        if (block.timestamp < expiry) revert ExpiryNotReached();
        if (seriesContract.isSettled()) revert SeriesAlreadySettled();

        FixingData memory fixing = verifyFixingRound(expiry, roundId);

        seriesContract.settleWithFixing(fixing.price, fixing.roundId, fixing.updatedAt);

        emit SettlementTriggered(series, fixing.price, fixing.roundId);
        emit FixingVerified(series, fixing.roundId, fixing.price, fixing.updatedAt);
    }

    /// @notice Settles a series by discovering the unique last pre-expiry round
    function settleSeries(address series) external override {
        IRiskSplitSeries seriesContract = IRiskSplitSeries(series);
        uint256 expiry = seriesContract.expiry();
        if (block.timestamp < expiry) revert ExpiryNotReached();
        if (seriesContract.isSettled()) revert SeriesAlreadySettled();

        FixingData memory fixing = getFixingRound(expiry);

        seriesContract.settleWithFixing(fixing.price, fixing.roundId, fixing.updatedAt);

        emit SettlementTriggered(series, fixing.price, fixing.roundId);
        emit FixingVerified(series, fixing.roundId, fixing.price, fixing.updatedAt);
    }
}
