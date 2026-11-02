// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISettlementAdapter, AggregatorV3Interface} from "./interfaces/ISettlementAdapter.sol";
import {IRiskSplitSeries} from "./interfaces/IRiskSplitSeries.sol";

contract SettlementAdapter is ISettlementAdapter {
    AggregatorV3Interface public immutable override priceFeed;
    uint256 public immutable override maxStaleness;

    constructor(address priceFeed_, uint256 maxStaleness_) {
        if (priceFeed_ == address(0)) revert ZeroAddress();
        if (maxStaleness_ == 0) revert InvalidParameters();
        priceFeed = AggregatorV3Interface(priceFeed_);
        maxStaleness = maxStaleness_;
    }

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

    function settleSeries(address series) external override {
        IRiskSplitSeries seriesContract = IRiskSplitSeries(series);
        if (block.timestamp < seriesContract.expiry()) revert ExpiryNotReached();
        if (seriesContract.isSettled()) revert SeriesAlreadySettled();

        (uint256 price, ) = getSettlementPrice();

        (uint80 roundId, , , , ) = priceFeed.latestRoundData();

        seriesContract.settle(price);

        emit SettlementTriggered(series, price, roundId);
    }
}
