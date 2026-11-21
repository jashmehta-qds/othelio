// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISeriesFactory} from "./interfaces/ISeriesFactory.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {RiskSplitSeries} from "./RiskSplitSeries.sol";
import {ClaimToken} from "./ClaimToken.sol";
import {ISettlementAdapter, AggregatorV3Interface} from "./interfaces/ISettlementAdapter.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract SeriesFactory is ISeriesFactory {
    using Clones for address;

    uint256 private constant MAX_PRICE = type(uint256).max / 1e18;
    address private immutable _claimTokenImplementation;
    address public override owner;
    address public override pendingOwner;

    address[] public override allSeries;
    mapping(address => bool) public override isSeries;
    mapping(bytes32 => address) public override seriesByTermKey;
    mapping(address => mapping(uint256 => bool)) public override approvedExpiry;

    mapping(address => mapping(address => bool)) public override approvedAdapter;

    function setApprovedAdapter(address underlying, address adapter, bool approved) external override onlyOwner {
        if (underlying == address(0) || adapter == address(0)) revert ZeroAddress();
        if (approved && adapter.code.length == 0) revert InvalidAdapter();
        approvedAdapter[underlying][adapter] = approved;
        emit AdapterApprovalUpdated(underlying, adapter, approved);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        _claimTokenImplementation = address(new ClaimToken("", "", address(this), 0));
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
    ) external override onlyOwner returns (address seriesAddress) {
        if (underlying == address(0) || settlementAdapter == address(0)) revert ZeroAddress();
        if (floorPrice == 0 || floorPrice >= capPrice || capPrice > MAX_PRICE) revert InvalidPriceRange();
        if (expiry <= block.timestamp) revert ExpiryInPast();
        if (!approvedExpiry[underlying][expiry]) revert UnapprovedExpiry();
        if (!approvedAdapter[underlying][settlementAdapter]) revert InvalidAdapter();

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

        ClaimToken protectedToken = ClaimToken(_claimTokenImplementation.clone());
        protectedToken.initialize("RiskSplit Protected Claim", "PROT", address(series), underlyingDecimals);

        ClaimToken upsideToken = ClaimToken(_claimTokenImplementation.clone());
        upsideToken.initialize("RiskSplit Upside Claim", "UP", address(series), underlyingDecimals);

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
