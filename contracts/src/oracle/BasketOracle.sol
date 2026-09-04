// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OthelioAssetRegistry} from "../registry/OthelioAssetRegistry.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

contract BasketOracle {
    OthelioAssetRegistry public immutable registry;
    uint256 public constant MAX_STALENESS = 24 hours;

    constructor(address registry_) {
        require(registry_ != address(0), "ZERO_REGISTRY");
        registry = OthelioAssetRegistry(registry_);
    }

    /// @notice Calculates the aggregate Net Asset Value (NAV) in USDC (6 decimals)
    /// @param tokens Array of constituent token addresses held by the Safe
    /// @param balances Raw token amounts held by the Safe
    /// @return totalNAV Total basket value normalized to 6 decimals (USDC standard)
    function calculateNAV(
        address[] calldata tokens,
        uint256[] calldata balances
    ) external view returns (uint256 totalNAV) {
        require(tokens.length == balances.length, "LENGTH_MISMATCH");
        uint256 chainId = block.chainid;

        for (uint256 i = 0; i < tokens.length; i++) {
            if (balances[i] == 0) continue;
            
            OthelioAssetRegistry.Asset memory asset = registry.getAsset(chainId, tokens[i]);
            require(asset.supported, "UNSUPPORTED_ASSET");

            (
                uint80 roundId,
                int256 price,
                ,
                uint256 updatedAt,
                uint80 answeredInRound
            ) = AggregatorV3Interface(asset.priceFeed).latestRoundData();

            require(price > 0, "INVALID_PRICE");
            require(updatedAt > 0, "INCOMPLETE_ROUND");
            require(block.timestamp - updatedAt <= MAX_STALENESS, "STALE_PRICE");
            require(answeredInRound >= roundId, "STALE_ROUND");

            // Value = balance * price normalized to 6 decimals (USDC)
            // Balance has asset.tokenDecimals, Price has asset.feedDecimals
            uint256 tokenValue = (balances[i] * uint256(price) * 1e6) / (10**asset.tokenDecimals * 10**asset.feedDecimals);
            totalNAV += tokenValue;
        }
    }
}
