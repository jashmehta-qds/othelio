// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUpsideFactory} from "./interfaces/IUpsideFactory.sol";
import {IOthelioAssetRegistry} from "./interfaces/IOthelioAssetRegistry.sol";
import {UpsideSeries} from "./UpsideSeries.sol";
import {UpsideClaimToken} from "./UpsideClaimToken.sol";

contract UpsideFactory is IUpsideFactory, Ownable2Step {
    address public immutable override assetRegistry;

    uint256 public override totalRounds;
    mapping(uint256 => RoundConfig) private _rounds;
    mapping(uint256 => mapping(uint256 => address)) public override marketByRoundAndStrike;
    address[] public allMarkets;
    mapping(address => bool) public override isMarket;
    mapping(uint256 => address[]) private _marketsByRound;

    constructor(address assetRegistry_) Ownable(msg.sender) {
        if (assetRegistry_ == address(0)) revert ZeroAddress();
        assetRegistry = assetRegistry_;
    }

    function getRound(uint256 roundId) external view override returns (RoundConfig memory) {
        if (roundId == 0 || roundId > totalRounds) revert RoundNotFound();
        return _rounds[roundId];
    }

    function allMarketsLength() external view override returns (uint256) {
        return allMarkets.length;
    }

    function getMarketsForRound(uint256 roundId) external view override returns (address[] memory) {
        return _marketsByRound[roundId];
    }

    function registerRound(RoundConfig calldata config) external override onlyOwner returns (uint256 roundId) {
        if (config.underlying == address(0) || config.adapter == address(0) || config.feed == address(0)) {
            revert ZeroAddress();
        }

        IOthelioAssetRegistry.Asset memory asset =
            IOthelioAssetRegistry(assetRegistry).getAsset(block.chainid, config.underlying);
        if (!asset.supported) revert AssetNotSupported();
        if (asset.priceFeed != config.feed) revert MismatchedFeed();
        if (asset.tokenDecimals > 18) revert UnsupportedDecimals(asset.tokenDecimals);

        if (config.strikeTick == 0) revert InvalidParameters();
        if (config.minStrike == 0 || config.minStrike > config.maxStrike) revert InvalidParameters();
        if (config.minStrike % config.strikeTick != 0 || config.maxStrike % config.strikeTick != 0) {
            revert InvalidParameters();
        }
        if (config.expiryTimestamp <= block.timestamp) revert RoundExpired();
        if (config.roundStart >= config.expiryTimestamp) revert InvalidParameters();
        if (config.referencePrice == 0) revert InvalidParameters();

        roundId = ++totalRounds;
        _rounds[roundId] = config;

        emit RoundRegistered(roundId, config.underlying, config.feed, config);
    }

    function setPublicCreationEnabled(uint256 roundId, bool enabled) external override onlyOwner {
        if (roundId == 0 || roundId > totalRounds) revert RoundNotFound();
        _rounds[roundId].publicCreationEnabled = enabled;
        emit PublicCreationToggled(roundId, enabled);
    }

    function createMarket(uint256 roundId, uint256 strikePrice) external override returns (address seriesAddress) {
        _validateMarket(roundId, strikePrice);

        RoundConfig memory round = _rounds[roundId];

        UpsideSeries series = new UpsideSeries(
            address(this),
            assetRegistry,
            round.underlying,
            round.adapter,
            strikePrice,
            round.expiryTimestamp,
            round.feed,
            round.referenceRoundId,
            round.referencePrice,
            roundId
        );

        uint8 decimals = IERC20Metadata(round.underlying).decimals();
        string memory symbol = IERC20Metadata(round.underlying).symbol();

        UpsideClaimToken up = new UpsideClaimToken(
            string.concat("Upside Claim ", symbol),
            "UP",
            address(series),
            decimals
        );
        UpsideClaimToken res = new UpsideClaimToken(
            string.concat("Residual Claim ", symbol),
            "RES",
            address(series),
            decimals
        );
        series.initializeTokens(address(up), address(res));

        seriesAddress = address(series);
        marketByRoundAndStrike[roundId][strikePrice] = seriesAddress;
        allMarkets.push(seriesAddress);
        isMarket[seriesAddress] = true;
        _marketsByRound[roundId].push(seriesAddress);

        emit MarketCreated(roundId, strikePrice, seriesAddress, address(up), address(res), msg.sender);
    }

    function _validateMarket(uint256 roundId, uint256 strikePrice) internal view {
        if (roundId == 0 || roundId > totalRounds) revert RoundNotFound();
        RoundConfig memory round = _rounds[roundId];

        if (!round.publicCreationEnabled && msg.sender != owner()) revert Unauthorized();
        if (block.timestamp >= round.expiryTimestamp) revert RoundExpired();

        if (!IOthelioAssetRegistry(assetRegistry).isSupported(block.chainid, round.underlying)) {
            revert AssetNotSupported();
        }

        if (strikePrice < round.minStrike || strikePrice > round.maxStrike) revert StrikeOutOfBounds();
        if (strikePrice % round.strikeTick != 0) revert OffStrikeGrid();

        if (marketByRoundAndStrike[roundId][strikePrice] != address(0)) revert DuplicateMarket();
    }
}
