// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle, AggregatorV3Interface} from "../src/oracle/BasketOracle.sol";

contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public override decimals;
    int256 public price;
    uint256 public updatedAt;

    constructor(uint8 decimals_, int256 price_) {
        decimals = decimals_;
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 price_) external {
        price = price_;
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound
    ) {
        return (1, price, block.timestamp, updatedAt, 1);
    }
}

contract BasketOracleTest is Test {
    OthelioAssetRegistry public registry;
    BasketOracle public oracle;

    address public owner = address(0x111);
    address public tokenNVDA = address(0x222);
    address public tokenUSDC = address(0x333);

    MockV3Aggregator public feedNVDA;
    MockV3Aggregator public feedUSDC;

    function setUp() public {
        registry = new OthelioAssetRegistry(owner, address(0));
        oracle = new BasketOracle(address(registry));

        feedNVDA = new MockV3Aggregator(8, 120 * 1e8); // $120.00
        feedUSDC = new MockV3Aggregator(8, 1 * 1e8);   // $1.00

        vm.startPrank(owner);
        registry.configure(block.chainid, tokenNVDA, address(feedNVDA), true, 18, 8, true);
        registry.configure(block.chainid, tokenUSDC, address(feedUSDC), true, 6, 8, false);
        vm.stopPrank();
    }

    function testCalculateNAV() public view {
        address[] memory tokens = new address[](2);
        tokens[0] = tokenNVDA;
        tokens[1] = tokenUSDC;

        uint256[] memory balances = new uint256[](2);
        balances[0] = 10 * 1e18; // 10 NVDA = $1200
        balances[1] = 500 * 1e6; // 500 USDC = $500

        uint256 nav = oracle.calculateNAV(tokens, balances);
        assertEq(nav, 1700 * 1e6);
    }
}
