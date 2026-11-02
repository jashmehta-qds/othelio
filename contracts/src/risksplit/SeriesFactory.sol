// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISeriesFactory} from "./interfaces/ISeriesFactory.sol";
import {RiskSplitSeries} from "./RiskSplitSeries.sol";
import {ClaimToken} from "./ClaimToken.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract SeriesFactory is ISeriesFactory {
    address[] public override allSeries;
    mapping(address => bool) public override isSeries;

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
        if (underlying == address(0) || settlementAdapter == address(0)) revert ZeroAddress();
        if (floorPrice > capPrice || capPrice == 0) revert InvalidPriceRange();
        if (expiry <= block.timestamp) revert ExpiryInPast();

        RiskSplitSeries series = new RiskSplitSeries(
            underlying,
            settlementAdapter,
            floorPrice,
            capPrice,
            expiry
        );
        uint8 underlyingDecimals = IERC20Metadata(underlying).decimals();

        ClaimToken protectedToken = new ClaimToken(
            "RiskSplit Protected Claim",
            "PROT",
            address(series),
            underlyingDecimals
        );

        ClaimToken upsideToken = new ClaimToken(
            "RiskSplit Upside Claim",
            "UP",
            address(series),
            underlyingDecimals
        );

        series.initializeTokens(address(protectedToken), address(upsideToken));

        seriesAddress = address(series);
        allSeries.push(seriesAddress);
        isSeries[seriesAddress] = true;

        emit SeriesCreated(
            seriesAddress,
            underlying,
            floorPrice,
            capPrice,
            expiry
        );
    }
}
