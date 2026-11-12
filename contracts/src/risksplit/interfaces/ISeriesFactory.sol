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
        uint256 expiry,
        address settlementAdapter,
        address referenceFeed,
        uint80 referenceRoundId,
        uint256 referencePrice,
        uint256 referenceBlock,
        address protectedToken,
        address upsideToken
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PublicCreationToggled(bool enabled);
    event ExpiryApprovalUpdated(address indexed underlying, uint256 indexed timestamp, bool approved);

    error InvalidPriceRange();
    error ExpiryInPast();
    error ZeroAddress();
    error Unauthorized();
    error UnapprovedExpiry();
    error DuplicateSeriesTerms();
    error InvalidDecimals();
    error InvalidAdapter();
    error SeriesAlreadyExists();

    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function publicCreationEnabled() external view returns (bool);
    function approvedExpiry(address underlying, uint256 timestamp) external view returns (bool);
    function seriesByTermKey(bytes32 termKey) external view returns (address);

    function transferOwnership(address newOwner) external;
    function acceptOwnership() external;
    function setPublicCreationEnabled(bool enabled) external;
    function setApprovedExpiry(address underlying, uint256 timestamp, bool approved) external;

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
