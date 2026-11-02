// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {AggregatorV3Interface} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";

contract MockStockToken is ERC20 {
    constructor() ERC20("Mock MSFTc", "MSFTc") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockDecimalStockToken is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor(uint8 decimals_) ERC20("Decimal stock", "DSTK") {
        tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOracle is AggregatorV3Interface {
    uint8 public override decimals = 8;
    string public override description = "Mock Feed";
    uint256 public override version = 1;

    int256 public price;
    uint256 public updatedAt;
    uint80 public roundId = 1;

    constructor(int256 initialPrice) {
        price = initialPrice;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 newPrice, uint256 newUpdatedAt) external {
        price = newPrice;
        updatedAt = newUpdatedAt;
        roundId++;
    }

    function getRoundData(uint80 _roundId) external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (_roundId, price, updatedAt, updatedAt, _roundId);
    }

    function latestRoundData() external view override returns (
        uint80,
        int256,
        uint256,
        uint256,
        uint80
    ) {
        return (roundId, price, updatedAt, updatedAt, roundId);
    }
}

contract RiskSplitSeriesTest is Test {
    MockStockToken internal stock;
    MockOracle internal oracle;
    SettlementAdapter internal adapter;
    SeriesFactory internal factory;

    RiskSplitSeries internal series;
    ClaimToken internal protectedToken;
    ClaimToken internal upsideToken;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant FLOOR_PRICE = 45e8; // $45
    uint256 internal constant CAP_PRICE = 55e8;   // $55
    uint256 internal constant HEARTBEAT = 24 hours;
    uint256 internal expiry;

    function setUp() public {
        stock = new MockStockToken();
        oracle = new MockOracle(50e8); // $50 initial price
        adapter = new SettlementAdapter(address(oracle), HEARTBEAT);
        factory = new SeriesFactory();

        expiry = block.timestamp + 7 days;

        address seriesAddr = factory.createSeries(
            address(stock),
            FLOOR_PRICE,
            CAP_PRICE,
            expiry,
            address(adapter)
        );

        series = RiskSplitSeries(seriesAddr);
        protectedToken = ClaimToken(address(series.protectedToken()));
        upsideToken = ClaimToken(address(series.upsideToken()));

        stock.mint(alice, 100 ether);
        stock.mint(bob, 100 ether);

        vm.prank(alice);
        stock.approve(address(series), type(uint256).max);
        vm.prank(bob);
        stock.approve(address(series), type(uint256).max);
    }

    function test_InitialState() public view {
        assertEq(address(series.underlying()), address(stock));
        assertEq(series.settlementAdapter(), address(adapter));
        assertEq(series.floorPrice(), FLOOR_PRICE);
        assertEq(series.capPrice(), CAP_PRICE);
        assertEq(series.expiry(), expiry);
        assertFalse(series.isSettled());
        assertEq(factory.allSeriesLength(), 1);
        assertTrue(factory.isSeries(address(series)));
    }

    function test_MintAndPairRedeem() public {
        vm.prank(alice);
        series.mint(10 ether);

        assertEq(stock.balanceOf(address(series)), 10 ether);
        assertEq(protectedToken.balanceOf(alice), 10 ether);
        assertEq(upsideToken.balanceOf(alice), 10 ether);

        // Combine and redeem back to stock
        vm.prank(alice);
        series.combineAndRedeem(4 ether);

        assertEq(stock.balanceOf(address(series)), 6 ether);
        assertEq(protectedToken.balanceOf(alice), 6 ether);
        assertEq(upsideToken.balanceOf(alice), 6 ether);
        assertEq(stock.balanceOf(alice), 94 ether);
    }

    function test_ClaimDecimalsMatchUnderlying() public {
        uint8[3] memory decimalCases = [uint8(6), uint8(8), uint8(18)];
        for (uint256 i = 0; i < decimalCases.length; i++) {
            uint8 units = decimalCases[i];
            MockDecimalStockToken token = new MockDecimalStockToken(units);
            uint256 oneToken = 10 ** units;
            token.mint(alice, oneToken);
            address vaultAddress = factory.createSeries(address(token), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
            RiskSplitSeries vault = RiskSplitSeries(vaultAddress);
            ClaimToken p = ClaimToken(address(vault.protectedToken()));
            ClaimToken u = ClaimToken(address(vault.upsideToken()));
            assertEq(p.decimals(), units);
            assertEq(u.decimals(), units);
            vm.startPrank(alice);
            token.approve(vaultAddress, oneToken);
            vault.mint(oneToken);
            assertEq(p.balanceOf(alice), oneToken);
            assertEq(u.balanceOf(alice), oneToken);
            vault.combineAndRedeem(oneToken);
            vm.stopPrank();
            assertEq(token.balanceOf(alice), oneToken);
        }
    }

    function test_SettlementRegime1_SevereCrash_BelowFloor() public {
        // Price crashes to $40 (below F=$45)
        // Expected: eP = 1.0 (WAD), eU = 0
        vm.prank(alice);
        series.mint(10 ether);

        vm.warp(expiry + 1);
        oracle.setPrice(40e8, block.timestamp);

        adapter.settleSeries(address(series));

        assertTrue(series.isSettled());
        assertEq(series.settledPrice(), 40e8);
        assertEq(series.protectedFraction(), 1e18);
        assertEq(series.upsideFraction(), 0);

        // Alice redeems Protected -> gets 100% of underlying
        uint256 aliceBalBefore = stock.balanceOf(alice);
        vm.prank(alice);
        series.redeemProtected(10 ether);
        assertEq(stock.balanceOf(alice) - aliceBalBefore, 10 ether);

        // Upside receives 0
        vm.prank(alice);
        series.redeemUpside(10 ether);
        assertEq(stock.balanceOf(alice) - aliceBalBefore, 10 ether);
    }

    function test_SettlementRegime2_BetweenFloorAnd2F() public {
        // Price is $70 (F=$45 <= S < 2F=$90)
        // Formula: eP = F / S = 45 / 70 ≈ 0.642857142857142857 WAD
        // eU = WAD - eP
        vm.prank(alice);
        series.mint(10 ether);

        vm.warp(expiry + 1);
        oracle.setPrice(70e8, block.timestamp);

        adapter.settleSeries(address(series));

        uint256 expectedProtectedFrac = (FLOOR_PRICE * 1e18) / 70e8;
        uint256 expectedUpsideFrac = 1e18 - expectedProtectedFrac;

        assertEq(series.protectedFraction(), expectedProtectedFrac);
        assertEq(series.upsideFraction(), expectedUpsideFrac);
        assertEq(series.protectedFraction() + series.upsideFraction(), 1e18);

        // Alice redeems Protected and Upside separately
        uint256 aliceBalBefore = stock.balanceOf(alice);
        vm.startPrank(alice);
        series.redeemProtected(10 ether);
        series.redeemUpside(10 ether);
        vm.stopPrank();

        uint256 received = stock.balanceOf(alice) - aliceBalBefore;
        assertApproxEqAbs(received, 10 ether, 1);
    }

    function test_SettlementRegime3_MiddleRange_2F_to_2C() public {
        // 2F = $90, 2C = $110. Let S = $100
        // Expected: eP = 0.5 WAD, eU = 0.5 WAD
        vm.prank(alice);
        series.mint(10 ether);

        vm.warp(expiry + 1);
        oracle.setPrice(100e8, block.timestamp);

        adapter.settleSeries(address(series));

        assertEq(series.protectedFraction(), 0.5e18);
        assertEq(series.upsideFraction(), 0.5e18);

        uint256 aliceBalBefore = stock.balanceOf(alice);
        vm.prank(alice);
        series.redeemProtected(10 ether);
        assertEq(stock.balanceOf(alice) - aliceBalBefore, 5 ether);

        vm.prank(alice);
        series.redeemUpside(10 ether);
        assertEq(stock.balanceOf(alice) - aliceBalBefore, 10 ether);
    }

    function test_SettlementRegime4_Rally_Above2C() public {
        // 2C = $110. Let S = $130 (rally)
        // Formula: eP = C / S = 55 / 130 ≈ 0.423076923076923076 WAD
        // eU = WAD - eP
        vm.prank(alice);
        series.mint(10 ether);

        vm.warp(expiry + 1);
        oracle.setPrice(130e8, block.timestamp);

        adapter.settleSeries(address(series));

        uint256 expectedProtectedFrac = (CAP_PRICE * 1e18) / 130e8;
        uint256 expectedUpsideFrac = 1e18 - expectedProtectedFrac;

        assertEq(series.protectedFraction(), expectedProtectedFrac);
        assertEq(series.upsideFraction(), expectedUpsideFrac);

        uint256 aliceBalBefore = stock.balanceOf(alice);
        vm.startPrank(alice);
        series.redeemProtected(10 ether);
        series.redeemUpside(10 ether);
        vm.stopPrank();

        uint256 received = stock.balanceOf(alice) - aliceBalBefore;
        assertApproxEqAbs(received, 10 ether, 1);
    }

    function test_CombineAndRedeemPostSettlement() public {
        vm.prank(alice);
        series.mint(10 ether);

        vm.warp(expiry + 1);
        oracle.setPrice(130e8, block.timestamp);
        adapter.settleSeries(address(series));

        uint256 aliceBalBefore = stock.balanceOf(alice);
        vm.prank(alice);
        series.combineAndRedeem(10 ether);

        assertEq(stock.balanceOf(alice) - aliceBalBefore, 10 ether);
        assertEq(stock.balanceOf(address(series)), 0);
    }
}
