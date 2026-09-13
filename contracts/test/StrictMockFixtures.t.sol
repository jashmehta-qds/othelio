// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";
import {IAerodromeSlipstreamSwapRouter} from "../src/dex/IAerodromeSlipstreamSwapRouter.sol";
import {MockAavePool, MockAToken} from "../src/mock/MockAavePool.sol";

contract FixtureERC20 is ERC20 {
    uint8 private immutable _fixtureDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _fixtureDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _fixtureDecimals;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract StrictMockDEXRouterTest is Test {
    MockDEXRouter private router;
    FixtureERC20 private tokenIn;
    FixtureERC20 private tokenOut;
    address private trader = makeAddr("trader");

    function setUp() public {
        router = new MockDEXRouter();
        tokenIn = new FixtureERC20("Input", "IN", 18);
        tokenOut = new FixtureERC20("Output", "OUT", 18);

        tokenIn.mint(trader, 10 ether);
        tokenOut.mint(address(router), 4 ether);
    }

    function testSwapConservesFundedInputAndOutput() public {
        vm.prank(trader);
        tokenIn.approve(address(router), 3 ether);

        router.swap(address(tokenIn), address(tokenOut), trader, 3 ether, 4 ether);

        assertEq(tokenIn.balanceOf(trader), 7 ether);
        assertEq(tokenIn.balanceOf(address(router)), 3 ether);
        assertEq(tokenOut.balanceOf(trader), 4 ether);
        assertEq(tokenOut.balanceOf(address(router)), 0);
    }

    function testSwapRejectsMissingInputAllowanceWithoutPayingOutput() public {
        vm.expectRevert();
        router.swap(address(tokenIn), address(tokenOut), trader, 3 ether, 4 ether);

        assertEq(tokenIn.balanceOf(trader), 10 ether);
        assertEq(tokenOut.balanceOf(trader), 0);
        assertEq(tokenOut.balanceOf(address(router)), 4 ether);
    }

    function testSwapRejectsMissingInputBalanceWithoutPayingOutput() public {
        vm.prank(trader);
        tokenIn.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.swap(address(tokenIn), address(tokenOut), trader, 11 ether, 4 ether);

        assertEq(tokenIn.balanceOf(trader), 10 ether);
        assertEq(tokenOut.balanceOf(trader), 0);
        assertEq(tokenOut.balanceOf(address(router)), 4 ether);
    }

    function testSwapMultiRevertsAtomicallyWhenAnyOutputIsUnfunded() public {
        FixtureERC20 secondOut = new FixtureERC20("Second Output", "OUT2", 18);
        address[] memory outputs = new address[](2);
        outputs[0] = address(tokenOut);
        outputs[1] = address(secondOut);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 4 ether;
        amounts[1] = 1 ether;

        vm.prank(trader);
        tokenIn.approve(address(router), 3 ether);
        vm.expectRevert();
        router.swapMulti(address(tokenIn), outputs, trader, 3 ether, amounts);

        assertEq(tokenIn.balanceOf(trader), 10 ether);
        assertEq(tokenIn.balanceOf(address(router)), 0);
        assertEq(tokenOut.balanceOf(trader), 0);
        assertEq(tokenOut.balanceOf(address(router)), 4 ether);
    }

    function testExactInput2HopConservesIntermediateUsdc() public {
        FixtureERC20 usdc = new FixtureERC20("USD Coin", "USDC", 6);
        bytes memory path = abi.encodePacked(address(tokenIn), int24(100), address(usdc), int24(100), address(tokenOut));

        vm.prank(trader);
        tokenIn.approve(address(router), 6 ether);

        // Reverts if router holds no USDC liquidity for intermediate hop
        vm.prank(trader);
        vm.expectRevert("INSUFFICIENT_INTERMEDIATE_USDC");
        router.exactInput(
            IAerodromeSlipstreamSwapRouter.ExactInputParams({
                path: path,
                recipient: trader,
                deadline: block.timestamp,
                amountIn: 1 ether,
                amountOutMinimum: 1 ether
            })
        );

        // When router holds USDC, 2-hop succeeds and intermediate USDC is deducted proportionally
        usdc.mint(address(router), 100e6);
        assertEq(usdc.balanceOf(address(router)), 100e6);

        // Trade 1: 1 ether input consumes 1e6 USDC
        vm.prank(trader);
        router.exactInput(
            IAerodromeSlipstreamSwapRouter.ExactInputParams({
                path: path,
                recipient: trader,
                deadline: block.timestamp,
                amountIn: 1 ether,
                amountOutMinimum: 1 ether
            })
        );

        assertEq(usdc.balanceOf(address(router)), 99e6);
        assertEq(usdc.balanceOf(address(0x000000000000000000000000000000000000dEaD)), 1e6);

        // Trade 2: 5 ether input consumes 5e6 USDC proportionally
        vm.prank(trader);
        router.exactInput(
            IAerodromeSlipstreamSwapRouter.ExactInputParams({
                path: path,
                recipient: trader,
                deadline: block.timestamp,
                amountIn: 5 ether,
                amountOutMinimum: 1 ether
            })
        );

        assertEq(usdc.balanceOf(address(router)), 94e6);
        assertEq(usdc.balanceOf(address(0x000000000000000000000000000000000000dEaD)), 6e6);

        // Trade 3: 100 ether input requires 100e6 USDC, but router only holds 94e6 -> reverts
        tokenIn.mint(trader, 100 ether);
        vm.prank(trader);
        tokenIn.approve(address(router), 100 ether);

        vm.prank(trader);
        vm.expectRevert("INSUFFICIENT_INTERMEDIATE_USDC");
        router.exactInput(
            IAerodromeSlipstreamSwapRouter.ExactInputParams({
                path: path,
                recipient: trader,
                deadline: block.timestamp,
                amountIn: 100 ether,
                amountOutMinimum: 1 ether
            })
        );
    }
}

contract StrictMockAavePoolTest is Test {
    MockAavePool private pool;
    FixtureERC20 private collateral;
    FixtureERC20 private debtAsset;
    MockAToken private receipt;
    address private user = makeAddr("user");

    function setUp() public {
        pool = new MockAavePool();
        collateral = new FixtureERC20("NVIDIA", "NVDA", 18);
        debtAsset = new FixtureERC20("USD Coin", "USDC", 6);

        address receiptAddress = pool.configureReserve(address(collateral), 18, 100 * 1e8);
        pool.configureReserve(address(debtAsset), 6, 1e8);
        receipt = MockAToken(receiptAddress);

        collateral.mint(user, 10 ether);
        debtAsset.mint(address(pool), 2_000e6);
        vm.prank(user);
        collateral.approve(address(pool), type(uint256).max);
    }

    function testNonUsdcCollateralProducesScaledHealthFactor() public {
        _supply(10 ether);
        vm.prank(user);
        pool.borrow(address(debtAsset), 400e6, 2, 0, user);

        (
            uint256 collateralBase,
            uint256 debtBase,
            uint256 availableBase,
            uint256 liquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        ) = pool.getUserAccountData(user);

        assertEq(collateralBase, 1_000 * 1e8);
        assertEq(debtBase, 400 * 1e8);
        assertEq(availableBase, 350 * 1e8);
        assertEq(liquidationThreshold, 8000);
        assertEq(ltv, 7500);
        assertEq(healthFactor, 2e18);
    }

    function testAvailableBorrowDoesNotUnderflowAfterPriceDrop() public {
        pool.configureReserve(address(collateral), 18, 200 * 1e8);
        _supply(10 ether);
        vm.prank(user);
        pool.borrow(address(debtAsset), 900e6, 2, 0, user);

        pool.configureReserve(address(collateral), 18, 100 * 1e8);
        (,, uint256 availableBase,,, uint256 healthFactor) = pool.getUserAccountData(user);

        assertEq(availableBase, 0);
        assertEq(healthFactor, 888888888888888888);
    }

    function testSupplyAndWithdrawConserveUnderlyingAndBurnReceipt() public {
        _supply(10 ether);
        assertEq(collateral.balanceOf(address(pool)), 10 ether);
        assertEq(receipt.balanceOf(user), 10 ether);
        assertEq(pool.userSupplied(address(collateral), user), 10 ether);

        vm.prank(user);
        uint256 withdrawn = pool.withdraw(address(collateral), 4 ether, user);

        assertEq(withdrawn, 4 ether);
        assertEq(collateral.balanceOf(user), 4 ether);
        assertEq(collateral.balanceOf(address(pool)), 6 ether);
        assertEq(receipt.balanceOf(user), 6 ether);
        assertEq(pool.userSupplied(address(collateral), user), 6 ether);
    }

    function testWithdrawRejectsCollateralReleaseBelowHealthThreshold() public {
        _supply(10 ether);
        vm.prank(user);
        pool.borrow(address(debtAsset), 700e6, 2, 0, user);

        vm.prank(user);
        vm.expectRevert("HEALTH_FACTOR_TOO_LOW");
        pool.withdraw(address(collateral), 2 ether, user);

        assertEq(pool.userSupplied(address(collateral), user), 10 ether);
        assertEq(receipt.balanceOf(user), 10 ether);
        assertEq(collateral.balanceOf(address(pool)), 10 ether);
    }

    function _supply(uint256 amount) private {
        vm.prank(user);
        pool.supply(address(collateral), amount, user, 0);
    }
}
