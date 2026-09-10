// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBorrowModule} from "../src/safe/OthelioBorrowModule.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {MockAavePool} from "../src/mock/MockAavePool.sol";

contract RecoveryToken is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract OthelioBorrowModuleTest is Test {
    uint256 private constant COLLATERAL = 10 ether;
    uint256 private constant USDC = 1e6;

    OthelioAssetRegistry private registry;
    OthelioBorrowModule private borrowModule;
    OthelioBasketAccount private safe;
    MockAavePool private aavePool;
    RecoveryToken private collateral;
    RecoveryToken private debtAsset;

    address private owner = address(0xBB22);
    address private attacker = address(0xBAD);

    function setUp() public {
        vm.startPrank(owner);
        registry = new OthelioAssetRegistry(owner, address(0));
        BasketOracle oracle = new BasketOracle(address(registry));
        borrowModule = new OthelioBorrowModule(address(oracle));
        safe = new OthelioBasketAccount(owner, address(borrowModule), address(registry));
        aavePool = new MockAavePool();
        collateral = new RecoveryToken("Collateral", "COL", 18);
        debtAsset = new RecoveryToken("USD Coin", "USDC", 6);
        registry.setApprovedLendingPool(address(aavePool), true);
        vm.stopPrank();

        aavePool.configureReserve(address(collateral), 18, 100e8);
        aavePool.configureReserve(address(debtAsset), 6, 1e8);
        collateral.mint(address(safe), COLLATERAL);
        debtAsset.mint(address(aavePool), 2_000 * USDC);
    }

    function testWalletRepayHandlesAccruedDebtAndRefundsExcess() public {
        _openDebt(300 * USDC);
        aavePool.accrueDebt(address(debtAsset), address(safe), 10 * USDC);
        debtAsset.mint(owner, 700 * USDC);
        debtAsset.mint(address(safe), 7 * USDC);

        uint256 walletBefore = debtAsset.balanceOf(owner);
        vm.startPrank(owner);
        debtAsset.approve(address(borrowModule), 1_000 * USDC);
        uint256 repaid =
            borrowModule.repayDebtFromWallet(address(safe), address(aavePool), address(debtAsset), 1_000 * USDC);
        vm.stopPrank();

        assertEq(repaid, 310 * USDC);
        assertEq(aavePool.userBorrowed(address(debtAsset), address(safe)), 0);
        assertEq(debtAsset.balanceOf(owner), walletBefore - 310 * USDC);
        assertEq(debtAsset.balanceOf(address(safe)), 7 * USDC, "existing Safe funds are untouched");
        assertEq(debtAsset.allowance(address(safe), address(aavePool)), 0, "pool allowance is cleared");
    }

    function testWalletRepaySupportsPartialDebtRepayment() public {
        _openDebt(300 * USDC);

        vm.startPrank(owner);
        debtAsset.approve(address(borrowModule), 100 * USDC);
        borrowModule.repayDebtFromWallet(address(safe), address(aavePool), address(debtAsset), 100 * USDC);
        vm.stopPrank();

        assertEq(aavePool.userBorrowed(address(debtAsset), address(safe)), 200 * USDC);
        assertEq(debtAsset.balanceOf(address(safe)), 0);
        assertEq(debtAsset.allowance(address(safe), address(aavePool)), 0);
    }

    function testSafeFundedRepayClearsPoolAllowance() public {
        _supplyCollateral();
        vm.startPrank(owner);
        borrowModule.borrowToSafe(address(safe), address(aavePool), address(debtAsset), 300 * USDC);
        borrowModule.repayDebt(address(safe), address(aavePool), address(debtAsset), 300 * USDC);
        vm.stopPrank();

        assertEq(aavePool.userBorrowed(address(debtAsset), address(safe)), 0);
        assertEq(debtAsset.balanceOf(address(safe)), 0);
        assertEq(debtAsset.allowance(address(safe), address(aavePool)), 0);
    }

    function testWalletRepayDebtFreeRefundsWalletFunds() public {
        debtAsset.mint(owner, 100 * USDC);
        debtAsset.mint(address(safe), 3 * USDC);
        uint256 walletBefore = debtAsset.balanceOf(owner);

        vm.startPrank(owner);
        debtAsset.approve(address(borrowModule), 100 * USDC);
        uint256 repaid =
            borrowModule.repayDebtFromWallet(address(safe), address(aavePool), address(debtAsset), 100 * USDC);
        vm.stopPrank();

        assertEq(repaid, 0);
        assertEq(debtAsset.balanceOf(owner), walletBefore);
        assertEq(debtAsset.balanceOf(address(safe)), 3 * USDC);
        assertEq(debtAsset.allowance(address(safe), address(aavePool)), 0);
    }

    function testWalletRepayRejectsInsufficientWalletBalanceOrAllowance() public {
        _openDebt(100 * USDC);

        vm.prank(owner);
        vm.expectRevert();
        borrowModule.repayDebtFromWallet(address(safe), address(aavePool), address(debtAsset), 1 * USDC);

        vm.startPrank(owner);
        debtAsset.approve(address(borrowModule), 101 * USDC);
        vm.expectRevert();
        borrowModule.repayDebtFromWallet(address(safe), address(aavePool), address(debtAsset), 101 * USDC);
        vm.stopPrank();

        assertEq(aavePool.userBorrowed(address(debtAsset), address(safe)), 100 * USDC);
        assertEq(debtAsset.balanceOf(address(safe)), 0);
    }

    function testRecoveryRequiresSafeOwner() public {
        debtAsset.mint(attacker, 1 * USDC);
        vm.startPrank(attacker);
        debtAsset.approve(address(borrowModule), 1 * USDC);
        vm.expectRevert("NOT_SAFE_OWNER");
        borrowModule.repayDebtFromWallet(address(safe), address(aavePool), address(debtAsset), 1 * USDC);
        vm.stopPrank();
    }

    function testDebtFreeCollateralReleaseReturnsCollateralToSafe() public {
        _supplyCollateral();

        vm.prank(owner);
        uint256 withdrawn =
            borrowModule.withdrawCollateral(address(safe), address(aavePool), address(collateral), COLLATERAL, 1e18);

        assertEq(withdrawn, COLLATERAL);
        assertEq(collateral.balanceOf(address(safe)), COLLATERAL);
        assertEq(aavePool.userSupplied(address(collateral), address(safe)), 0);
    }

    function testCollateralReleaseFailsAtomicallyWhenAaveRejectsHealthFactor() public {
        _openDebt(700 * USDC);

        vm.prank(owner);
        vm.expectRevert("EXEC_MODULE_FAILED");
        borrowModule.withdrawCollateral(address(safe), address(aavePool), address(collateral), 2 ether, 1e18);

        assertEq(aavePool.userSupplied(address(collateral), address(safe)), COLLATERAL);
        assertEq(collateral.balanceOf(address(safe)), 0);
    }

    function testCollateralReleaseEnforcesCallerHealthFactorFloorAtomically() public {
        _openDebt(700 * USDC);

        vm.prank(owner);
        vm.expectRevert("HEALTH_FACTOR_BELOW_FLOOR");
        borrowModule.withdrawCollateral(address(safe), address(aavePool), address(collateral), 1 ether, 11e17);

        assertEq(aavePool.userSupplied(address(collateral), address(safe)), COLLATERAL);
        assertEq(collateral.balanceOf(address(safe)), 0);
    }

    function testCollateralReleaseSucceedsAboveAaveAndCallerFloors() public {
        _openDebt(600 * USDC);

        vm.prank(owner);
        borrowModule.withdrawCollateral(address(safe), address(aavePool), address(collateral), 1 ether, 11e17);

        assertEq(aavePool.userSupplied(address(collateral), address(safe)), 9 ether);
        assertEq(collateral.balanceOf(address(safe)), 1 ether);
    }

    function testCollateralReleaseRequiresAtLeastAaveLiquidationFloor() public {
        _supplyCollateral();

        vm.prank(owner);
        vm.expectRevert("HEALTH_FACTOR_FLOOR_TOO_LOW");
        borrowModule.withdrawCollateral(address(safe), address(aavePool), address(collateral), 1 ether, 1e18 - 1);
    }

    function _supplyCollateral() private {
        vm.prank(owner);
        borrowModule.supplyCollateral(address(safe), address(aavePool), address(collateral), COLLATERAL);
    }

    function _openDebt(uint256 amount) private {
        _supplyCollateral();
        vm.prank(owner);
        borrowModule.borrowToWallet(address(safe), address(aavePool), address(debtAsset), amount, owner);
    }
}
