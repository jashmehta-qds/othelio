// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {ISeriesFactory} from "../../src/risksplit/interfaces/ISeriesFactory.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";
import {IRiskSplitSeries} from "../../src/risksplit/interfaces/IRiskSplitSeries.sol";
import {IClaimToken} from "../../src/risksplit/interfaces/IClaimToken.sol";
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

    function _implementation(address clone) internal view returns (address implementation) {
        bytes memory code = new bytes(45);
        assembly {
            extcodecopy(clone, add(code, 32), 0, 45)
            implementation := shr(0x60, mload(add(code, 42)))
        }
    }

    function setUp() public {
        owner = address(this);
        factory = new SeriesFactory();
        stock = new MockStockToken();
        oracle = new MockOracle(50e8);
        adapter = new SettlementAdapter(address(oracle), 86400, address(this));

        expiry = block.timestamp + 7 days;
        factory.setApprovedExpiry(address(stock), expiry, true);
        factory.setApprovedAdapter(address(stock), address(adapter), true);
    }

    function test_Permissions_AdapterAllowlist() public {
        SettlementAdapter untrusted = new SettlementAdapter(address(oracle), 86400, address(this));
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.setApprovedAdapter(address(stock), address(untrusted), true);
        vm.expectRevert(ISeriesFactory.InvalidAdapter.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(untrusted));
        factory.setApprovedAdapter(address(stock), address(untrusted), true);
        address created = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(untrusted));
        assertTrue(factory.isSeries(created));
        factory.setApprovedAdapter(address(stock), address(untrusted), false);
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

        // Old owner cannot create after ownership transfer
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        vm.prank(alice);
        address created = factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        assertTrue(factory.isSeries(created));
    }

    function test_Permissions_NonOwnerCannotCreateSeries() public {
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
    }

    function test_Permissions_NonOwnerCannotCreateWithInvalidTerms() public {
        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        factory.createSeries(address(0), 0, 0, 0, address(0));
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

    function test_Gas_CreateSeries() public {
        uint256 gasBefore = gasleft();
        factory.createSeries(address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter));
        emit log_named_uint("createSeries gas", gasBefore - gasleft());
    }

    function test_ClaimTokenClones_InitializationAndMintAccess() public {
        RiskSplitSeries series = RiskSplitSeries(factory.createSeries(
            address(stock), FLOOR_PRICE, CAP_PRICE, expiry, address(adapter)
        ));
        IClaimToken token = series.protectedToken();

        assertLt(address(token).code.length, 100);
        assertEq(token.name(), "RiskSplit Protected Claim");
        assertEq(token.symbol(), "PROT");
        assertEq(token.seriesVault(), address(series));

        address implementation = _implementation(address(token));
        assertGt(implementation.code.length, 1000);
        vm.prank(address(factory));
        vm.expectRevert(IClaimToken.Unauthorized.selector);
        ClaimToken(implementation).initialize("Reinitialized", "BAD", address(this), 18);

        ClaimToken fresh = ClaimToken(Clones.clone(implementation));
        vm.expectRevert(IClaimToken.Unauthorized.selector);
        fresh.initialize("Fresh", "NEW", address(series), 6);
        vm.prank(address(factory));
        vm.expectRevert(IClaimToken.ZeroAddress.selector);
        fresh.initialize("Fresh", "NEW", address(0), 6);
        vm.prank(address(factory));
        fresh.initialize("", "", address(series), 6);
        assertEq(fresh.name(), "");
        assertEq(fresh.symbol(), "");
        assertEq(fresh.decimals(), 6);

        vm.prank(address(factory));
        vm.expectRevert(IClaimToken.Unauthorized.selector);
        ClaimToken(address(token)).initialize("Reinitialized", "BAD", address(this), 18);

        vm.expectRevert(IClaimToken.Unauthorized.selector);
        token.mint(address(this), 1);
        vm.expectRevert(IClaimToken.Unauthorized.selector);
        token.burn(address(this), 1);
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
