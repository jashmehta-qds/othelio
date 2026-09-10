// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle, AggregatorV3Interface} from "../src/oracle/BasketOracle.sol";

contract MockV3Aggregator is AggregatorV3Interface {
    uint8 public override decimals;
    int256 public price;
    uint256 public updatedAt;
    bool public shouldRevert;

    constructor(uint8 decimals_, int256 price_) {
        decimals = decimals_;
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 price_) external {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    function setShouldRevert(bool shouldRevert_) external {
        shouldRevert = shouldRevert_;
    }

    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt_,
        uint80 answeredInRound
    ) {
        require(!shouldRevert, "MOCK_REVERT");
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

    function testRevertUnsupportedAssetInsteadOfDollarFallback() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(0x999);
        uint256[] memory balances = new uint256[](1);
        balances[0] = 1e6;

        vm.expectRevert("UNSUPPORTED_ASSET");
        oracle.calculateNAV(tokens, balances);
    }

    function testRevertStalePrice() public {
        vm.warp(30 days);
        feedUSDC.setUpdatedAt(block.timestamp - oracle.MAX_STALENESS() - 1);
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = 500 * 1e6;

        vm.expectRevert("STALE_PRICE");
        oracle.calculateNAV(tokens, balances);
    }

    function testRevertZeroAndNegativePrice() public {
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = 500 * 1e6;

        feedUSDC.setPrice(0);
        vm.expectRevert("INVALID_PRICE");
        oracle.calculateNAV(tokens, balances);

        feedUSDC.setPrice(-1);
        vm.expectRevert("INVALID_PRICE");
        oracle.calculateNAV(tokens, balances);
    }

    function testRevertFeedFailureInsteadOfDollarFallback() public {
        feedUSDC.setShouldRevert(true);
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = 500 * 1e6;

        vm.expectRevert("PRICE_READ_FAILED");
        oracle.calculateNAV(tokens, balances);
    }

    function testRevertDuplicateTokenInsteadOfDoubleCounting() public {
        address[] memory tokens = new address[](2);
        tokens[0] = tokenUSDC;
        tokens[1] = tokenUSDC;
        uint256[] memory balances = new uint256[](2);
        balances[0] = 500 * 1e6;
        balances[1] = 500 * 1e6;

        vm.expectRevert("DUPLICATE_TOKEN");
        oracle.calculateNAV(tokens, balances);
    }

    function testSixDecimalAssetStillValuesAtConfiguredPrecision() public view {
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = 1_234_567;

        assertEq(oracle.calculateNAV(tokens, balances), 1_234_567);
    }
}
