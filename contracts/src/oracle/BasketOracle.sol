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
    uint256 public constant MAX_STALENESS = 7 days;

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
            require(tokens[i] != address(0), "ZERO_TOKEN");
            for (uint256 j = 0; j < i; j++) {
                require(tokens[j] != tokens[i], "DUPLICATE_TOKEN");
            }

            OthelioAssetRegistry.Asset memory asset = registry.getAsset(chainId, tokens[i]);
            require(asset.supported, "UNSUPPORTED_ASSET");
            require(asset.priceFeed != address(0) && asset.priceFeed.code.length > 0, "INVALID_PRICE_FEED");
            if (balances[i] == 0) continue;

            try AggregatorV3Interface(asset.priceFeed).latestRoundData() returns (
                uint80 roundId,
                int256 price,
                uint256,
                uint256 updatedAt,
                uint80 answeredInRound
            ) {
                require(roundId > 0 && answeredInRound >= roundId, "INCOMPLETE_PRICE_ROUND");
                require(price > 0, "INVALID_PRICE");
                require(updatedAt > 0 && updatedAt <= block.timestamp, "INVALID_PRICE_TIME");
                require(block.timestamp - updatedAt <= MAX_STALENESS, "STALE_PRICE");

                uint256 tokenScale = 10 ** asset.tokenDecimals;
                uint256 feedScale = 10 ** asset.feedDecimals;
                uint256 tokenValue = (balances[i] * uint256(price) * 1e6) / (tokenScale * feedScale);
                totalNAV += tokenValue;
            } catch {
                revert("PRICE_READ_FAILED");
            }
        }
    }
}
