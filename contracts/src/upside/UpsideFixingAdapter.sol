// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUpsideFixingAdapter, AggregatorV3Interface} from "./interfaces/IUpsideFixingAdapter.sol";
import {IUpsideSeries} from "./interfaces/IUpsideSeries.sol";

contract UpsideFixingAdapter is IUpsideFixingAdapter {
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

        (uint80 rId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound) =
            priceFeed.getRoundData(roundId);

        if (rId == 0) revert RoundNotComplete();
        if (answer == 0) revert ZeroPrice();
        if (answer < 0) revert NegativePrice();
        if (updatedAt == 0 || startedAt > updatedAt) revert StalePrice();
        if (answeredInRound < roundId) revert RoundNotComplete();

        if (updatedAt > expiry) revert PostExpiryRound();

        if (expiry - updatedAt > maxStaleness) revert StalePrice();

        uint16 phaseId = uint16(roundId >> 64);
        uint64 aggRoundId = uint64(roundId);

        bool nextFound = false;

        uint80 nextInPhase = (uint80(phaseId) << 64) | (aggRoundId + 1);
        try priceFeed.getRoundData(nextInPhase) returns (
            uint80, int256, uint256, uint256 nextUpdated, uint80 nextAnswered
        ) {
            if (nextUpdated > 0 && nextAnswered >= nextInPhase) {
                nextFound = true;
                if (nextUpdated <= expiry) revert NotLastPreExpiryRound();
            }
        } catch {}

        if (!nextFound) {
            uint80 nextPhaseFirst = (uint80(phaseId + 1) << 64) | 1;
            try priceFeed.getRoundData(nextPhaseFirst) returns (
                uint80, int256, uint256, uint256 nextPhaseUpdated, uint80 nextPhaseAnswered
            ) {
                if (nextPhaseUpdated > 0 && nextPhaseAnswered >= nextPhaseFirst) {
                    nextFound = true;
                    if (nextPhaseUpdated <= expiry) revert NotLastPreExpiryRound();
                }
            } catch {}
        }

        if (!nextFound) {
            (uint80 latestRoundId,,,,) = priceFeed.latestRoundData();
            if (latestRoundId != roundId) revert NotLastPreExpiryRound();
        }

        return FixingData({
            roundId: roundId, price: uint256(answer), updatedAt: updatedAt, feed: address(priceFeed), decimals: decimals
        });
    }

    function getFixingRound(uint256 expiry) public view override returns (FixingData memory fixing) {
        (uint80 currentRoundId,,, uint256 currentUpdatedAt,) = priceFeed.latestRoundData();

        if (currentRoundId == 0) revert RoundNotComplete();

        uint80 candidateRoundId = currentRoundId;

        if (currentUpdatedAt > expiry) {
            uint16 phaseId = uint16(currentRoundId >> 64);
            uint64 aggRoundId = uint64(currentRoundId);

            bool found = false;

            for (uint256 i = 0; i < 50; i++) {
                if (aggRoundId == 0) break;
                aggRoundId--;
                uint80 roundToCheck = (uint80(phaseId) << 64) | aggRoundId;

                try priceFeed.getRoundData(roundToCheck) returns (uint80, int256, uint256, uint256 rUpdatedAt, uint80) {
                    if (rUpdatedAt > 0 && rUpdatedAt <= expiry) {
                        candidateRoundId = roundToCheck;
                        found = true;
                        break;
                    }
                } catch {
                    break;
                }
            }

            if (!found && phaseId > 1) {
                uint16 prevPhaseId = phaseId - 1;
                for (uint64 offset = 100; offset > 0; offset--) {
                    uint80 roundToCheck = (uint80(prevPhaseId) << 64) | offset;
                    try priceFeed.getRoundData(roundToCheck) returns (
                        uint80, int256, uint256, uint256 rUpdatedAt, uint80
                    ) {
                        if (rUpdatedAt > 0 && rUpdatedAt <= expiry) {
                            candidateRoundId = roundToCheck;
                            found = true;
                            break;
                        }
                    } catch {}
                }
            }
        }

        return verifyFixingRound(expiry, candidateRoundId);
    }

    function settleSeries(address series, uint80 roundId) public override returns (uint256 price, uint256 updatedAt) {
        if (series == address(0)) revert ZeroAddress();
        IUpsideSeries target = IUpsideSeries(series);

        if (target.referenceFeed() != address(priceFeed)) revert MismatchedFeed();

        uint256 expiry = target.expiry();
        if (block.timestamp < expiry) revert ExpiryNotReached();
        if (target.isSettled()) revert AlreadySettled();

        FixingData memory fixing = verifyFixingRound(expiry, roundId);

        target.settleWithFixing(fixing.price, fixing.roundId, fixing.updatedAt);

        emit SeriesSettled(series, roundId, fixing.price, fixing.updatedAt);
        return (fixing.price, fixing.updatedAt);
    }

    function settleSeries(address series) external override returns (uint256 price, uint256 updatedAt) {
        if (series == address(0)) revert ZeroAddress();
        uint256 expiry = IUpsideSeries(series).expiry();
        FixingData memory fixing = getFixingRound(expiry);
        return settleSeries(series, fixing.roundId);
    }
}
