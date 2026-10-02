// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployBaseOthelio} from "./DeployBaseOthelio.s.sol";

/// @notice Base-compatible local fork deployment. The fork uses Base protocol
/// addresses and state, but its wallet-facing chain ID is 31337.
contract DeployBaseForkOthelio is DeployBaseOthelio {
    uint256 internal constant BASE_FORK_CHAIN_ID = 31337;

    function run() external override returns (address registryAddr, address oracleAddr, address moduleAddr, address factoryAddr) {
        validateChain();
        return _run();
    }

    function validateChain() public view override {
        require(block.chainid == BASE_FORK_CHAIN_ID, "FORK_REQUIRES_LOCAL_BASE_FORK");
    }
}
