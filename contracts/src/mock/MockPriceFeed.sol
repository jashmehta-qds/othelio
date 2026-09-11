// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Deterministic local-only price feed whose timestamp always matches
/// the current Anvil block, avoiding stale mainnet-fork oracle rounds.
contract MockPriceFeed {
    uint8 public constant decimals = 8;
    int256 public immutable answer;

    constructor(int256 answer_) {
        require(answer_ > 0, "INVALID_PRICE");
        answer = answer_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 price, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
