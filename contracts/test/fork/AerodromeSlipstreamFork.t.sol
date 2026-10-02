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
import {OthelioSafeFactory} from "../../src/factory/OthelioSafeFactory.sol";
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
    address private constant BASE_AERODROME_ROUTER = 0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F;
    bytes32 private constant BASE_AERODROME_ROUTER_CODEHASH = 0xfedc4e21e1097b0ec1b4f1aa901cf645c22f9e5d297727b0f37275ee1d083df4;
    address private constant BASE_AERODROME_QUOTER = 0x514c8B5f54112481E28028F1166Bd78501089259;
    address private constant BASE_AERODROME_FACTORY = 0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef;
    address private constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address private constant BASE_AAPL = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address private constant BASE_GOOGL = 0xb2000000000000000000002D0BA3164cc74f58B7;
    uint256 private constant BASE_FORK_BLOCK = 51_166_844;

    address private owner = address(0xA11CE);

    function testFork_BaseAerodromeContractsExist() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: Aerodrome fork test skipped");

        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        console.log("Router code length:", BASE_AERODROME_ROUTER.code.length);
        console.log("Factory code length:", BASE_AERODROME_FACTORY.code.length);
        console.log("USDC code length:", BASE_USDC.code.length);

        assertGt(BASE_AERODROME_ROUTER.code.length, 0, "Aerodrome router missing on Base");
        assertEq(BASE_AERODROME_ROUTER.codehash, BASE_AERODROME_ROUTER_CODEHASH, "Aerodrome router code changed");
        assertGt(BASE_AERODROME_QUOTER.code.length, 0, "Aerodrome quoter missing on Base");
        assertGt(BASE_AERODROME_FACTORY.code.length, 0, "Aerodrome factory missing on Base");
        assertGt(BASE_USDC.code.length, 0, "USDC token missing on Base");
    }

    function testFork_DirectAerodromeSwapExecution() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: Aerodrome fork test skipped");

        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        vm.startPrank(owner);
        OthelioAssetRegistry registry = new OthelioAssetRegistry(owner);
        BasketOracle oracle = new BasketOracle(address(registry));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(owner, BASE_AERODROME_FACTORY);
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

        OthelioSafeFactory basketFactory = new OthelioSafeFactory(address(portfolio), address(registry));
        portfolio.setFactory(address(basketFactory));
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketFactory.createBasket("Fork basket")));

        // Configure feeds: USDC = $1 (6 dec, 8 feed dec), AAPLc (8 token dec, 8 feed dec).
        address usdcFeed = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
        address aaplFeed = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
        registry.configure(block.chainid, BASE_USDC, usdcFeed, true, 6, 8, false);
        registry.configure(block.chainid, BASE_AAPL, aaplFeed, true, 8, 8, true);
        assertTrue(registry.isVerifiedCoinbaseB20(block.chainid, BASE_AAPL), "AAPLc is not an initialized B20");

        routeRegistry.setPoolApproval(block.chainid, BASE_USDC, BASE_AAPL, 10, BASE_AERODROME_FACTORY, true);
        vm.stopPrank();

        // Query real Aerodrome Quoter for 100 USDC -> AAPLc.
        bytes memory path = abi.encodePacked(BASE_USDC, int24(10), BASE_AAPL);
        (uint256 expectedOut,,,) = IAerodromeQuoter(BASE_AERODROME_QUOTER).quoteExactInput(path, 100e6);
        assertGt(expectedOut, 0, "Quoter returned 0 output for USDC -> AAPLc");

        // Fund owner with USDC and execute fundAerodromePortfolio
        deal(BASE_USDC, owner, 100e6);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: BASE_USDC,
            tokenOut: BASE_AAPL,
            firstTickSpacing: 10,
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

        assertGt(IERC20(BASE_AAPL).balanceOf(address(basket)), 0, "Basket did not receive AAPLc from direct swap");
    }

    function testFork_ViaUsdcAerodromeSwapExecution() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: Aerodrome fork test skipped");

        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        vm.startPrank(owner);
        OthelioAssetRegistry registry = new OthelioAssetRegistry(owner);
        BasketOracle oracle = new BasketOracle(address(registry));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(owner, BASE_AERODROME_FACTORY);
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

        OthelioSafeFactory basketFactory = new OthelioSafeFactory(address(portfolio), address(registry));
        portfolio.setFactory(address(basketFactory));
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketFactory.createBasket("Fork basket")));

        // Configure feeds: USDC = $1, AAPLc, GOOGLc using real Base Chainlink price feeds.
        address usdcFeed = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
        address aaplFeed = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
        address googlFeed = 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2;
        registry.configure(block.chainid, BASE_USDC, usdcFeed, true, 6, 8, false);
        registry.configure(block.chainid, BASE_AAPL, aaplFeed, true, 8, 8, true);
        registry.configure(block.chainid, BASE_GOOGL, googlFeed, true, 8, 8, true);
        assertTrue(registry.isVerifiedCoinbaseB20(block.chainid, BASE_AAPL), "AAPLc is not an initialized B20");
        assertTrue(registry.isVerifiedCoinbaseB20(block.chainid, BASE_GOOGL), "GOOGLc is not an initialized B20");

        routeRegistry.setPoolApproval(block.chainid, BASE_USDC, BASE_AAPL, 10, BASE_AERODROME_FACTORY, true);
        routeRegistry.setPoolApproval(block.chainid, BASE_AAPL, BASE_USDC, 10, BASE_AERODROME_FACTORY, true);
        routeRegistry.setPoolApproval(block.chainid, BASE_USDC, BASE_GOOGL, 10, BASE_AERODROME_FACTORY, true);
        vm.stopPrank();

        // Step 1: Fund basket with AAPLc via fundAerodromePortfolio
        uint256 funding = 100e6;
        deal(BASE_USDC, owner, funding);
        bytes memory pathFund = abi.encodePacked(BASE_USDC, int24(10), BASE_AAPL);
        (uint256 expectedFundOut,,,) = IAerodromeQuoter(BASE_AERODROME_QUOTER).quoteExactInput(pathFund, funding);

        AerodromeRoute[] memory fundRoutes = new AerodromeRoute[](1);
        fundRoutes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: BASE_USDC,
            tokenOut: BASE_AAPL,
            firstTickSpacing: 10,
            secondTickSpacing: 0,
            amountIn: funding,
            minimumAmountOut: (expectedFundOut * 99) / 100
        });

        vm.startPrank(owner);
        IERC20(BASE_USDC).approve(address(portfolio), funding);
        portfolio.fundAerodromePortfolio(
            address(basket),
            BASE_USDC,
            funding,
            fundRoutes,
            block.timestamp + 300
        );
        vm.stopPrank();

        uint256 aaplBalance = IERC20(BASE_AAPL).balanceOf(address(basket));
        assertGt(aaplBalance, 0, "Basket did not receive AAPLc from funding");

        // Step 2: Rebalance AAPLc -> USDC -> GOOGLc
        bytes memory pathRebalance = abi.encodePacked(BASE_AAPL, int24(10), BASE_USDC, int24(10), BASE_GOOGL);
        (uint256 expectedOut,,,) = IAerodromeQuoter(BASE_AERODROME_QUOTER).quoteExactInput(pathRebalance, aaplBalance);
        assertGt(expectedOut, 0, "Quoter returned 0 output for AAPLc -> USDC -> GOOGLc");

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: BASE_AAPL,
            tokenOut: BASE_GOOGL,
            firstTickSpacing: 10,
            secondTickSpacing: 10,
            amountIn: aaplBalance,
            minimumAmountOut: (expectedOut * 99) / 100
        });

        vm.prank(owner);
        portfolio.rebalanceAerodromePortfolio(
            address(basket),
            routes,
            block.timestamp + 300
        );

        assertGt(IERC20(BASE_GOOGL).balanceOf(address(basket)), 0, "Basket did not receive GOOGLc from 2-hop swap");
        assertEq(IERC20(BASE_AAPL).balanceOf(address(basket)), 0, "Basket still holds AAPLc after swap");
    }
}
