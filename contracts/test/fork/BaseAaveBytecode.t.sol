// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {MockAavePool} from "../../src/mock/MockAavePool.sol";

contract BaseAaveBytecodeForkTest is Test {
    address private constant BASE_AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    uint256 private constant BASE_FORK_BLOCK = 30_000_000;

    function testFork_BaseAavePoolHasRealBytecode() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string(""));
        vm.skip(bytes(rpcUrl).length == 0, "BASE_RPC_URL unavailable: fork bytecode not verified");

        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        assertGt(BASE_AAVE_POOL.code.length, 0, "Aave pool missing at pinned block");
        assertNotEq(
            keccak256(BASE_AAVE_POOL.code),
            keccak256(type(MockAavePool).runtimeCode),
            "fork replaced the real Aave pool with MockAavePool"
        );
    }
}
