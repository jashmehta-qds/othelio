// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ISeriesFactory} from "../../src/risksplit/interfaces/ISeriesFactory.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {IRiskSplitSeries} from "../../src/risksplit/interfaces/IRiskSplitSeries.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {MockStockToken, MockOracle} from "./RiskSplitSeriesTest.t.sol";

contract SeriesFactoryPermissionsTest is Test {
    SeriesFactory internal factory;
    MockStockToken internal stock;
    MockOracle internal oracle;
    SettlementAdapter internal adapter;

    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant FLOOR_PRICE = 45e8;
    uint256 internal constant CAP_PRICE = 55e8;
    uint256 internal expiry;

    function setUp() public {
        owner = address(this);
        factory = new SeriesFactory();
        stock = new MockStockToken();
        oracle = new MockOracle(50e8);
        adapter = new SettlementAdapter(address(oracle), 86400);

        expiry = block.timestamp + 7 days;
        factory.setApprovedExpiry(address(stock), expiry, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);
    }

    function test_Permissions_AdapterAllowlist() public {
        factory.setPublicCreationEnabled(true);
        SettlementAdapter untrusted = new SettlementAdapter(address(oracle), 86400);
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.setApprovedAdapter(address(stock), address(untrusted), true);
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.InvalidAdapter.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(untrusted));
        factory.setApprovedAdapter(address(stock), address(untrusted), true);
        vm.prank(alice);
        address created = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(untrusted));
        assertTrue(factory.isSeries(created));
        factory.setApprovedAdapter(address(stock), address(untrusted), false);
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.InvalidAdapter.selector);
        factory.createSeries(address(stock), FLOOR_PRICE + 1, CAP_PRICE, expiry, address(untrusted));
        vm.expectRevert(ISeriesFactory.ZeroAddress.selector);
        factory.setApprovedAdapter(address(stock), address(0), true);
        vm.expectRevert(ISeriesFactory.InvalidAdapter.selector);
        factory.setApprovedAdapter(address(stock), address(0xBAD), true);
    }

    function test_Permissions_InitialState() public view {
        assertEq(factory.owner(), owner, "Owner mismatch");
        assertEq(factory.pendingOwner(), address(0), "Pending owner should be 0");
        assertFalse(factory.publicCreationEnabled(), "Public creation should default to false");
        assertTrue(factory.approvedExpiry(address(stock), expiry), "Expiry should be approved");
    }

    function test_Permissions_TwoStepOwnershipTransfer() public {
        // Step 1: Owner initiates transfer
        factory.transferOwnership(alice);
        assertEq(factory.pendingOwner(), alice, "Pending owner not set");
        assertEq(factory.owner(), owner, "Owner should not change yet");

        // Non-pending owner cannot accept
        vm.prank(bob);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.acceptOwnership();

        // Step 2: Pending owner accepts
        vm.prank(alice);
        factory.acceptOwnership();
        assertEq(factory.owner(), alice, "Owner not transferred");
        assertEq(factory.pendingOwner(), address(0), "Pending owner not reset");

        // Old owner cannot perform owner actions
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.setPublicCreationEnabled(true);
    }

    function test_Permissions_NonOwnerCannotCreateSeriesByDefault() public {
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
    }

    function test_Permissions_PublicCreationToggle() public {
        // Non-owner cannot toggle
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.setPublicCreationEnabled(true);

        // Owner enables public creation
        factory.setPublicCreationEnabled(true);
        assertTrue(factory.publicCreationEnabled());

        // Now alice can create a series with approved expiry
        vm.prank(alice);
        address seriesAddr = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        assertTrue(factory.isSeries(seriesAddr));
    }

    function test_Permissions_UnapprovedExpiryReverts() public {
        uint256 unapprovedExpiry = block.timestamp + 14 days;

        // Even owner cannot create without explicit expiry approval
        vm.expectRevert(ISeriesFactory.UnapprovedExpiry.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, unapprovedExpiry, address(adapter));

        // Approving expiry allows creation
        factory.setApprovedExpiry(address(stock), unapprovedExpiry, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);
        address seriesAddr =
            factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, unapprovedExpiry, address(adapter));
        assertTrue(factory.isSeries(seriesAddr));
    }

    function test_Permissions_DuplicateTermsRejected() public {
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));

        // Attempting to deploy identical series reverts
        vm.expectRevert(ISeriesFactory.DuplicateSeriesTerms.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
    }

    function test_Permissions_InvalidParametersRevert() public {
        // Zero address underlying
        vm.expectRevert(ISeriesFactory.ZeroAddress.selector);
        factory.createSeries(address(0), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));

        // Zero address adapter
        vm.expectRevert(ISeriesFactory.ZeroAddress.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(0));

        // Inverted price range (floor >= cap)
        vm.expectRevert(ISeriesFactory.InvalidPriceRange.selector);
        factory.createSeries(address(stock), CAP_PRICE, FLOOR_PRICE, expiry, address(adapter));

        // Zero floor price
        vm.expectRevert(ISeriesFactory.InvalidPriceRange.selector);
        factory.createSeries(address(stock), 0, CAP_PRICE, expiry, address(adapter));

        // Past expiry
        factory.setApprovedExpiry(address(stock), block.timestamp - 1, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);
        vm.expectRevert(ISeriesFactory.ExpiryInPast.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, block.timestamp - 1, address(adapter));
    }

    function test_Permissions_VaultInitializeTokens_CallerRestriction() public {
        address seriesAddr = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        RiskSplitSeries series = RiskSplitSeries(seriesAddr);

        // Third party cannot call initializeTokens on already-initialized vault
        vm.prank(alice);
        vm.expectRevert(IRiskSplitSeries.Unauthorized.selector);
        series.initializeTokens(alice, bob);

        // Direct deployment of RiskSplitSeries can only be initialized by its factory
        RiskSplitSeries directSeries = new RiskSplitSeries(
            address(stock), address(adapter), FLOOR_PRICE, CAP_PRICE, expiry, address(oracle), 1, 50e8
        );
        assertEq(directSeries.factory(), address(this));

        // Non-deployer cannot initialize direct vault
        vm.prank(alice);
        vm.expectRevert(IRiskSplitSeries.Unauthorized.selector);
        directSeries.initializeTokens(alice, bob);
    }
}
