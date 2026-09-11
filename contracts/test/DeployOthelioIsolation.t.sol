// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {DeployOthelio} from "../script/DeployOthelio.s.sol";

contract DeployOthelioIsolationTest is Test {
    address private constant BASE_AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    function testDefaultDeploymentDoesNotInstallLocalMocks() public {
        vm.chainId(31337);
        vm.setEnv("COINBASE_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000");

        DeployOthelio deployment = new DeployOthelio();
        (,,,,, address dexRouter,) = deployment.runWithLocalMocks(false);

        assertEq(dexRouter, address(0));
        assertEq(BASE_AAVE_POOL.code.length, 0);
    }

    function testLocalMockModePreservesExistingAaveCode() public {
        vm.chainId(31337);
        vm.setEnv("COINBASE_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000");
        vm.etch(BASE_AAVE_POOL, hex"00");
        bytes32 existingCodeHash = BASE_AAVE_POOL.codehash;

        DeployOthelio deployment = new DeployOthelio();
        (,,,,, address dexRouter,) = deployment.runWithLocalMocks(true);

        assertNotEq(dexRouter, address(0));
        assertEq(BASE_AAVE_POOL.codehash, existingCodeHash);
    }
}
