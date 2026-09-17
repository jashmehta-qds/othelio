// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../src/lending/OthelioAaveV3Adapter.sol";
import {MockAavePool} from "../src/mock/MockAavePool.sol";
import {MockPriceFeed} from "../src/mock/MockPriceFeed.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../src/dex/AerodromeRouteTypes.sol";

contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFactory {
    function getPool(address, address, int24) external view returns (address) {
        return address(this);
    }
}

contract OthelioConstrainedRoutingTest is Test {
    address private owner = address(0xA11CE);
    address private stranger = address(0xBAD);

    OthelioAssetRegistry private registry;
    BasketOracle private oracle;
    OthelioAaveV3Adapter private aaveAdapter;
    OthelioAerodromeRouteRegistry private routeRegistry;
    OthelioAerodromeSlipstreamAdapter private dexAdapter;
    OthelioPortfolioModule private portfolio;
    OthelioBasketAccount private basket;
    OthelioSafeFactory private basketFactory;
    MockDEXRouter private router;
    MockFactory private factory;

    TestToken private usdc;
    TestToken private nvda;
    TestToken private goog;

    function setUp() public {
        vm.startPrank(owner);
        registry = new OthelioAssetRegistry(owner, address(0));
        oracle = new BasketOracle(address(registry));
        MockAavePool pool = new MockAavePool();
        aaveAdapter = new OthelioAaveV3Adapter(address(pool));

        factory = new MockFactory();
        router = new MockDEXRouter();
        routeRegistry = new OthelioAerodromeRouteRegistry(owner, address(factory));

        usdc = new TestToken("USDC", "USDC");
        nvda = new TestToken("NVIDIA", "NVDAc");
        goog = new TestToken("Alphabet", "GOOGc");

        dexAdapter = new OthelioAerodromeSlipstreamAdapter(
            address(router),
            address(usdc),
            address(routeRegistry)
        );

        portfolio = new OthelioPortfolioModule(
            address(oracle),
            address(aaveAdapter),
            address(dexAdapter),
            false,
            1.25e18
        );

        basketFactory = new OthelioSafeFactory(address(portfolio), address(registry));
        portfolio.setFactory(address(basketFactory));
        basket = OthelioBasketAccount(payable(basketFactory.createBasket("Test basket")));

        // Configure oracle feeds: USDC = $1, NVDA = $100, GOOG = $100
        registry.configure(block.chainid, address(usdc), address(new MockPriceFeed(1e8)), true, 18, 8, false);
        registry.configure(block.chainid, address(nvda), address(new MockPriceFeed(100e8)), true, 18, 8, false);
        registry.configure(block.chainid, address(goog), address(new MockPriceFeed(100e8)), true, 18, 8, false);

        // Approve pools: USDC <-> NVDA (tick 100) and USDC <-> GOOG (tick 100)
        routeRegistry.setPoolApproval(block.chainid, address(usdc), address(nvda), 100, address(factory), true);
        routeRegistry.setPoolApproval(block.chainid, address(usdc), address(goog), 100, address(factory), true);

        vm.stopPrank();
    }

    function testApprovedDexRoutesReturnsTrueForRouter() public view {
        assertTrue(portfolio.approvedDexRoutes(address(router), address(router)));
        assertFalse(portfolio.approvedDexRoutes(address(router), stranger));
        assertFalse(portfolio.approvedDexRoutes(stranger, address(router)));
    }

    function testDirectRouteFundingSucceeds() public {
        usdc.mint(owner, 100 ether);
        nvda.mint(address(router), 1 ether); // $100 NVDA for $100 USDC

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: address(usdc),
            tokenOut: address(nvda),
            firstTickSpacing: 100,
            secondTickSpacing: 0,
            amountIn: 100 ether,
            minimumAmountOut: 0.99 ether // $99 min out ($100 in, 1% slippage)
        });

        vm.startPrank(owner);
        usdc.approve(address(portfolio), 100 ether);
        portfolio.fundAerodromePortfolio(
            address(basket),
            address(usdc),
            100 ether,
            routes,
            block.timestamp + 1
        );
        vm.stopPrank();

        assertEq(nvda.balanceOf(address(basket)), 0.99 ether);
        assertEq(usdc.allowance(address(basket), address(router)), 0);
    }

    function testFundingRevertsIfNotUsdc() public {
        nvda.mint(owner, 1 ether);
        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: address(nvda),
            tokenOut: address(goog),
            firstTickSpacing: 100,
            secondTickSpacing: 100,
            amountIn: 1 ether,
            minimumAmountOut: 0.99 ether
        });

        vm.startPrank(owner);
        nvda.approve(address(portfolio), 1 ether);
        vm.expectRevert("MUST_FUND_WITH_USDC");
        portfolio.fundAerodromePortfolio(
            address(basket),
            address(nvda),
            1 ether,
            routes,
            block.timestamp + 1
        );
        vm.stopPrank();
    }

    function testViaUsdcRebalanceSucceeds() public {
        // NVDA -> USDC -> GOOG
        nvda.mint(address(basket), 1 ether);
        usdc.mint(address(router), 100 ether);
        goog.mint(address(router), 1 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: address(nvda),
            tokenOut: address(goog),
            firstTickSpacing: 100,
            secondTickSpacing: 100,
            amountIn: 1 ether,
            minimumAmountOut: 0.98 ether // 2% slippage max vs oracle $100
        });

        vm.prank(owner);
        portfolio.rebalanceAerodromePortfolio(
            address(basket),
            routes,
            block.timestamp + 1
        );

        assertEq(goog.balanceOf(address(basket)), 0.98 ether);
        assertEq(nvda.allowance(address(basket), address(router)), 0);
    }

    function testRebalanceAggregatesDuplicateBoughtAssetsForNav() public {
        // A rebalance may split one sell asset across several purchases of the
        // same destination. The route event keeps both legs, but NAV must be
        // calculated from their single aggregated GOOG balance.
        nvda.mint(address(basket), 1 ether);
        usdc.mint(address(router), 100 ether);
        goog.mint(address(router), 1 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](2);
        for (uint256 i = 0; i < 2; i++) {
            routes[i] = AerodromeRoute({
                kind: AerodromeRouteKind.VIA_USDC,
                tokenIn: address(nvda),
                tokenOut: address(goog),
                firstTickSpacing: 100,
                secondTickSpacing: 100,
                amountIn: 0.5 ether,
                minimumAmountOut: 0.49 ether
            });
        }

        vm.prank(owner);
        portfolio.rebalanceAerodromePortfolio(address(basket), routes, block.timestamp + 1);

        assertEq(goog.balanceOf(address(basket)), 0.98 ether);
        assertEq(nvda.balanceOf(address(basket)), 0);
    }

    function testRebalanceRevertsIfUnapprovedPool() public {
        TestToken unapproved = new TestToken("Unapproved", "UNP");
        MockPriceFeed unapprovedFeed = new MockPriceFeed(100e8);
        vm.prank(owner);
        registry.configure(block.chainid, address(unapproved), address(unapprovedFeed), true, 18, 8, false);

        nvda.mint(address(basket), 1 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: address(nvda),
            tokenOut: address(unapproved),
            firstTickSpacing: 100,
            secondTickSpacing: 100,
            amountIn: 1 ether,
            minimumAmountOut: 0.98 ether
        });

        vm.prank(owner);
        vm.expectRevert("UNAPPROVED_AERODROME_POOL");
        portfolio.rebalanceAerodromePortfolio(address(basket), routes, block.timestamp + 1);
    }

    function testRebalanceRevertsIfOracleValueLossExceedsLimit() public {
        nvda.mint(address(basket), 1 ether); // $100 in

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: address(nvda),
            tokenOut: address(goog),
            firstTickSpacing: 100,
            secondTickSpacing: 100,
            amountIn: 1 ether,
            minimumAmountOut: 0.95 ether // $95 min out represents 5% loss (exceeds 3% limit)
        });

        vm.prank(owner);
        vm.expectRevert("VALUE_LOSS_EXCEEDED");
        portfolio.rebalanceAerodromePortfolio(address(basket), routes, block.timestamp + 1);
    }

    function testRebalanceRevertsIfRouteCountExceeds16() public {
        AerodromeRoute[] memory routes = new AerodromeRoute[](17);

        vm.prank(owner);
        vm.expectRevert("INVALID_ROUTE_COUNT");
        portfolio.rebalanceAerodromePortfolio(address(basket), routes, block.timestamp + 1);
    }

    function testRebalanceRevertsIfNotSafeOwner() public {
        AerodromeRoute[] memory routes = new AerodromeRoute[](1);

        vm.prank(stranger);
        vm.expectRevert("NOT_SAFE_OWNER");
        portfolio.rebalanceAerodromePortfolio(address(basket), routes, block.timestamp + 1);
    }
}
