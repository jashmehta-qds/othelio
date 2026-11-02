// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink AggregatorV3Interface
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/// @notice Alias for AggregatorV3Interface
interface IAggregatorV3 is AggregatorV3Interface {}

/// @title ISettlementAdapter
/// @notice Interface for the oracle settlement adapter validating price and settling series.
interface ISettlementAdapter {
    // Events
    event SettlementTriggered(address indexed series, uint256 price, uint80 roundId);

    // Custom Errors
    error StalePrice();
    error NegativePrice();
    error ZeroPrice();
    error ExpiryNotReached();
    error RoundNotComplete();
    error SeriesAlreadySettled();
    error ZeroAddress();
    error InvalidParameters();
    error Unauthorized();

    /// @notice Returns the Chainlink price feed aggregator
    function priceFeed() external view returns (AggregatorV3Interface);

    /// @notice Maximum allowed staleness of the oracle answer in seconds
    function maxStaleness() external view returns (uint256);

    /// @notice Returns the validated current price and timestamp from the feed
    function getSettlementPrice() external view returns (uint256 price, uint256 updatedAt);

    /// @notice Validates oracle conditions and triggers settlement on the given series
    /// @param series Address of the RiskSplitSeries contract to settle
    function settleSeries(address series) external;
}
