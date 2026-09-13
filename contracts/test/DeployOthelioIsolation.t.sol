// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeployOthelio, MockAerodromeFactory} from "../script/DeployOthelio.s.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";

contract DeployOthelioIsolationTest is Test {
    address private constant BASE_AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    function testDefaultDeploymentDoesNotInstallLocalMocks() public {
        vm.chainId(31337);
        vm.setEnv("COINBASE_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000");
        vm.setEnv("GOVERNANCE_OWNER_ADDRESS", "0x0000000000000000000000000000000000009999");

        DeployOthelio deployment = new DeployOthelio();
        (,,,, address dexRouter,) = deployment.runWithLocalMocks(false);

        assertEq(dexRouter, address(0));
        assertEq(BASE_AAVE_POOL.code.length, 0);
    }

    function testLocalMockModePreservesExistingAaveCode() public {
        vm.chainId(31337);
        vm.setEnv("COINBASE_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000");
        vm.etch(BASE_AAVE_POOL, hex"00");
        bytes32 existingCodeHash = BASE_AAVE_POOL.codehash;

        DeployOthelio deployment = new DeployOthelio();
        (,,,, address dexRouter,) = deployment.runWithLocalMocks(true);

        assertNotEq(dexRouter, address(0));
        assertEq(BASE_AAVE_POOL.codehash, existingCodeHash);
    }

    function testMultiFactoryDiscovery() public {
        vm.chainId(31337);
        address extraFactory = makeAddr("extraFactory");
        vm.etch(extraFactory, type(MockAerodromeFactory).runtimeCode);
        vm.setEnv("COINBASE_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000");
        vm.setEnv("GOVERNANCE_OWNER_ADDRESS", "0x0000000000000000000000000000000000009999");
        vm.setEnv("ADDITIONAL_AERODROME_FACTORY", vm.toString(extraFactory));

        DeployOthelio deployment = new DeployOthelio();
        (,, address moduleAddr,,,) = deployment.runWithLocalMocks(false);

        OthelioPortfolioModule module = OthelioPortfolioModule(payable(moduleAddr));
        OthelioAerodromeSlipstreamAdapter adapter = OthelioAerodromeSlipstreamAdapter(module.aerodromeAdapter());
        OthelioAerodromeRouteRegistry routeRegistry = adapter.routeRegistry();

        (address factory, address pool) = routeRegistry.requireApprovedPool(
            block.chainid,
            0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913,
            TokenizedAssetConstants.AAPLc,
            100
        );

        assertEq(factory, extraFactory, "Multi-factory discovery failed to register extraFactory");
        assertEq(pool, extraFactory, "Discovered pool does not match extraFactory pool");
    }
}
