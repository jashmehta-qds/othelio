// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry, ICoinbaseRegistry} from "../src/registry/OthelioAssetRegistry.sol";

contract MockCoinbaseRegistry is ICoinbaseRegistry {
    mapping(address => bool) public registeredTokens;

    function setRegistered(address token, bool registered) external {
        registeredTokens[token] = registered;
    }

    function isRegistered(address token) external view override returns (bool) {
        return registeredTokens[token];
    }
}

contract OthelioAssetRegistryTest is Test {
    OthelioAssetRegistry public registry;
    MockCoinbaseRegistry public mockCoinbaseRegistry;

    address public owner = address(0x111);
    address public user = address(0x222);
    address public tokenNVDA = address(0x333);
    address public feedNVDA = address(0x444);

    function setUp() public {
        mockCoinbaseRegistry = new MockCoinbaseRegistry();
        registry = new OthelioAssetRegistry(owner, address(mockCoinbaseRegistry));
        mockCoinbaseRegistry.setRegistered(tokenNVDA, true);
    }

    function testConfigureAssetByOwner() public {
        vm.prank(owner);
        registry.configure(block.chainid, tokenNVDA, feedNVDA, true, 18, 8, true);

        assertTrue(registry.isSupported(block.chainid, tokenNVDA));
        
        OthelioAssetRegistry.Asset memory asset = registry.getAsset(block.chainid, tokenNVDA);
        assertEq(asset.supported, true);
        assertEq(asset.priceFeed, feedNVDA);
        assertEq(asset.tokenDecimals, 18);
        assertEq(asset.feedDecimals, 8);
        assertEq(asset.isCoinbaseB20, true);
    }

    function testRevertConfigureAssetByNonOwner() public {
        vm.prank(user);
        vm.expectRevert();
        registry.configure(block.chainid, tokenNVDA, feedNVDA, true, 18, 8, true);
    }

    function testDisableAsset() public {
        vm.startPrank(owner);
        registry.configure(block.chainid, tokenNVDA, feedNVDA, true, 18, 8, true);
        assertTrue(registry.isSupported(block.chainid, tokenNVDA));

        registry.configure(block.chainid, tokenNVDA, feedNVDA, false, 18, 8, true);
        assertFalse(registry.isSupported(block.chainid, tokenNVDA));
        vm.stopPrank();
    }

    function testRejectDecimalsThatWouldOverflowOracleScaling() public {
        vm.prank(owner);
        vm.expectRevert("DECIMALS_TOO_LARGE");
        registry.configure(block.chainid, tokenNVDA, feedNVDA, true, 39, 8, true);
    }
}
