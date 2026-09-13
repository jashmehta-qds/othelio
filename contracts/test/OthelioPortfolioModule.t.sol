// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../src/lending/OthelioAaveV3Adapter.sol";
import {MockAavePool} from "../src/mock/MockAavePool.sol";
import {MockPriceFeed} from "../src/mock/MockPriceFeed.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../src/dex/AerodromeRouteTypes.sol";

contract AaveTestToken is ERC20 {
    constructor() ERC20("Aave test token", "ATST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFactory {
    function getPool(address, address, int24) external view returns (address) {
        return address(this);
    }
}

contract OthelioPortfolioModuleTest is Test {
    address private owner = address(0xA11CE);
    OthelioPortfolioModule private portfolio;
    OthelioPortfolioModule private enabledPortfolio;
    OthelioBasketAccount private basket;
    OthelioBasketAccount private enabledBasket;
    OthelioAaveV3Adapter private adapter;
    AaveTestToken private asset;
    AaveTestToken private outputToken;
    MockAavePool private pool;
    OthelioAssetRegistry private registry;
    BasketOracle private oracle;
    OthelioAerodromeRouteRegistry private routeRegistry;
    MockDEXRouter private router;

    function setUp() public {
        vm.startPrank(owner);
        registry = new OthelioAssetRegistry(owner, address(0));
        oracle = new BasketOracle(address(registry));
        pool = new MockAavePool();
        adapter = new OthelioAaveV3Adapter(address(pool));
        router = new MockDEXRouter();
        routeRegistry = new OthelioAerodromeRouteRegistry(owner);
        MockFactory factory = new MockFactory();

        asset = new AaveTestToken();
        outputToken = new AaveTestToken();

        OthelioAerodromeSlipstreamAdapter dexAdapter = new OthelioAerodromeSlipstreamAdapter(
            address(router),
            address(asset),
            address(routeRegistry)
        );
        portfolio = new OthelioPortfolioModule(address(oracle), address(adapter), address(dexAdapter), false, 1.25e18);
        enabledPortfolio = new OthelioPortfolioModule(address(oracle), address(adapter), address(dexAdapter), true, 1.25e18);
        basket = new OthelioBasketAccount(owner, address(portfolio), address(registry));
        enabledBasket = new OthelioBasketAccount(owner, address(enabledPortfolio), address(registry));

        pool.configureReserve(address(asset), 18, 1e8);
        registry.configure(block.chainid, address(asset), address(new MockPriceFeed(1e8)), true, 18, 8, false);
        registry.configure(block.chainid, address(outputToken), address(new MockPriceFeed(1e8)), true, 18, 8, false);

        routeRegistry.setPoolApproval(block.chainid, address(asset), address(outputToken), 100, address(factory), true);
        vm.stopPrank();
    }

    function testOnlyPortfolioModuleHasAccountAuthority() public view {
        assertTrue(basket.isModuleEnabled(address(portfolio)));
        assertFalse(basket.isModuleEnabled(address(adapter)));
    }

    function testNewAaveSupplyIsDisabledByDeploymentPolicy() public {
        vm.prank(owner);
        vm.expectRevert("NEW_AAVE_SUPPLY_DISABLED");
        portfolio.supplyAave(address(basket), address(asset), 1 ether);
    }

    function testPortfolioHasNoGenericLendingEntryPoint() public {
        bytes4 generic = bytes4(keccak256("executeLending(address,address,bytes,address,uint256)"));
        (bool success,) = address(portfolio).call(abi.encodeWithSelector(generic, address(basket), address(adapter), bytes(""), address(0), 0));
        assertFalse(success);
    }

    function testEnabledAaveLifecycleSuppliesAndWithdrawsToBasketOnly() public {
        asset.mint(address(enabledBasket), 10 ether);

        vm.prank(owner);
        enabledPortfolio.supplyAave(address(enabledBasket), address(asset), 10 ether);
        assertEq(pool.userSupplied(address(asset), address(enabledBasket)), 10 ether);
        assertEq(asset.balanceOf(address(enabledBasket)), 0);

        vm.prank(owner);
        uint256 withdrawn = enabledPortfolio.withdrawAaveCollateral(address(enabledBasket), address(asset), 4 ether, 1.25e18);
        assertEq(withdrawn, 4 ether);
        assertEq(asset.balanceOf(address(enabledBasket)), 4 ether);
        assertEq(pool.userSupplied(address(asset), address(enabledBasket)), 6 ether);
    }

    function testWalletRepayClearsExistingDebtAndRefundsUnusedAmount() public {
        asset.mint(address(enabledBasket), 10 ether);
        vm.prank(owner);
        enabledPortfolio.supplyAave(address(enabledBasket), address(asset), 10 ether);
        pool.accrueDebt(address(asset), address(enabledBasket), 3 ether);
        asset.mint(owner, 5 ether);

        vm.startPrank(owner);
        asset.approve(address(enabledPortfolio), 5 ether);
        uint256 repaid = enabledPortfolio.repayAaveFromWallet(address(enabledBasket), address(asset), 5 ether);
        vm.stopPrank();

        assertEq(repaid, 3 ether);
        assertEq(pool.userBorrowed(address(asset), address(enabledBasket)), 0);
        assertEq(asset.balanceOf(owner), 2 ether);
    }

    function testTypedAerodromePortfolioFundingPullsExactInputAndPaysBasket() public {
        asset.mint(owner, 10 ether);
        outputToken.mint(address(router), 10 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: address(asset),
            tokenOut: address(outputToken),
            firstTickSpacing: 100,
            secondTickSpacing: 0,
            amountIn: 10 ether,
            minimumAmountOut: 9.9 ether
        });

        vm.startPrank(owner);
        asset.approve(address(portfolio), 10 ether);
        portfolio.fundAerodromePortfolio(
            address(basket), address(asset), 10 ether, routes, block.timestamp + 1
        );
        vm.stopPrank();

        assertEq(outputToken.balanceOf(address(basket)), 9.9 ether);
        assertEq(asset.allowance(address(basket), portfolio.aerodromeAdapter().router()), 0);
    }
}
