// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISettlementAdapter, AggregatorV3Interface} from "./interfaces/ISettlementAdapter.sol";
import {IRiskSplitSeries} from "./interfaces/IRiskSplitSeries.sol";

contract SettlementAdapter is ISettlementAdapter {
    uint256 public constant MAX_SUCCESSOR_SCAN = 20;

    struct RoundObservation {
        uint80 returnedId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
        bool valid;
    }

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
        (uint80 roundId, int256 answer,, uint256 roundUpdatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();

        if (roundId == 0) revert RoundNotComplete();
        if (answer == 0) revert ZeroPrice();
        if (answer < 0) revert NegativePrice();
        if (roundUpdatedAt == 0 || block.timestamp < roundUpdatedAt) revert StalePrice();
        if (block.timestamp - roundUpdatedAt > maxStaleness) revert StalePrice();
        if (answeredInRound < roundId) revert RoundNotComplete();

        return (uint256(answer), roundUpdatedAt);
    }

    function verifyFixingRound(uint256 expiry, uint80 roundId) public view override returns (FixingData memory fixing) {
        if (roundId == 0) revert RoundNotComplete();

        RoundObservation memory candidate = _readRound(roundId);
        _requireValidCandidate(candidate, roundId);

        if (candidate.updatedAt > expiry) revert PostExpiryRound();

        if (expiry - candidate.updatedAt > maxStaleness) revert StalePrice();

        uint16 phaseId = uint16(roundId >> 64);
        uint64 aggRoundId = uint64(roundId);
        RoundObservation memory successor = _findFirstValidSuccessor(phaseId, aggRoundId);
        if (successor.valid && successor.updatedAt <= expiry) revert NotLastPreExpiryRound();

        if (!successor.valid) {
            RoundObservation memory latest = _readLatestRound();
            if (latest.returnedId != roundId && !(latest.valid && latest.updatedAt > expiry)) {
                revert NotLastPreExpiryRound();
            }
        }

        return FixingData({
            roundId: roundId,
            price: uint256(candidate.answer),
            updatedAt: candidate.updatedAt,
            feed: address(priceFeed),
            decimals: decimals
        });
    }

    function getFixingRound(uint256 expiry) public view override returns (FixingData memory fixing) {
        RoundObservation memory latest = _readLatestRound();
        if (latest.returnedId == 0) revert RoundNotComplete();

        uint80 candidateRoundId = latest.returnedId;

        if (!latest.valid || latest.updatedAt > expiry) {
            uint16 phaseId = uint16(candidateRoundId >> 64);
            uint64 aggRoundId = uint64(candidateRoundId);

            bool found = false;

            for (uint256 i = 0; i < 100; i++) {
                if (aggRoundId == 0) {
                    if (phaseId <= 1) break;
                    phaseId--;
                    aggRoundId = 1000;
                } else {
                    aggRoundId--;
                }
                uint80 roundToCheck = (uint80(phaseId) << 64) | aggRoundId;

                RoundObservation memory candidate = _readRound(roundToCheck);
                if (candidate.valid && candidate.updatedAt <= expiry) {
                    candidateRoundId = roundToCheck;
                    found = true;
                    break;
                }
            }

            if (!found) revert StalePrice();
        }

        return verifyFixingRound(expiry, candidateRoundId);
    }

    function _isValidRound(
        uint80 requestedId,
        uint80 returnedId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) private pure returns (bool) {
        return returnedId == requestedId && answer > 0 && updatedAt > 0 && startedAt <= updatedAt
            && answeredInRound >= requestedId;
    }

    function _readRound(uint80 roundId) private view returns (RoundObservation memory observation) {
        try priceFeed.getRoundData(roundId) returns (
            uint80 returnedId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            observation = RoundObservation({
                returnedId: returnedId,
                answer: answer,
                startedAt: startedAt,
                updatedAt: updatedAt,
                answeredInRound: answeredInRound,
                valid: _isValidRound(roundId, returnedId, answer, startedAt, updatedAt, answeredInRound)
            });
        } catch {}
    }

    function _readLatestRound() private view returns (RoundObservation memory observation) {
        try priceFeed.latestRoundData() returns (
            uint80 returnedId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            observation = RoundObservation({
                returnedId: returnedId,
                answer: answer,
                startedAt: startedAt,
                updatedAt: updatedAt,
                answeredInRound: answeredInRound,
                valid: _isValidRound(returnedId, returnedId, answer, startedAt, updatedAt, answeredInRound)
            });
        } catch {}
    }

    function _requireValidCandidate(RoundObservation memory candidate, uint80 roundId) private pure {
        if (candidate.valid) return;
        if (candidate.returnedId != roundId) revert RoundNotComplete();
        if (candidate.answer == 0) revert ZeroPrice();
        if (candidate.answer < 0) revert NegativePrice();
        if (candidate.updatedAt == 0 || candidate.startedAt > candidate.updatedAt) revert StalePrice();
        if (candidate.answeredInRound < roundId) revert RoundNotComplete();
    }

    function _findFirstValidSuccessor(uint16 phaseId, uint64 aggRoundId)
        private
        view
        returns (RoundObservation memory successor)
    {
        for (uint256 offset = 1; offset <= MAX_SUCCESSOR_SCAN; offset++) {
            if (uint256(aggRoundId) + offset > type(uint64).max) break;
            uint80 successorId = (uint80(phaseId) << 64) | uint64(uint256(aggRoundId) + offset);
            successor = _readRound(successorId);
            if (successor.valid) return successor;
        }

        if (phaseId == type(uint16).max) return successor;
        for (uint256 offset = 1; offset <= MAX_SUCCESSOR_SCAN; offset++) {
            uint80 successorId = (uint80(phaseId + 1) << 64) | uint64(offset);
            successor = _readRound(successorId);
            if (successor.valid) return successor;
        }
    }

    /// @notice Settles a series using a nominated, verifiable roundId
    function settleSeries(address series, uint80 roundId) external override {
        IRiskSplitSeries seriesContract = IRiskSplitSeries(series);
        uint256 expiry = seriesContract.expiry();
        if (block.timestamp <= expiry) revert ExpiryNotReached();
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
        if (block.timestamp <= expiry) revert ExpiryNotReached();
        if (seriesContract.isSettled()) revert SeriesAlreadySettled();

        FixingData memory fixing = getFixingRound(expiry);

        seriesContract.settleWithFixing(fixing.price, fixing.roundId, fixing.updatedAt);

        emit SettlementTriggered(series, fixing.price, fixing.roundId);
        emit FixingVerified(series, fixing.roundId, fixing.price, fixing.updatedAt);
    }
}
