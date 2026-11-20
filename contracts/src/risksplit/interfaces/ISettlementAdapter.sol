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
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Alias for AggregatorV3Interface
interface IAggregatorV3 is AggregatorV3Interface {}

/// @title ISettlementAdapter
/// @notice Interface for the oracle settlement adapter validating price and settling series.
interface ISettlementAdapter {
    struct FixingData {
        uint80 roundId;
        uint256 price;
        uint256 updatedAt;
        address feed;
        uint8 decimals;
    }

    // Events
    event SettlementTriggered(address indexed series, uint256 price, uint80 roundId);
    event FixingVerified(address indexed series, uint80 indexed roundId, uint256 price, uint256 updatedAt);

    // Custom Errors
    error StalePrice();
    error NegativePrice();
    error ZeroPrice();
    error MismatchedAdapter();
    error ExpiryNotReached();
    error RoundNotComplete();
    error SeriesAlreadySettled();
    error ZeroAddress();
    error InvalidParameters();
    error Unauthorized();
    error PostExpiryRound();
    error NotLastPreExpiryRound();
    error InvalidDecimals();
    error OracleCallFailed();

    event EmergencySettled(address indexed series, uint256 price, address indexed caller);

    function emergencySettle(address series, uint256 price) external;

    /// @notice Returns the Chainlink price feed aggregator
    function priceFeed() external view returns (AggregatorV3Interface);

    /// @notice Decimals of the price feed
    function decimals() external view returns (uint8);

    /// @notice Maximum allowed staleness of the oracle answer relative to expiry in seconds
    function maxStaleness() external view returns (uint256);

    /// @notice Returns the validated current price and timestamp from the feed
    function getSettlementPrice() external view returns (uint256 price, uint256 updatedAt);

    /// @notice Verifies that a specific round is the last valid eligible pre-expiry round
    function verifyFixingRound(uint256 expiry, uint80 roundId) external view returns (FixingData memory fixing);

    /// @notice Discovers the unique last pre-expiry round
    function getFixingRound(uint256 expiry) external view returns (FixingData memory fixing);

    /// @notice Settles a series using a nominated, verifiable roundId
    function settleSeries(address series, uint80 roundId) external;

    /// @notice Settles a series by discovering the unique last pre-expiry round
    function settleSeries(address series) external;
}
