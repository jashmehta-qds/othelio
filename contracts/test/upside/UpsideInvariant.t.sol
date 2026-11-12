// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {MockUnderlyingToken, MockAssetRegistry} from "./UpsidePayoff.t.sol";

contract UpsideHandler is Test {
    UpsideSeries public immutable series;
    MockUnderlyingToken public immutable stock;
    UpsideClaimToken public immutable upsideToken;
    UpsideClaimToken public immutable residualToken;
    address public immutable adapter;

    address[] public actors;
    bool public settled;
    uint256 public totalWithdrawn;

    constructor(
        UpsideSeries series_,
        MockUnderlyingToken stock_,
        UpsideClaimToken upsideToken_,
        UpsideClaimToken residualToken_,
        address adapter_
    ) {
        series = series_;
        stock = stock_;
        upsideToken = upsideToken_;
        residualToken = residualToken_;
        adapter = adapter_;

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

    function combineAndWithdraw(uint256 actorIndex, uint256 amount) external {
        if (settled) return;
        address actor = actors[actorIndex % actors.length];
        uint256 uBal = upsideToken.balanceOf(actor);
        uint256 rBal = residualToken.balanceOf(actor);
        uint256 maxCombine = uBal < rBal ? uBal : rBal;
        if (maxCombine == 0) return;

        amount = bound(amount, 1, maxCombine);
        vm.prank(actor);
        series.combineAndWithdraw(amount);
    }

    function triggerSettlement(uint256 price) external {
        if (settled) return;
        price = bound(price, 0, 500e8); // $0 to $500

        uint256 exp = series.expiry();
        vm.warp(exp + 1);
        vm.prank(adapter);
        series.settleWithFixing(price, 10, exp);
        settled = true;
    }

    function redeemUpside(uint256 actorIndex, uint256 amount) external {
        if (!settled) return;
        address actor = actors[actorIndex % actors.length];
        uint256 bal = upsideToken.balanceOf(actor);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);
        vm.prank(actor);
        uint256 out = series.redeemUpside(amount);
        totalWithdrawn += out;
    }

    function redeemResidual(uint256 actorIndex, uint256 amount) external {
        if (!settled) return;
        address actor = actors[actorIndex % actors.length];
        uint256 bal = residualToken.balanceOf(actor);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);
        vm.prank(actor);
        uint256 out = series.redeemResidual(amount);
        totalWithdrawn += out;
    }
}

contract UpsideInvariantTest is Test {
    MockUnderlyingToken internal stock;
    MockAssetRegistry internal registry;
    UpsideSeries internal series;
    UpsideClaimToken internal upsideToken;
    UpsideClaimToken internal residualToken;
    UpsideHandler internal handler;

    address internal adapter = address(0xAA);
    address internal feed = address(0xBB);
    uint256 internal constant STRIKE = 205e8;

    function setUp() public {
        stock = new MockUnderlyingToken("Stock", "STK", 18);
        registry = new MockAssetRegistry();
        registry.setAsset(block.chainid, address(stock), true, feed, 18, 8);

        uint256 expiry = block.timestamp + 7 days;
        series = new UpsideSeries(
            address(this), address(registry), address(stock), adapter, STRIKE, expiry, feed, 1, STRIKE, 1
        );

        upsideToken = new UpsideClaimToken("Upside", "UP", address(series), 18);
        residualToken = new UpsideClaimToken("Residual", "RES", address(series), 18);
        series.initializeTokens(address(upsideToken), address(residualToken));

        handler = new UpsideHandler(series, stock, upsideToken, residualToken, adapter);
        targetContract(address(handler));
    }

    function invariant_VaultSolvencyAndConservation() public view {
        uint256 vaultBalance = stock.balanceOf(address(series));
        uint256 uSupply = upsideToken.totalSupply();
        uint256 rSupply = residualToken.totalSupply();

        if (!series.isSettled()) {
            assertEq(vaultBalance, uSupply, "Pre-settlement: vault balance must equal upside supply");
            assertEq(vaultBalance, rSupply, "Pre-settlement: vault balance must equal residual supply");
        } else {
            uint256 cSnap = series.collateralSnapshot();
            uint256 qSnap = series.totalClaimSupplySnapshot();

            assertEq(
                series.upsideAllocation() + series.residualAllocation(),
                cSnap,
                "Allocations must sum exactly to collateral snapshot"
            );

            if (qSnap > 0) {
                uint256 remainingUpObligation = series.upsideAllocation()
                    - Math.mulDiv(series.upsideAllocation(), series.totalUpsideRedeemed(), qSnap);
                uint256 remainingResObligation = series.residualAllocation()
                    - Math.mulDiv(series.residualAllocation(), series.totalResidualRedeemed(), qSnap);

                assertEq(
                    vaultBalance,
                    remainingUpObligation + remainingResObligation,
                    "Vault balance must exactly equal sum of remaining obligations"
                );
            } else {
                assertEq(vaultBalance, 0);
            }
        }
    }
}
