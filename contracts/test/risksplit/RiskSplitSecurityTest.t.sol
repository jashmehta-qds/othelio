// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {IRiskSplitSeries} from "../../src/risksplit/interfaces/IRiskSplitSeries.sol";
import {ISettlementAdapter} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";
import {MockStockToken, MockOracle} from "./RiskSplitSeriesTest.t.sol";

contract MaliciousReentrantToken is ERC20 {
    address public targetSeries;
    bool public attacking;

    constructor() ERC20("Malicious Token", "BAD") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function setTarget(address target) external {
        targetSeries = target;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!attacking && targetSeries != address(0)) {
            attacking = true;
            // Attempt to reenter
            RiskSplitSeries(targetSeries).mint(1 ether);
        }
        return super.transfer(to, amount);
    }
}

contract DeceptiveFeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        // Skim 10%
        uint256 fee = amount / 10;
        uint256 net = amount - fee;
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, net);
        return true;
    }
}

contract RiskSplitSecurityTest is Test {
    MockStockToken internal stock;
    MockOracle internal oracle;
    SettlementAdapter internal adapter;
    SeriesFactory internal factory;

    RiskSplitSeries internal series;
    ClaimToken internal protectedToken;
    ClaimToken internal upsideToken;

    address internal attacker = address(0xBAD);
    address internal victim = address(0xFACE);

    uint256 internal constant FLOOR_PRICE = 45e8;
    uint256 internal constant CAP_PRICE = 55e8;
    uint256 internal constant HEARTBEAT = 24 hours;
    uint256 internal expiry;

    function setUp() public {
        stock = new MockStockToken();
        oracle = new MockOracle(50e8);
        adapter = new SettlementAdapter(address(oracle), HEARTBEAT, address(this));
        factory = new SeriesFactory();

        expiry = block.timestamp + 7 days;
        factory.setApprovedExpiry(address(stock), expiry, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);

        address seriesAddr = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));

        series = RiskSplitSeries(seriesAddr);
        protectedToken = ClaimToken(address(series.protectedToken()));
        upsideToken = ClaimToken(address(series.upsideToken()));

        stock.mint(attacker, 100 ether);
        stock.mint(victim, 100 ether);

        vm.prank(attacker);
        stock.approve(address(series), type(uint256).max);
        vm.prank(victim);
        stock.approve(address(series), type(uint256).max);
    }

    function test_Security_ReentrancyBlocked() public {
        MaliciousReentrantToken badToken = new MaliciousReentrantToken();
        factory.setApprovedExpiry(address(badToken), expiry, true);
        factory.setApprovedAdapter(address(badToken), address(adapter), true);
        address seriesAddr = factory.createSeries(address(badToken), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        RiskSplitSeries badSeries = RiskSplitSeries(seriesAddr);
        badToken.setTarget(seriesAddr);

        badToken.approve(seriesAddr, type(uint256).max);
        badSeries.mint(10 ether);

        oracle.setPrice(50e8, expiry);
        vm.warp(expiry + 1);
        adapter.settleSeries(seriesAddr);

        // When redeeming, badToken.transfer will attempt reentrancy, which must revert
        vm.expectRevert();
        badSeries.redeemProtected(5 ether);
    }

    function test_Security_FeeOnTransferRejected() public {
        DeceptiveFeeToken feeToken = new DeceptiveFeeToken();
        factory.setApprovedExpiry(address(feeToken), expiry, true);
        factory.setApprovedAdapter(address(feeToken), address(adapter), true);
        address seriesAddr = factory.createSeries(address(feeToken), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        RiskSplitSeries feeSeries = RiskSplitSeries(seriesAddr);

        feeToken.approve(seriesAddr, type(uint256).max);

        // Vault verifies pre/post balance delta. Fee-on-transfer mismatch reverts with FeeOnTransferNotSupported
        vm.expectRevert(IRiskSplitSeries.FeeOnTransferNotSupported.selector);
        feeSeries.mint(10 ether);
    }

    function test_Security_PrematureSettlementRejected() public {
        // Trying to settle before expiry must revert
        vm.expectRevert(ISettlementAdapter.ExpiryNotReached.selector);
        adapter.settleSeries(address(series));

        vm.expectRevert(IRiskSplitSeries.ExpiryNotReached.selector);
        vm.prank(address(adapter));
        series.settle(50e8);
    }

    function test_Security_UnauthorizedSettlementRejected() public {
        vm.warp(expiry + 1);
        // Direct call to series.settle from non-adapter must revert
        vm.prank(attacker);
        vm.expectRevert(IRiskSplitSeries.Unauthorized.selector);
        series.settle(100e8);
    }

    function test_Security_DoubleSettlementRejected() public {
        oracle.setPrice(50e8, expiry);
        vm.warp(expiry + 1);
        adapter.settleSeries(address(series));

        // Second call must revert
        vm.expectRevert(ISettlementAdapter.SeriesAlreadySettled.selector);
        adapter.settleSeries(address(series));
    }

    function test_Security_MintAfterExpiryOrSettlementRejected() public {
        vm.warp(expiry + 1);
        vm.prank(attacker);
        vm.expectRevert(IRiskSplitSeries.SeriesExpired.selector);
        series.mint(1 ether);

        oracle.setPrice(50e8, expiry);
        adapter.settleSeries(address(series));
        vm.prank(attacker);
        vm.expectRevert(IRiskSplitSeries.SeriesExpired.selector);
        series.mint(1 ether);
    }

    function test_Security_SingleClaimRedeemBeforeSettlementRejected() public {
        vm.prank(attacker);
        series.mint(10 ether);

        vm.prank(attacker);
        vm.expectRevert(IRiskSplitSeries.NotSettled.selector);
        series.redeemProtected(5 ether);

        vm.prank(attacker);
        vm.expectRevert(IRiskSplitSeries.NotSettled.selector);
        series.redeemUpside(5 ether);
    }

    function test_Security_StaleOraclePriceRejected() public {
        vm.warp(expiry + 1);
        // Stale timestamp (older than heartbeat = 24 hours relative to expiry)
        oracle.setPrice(50e8, expiry - 25 hours);

        vm.expectRevert(ISettlementAdapter.StalePrice.selector);
        adapter.settleSeries(address(series));
    }

    function test_Security_ZeroOrNegativeOraclePriceRejected() public {
        oracle.setPrice(0, expiry);
        vm.warp(expiry + 1);
        vm.expectRevert(ISettlementAdapter.StalePrice.selector);
        adapter.settleSeries(address(series));

        oracle.setPrice(-10e8, expiry);
        vm.expectRevert(ISettlementAdapter.StalePrice.selector);
        adapter.settleSeries(address(series));
    }

    function test_Security_RoundingDustFavorsVault() public {
        vm.prank(attacker);
        series.mint(1);

        oracle.setPrice(70e8, expiry);
        vm.warp(expiry + 1);
        adapter.settleSeries(address(series));

        uint256 balBefore = stock.balanceOf(attacker);
        vm.prank(attacker);
        series.redeemProtected(1);
        vm.prank(attacker);
        series.redeemUpside(1);
        uint256 balAfter = stock.balanceOf(attacker);

        // Payout rounds down; attacker cannot extract more than exists
        assertEq(balAfter - balBefore, 0);
        // The 1 wei remains safely in the vault
        assertEq(stock.balanceOf(address(series)), 1);
    }
}
