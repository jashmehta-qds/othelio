// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
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
    uint256 public constant DEFAULT_MAX_STALENESS = 3 days;
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;
    address public immutable sequencerUptimeFeed;

    error SequencerDown();
    error GracePeriodNotOver();
    error InvalidSequencerTimestamp();
    error InvalidSequencerAnswer();
    error SequencerReadFailed();

    constructor(address registry_, address sequencerUptimeFeed_) {
        require(registry_ != address(0), "ZERO_REGISTRY");
        registry = OthelioAssetRegistry(registry_);
        sequencerUptimeFeed = sequencerUptimeFeed_;
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
        _checkSequencer();
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
                uint256 maxStaleness = registry.heartbeatOf(chainId, tokens[i]);
                if (maxStaleness == 0) maxStaleness = DEFAULT_MAX_STALENESS;
                require(block.timestamp - updatedAt <= maxStaleness, "STALE_PRICE");

                uint256 tokenScale = 10 ** asset.tokenDecimals;
                uint256 feedScale = 10 ** asset.feedDecimals;
                uint256 denominator = tokenScale * feedScale;
                uint256 tokenValue;
                if (denominator >= 1e6) {
                    tokenValue = Math.mulDiv(balances[i], uint256(price), denominator / 1e6);
                } else {
                    tokenValue = Math.mulDiv(balances[i], uint256(price), 1) * (1e6 / denominator);
                }
                totalNAV += tokenValue;
            } catch {
                revert("PRICE_READ_FAILED");
            }
        }
    }

    function _checkSequencer() private view {
        if (sequencerUptimeFeed == address(0)) return;

        try AggregatorV3Interface(sequencerUptimeFeed).latestRoundData() returns (
            uint80,
            int256 answer,
            uint256 startedAt,
            uint256,
            uint80
        ) {
            if (answer == 1) revert SequencerDown();
            if (answer != 0) revert InvalidSequencerAnswer();
            if (startedAt == 0 || startedAt > block.timestamp) revert InvalidSequencerTimestamp();
            if (block.timestamp - startedAt < SEQUENCER_GRACE_PERIOD) revert GracePeriodNotOver();
        } catch (bytes memory reason) {
            if (reason.length != 0) assembly { revert(add(reason, 32), mload(reason)) }
            revert SequencerReadFailed();
        }
    }
}
