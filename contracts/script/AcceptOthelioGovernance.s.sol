// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";

/// @notice Second, EOA-governance-controlled half of the ownership handoff.
/// @dev For a Safe multisig or timelock, execute acceptOwnership() on both
/// registries through that governance contract instead. A signer of a Safe cannot
/// accept ownership on the Safe's behalf.
contract AcceptOthelioGovernance is Script {
    function run() external {
        uint256 governancePrivateKey = vm.envUint("GOVERNANCE_PRIVATE_KEY");
        address governance = vm.addr(governancePrivateKey);
        OthelioAssetRegistry assetRegistry = OthelioAssetRegistry(vm.envAddress("ASSET_REGISTRY_ADDRESS"));
        OthelioAerodromeRouteRegistry routeRegistry =
            OthelioAerodromeRouteRegistry(vm.envAddress("AERODROME_ROUTE_REGISTRY_ADDRESS"));

        require(assetRegistry.pendingOwner() == governance, "ASSET_REGISTRY_NOT_PENDING_FOR_GOVERNANCE");
        require(routeRegistry.pendingOwner() == governance, "ROUTE_REGISTRY_NOT_PENDING_FOR_GOVERNANCE");

        vm.startBroadcast(governancePrivateKey);
        assetRegistry.acceptOwnership();
        routeRegistry.acceptOwnership();
        vm.stopBroadcast();

        require(assetRegistry.owner() == governance, "ASSET_REGISTRY_HANDOFF_FAILED");
        require(routeRegistry.owner() == governance, "ROUTE_REGISTRY_HANDOFF_FAILED");
        console.log("Governance ownership accepted by:", governance);
    }
}
