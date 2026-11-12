// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISeriesFactory} from "./interfaces/ISeriesFactory.sol";
import {RiskSplitSeries} from "./RiskSplitSeries.sol";
import {ClaimToken} from "./ClaimToken.sol";
import {ISettlementAdapter, AggregatorV3Interface} from "./interfaces/ISettlementAdapter.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract SeriesFactory is ISeriesFactory {
    address public override owner;
    address public override pendingOwner;
    bool public override publicCreationEnabled;

    address[] public override allSeries;
    mapping(address => bool) public override isSeries;
    mapping(bytes32 => address) public override seriesByTermKey;
    mapping(address => mapping(uint256 => bool)) public override approvedExpiry;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external override {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function setPublicCreationEnabled(bool enabled) external override onlyOwner {
        publicCreationEnabled = enabled;
        emit PublicCreationToggled(enabled);
    }

    function setApprovedExpiry(address underlying, uint256 timestamp, bool approved) external override onlyOwner {
        if (underlying == address(0)) revert ZeroAddress();
        approvedExpiry[underlying][timestamp] = approved;
        emit ExpiryApprovalUpdated(underlying, timestamp, approved);
    }

    function allSeriesLength() external view override returns (uint256) {
        return allSeries.length;
    }

    function createSeries(
        address underlying,
        uint256 floorPrice,
        uint256 capPrice,
        uint256 expiry,
        address settlementAdapter
    ) external override returns (address seriesAddress) {
        if (!publicCreationEnabled && msg.sender != owner) revert Unauthorized();
        if (underlying == address(0) || settlementAdapter == address(0)) revert ZeroAddress();
        if (floorPrice >= capPrice || floorPrice == 0) revert InvalidPriceRange();
        if (expiry <= block.timestamp) revert ExpiryInPast();
        if (!approvedExpiry[underlying][expiry]) revert UnapprovedExpiry();

        bytes32 termKey = keccak256(abi.encode(underlying, floorPrice, capPrice, expiry, settlementAdapter));
        if (seriesByTermKey[termKey] != address(0)) revert DuplicateSeriesTerms();

        uint8 underlyingDecimals = IERC20Metadata(underlying).decimals();
        if (underlyingDecimals == 0 || underlyingDecimals > 18) revert InvalidDecimals();

        address feedAddr = address(ISettlementAdapter(settlementAdapter).priceFeed());
        if (feedAddr == address(0)) revert InvalidAdapter();

        (uint80 refRoundId, int256 refPrice,,, uint80 refAnswered) = AggregatorV3Interface(feedAddr).latestRoundData();

        if (refRoundId == 0 || refPrice <= 0 || refAnswered < refRoundId) revert InvalidAdapter();

        RiskSplitSeries series = new RiskSplitSeries(
            underlying, settlementAdapter, floorPrice, capPrice, expiry, feedAddr, refRoundId, uint256(refPrice)
        );

        ClaimToken protectedToken =
            new ClaimToken("RiskSplit Protected Claim", "PROT", address(series), underlyingDecimals);

        ClaimToken upsideToken = new ClaimToken("RiskSplit Upside Claim", "UP", address(series), underlyingDecimals);

        series.initializeTokens(address(protectedToken), address(upsideToken));

        seriesAddress = address(series);
        allSeries.push(seriesAddress);
        isSeries[seriesAddress] = true;
        seriesByTermKey[termKey] = seriesAddress;

        emit SeriesCreated(
            seriesAddress,
            underlying,
            floorPrice,
            capPrice,
            expiry,
            settlementAdapter,
            feedAddr,
            refRoundId,
            uint256(refPrice),
            block.number,
            address(protectedToken),
            address(upsideToken)
        );
    }
}
