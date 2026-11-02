// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISeriesFactory
/// @notice Interface for deploying and tracking RiskSplitSeries vaults.
interface ISeriesFactory {
    event SeriesCreated(
        address indexed seriesAddress,
        address indexed underlying,
        uint256 floorPrice,
        uint256 capPrice,
        uint256 expiry
    );

    error InvalidPriceRange();
    error ExpiryInPast();
    error ZeroAddress();
    error SeriesAlreadyExists();

    /// @notice Creates a new series vault deterministically
    /// @param underlying Address of the underlying stock token
    /// @param floorPrice Protected floor price in feed decimals
    /// @param capPrice Protected cap price in feed decimals (floorPrice <= capPrice)
    /// @param expiry Expiry timestamp in seconds
    /// @param settlementAdapter Address of the designated settlement adapter
    /// @return series Address of the newly created series
    function createSeries(
        address underlying,
        uint256 floorPrice,
        uint256 capPrice,
        uint256 expiry,
        address settlementAdapter
    ) external returns (address series);

    /// @notice Returns the total number of series deployed
    function allSeriesLength() external view returns (uint256);

    /// @notice Returns the series address at `index`
    function allSeries(uint256 index) external view returns (address);

    /// @notice Returns whether an address is a series deployed by this factory
    function isSeries(address series) external view returns (bool);
}
