// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {IUpsideSeries} from "../../src/upside/interfaces/IUpsideSeries.sol";
import {IOthelioAssetRegistry} from "../../src/upside/interfaces/IOthelioAssetRegistry.sol";

contract MockUnderlyingToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAssetRegistry is IOthelioAssetRegistry {
    mapping(uint256 => mapping(address => Asset)) public assetMap;
    address[] public supportedTokens;

    function setAsset(uint256 chainId, address token, bool supported, address feed, uint8 tDec, uint8 fDec) external {
        assetMap[chainId][token] = Asset({
            supported: supported, priceFeed: feed, tokenDecimals: tDec, feedDecimals: fDec, isCoinbaseB20: false
        });
        if (supported) supportedTokens.push(token);
    }

    function isSupported(uint256 chainId, address token) external view override returns (bool) {
        return assetMap[chainId][token].supported;
    }

    function getAsset(uint256 chainId, address token) external view override returns (Asset memory) {
        return assetMap[chainId][token];
    }

    function getSupportedTokens(uint256 chainId) external view override returns (address[] memory) {
        return supportedTokens;
    }
}

contract UpsidePayoffTest is Test {
    MockAssetRegistry public registry;
    MockUnderlyingToken public underlying18;
    MockUnderlyingToken public underlying0;
    MockUnderlyingToken public underlying6;
    MockUnderlyingToken public underlying8;
    MockUnderlyingToken public underlying38;

    address public adapter = address(0xAA);
    address public feed = address(0xBB);
    address public alice = address(0x11);
    address public bob = address(0x22);
    address public carol = address(0x33);

    uint256 public constant K = 205e8; // Strike: $205.00 (8 feed decimals)
    uint256 public constant EXPIRY_DELTA = 7 days;

    function setUp() public {
        registry = new MockAssetRegistry();

        underlying18 = new MockUnderlyingToken("Stock 18", "STK18", 18);
        underlying0 = new MockUnderlyingToken("Stock 0", "STK0", 0);
        underlying6 = new MockUnderlyingToken("Stock 6", "STK6", 6);
        underlying8 = new MockUnderlyingToken("Stock 8", "STK8", 8);
        underlying38 = new MockUnderlyingToken("Stock 38", "STK38", 38);

        registry.setAsset(block.chainid, address(underlying18), true, feed, 18, 8);
        registry.setAsset(block.chainid, address(underlying0), true, feed, 0, 8);
        registry.setAsset(block.chainid, address(underlying6), true, feed, 6, 8);
        registry.setAsset(block.chainid, address(underlying8), true, feed, 8, 8);
        registry.setAsset(block.chainid, address(underlying38), true, feed, 38, 8);
    }

    function _createSeries(MockUnderlyingToken token, uint256 strike) internal returns (UpsideSeries series) {
        series = new UpsideSeries(
            address(this),
            address(registry),
            address(token),
            adapter,
            strike,
            block.timestamp + EXPIRY_DELTA,
            feed,
            1,
            strike,
            1
        );

        UpsideClaimToken up = new UpsideClaimToken("Upside", "UP", address(series), token.decimals());
        UpsideClaimToken res = new UpsideClaimToken("Residual", "RES", address(series), token.decimals());
        series.initializeTokens(address(up), address(res));
    }

    function test_Payoff_BelowStrike_S190() public {
        UpsideSeries series = _createSeries(underlying18, K);

        uint256 deposit = 1 ether;
        underlying18.mint(alice, deposit);

        vm.startPrank(alice);
        underlying18.approve(address(series), deposit);
        series.mint(deposit);
        vm.stopPrank();

        // Warp to expiry and settle at S = 190 (below K = 205)
        uint256 exp = series.expiry();
        vm.warp(exp);
        vm.prank(adapter);
        series.settleWithFixing(190e8, 10, exp);

        // Upside should be 0, Residual gets 100%
        assertEq(series.upsideAllocation(), 0);
        assertEq(series.residualAllocation(), deposit);
        assertEq(series.upsideAllocation() + series.residualAllocation(), deposit);

        // Redeem
        vm.prank(alice);
        uint256 upOut = series.redeemUpside(deposit);
        assertEq(upOut, 0);

        vm.prank(alice);
        uint256 resOut = series.redeemResidual(deposit);
        assertEq(resOut, deposit);
        assertEq(underlying18.balanceOf(alice), deposit);
    }

    function test_Payoff_AtStrike_S205() public {
        UpsideSeries series = _createSeries(underlying18, K);

        uint256 deposit = 1 ether;
        underlying18.mint(alice, deposit);

        vm.startPrank(alice);
        underlying18.approve(address(series), deposit);
        series.mint(deposit);
        vm.stopPrank();

        uint256 exp = series.expiry();
        vm.warp(exp);
        vm.prank(adapter);
        series.settleWithFixing(205e8, 10, exp);

        // At strike, upside is 0, residual is 100%
        assertEq(series.upsideAllocation(), 0);
        assertEq(series.residualAllocation(), deposit);
        assertEq(series.upsideAllocation() + series.residualAllocation(), deposit);
    }

    function test_Payoff_AboveStrike_S230() public {
        UpsideSeries series = _createSeries(underlying18, K);

        uint256 deposit = 1 ether;
        underlying18.mint(alice, deposit);

        vm.startPrank(alice);
        underlying18.approve(address(series), deposit);
        series.mint(deposit);
        vm.stopPrank();

        uint256 exp = series.expiry();
        vm.warp(exp);
        vm.prank(adapter);
        series.settleWithFixing(230e8, 10, exp);

        // S = 230, K = 205 => upsideVal = 25
        // Expected upside allocation: floor(1e18 * 25 / 230) = 108695652173913043
        uint256 expectedUp = (deposit * 25) / 230;
        uint256 expectedRes = deposit - expectedUp;

        assertEq(series.upsideAllocation(), expectedUp);
        assertEq(series.residualAllocation(), expectedRes);
        assertEq(series.upsideAllocation() + series.residualAllocation(), deposit);

        // Redeem both
        vm.prank(alice);
        uint256 upOut = series.redeemUpside(deposit);
        vm.prank(alice);
        uint256 resOut = series.redeemResidual(deposit);

        assertEq(upOut, expectedUp);
        assertEq(resOut, expectedRes);
        assertEq(upOut + resOut, deposit);
        assertEq(underlying18.balanceOf(address(series)), 0);
    }

    function test_Payoff_FractionalSupply_0_4_Units() public {
        UpsideSeries series = _createSeries(underlying18, K);

        // 0.4 units = 0.4 ether = 400,000,000,000,000,000
        uint256 deposit = 4e17;
        underlying18.mint(alice, deposit);

        vm.startPrank(alice);
        underlying18.approve(address(series), deposit);
        series.mint(deposit);
        vm.stopPrank();

        uint256 exp = series.expiry();
        vm.warp(exp);
        vm.prank(adapter);
        series.settleWithFixing(230e8, 10, exp);

        uint256 expectedUp = (deposit * 25) / 230;
        uint256 expectedRes = deposit - expectedUp;

        assertEq(series.upsideAllocation(), expectedUp);
        assertEq(series.residualAllocation(), expectedRes);
        assertEq(series.upsideAllocation() + series.residualAllocation(), deposit);

        vm.prank(alice);
        uint256 upOut = series.redeemUpside(deposit);
        vm.prank(alice);
        uint256 resOut = series.redeemResidual(deposit);

        assertEq(upOut + resOut, deposit);
        assertEq(underlying18.balanceOf(address(series)), 0);
    }

    function test_Payoff_Decimals_0_6_8_18_And_38_Rejection() public {
        // 1. 0 decimals (whole unit)
        UpsideSeries s0 = _createSeries(underlying0, K);
        underlying0.mint(alice, 100);
        vm.startPrank(alice);
        underlying0.approve(address(s0), 100);
        s0.mint(100);
        vm.stopPrank();
        uint256 exp0 = s0.expiry();
        vm.warp(exp0);
        vm.prank(adapter);
        s0.settleWithFixing(230e8, 10, exp0);
        assertEq(s0.upsideAllocation() + s0.residualAllocation(), 100);

        // 2. 6 decimals
        UpsideSeries s6 = _createSeries(underlying6, K);
        underlying6.mint(alice, 1_000_000);
        vm.startPrank(alice);
        underlying6.approve(address(s6), 1_000_000);
        s6.mint(1_000_000);
        vm.stopPrank();
        uint256 exp6 = s6.expiry();
        vm.warp(exp6);
        vm.prank(adapter);
        s6.settleWithFixing(230e8, 10, exp6);
        assertEq(s6.upsideAllocation() + s6.residualAllocation(), 1_000_000);

        // 3. 8 decimals
        UpsideSeries s8 = _createSeries(underlying8, K);
        underlying8.mint(alice, 100_000_000);
        vm.startPrank(alice);
        underlying8.approve(address(s8), 100_000_000);
        s8.mint(100_000_000);
        vm.stopPrank();
        uint256 exp8 = s8.expiry();
        vm.warp(exp8);
        vm.prank(adapter);
        s8.settleWithFixing(230e8, 10, exp8);
        assertEq(s8.upsideAllocation() + s8.residualAllocation(), 100_000_000);

        // 4. 38 decimals: explicitly rejected
        vm.expectRevert(abi.encodeWithSelector(IUpsideSeries.UnsupportedDecimals.selector, 38));
        new UpsideSeries(
            address(this),
            address(registry),
            address(underlying38),
            adapter,
            K,
            block.timestamp + EXPIRY_DELTA,
            feed,
            1,
            K,
            1
        );
    }

    function test_Payoff_ZeroAndHugeFixing() public {
        // Zero fixing: S = 0
        UpsideSeries sZero = _createSeries(underlying18, K);
        underlying18.mint(alice, 1 ether);
        vm.startPrank(alice);
        underlying18.approve(address(sZero), 1 ether);
        sZero.mint(1 ether);
        vm.stopPrank();
        uint256 exp0 = sZero.expiry();
        vm.warp(exp0);
        vm.prank(adapter);
        sZero.settleWithFixing(0, 10, exp0);
        assertEq(sZero.upsideAllocation(), 0);
        assertEq(sZero.residualAllocation(), 1 ether);

        // Huge fixing: S = 10^15 * 10^8
        UpsideSeries sHuge = _createSeries(underlying18, K);
        underlying18.mint(alice, 1 ether);
        vm.startPrank(alice);
        underlying18.approve(address(sHuge), 1 ether);
        sHuge.mint(1 ether);
        vm.stopPrank();
        uint256 expHuge = sHuge.expiry();
        vm.warp(expHuge);
        vm.prank(adapter);
        uint256 hugePrice = 1e23;
        sHuge.settleWithFixing(hugePrice, 10, expHuge);
        assertGt(sHuge.upsideAllocation(), 0);
        assertGt(sHuge.residualAllocation(), 0);
        assertEq(sHuge.upsideAllocation() + sHuge.residualAllocation(), 1 ether);
    }

    function test_Payoff_LastRedeemerDust_TelescopingAllocation() public {
        UpsideSeries series = _createSeries(underlying18, K);

        // 3 users deposit unequal amounts totaling 100 ether
        underlying18.mint(alice, 33 ether);
        underlying18.mint(bob, 33 ether);
        underlying18.mint(carol, 34 ether);

        vm.startPrank(alice);
        underlying18.approve(address(series), 33 ether);
        series.mint(33 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        underlying18.approve(address(series), 33 ether);
        series.mint(33 ether);
        vm.stopPrank();

        vm.startPrank(carol);
        underlying18.approve(address(series), 34 ether);
        series.mint(34 ether);
        vm.stopPrank();

        uint256 exp = series.expiry();
        vm.warp(exp);
        vm.prank(adapter);
        series.settleWithFixing(230e8, 10, exp);

        uint256 uAlloc = series.upsideAllocation();
        uint256 rAlloc = series.residualAllocation();
        assertEq(uAlloc + rAlloc, 100 ether);

        // Alice, Bob, Carol redeem Upside in sequence
        vm.prank(alice);
        uint256 uA = series.redeemUpside(33 ether);
        vm.prank(bob);
        uint256 uB = series.redeemUpside(33 ether);
        vm.prank(carol);
        uint256 uC = series.redeemUpside(34 ether);

        assertEq(uA + uB + uC, uAlloc, "Cumulative upside redemption must telescope exactly to total allocation");

        // Alice, Bob, Carol redeem Residual in sequence
        vm.prank(alice);
        uint256 rA = series.redeemResidual(33 ether);
        vm.prank(bob);
        uint256 rB = series.redeemResidual(33 ether);
        vm.prank(carol);
        uint256 rC = series.redeemResidual(34 ether);

        assertEq(rA + rB + rC, rAlloc, "Cumulative residual redemption must telescope exactly to total allocation");

        // Vault is completely drained to 0 with zero stranded dust
        assertEq(underlying18.balanceOf(address(series)), 0, "No collateral dust stranded in vault");
    }

    function test_Payoff_PairBurn_BeforeSettlement() public {
        UpsideSeries series = _createSeries(underlying18, K);

        underlying18.mint(alice, 10 ether);
        vm.startPrank(alice);
        underlying18.approve(address(series), 10 ether);
        series.mint(10 ether);

        // Combine and withdraw 4 ether
        uint256 withdrawn = series.combineAndWithdraw(4 ether);
        assertEq(withdrawn, 4 ether);
        assertEq(underlying18.balanceOf(alice), 4 ether);
        assertEq(underlying18.balanceOf(address(series)), 6 ether);
        assertEq(series.upsideToken().totalSupply(), 6 ether);
        assertEq(series.residualToken().totalSupply(), 6 ether);
        vm.stopPrank();

        // Warp past expiry, still unsettled: pair withdraw is still permitted
        vm.warp(series.expiry() + 1 days);
        vm.prank(alice);
        series.combineAndWithdraw(2 ether);
        assertEq(underlying18.balanceOf(alice), 6 ether);
        assertEq(underlying18.balanceOf(address(series)), 4 ether);

        // Now settle
        uint256 exp = series.expiry();
        vm.prank(adapter);
        series.settleWithFixing(230e8, 10, exp);

        // After settlement, combineAndWithdraw reverts AlreadySettled
        vm.prank(alice);
        vm.expectRevert(IUpsideSeries.AlreadySettled.selector);
        series.combineAndWithdraw(1 ether);
    }

    function test_Payoff_ExpiryBoundary_And_Permissions() public {
        UpsideSeries series = _createSeries(underlying18, K);
        uint256 exp = series.expiry();

        underlying18.mint(alice, 5 ether);
        vm.startPrank(alice);
        underlying18.approve(address(series), 5 ether);
        vm.stopPrank();

        // Settle before expiry reverts
        vm.prank(adapter);
        vm.expectRevert(IUpsideSeries.ExpiryNotReached.selector);
        series.settleWithFixing(230e8, 10, block.timestamp);

        // Mint at expiry reverts
        vm.warp(exp);
        vm.prank(alice);
        vm.expectRevert(IUpsideSeries.SeriesExpired.selector);
        series.mint(1 ether);

        // Unauthorized settlement reverts
        vm.expectRevert(IUpsideSeries.Unauthorized.selector);
        series.settleWithFixing(230e8, 10, exp);

        // Redeem before settlement reverts NotSettled
        vm.prank(alice);
        vm.expectRevert(IUpsideSeries.NotSettled.selector);
        series.redeemUpside(1 ether);
    }
}
