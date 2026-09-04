// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {OthelioBasketGuard} from "../src/safe/OthelioBasketGuard.sol";

contract OthelioBasketGuardTest is Test {
    OthelioAssetRegistry public registry;
    OthelioBasketGuard public guard;

    address public owner = address(0x111);
    address public module = address(0x222);
    address public multiSend = address(0x777);
    address public randomUser = address(0x333);

    address public trackedToken = address(0x444);
    address public untrackedToken = address(0x555);
    address public priceFeed = address(0x666);

    function setUp() public {
        registry = new OthelioAssetRegistry(owner, address(0));
        guard = new OthelioBasketGuard(address(registry), module, multiSend);

        vm.prank(owner);
        registry.configure(block.chainid, trackedToken, priceFeed, true, 18, 8, true);
    }

    function testAllowModuleTransferTrackedAsset() public view {
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", randomUser, 100);
        guard.checkTransaction(
            trackedToken,
            0,
            data,
            0,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            module
        );
    }

    function testRevertNonModuleTransferTrackedAsset() public {
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", randomUser, 100);
        
        vm.expectRevert("OthelioGuard: Tracked assets must be managed via OthelioBasketModule");
        guard.checkTransaction(
            trackedToken,
            0,
            data,
            0,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            randomUser
        );
    }

    function testRevertNonModuleApproveTrackedAsset() public {
        bytes memory data = abi.encodeWithSignature("approve(address,uint256)", randomUser, 100);
        
        vm.expectRevert("OthelioGuard: Tracked assets must be managed via OthelioBasketModule");
        guard.checkTransaction(
            trackedToken,
            0,
            data,
            0,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            randomUser
        );
    }

    function testAllowAnyTransferUntrackedAsset() public view {
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", randomUser, 500);
        guard.checkTransaction(
            untrackedToken,
            0,
            data,
            0,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            randomUser
        );
    }
}
