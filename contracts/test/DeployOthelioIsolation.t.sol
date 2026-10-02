// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeployBaseOthelio} from "../script/DeployBaseOthelio.s.sol";
import {DeployBaseForkOthelio} from "../script/DeployBaseForkOthelio.s.sol";
import {DeployLocalOthelio, LocalMockAerodromeFactory} from "../script/local/DeployLocalOthelio.s.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";

contract DeployOthelioIsolationTest is Test {
    address private constant BASE_AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    function testProductionDeploymentFailsClosedOutsideBase() public {
        vm.chainId(31337);
        DeployBaseOthelio deployment = new DeployBaseOthelio();
        vm.expectRevert("PRODUCTION_REQUIRES_BASE");
        deployment.run();
    }

    function testBaseForkDeploymentAcceptsOnly31337() public {
        vm.chainId(31337);
        new DeployBaseForkOthelio().validateChain();
    }

    function testLocalMockModePreservesExistingAaveCode() public {
        vm.chainId(31337);
        vm.etch(BASE_AAVE_POOL, hex"00");
        bytes32 existingCodeHash = BASE_AAVE_POOL.codehash;

        DeployLocalOthelio deployment = new DeployLocalOthelio();
        deployment.run();

        assertEq(0xBD606f1dAE0285D55113eFC11501677B2221A4dd.code.length, 0);
        assertEq(BASE_AAVE_POOL.codehash, existingCodeHash);
    }

    function testRouteRegistryRejectsNonCanonicalFactory() public {
        vm.chainId(31337);
        address extraFactory = makeAddr("extraFactory");
        vm.etch(extraFactory, type(LocalMockAerodromeFactory).runtimeCode);
        address canonicalFactory = address(new LocalMockAerodromeFactory());
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(address(this), canonicalFactory);
        vm.expectRevert("INVALID_FACTORY");
        routeRegistry.setPoolApproval(
            block.chainid, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, TokenizedAssetConstants.AAPLc, 100, extraFactory, true
        );
    }

    function testGovernanceMustExplicitlyAcceptOwnership() public {
        address governance = makeAddr("governance");
        OthelioAssetRegistry registry = new OthelioAssetRegistry(address(this));
        OthelioAerodromeRouteRegistry routeRegistry =
            new OthelioAerodromeRouteRegistry(address(this), address(new LocalMockAerodromeFactory()));

        registry.transferOwnership(governance);
        routeRegistry.transferOwnership(governance);
        assertEq(registry.owner(), address(this));
        assertEq(routeRegistry.owner(), address(this));
        assertEq(registry.pendingOwner(), governance);
        assertEq(routeRegistry.pendingOwner(), governance);

        vm.prank(governance);
        registry.acceptOwnership();
        vm.prank(governance);
        routeRegistry.acceptOwnership();
        assertEq(registry.owner(), governance);
        assertEq(routeRegistry.owner(), governance);
    }
}
