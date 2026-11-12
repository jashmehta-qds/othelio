// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IUpsideFactory {
    struct RoundConfig {
        address underlying;
        address feed;
        address adapter;
        uint80 referenceRoundId;
        uint256 referencePrice;
        uint256 referenceTime;
        uint256 roundStart;
        uint256 expiryTimestamp;
        uint256 expectedMove;
        bytes32 provenanceHash;
        uint256 strikeTick;
        uint256 minStrike;
        uint256 maxStrike;
        bool publicCreationEnabled;
    }

    error Unauthorized();
    error ZeroAddress();
    error InvalidParameters();
    error AssetNotSupported();
    error MismatchedFeed();
    error UnsupportedDecimals(uint8 decimals);
    error RoundNotFound();
    error RoundExpired();
    error StrikeOutOfBounds();
    error OffStrikeGrid();
    error DuplicateMarket();

    event RoundRegistered(
        uint256 indexed roundId,
        address indexed underlying,
        address indexed feed,
        RoundConfig config
    );
    event PublicCreationToggled(uint256 indexed roundId, bool enabled);
    event MarketCreated(
        uint256 indexed roundId,
        uint256 indexed strikePrice,
        address indexed seriesAddress,
        address upsideToken,
        address residualToken,
        address creator
    );

    function assetRegistry() external view returns (address);
    function totalRounds() external view returns (uint256);
    function getRound(uint256 roundId) external view returns (RoundConfig memory);
    function marketByRoundAndStrike(uint256 roundId, uint256 strikePrice) external view returns (address);
    function allMarketsLength() external view returns (uint256);
    function getMarketsForRound(uint256 roundId) external view returns (address[] memory);
    function isMarket(address series) external view returns (bool);

    function registerRound(RoundConfig calldata config) external returns (uint256 roundId);
    function setPublicCreationEnabled(uint256 roundId, bool enabled) external;
    function createMarket(uint256 roundId, uint256 strikePrice) external returns (address seriesAddress);
}
