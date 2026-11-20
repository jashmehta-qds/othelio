// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {MockStockToken, MockOracle} from "./RiskSplitSeriesTest.t.sol";

contract RiskSplitHandler is Test {
    RiskSplitSeries public immutable series;
    MockStockToken public immutable stock;
    ClaimToken public immutable protectedToken;
    ClaimToken public immutable upsideToken;
    SettlementAdapter public immutable adapter;
    MockOracle public immutable oracle;

    address[] public actors;
    bool public settled;

    constructor(
        RiskSplitSeries series_,
        MockStockToken stock_,
        ClaimToken protectedToken_,
        ClaimToken upsideToken_,
        SettlementAdapter adapter_,
        MockOracle oracle_
    ) {
        series = series_;
        stock = stock_;
        protectedToken = protectedToken_;
        upsideToken = upsideToken_;
        adapter = adapter_;
        oracle = oracle_;

        actors.push(address(0x1111));
        actors.push(address(0x2222));
        actors.push(address(0x3333));

        for (uint256 i = 0; i < actors.length; i++) {
            stock.mint(actors[i], 1_000_000 ether);
            vm.prank(actors[i]);
            stock.approve(address(series), type(uint256).max);
        }
    }

    function mint(uint256 actorIndex, uint256 amount) external {
        if (settled || block.timestamp >= series.expiry()) return;
        amount = bound(amount, 1, 10_000 ether);
        address actor = actors[actorIndex % actors.length];

        vm.prank(actor);
        series.mint(amount);
    }

    function combineAndRedeem(uint256 actorIndex, uint256 amount) external {
        address actor = actors[actorIndex % actors.length];
        uint256 pBal = protectedToken.balanceOf(actor);
        uint256 uBal = upsideToken.balanceOf(actor);
        uint256 maxRedeem = pBal < uBal ? pBal : uBal;
        if (maxRedeem == 0) return;

        amount = bound(amount, 1, maxRedeem);
        vm.prank(actor);
        series.combineAndRedeem(amount);
    }

    function triggerSettlement(int256 price) external {
        if (settled) return;
        price = int256(bound(uint256(price), 1e8, 500e8)); // $1 to $500

        oracle.setPrice(price, series.expiry());
        vm.warp(series.expiry() + 1);
        adapter.settleSeries(address(series));
        settled = true;
    }

    function redeemProtected(uint256 actorIndex, uint256 amount) external {
        if (!settled) return;
        address actor = actors[actorIndex % actors.length];
        uint256 bal = protectedToken.balanceOf(actor);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);
        vm.prank(actor);
        series.redeemProtected(amount);
    }

    function redeemUpside(uint256 actorIndex, uint256 amount) external {
        if (!settled) return;
        address actor = actors[actorIndex % actors.length];
        uint256 bal = upsideToken.balanceOf(actor);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);
        vm.prank(actor);
        series.redeemUpside(amount);
    }
}

contract RiskSplitInvariantTest is Test {
    MockStockToken internal stock;
    MockOracle internal oracle;
    SettlementAdapter internal adapter;
    SeriesFactory internal factory;

    RiskSplitSeries internal series;
    ClaimToken internal protectedToken;
    ClaimToken internal upsideToken;
    RiskSplitHandler internal handler;

    uint256 internal constant FLOOR_PRICE = 45e8;
    uint256 internal constant CAP_PRICE = 55e8;
    uint256 internal constant HEARTBEAT = 24 hours;

    function setUp() public {
        stock = new MockStockToken();
        oracle = new MockOracle(50e8);
        adapter = new SettlementAdapter(address(oracle), HEARTBEAT, address(this));
        factory = new SeriesFactory();

        uint256 expiry = block.timestamp + 7 days;
        factory.setApprovedExpiry(address(stock), expiry, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);

        address seriesAddr = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));

        series = RiskSplitSeries(seriesAddr);
        protectedToken = ClaimToken(address(series.protectedToken()));
        upsideToken = ClaimToken(address(series.upsideToken()));

        handler = new RiskSplitHandler(series, stock, protectedToken, upsideToken, adapter, oracle);

        targetContract(address(handler));
    }

    function invariant_VaultSolvencyAndConservation() public view {
        uint256 vaultBalance = stock.balanceOf(address(series));
        uint256 pSupply = protectedToken.totalSupply();
        uint256 uSupply = upsideToken.totalSupply();

        if (!series.isSettled()) {
            // Before settlement: vault underlying balance MUST exactly equal total supply
            assertEq(vaultBalance, pSupply, "Pre-settlement: vault balance must match protected supply");
            assertEq(vaultBalance, uSupply, "Pre-settlement: vault balance must match upside supply");
        } else {
            // After settlement: vault balance must be >= total remaining liabilities
            uint256 pLiabilities = (pSupply * series.protectedFraction()) / 1e18;
            uint256 uLiabilities = (uSupply * series.upsideFraction()) / 1e18;
            assertGe(
                vaultBalance,
                pLiabilities + uLiabilities,
                "Post-settlement: vault balance must cover remaining liabilities"
            );
        }
    }
}
