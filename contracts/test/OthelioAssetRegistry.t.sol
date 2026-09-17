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

    function testRejectsUnregisteredCoinbaseB20() public {
        address unregistered = address(0x999);
        vm.prank(owner);
        vm.expectRevert("UNREGISTERED_COINBASE_B20");
        registry.configure(block.chainid, unregistered, feedNVDA, true, 18, 8, true);
    }

    function testRejectsCoinbaseB20WhenRegistryIsMissing() public {
        OthelioAssetRegistry missingRegistry = new OthelioAssetRegistry(owner, address(0));
        vm.prank(owner);
        vm.expectRevert("INVALID_COINBASE_REGISTRY");
        missingRegistry.configure(block.chainid, tokenNVDA, feedNVDA, true, 18, 8, true);
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

    function testEnumerationAndRemovalOfSupportedTokens() public {
        address tokenAAPL = address(0x555);
        address feedAAPL = address(0x666);
        address tokenUSDC = address(0x777);
        address feedUSDC = address(0x888);

        vm.startPrank(owner);
        mockCoinbaseRegistry.setRegistered(tokenAAPL, true);
        // Configure NVDA (B20)
        registry.configure(block.chainid, tokenNVDA, feedNVDA, true, 18, 8, true);
        // Configure AAPL (B20)
        registry.configure(block.chainid, tokenAAPL, feedAAPL, true, 18, 8, true);
        // Configure USDC (not B20)
        registry.configure(block.chainid, tokenUSDC, feedUSDC, true, 6, 8, false);

        address[] memory supported = registry.getSupportedTokens(block.chainid);
        assertEq(supported.length, 3);
        assertEq(supported[0], tokenNVDA);
        assertEq(supported[1], tokenAAPL);
        assertEq(supported[2], tokenUSDC);

        address[] memory b20 = registry.getSupportedB20Tokens(block.chainid);
        assertEq(b20.length, 2);
        assertEq(b20[0], tokenNVDA);
        assertEq(b20[1], tokenAAPL);

        // Disabling an asset removes it from both supported lists
        registry.configure(block.chainid, tokenNVDA, feedNVDA, false, 18, 8, true);
        supported = registry.getSupportedTokens(block.chainid);
        assertEq(supported.length, 2);

        b20 = registry.getSupportedB20Tokens(block.chainid);
        assertEq(b20.length, 1);
        assertEq(b20[0], tokenAAPL);

        // Re-enabling re-adds it
        registry.configure(block.chainid, tokenNVDA, feedNVDA, true, 18, 8, true);
        supported = registry.getSupportedTokens(block.chainid);
        assertEq(supported.length, 3);
        vm.stopPrank();
    }
}
