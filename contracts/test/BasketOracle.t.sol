// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle, AggregatorV3Interface} from "../src/oracle/BasketOracle.sol";

contract OracleMetadataToken {
    uint8 public immutable decimals;
    constructor(uint8 decimals_) { decimals = decimals_; }
}

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

contract MockSequencerUptimeFeed is AggregatorV3Interface {
    uint8 public constant override decimals = 0;
    int256 public answer;
    uint256 public startedAt;

    constructor(int256 answer_, uint256 startedAt_) {
        answer = answer_;
        startedAt = startedAt_;
    }

    function setStatus(int256 answer_, uint256 startedAt_) external {
        answer = answer_;
        startedAt = startedAt_;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, startedAt, startedAt, 1);
    }
}

contract BasketOracleTest is Test {
    OthelioAssetRegistry public registry;
    BasketOracle public oracle;

    address public owner = address(0x111);
    address public tokenNVDA;
    address public tokenUSDC;

    MockV3Aggregator public feedNVDA;
    MockV3Aggregator public feedUSDC;

    function setUp() public {
        registry = new OthelioAssetRegistry(owner);
        oracle = new BasketOracle(address(registry), address(0));
        tokenNVDA = address(new OracleMetadataToken(18));
        tokenUSDC = address(new OracleMetadataToken(6));

        feedNVDA = new MockV3Aggregator(8, 120 * 1e8); // $120.00
        feedUSDC = new MockV3Aggregator(8, 1 * 1e8);   // $1.00

        vm.startPrank(owner);
        registry.configure(block.chainid, tokenNVDA, address(feedNVDA), true, 18, 8, false);
        registry.configure(block.chainid, tokenUSDC, address(feedUSDC), true, 6, 8, false);
        vm.stopPrank();
    }

    function testConfigureRejectsFeedDecimalsMismatch() public {
        vm.startPrank(owner);
        vm.expectRevert("FEED_DECIMALS_MISMATCH");
        registry.configure(block.chainid, tokenNVDA, address(feedNVDA), true, 18, 6, false);
        vm.expectRevert("FEED_DECIMALS_MISMATCH");
        registry.configure(block.chainid, tokenNVDA, address(oracle), true, 18, 8, false);
        registry.configure(block.chainid, tokenNVDA, address(feedNVDA), false, 18, 6, false);
        vm.stopPrank();
    }

    function testLargeBalanceDoesNotOverflowIntermediateProduct() public view {
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = type(uint256).max / 1e8;
        assertEq(oracle.calculateNAV(tokens, balances), balances[0]);
    }

    function testFuzzNAVMatchesExactScaling(uint64 balance, uint64 price, uint8, uint8 feedDecimals) public {
        uint8 tokenDecimals = 18;
        feedDecimals = uint8(bound(feedDecimals, 0, 38));
        price = uint64(bound(price, 1, type(uint64).max));
        MockV3Aggregator feed = new MockV3Aggregator(feedDecimals, int256(uint256(price)));
        vm.prank(owner);
        registry.configure(block.chainid, tokenNVDA, address(feed), true, tokenDecimals, feedDecimals, false);
        address[] memory tokens = new address[](1);
        tokens[0] = tokenNVDA;
        uint256[] memory balances = new uint256[](1);
        balances[0] = balance;
        uint256 expected = uint256(balance) * price * 1e6 / (10 ** uint256(tokenDecimals) * 10 ** uint256(feedDecimals));
        assertEq(oracle.calculateNAV(tokens, balances), expected);
    }

    function testEmptyAndZeroBalances() public view {
        assertEq(oracle.calculateNAV(new address[](0), new uint256[](0)), 0);
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        assertEq(oracle.calculateNAV(tokens, new uint256[](1)), 0);
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
        feedUSDC.setUpdatedAt(block.timestamp - oracle.DEFAULT_MAX_STALENESS() - 1);
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = 500 * 1e6;

        vm.expectRevert("STALE_PRICE");
        oracle.calculateNAV(tokens, balances);
    }

    function testPerAssetHeartbeatOverride() public {
        vm.warp(4 days);
        feedUSDC.setUpdatedAt(block.timestamp - 2 days);
        address[] memory tokens = new address[](1);
        tokens[0] = tokenUSDC;
        uint256[] memory balances = new uint256[](1);
        balances[0] = 500 * 1e6;

        assertEq(oracle.calculateNAV(tokens, balances), 500 * 1e6);

        vm.prank(owner);
        registry.setHeartbeat(block.chainid, tokenUSDC, 1 days);
        vm.expectRevert("STALE_PRICE");
        oracle.calculateNAV(tokens, balances);

        vm.prank(owner);
        registry.setHeartbeat(block.chainid, tokenUSDC, 2 days);
        assertEq(oracle.calculateNAV(tokens, balances), 500 * 1e6);
    }

    function testSequencerDownReverts() public {
        vm.warp(2 hours);
        MockSequencerUptimeFeed sequencer = new MockSequencerUptimeFeed(1, block.timestamp - 1 hours);
        BasketOracle sequencerOracle = new BasketOracle(address(registry), address(sequencer));
        address[] memory tokens = new address[](0);
        uint256[] memory balances = new uint256[](0);

        vm.expectRevert(BasketOracle.SequencerDown.selector);
        sequencerOracle.calculateNAV(tokens, balances);
    }

    function testSequencerGracePeriodReverts() public {
        vm.warp(2 hours);
        MockSequencerUptimeFeed sequencer = new MockSequencerUptimeFeed(0, block.timestamp - 1 hours + 1);
        BasketOracle sequencerOracle = new BasketOracle(address(registry), address(sequencer));

        vm.expectRevert(BasketOracle.GracePeriodNotOver.selector);
        sequencerOracle.calculateNAV(new address[](0), new uint256[](0));
    }

    function testSequencerZeroStartedAtReverts() public {
        MockSequencerUptimeFeed sequencer = new MockSequencerUptimeFeed(0, 0);
        BasketOracle sequencerOracle = new BasketOracle(address(registry), address(sequencer));

        vm.expectRevert(BasketOracle.InvalidSequencerTimestamp.selector);
        sequencerOracle.calculateNAV(new address[](0), new uint256[](0));
    }

    function testSequencerAddressZeroDisablesCheck() public view {
        assertEq(oracle.sequencerUptimeFeed(), address(0));
        assertEq(oracle.calculateNAV(new address[](0), new uint256[](0)), 0);
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
