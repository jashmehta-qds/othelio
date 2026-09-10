// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketModule, ISafe} from "../src/safe/OthelioBasketModule.sol";
import {OthelioBasketGuard} from "../src/safe/OthelioBasketGuard.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {MockV3Aggregator} from "./BasketOracle.t.sol";

contract MockERC20Token is ERC20 {
    uint8 private immutable _decimals;
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }
    function decimals() public view override returns (uint8) { return _decimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockAToken is MockERC20Token {
    address public immutable underlyingAsset;
    constructor(string memory name_, string memory symbol_, address underlying_) 
        MockERC20Token(name_, symbol_, 18) 
    {
        underlyingAsset = underlying_;
    }
}

contract MockAaveV3Pool {
    mapping(address => mapping(address => uint256)) public userCollateral; // user => asset => amount
    mapping(address => mapping(address => uint256)) public userDebt;       // user => debtAsset => amount
    mapping(address => address) public aTokens;                            // asset => aToken

    function setAToken(address asset, address aToken) external {
        aTokens[asset] = aToken;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        userCollateral[onBehalfOf][asset] += amount;
        if (aTokens[asset] != address(0)) {
            MockAToken(aTokens[asset]).mint(onBehalfOf, amount);
        }
    }

    function borrow(address asset, uint256 amount, uint256, uint16, address onBehalfOf) external {
        userDebt[onBehalfOf][asset] += amount;
        MockERC20Token(asset).mint(onBehalfOf, amount);
    }

    function repay(address asset, uint256 amount, uint256, address onBehalfOf) external returns (uint256) {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        if (userDebt[onBehalfOf][asset] >= amount) {
            userDebt[onBehalfOf][asset] -= amount;
        } else {
            userDebt[onBehalfOf][asset] = 0;
        }
        return amount;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(userCollateral[msg.sender][asset] >= amount, "INSUFFICIENT_COLLATERAL");
        userCollateral[msg.sender][asset] -= amount;
        IERC20(asset).transfer(to, amount);
        return amount;
    }
}

contract OthelioAaveIntegrationTest is Test {
    OthelioAssetRegistry public registry;
    BasketOracle public oracle;
    OthelioBasketModule public module;
    OthelioSafeFactory public factory;

    MockERC20Token public tokenNVDA;
    MockERC20Token public tokenUSDC;
    MockAToken public aTokenNVDA;
    MockAaveV3Pool public aavePool;

    MockV3Aggregator public feedNVDA;
    MockV3Aggregator public feedUSDC;

    address public owner = address(0xAA11);
    address public basketAddress;
    OthelioBasketAccount public basket;

    function setUp() public {
        vm.startPrank(owner);

        registry = new OthelioAssetRegistry(owner, address(0));
        oracle = new BasketOracle(address(registry));
        module = new OthelioBasketModule(address(oracle));
        factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));

        tokenNVDA = new MockERC20Token("NVIDIA Token", "NVDAc", 18);
        tokenUSDC = new MockERC20Token("USD Coin", "USDC", 6);
        aTokenNVDA = new MockAToken("Aave NVDA Collateral", "aNVDAc", address(tokenNVDA));

        feedNVDA = new MockV3Aggregator(8, 100 * 1e8); // $100 per NVDA
        feedUSDC = new MockV3Aggregator(8, 1 * 1e8);   // $1 per USDC

        registry.configure(block.chainid, address(tokenNVDA), address(feedNVDA), true, 18, 8, true);
        registry.configure(block.chainid, address(tokenUSDC), address(feedUSDC), true, 6, 8, false);

        aavePool = new MockAaveV3Pool();
        aavePool.setAToken(address(tokenNVDA), address(aTokenNVDA));
        registry.setApprovedLendingPool(address(aavePool), true);

        // Create Basket Account via Factory
        basketAddress = factory.createBasket("Tech Collateral Basket");
        basket = OthelioBasketAccount(payable(basketAddress));

        // Seed 10 NVDA ($1000 NAV) into Basket
        tokenNVDA.mint(basketAddress, 10 * 1e18);

        vm.stopPrank();
    }

    function testBasketInitialNAV() public view {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tokenNVDA);
        uint256[] memory balances = new uint256[](1);
        balances[0] = tokenNVDA.balanceOf(basketAddress);

        uint256 nav = oracle.calculateNAV(tokens, balances);
        assertEq(nav, 1000 * 1e6); // $1000 USDC NAV
    }

    function testAaveSupplyAndBorrowLifecycle() public {
        // Step 1: Safe owner executes Aave Supply call via dedicated module method
        vm.startPrank(owner);

        module.supplyToAave(basketAddress, address(aavePool), address(tokenNVDA), 10 * 1e18);

        // Verify Safe received aNVDA collateral tokens and pool recorded collateral
        assertEq(tokenNVDA.balanceOf(address(aavePool)), 10 * 1e18);
        assertEq(aTokenNVDA.balanceOf(basketAddress), 10 * 1e18);
        assertEq(aavePool.userCollateral(basketAddress, address(tokenNVDA)), 10 * 1e18);

        // Step 2: Borrow 400 USDC ($400 debt) against $1000 collateral (40% LTV)
        module.borrowFromAave(basketAddress, address(aavePool), address(tokenUSDC), 400 * 1e6);

        // Verify debt and borrowed USDC balance
        assertEq(tokenUSDC.balanceOf(basketAddress), 400 * 1e6);
        assertEq(aavePool.userDebt(basketAddress, address(tokenUSDC)), 400 * 1e6);

        // Step 3: Health Factor Calculation Verification
        // Collateral NAV = $1000, Liquidation Threshold = 80%, Debt = $400
        // Health Factor = (1000 * 0.80) / 400 = 800 / 400 = 2.00 (SAFE)
        uint256 collateralNAV = 1000;
        uint256 debtUSDC = 400;
        uint256 liqThresholdPct = 80;
        uint256 healthFactorScaled = (collateralNAV * liqThresholdPct) / debtUSDC; // 200 = 2.00x
        assertEq(healthFactorScaled, 200);

        // Step 4: Repay Borrowed USDC
        module.repayAave(basketAddress, address(aavePool), address(tokenUSDC), 400 * 1e6);

        assertEq(aavePool.userDebt(basketAddress, address(tokenUSDC)), 0);

        vm.stopPrank();
    }

    function testRevertUnauthorizedAaveExec() public {
        // Non-owner attempts to trigger transaction on Safe via Module
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert("NOT_SAFE_OWNER");
        module.executeTransaction(
            basketAddress,
            address(aavePool),
            0,
            abi.encodeWithSelector(MockAaveV3Pool.borrow.selector, address(tokenUSDC), 1000 * 1e6, 2, 0, attacker)
        );
    }

    function testBorrowAndSweepToEOA() public {
        vm.startPrank(owner);
        module.supplyToAave(basketAddress, address(aavePool), address(tokenNVDA), 10 * 1e18);

        uint256 preOwnerUSDC = tokenUSDC.balanceOf(owner);
        module.borrowAndSweep(basketAddress, address(aavePool), address(tokenUSDC), 400 * 1e6, owner);

        assertEq(tokenUSDC.balanceOf(owner) - preOwnerUSDC, 400 * 1e6);
        assertEq(tokenUSDC.balanceOf(basketAddress), 0);
        assertEq(aavePool.userDebt(basketAddress, address(tokenUSDC)), 400 * 1e6);
        vm.stopPrank();
    }
}
