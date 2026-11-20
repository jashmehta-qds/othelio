// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IUpsideFixingAdapter {
    struct FixingData {
        uint80 roundId;
        uint256 price;
        uint256 updatedAt;
        address feed;
        uint8 decimals;
    }

    error ZeroAddress();
    error InvalidParameters();
    error InvalidDecimals();
    error StalePrice();
    error RoundNotComplete();
    error ZeroPrice();
    error MismatchedAdapter();
    error NegativePrice();
    error PostExpiryRound();
    error NotLastPreExpiryRound();
    error ExpiryNotReached();
    error AlreadySettled();
    error MismatchedFeed();

    event SeriesSettled(address indexed series, uint80 indexed roundId, uint256 price, uint256 updatedAt);

    event EmergencySettled(address indexed series, uint256 price, address indexed caller);

    function emergencySettle(address series, uint256 price) external;

    function priceFeed() external view returns (AggregatorV3Interface);
    function maxStaleness() external view returns (uint256);
    function decimals() external view returns (uint8);

    function getSettlementPrice() external view returns (uint256 price, uint256 updatedAt);
    function verifyFixingRound(uint256 expiry, uint80 roundId) external view returns (FixingData memory fixing);
    function getFixingRound(uint256 expiry) external view returns (FixingData memory fixing);
    function settleSeries(address series, uint80 roundId) external returns (uint256 price, uint256 updatedAt);
    function settleSeries(address series) external returns (uint256 price, uint256 updatedAt);
}
