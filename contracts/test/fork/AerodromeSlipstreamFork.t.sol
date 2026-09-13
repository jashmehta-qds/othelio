// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry} from "../../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../../src/oracle/BasketOracle.sol";
import {OthelioPortfolioModule} from "../../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../../src/lending/OthelioAaveV3Adapter.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry, IAerodromeSlipstreamFactory} from "../../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioBasketAccount} from "../../src/safe/OthelioBasketAccount.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../../src/dex/AerodromeRouteTypes.sol";
import {MockPriceFeed} from "../../src/mock/MockPriceFeed.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAerodromeQuoter {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

contract AerodromeSlipstreamForkTest is Test {
    address private constant BASE_AERODROME_ROUTER = 0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5;
    address private constant BASE_AERODROME_QUOTER = 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a;
    address private constant BASE_AERODROME_FACTORY = 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A;
    address private constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address private constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    address private constant BASE_AERO = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    uint256 private constant BASE_FORK_BLOCK = 30_000_000;

    address private owner = address(0xA11CE);

    function testFork_BaseAerodromeContractsExist() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: Aerodrome fork test skipped");

        vm.createSelectFork(rpcUrl);

        console.log("Router code length:", BASE_AERODROME_ROUTER.code.length);
        console.log("Factory code length:", BASE_AERODROME_FACTORY.code.length);
        console.log("USDC code length:", BASE_USDC.code.length);

        assertGt(BASE_AERODROME_ROUTER.code.length, 0, "Aerodrome router missing on Base");
        assertGt(BASE_AERODROME_QUOTER.code.length, 0, "Aerodrome quoter missing on Base");
        assertGt(BASE_AERODROME_FACTORY.code.length, 0, "Aerodrome factory missing on Base");
        assertGt(BASE_USDC.code.length, 0, "USDC token missing on Base");
    }

    function testFork_DirectAerodromeSwapExecution() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: Aerodrome fork test skipped");

        vm.createSelectFork(rpcUrl);

        vm.startPrank(owner);
        OthelioAssetRegistry registry = new OthelioAssetRegistry(owner, address(0));
        BasketOracle oracle = new BasketOracle(address(registry));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(owner);
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(address(0x1111)); // mock placeholder for lending

        OthelioAerodromeSlipstreamAdapter dexAdapter = new OthelioAerodromeSlipstreamAdapter(
            BASE_AERODROME_ROUTER,
            BASE_USDC,
            address(routeRegistry)
        );

        OthelioPortfolioModule portfolio = new OthelioPortfolioModule(
            address(oracle),
            address(aaveAdapter),
            address(dexAdapter),
            false,
            1.25e18
        );

        OthelioBasketAccount basket = new OthelioBasketAccount(owner, address(portfolio), address(registry));

        // Configure feeds: USDC = $1 (6 dec, 8 feed dec), WETH = $3000 (18 dec, 8 feed dec)
        registry.configure(block.chainid, BASE_USDC, address(new MockPriceFeed(1e8)), true, 6, 8, false);
        registry.configure(block.chainid, BASE_WETH, address(new MockPriceFeed(3000e8)), true, 18, 8, false);

        // Approve pool
        routeRegistry.setPoolApproval(block.chainid, BASE_USDC, BASE_WETH, 100, BASE_AERODROME_FACTORY, true);
        vm.stopPrank();

        // Query real Aerodrome Quoter for 100 USDC -> WETH
        bytes memory path = abi.encodePacked(BASE_USDC, int24(100), BASE_WETH);
        (uint256 expectedOut,,,) = IAerodromeQuoter(BASE_AERODROME_QUOTER).quoteExactInput(path, 100e6);
        assertGt(expectedOut, 0, "Quoter returned 0 output for USDC -> WETH");

        // Fund owner with USDC and execute fundAerodromePortfolio
        deal(BASE_USDC, owner, 100e6);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: BASE_USDC,
            tokenOut: BASE_WETH,
            firstTickSpacing: 100,
            secondTickSpacing: 0,
            amountIn: 100e6,
            minimumAmountOut: (expectedOut * 99) / 100 // 1% slippage
        });

        vm.startPrank(owner);
        IERC20(BASE_USDC).approve(address(portfolio), 100e6);
        portfolio.fundAerodromePortfolio(
            address(basket),
            BASE_USDC,
            100e6,
            routes,
            block.timestamp + 300
        );
        vm.stopPrank();

        assertGt(IERC20(BASE_WETH).balanceOf(address(basket)), 0, "Basket did not receive WETH from direct swap");
    }

    function testFork_ViaUsdcAerodromeSwapExecution() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: Aerodrome fork test skipped");

        vm.createSelectFork(rpcUrl);

        vm.startPrank(owner);
        OthelioAssetRegistry registry = new OthelioAssetRegistry(owner, address(0));
        BasketOracle oracle = new BasketOracle(address(registry));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(owner);
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(address(0x1111));

        OthelioAerodromeSlipstreamAdapter dexAdapter = new OthelioAerodromeSlipstreamAdapter(
            BASE_AERODROME_ROUTER,
            BASE_USDC,
            address(routeRegistry)
        );

        OthelioPortfolioModule portfolio = new OthelioPortfolioModule(
            address(oracle),
            address(aaveAdapter),
            address(dexAdapter),
            false,
            1.25e18
        );

        OthelioBasketAccount basket = new OthelioBasketAccount(owner, address(portfolio), address(registry));

        // Configure feeds: USDC = $1, WETH = $3000, AERO = $0.084
        registry.configure(block.chainid, BASE_USDC, address(new MockPriceFeed(1e8)), true, 6, 8, false);
        registry.configure(block.chainid, BASE_WETH, address(new MockPriceFeed(3000e8)), true, 18, 8, false);
        registry.configure(block.chainid, BASE_AERO, address(new MockPriceFeed(8400000)), true, 18, 8, false);

        // Approve pools: WETH <-> USDC (tick 100) and USDC <-> AERO (tick 100)
        routeRegistry.setPoolApproval(block.chainid, BASE_WETH, BASE_USDC, 100, BASE_AERODROME_FACTORY, true);
        routeRegistry.setPoolApproval(block.chainid, BASE_USDC, BASE_AERO, 100, BASE_AERODROME_FACTORY, true);
        vm.stopPrank();

        // Query real Aerodrome Quoter for 0.01 WETH -> USDC -> AERO
        bytes memory path = abi.encodePacked(BASE_WETH, int24(100), BASE_USDC, int24(100), BASE_AERO);
        (uint256 expectedOut,,,) = IAerodromeQuoter(BASE_AERODROME_QUOTER).quoteExactInput(path, 0.01 ether);
        assertGt(expectedOut, 0, "Quoter returned 0 output for WETH -> USDC -> AERO");

        // Fund basket with WETH and rebalance
        deal(BASE_WETH, address(basket), 0.01 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: BASE_WETH,
            tokenOut: BASE_AERO,
            firstTickSpacing: 100,
            secondTickSpacing: 100,
            amountIn: 0.01 ether,
            minimumAmountOut: expectedOut
        });

        vm.prank(owner);
        portfolio.rebalanceAerodromePortfolio(
            address(basket),
            routes,
            block.timestamp + 300
        );

        assertGt(IERC20(BASE_AERO).balanceOf(address(basket)), 0, "Basket did not receive AERO from 2-hop swap");
        assertEq(IERC20(BASE_WETH).balanceOf(address(basket)), 0, "Basket still holds WETH after swap");
    }
}
