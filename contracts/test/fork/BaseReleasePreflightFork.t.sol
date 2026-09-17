// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeployBaseOthelio} from "../../script/DeployBaseOthelio.s.sol";
import {OthelioDeploymentAssets} from "../../script/OthelioDeploymentAssets.sol";
import {OthelioAssetRegistry} from "../../src/registry/OthelioAssetRegistry.sol";
import {OthelioPortfolioModule} from "../../src/safe/OthelioPortfolioModule.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioSafeFactory} from "../../src/factory/OthelioSafeFactory.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../../src/dex/AerodromeRouteTypes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IReleaseAerodromeQuoter {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256);
}

/// @notice Required release gate. Run through script/verify-base-release.sh;
/// normal local tests skip it because an archival Base RPC is intentionally not required for everyday development.
contract BaseReleasePreflightForkTest is Test {
    uint256 private constant BASE_FORK_BLOCK = 51_166_844;
    uint256 private constant DEPLOYER_PRIVATE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address private constant GOVERNANCE = 0x0000000000000000000000000000000000009999;
    address private constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address private constant QUOTER = 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a;

    function testFork_ProductionLaunchManifestAndB20Execution() public {
        if (!vm.envOr("REQUIRE_BASE_RELEASE_TESTS", false)) {
            vm.skip(true, "Release-only: run script/verify-base-release.sh with an archival BASE_RPC_URL");
        }
        string memory rpcUrl = vm.envString("BASE_RPC_URL");
        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);
        address deployer = vm.addr(DEPLOYER_PRIVATE_KEY);
        vm.deal(deployer, 100 ether);
        vm.setEnv("PRIVATE_KEY", vm.toString(DEPLOYER_PRIVATE_KEY));
        vm.setEnv("GOVERNANCE_OWNER_ADDRESS", vm.toString(GOVERNANCE));

        DeployBaseOthelio deployment = new DeployBaseOthelio();
        (address registryAddress,, address moduleAddress, address factoryAddress) = deployment.run();
        OthelioAssetRegistry registry = OthelioAssetRegistry(registryAddress);
        OthelioPortfolioModule module = OthelioPortfolioModule(payable(moduleAddress));
        OthelioAerodromeRouteRegistry routes =
            OthelioAerodromeSlipstreamAdapter(module.aerodromeAdapter()).routeRegistry();

        assertEq(registry.pendingOwner(), GOVERNANCE, "asset registry governance handoff missing");
        assertEq(routes.pendingOwner(), GOVERNANCE, "route registry governance handoff missing");

        (address[] memory tokens,) = OthelioDeploymentAssets.tokensAndBaseFeeds();
        for (uint256 i; i < tokens.length; i++) {
            assertTrue(registry.isSupported(block.chainid, tokens[i]), "launch B20 not configured");
            _approvedTick(routes, USDC, tokens[i]);
        }

        address owner = makeAddr("release-test-owner");
        OthelioSafeFactory factory = OthelioSafeFactory(factoryAddress);
        vm.prank(owner);
        address basket = factory.createBasket("Release B20 basket");

        address firstB20 = tokens[0];
        address secondB20 = tokens[1];
        int24 usdcToFirstTick = _approvedTick(routes, USDC, firstB20);
        uint256 funding = 100e6;
        deal(USDC, owner, funding);
        uint256 firstOut = _quote(abi.encodePacked(USDC, usdcToFirstTick, firstB20), funding);
        AerodromeRoute[] memory fundingRoutes = new AerodromeRoute[](1);
        fundingRoutes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: USDC,
            tokenOut: firstB20,
            firstTickSpacing: usdcToFirstTick,
            secondTickSpacing: 0,
            amountIn: funding,
            minimumAmountOut: (firstOut * 99) / 100
        });
        vm.startPrank(owner);
        IERC20(USDC).approve(moduleAddress, funding);
        module.fundAerodromePortfolio(basket, USDC, funding, fundingRoutes, block.timestamp + 300);
        vm.stopPrank();

        uint256 firstBalance = IERC20(firstB20).balanceOf(basket);
        assertGt(firstBalance, 0, "direct B20 purchase failed");
        int24 firstToUsdcTick = _approvedTick(routes, firstB20, USDC);
        int24 usdcToSecondTick = _approvedTick(routes, USDC, secondB20);
        uint256 secondOut = _quote(
            abi.encodePacked(firstB20, firstToUsdcTick, USDC, usdcToSecondTick, secondB20), firstBalance
        );
        AerodromeRoute[] memory rebalanceRoutes = new AerodromeRoute[](1);
        rebalanceRoutes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.VIA_USDC,
            tokenIn: firstB20,
            tokenOut: secondB20,
            firstTickSpacing: firstToUsdcTick,
            secondTickSpacing: usdcToSecondTick,
            amountIn: firstBalance,
            minimumAmountOut: (secondOut * 99) / 100
        });
        vm.prank(owner);
        module.rebalanceAerodromePortfolio(basket, rebalanceRoutes, block.timestamp + 300);
        assertGt(IERC20(secondB20).balanceOf(basket), 0, "via-USDC B20 rebalance failed");
    }

    function _approvedTick(OthelioAerodromeRouteRegistry routes, address tokenA, address tokenB)
        private
        view
        returns (int24)
    {
        int24[4] memory ticks = [int24(100), int24(200), int24(500), int24(2000)];
        for (uint256 i; i < ticks.length; i++) {
            try routes.requireApprovedPool(block.chainid, tokenA, tokenB, ticks[i]) returns (address, address) {
                return ticks[i];
            } catch {}
        }
        revert("MISSING_RELEASE_ROUTE");
    }

    function _quote(bytes memory path, uint256 amountIn) private returns (uint256 amountOut) {
        (amountOut,,,) = IReleaseAerodromeQuoter(QUOTER).quoteExactInput(path, amountIn);
        require(amountOut > 0, "ZERO_RELEASE_QUOTE");
    }
}
