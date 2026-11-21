// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {UpsideFactory} from "../../src/upside/UpsideFactory.sol";
import {IUpsideFactory} from "../../src/upside/interfaces/IUpsideFactory.sol";
import {IUpsideSeries} from "../../src/upside/interfaces/IUpsideSeries.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {IUpsideClaimToken} from "../../src/upside/interfaces/IUpsideClaimToken.sol";
import {MockUnderlyingToken, MockAssetRegistry} from "./UpsidePayoff.t.sol";

contract UpsideFactoryTest is Test {
    MockAssetRegistry public registry;
    UpsideFactory public factory;

    MockUnderlyingToken public stockA;
    MockUnderlyingToken public stockB;
    MockUnderlyingToken public stock38;

    address public adapter = address(0xAA);
    address public feedA = address(0x111);
    address public feedB = address(0x222);
    address public user = address(0x333);
    address public newOwner = address(0x444);

    function _implementation(address clone) internal view returns (address implementation) {
        bytes memory code = new bytes(45);
        assembly {
            extcodecopy(clone, add(code, 32), 0, 45)
            implementation := shr(0x60, mload(add(code, 42)))
        }
    }

    uint256 public constant STRIKE_TICK = 1e8; // $1.00 tick
    uint256 public constant MIN_STRIKE = 150e8;
    uint256 public constant MAX_STRIKE = 300e8;

    function setUp() public {
        vm.etch(adapter, hex"00");
        vm.mockCall(adapter, abi.encodeWithSignature("priceFeed()"), abi.encode(feedA));
        registry = new MockAssetRegistry();
        factory = new UpsideFactory(address(registry));

        vm.etch(address(0xBB), hex"00");
        vm.mockCall(address(0xBB), abi.encodeWithSignature("priceFeed()"), abi.encode(feedB));
        stockA = new MockUnderlyingToken("Stock A", "STKA", 18);
        stockB = new MockUnderlyingToken("Stock B", "STKB", 18);
        stock38 = new MockUnderlyingToken("Stock 38", "STK38", 38);

        registry.setAsset(block.chainid, address(stockA), true, feedA, 18, 8);
        registry.setAsset(block.chainid, address(stockB), true, feedB, 18, 8);
        registry.setAsset(block.chainid, address(stock38), true, feedA, 38, 8);
    }

    function test_Factory_RejectsInvalidAdapter() public {
        IUpsideFactory.RoundConfig memory cfg = _validConfig(address(stockA), feedA, block.timestamp + 7 days);
        cfg.adapter = address(0xDEAD);
        vm.expectRevert(IUpsideFactory.ZeroAddress.selector);
        factory.registerRound(cfg);
        cfg.adapter = adapter;
        vm.mockCall(adapter, abi.encodeWithSignature("priceFeed()"), abi.encode(feedB));
        vm.expectRevert(IUpsideFactory.MismatchedFeed.selector);
        factory.registerRound(cfg);
        vm.mockCallRevert(adapter, abi.encodeWithSignature("priceFeed()"), "");
        vm.expectRevert(IUpsideFactory.MismatchedFeed.selector);
        factory.registerRound(cfg);
    }

    function _validConfig(address underlying, address feed, uint256 expiry)
        internal
        view
        returns (IUpsideFactory.RoundConfig memory)
    {
        return IUpsideFactory.RoundConfig({
            underlying: underlying,
            feed: feed,
            adapter: feed == feedB ? address(0xBB) : adapter,
            referenceRoundId: 100,
            referencePrice: 200e8,
            referenceTime: block.timestamp,
            roundStart: block.timestamp,
            expiryTimestamp: expiry,
            expectedMove: 10e8,
            provenanceHash: keccak256("provenance-uri-v1"),
            strikeTick: STRIKE_TICK,
            minStrike: MIN_STRIKE,
            maxStrike: MAX_STRIKE
        });
    }

    function test_Factory_RegisterRound_Success() public {
        uint256 expiry = block.timestamp + 7 days;
        IUpsideFactory.RoundConfig memory cfg = _validConfig(address(stockA), feedA, expiry);

        uint256 roundId = factory.registerRound(cfg);
        assertEq(roundId, 1);
        assertEq(factory.totalRounds(), 1);

        IUpsideFactory.RoundConfig memory stored = factory.getRound(1);
        assertEq(stored.underlying, address(stockA));
        assertEq(stored.feed, feedA);
    }

    function test_Factory_RegisterRound_Permissions_And_Rejections() public {
        uint256 expiry = block.timestamp + 7 days;
        IUpsideFactory.RoundConfig memory cfg = _validConfig(address(stockA), feedA, expiry);

        // 1. Non-owner cannot register
        vm.prank(user);
        vm.expectRevert();
        factory.registerRound(cfg);

        // 2. Unsupported asset reverts
        IUpsideFactory.RoundConfig memory cfgUnsupported = _validConfig(address(0x9999), feedA, expiry);
        vm.expectRevert(IUpsideFactory.AssetNotSupported.selector);
        factory.registerRound(cfgUnsupported);

        // 3. Mismatched feed reverts
        IUpsideFactory.RoundConfig memory cfgMismatched = _validConfig(address(stockA), address(0x999), expiry);
        vm.expectRevert(IUpsideFactory.MismatchedFeed.selector);
        factory.registerRound(cfgMismatched);

        // 4. Decimals > 18 reverts
        IUpsideFactory.RoundConfig memory cfg38 = _validConfig(address(stock38), feedA, expiry);
        vm.expectRevert(abi.encodeWithSelector(IUpsideFactory.UnsupportedDecimals.selector, 38));
        factory.registerRound(cfg38);

        // 5. Expired round timestamp reverts
        IUpsideFactory.RoundConfig memory cfgExpired = _validConfig(address(stockA), feedA, block.timestamp);
        vm.expectRevert(IUpsideFactory.RoundExpired.selector);
        factory.registerRound(cfgExpired);
    }

    function test_Factory_MarketCreation_OwnerOnly() public {
        uint256 expiry = block.timestamp + 7 days;
        IUpsideFactory.RoundConfig memory cfg = _validConfig(address(stockA), feedA, expiry);
        uint256 roundId = factory.registerRound(cfg);

        // Non-owner cannot create
        vm.prank(user);
        vm.expectRevert(IUpsideFactory.Unauthorized.selector);
        factory.createMarket(roundId, 200e8);

        // Admin can create valid in-bounds market
        address series1 = factory.createMarket(roundId, 200e8);
        assertTrue(series1 != address(0));
        assertEq(factory.marketByRoundAndStrike(roundId, 200e8), series1);
        assertTrue(factory.isMarket(series1));
        assertEq(factory.allMarketsLength(), 1);

        // Duplicate market reverts
        vm.expectRevert(IUpsideFactory.DuplicateMarket.selector);
        factory.createMarket(roundId, 200e8);

        // Out of bounds strike reverts
        vm.expectRevert(IUpsideFactory.StrikeOutOfBounds.selector);
        factory.createMarket(roundId, 100e8); // min is 150e8

        // Off-tick strike reverts
        vm.expectRevert(IUpsideFactory.OffStrikeGrid.selector);
        factory.createMarket(roundId, 2005e7); // not multiple of 1e8

        vm.prank(user);
        vm.expectRevert(IUpsideFactory.Unauthorized.selector);
        factory.createMarket(roundId, 210e8);

        vm.prank(user);
        vm.expectRevert(IUpsideFactory.Unauthorized.selector);
        factory.createMarket(roundId, 350e8);

        vm.prank(user);
        vm.expectRevert(IUpsideFactory.Unauthorized.selector);
        factory.createMarket(0, 0);

    }

    function test_Gas_CreateMarket() public {
        uint256 expiry = block.timestamp + 7 days;
        uint256 roundId = factory.registerRound(_validConfig(address(stockA), feedA, expiry));

        uint256 gasBefore = gasleft();
        factory.createMarket(roundId, 200e8);
        emit log_named_uint("createMarket gas", gasBefore - gasleft());
    }

    function test_ClaimTokenClones_InitializationAndMintAccess() public {
        uint256 expiry = block.timestamp + 7 days;
        uint256 roundId = factory.registerRound(_validConfig(address(stockA), feedA, expiry));
        UpsideSeries series = UpsideSeries(factory.createMarket(roundId, 200e8));
        IUpsideClaimToken token = series.upsideToken();

        assertLt(address(token).code.length, 100);
        assertEq(token.name(), "Upside Claim STKA");
        assertEq(token.symbol(), "UP");
        assertEq(token.seriesVault(), address(series));

        address implementation = _implementation(address(token));
        assertGt(implementation.code.length, 1000);
        vm.prank(address(factory));
        vm.expectRevert(IUpsideClaimToken.Unauthorized.selector);
        UpsideClaimToken(implementation).initialize("Reinitialized", "BAD", address(this), 18);

        UpsideClaimToken fresh = UpsideClaimToken(Clones.clone(implementation));
        vm.expectRevert(IUpsideClaimToken.Unauthorized.selector);
        fresh.initialize("Fresh", "NEW", address(series), 6);
        vm.prank(address(factory));
        vm.expectRevert(IUpsideClaimToken.ZeroAddress.selector);
        fresh.initialize("Fresh", "NEW", address(0), 6);
        vm.prank(address(factory));
        fresh.initialize("", "", address(series), 6);
        assertEq(fresh.name(), "");
        assertEq(fresh.symbol(), "");
        assertEq(fresh.decimals(), 6);

        vm.prank(address(factory));
        vm.expectRevert(IUpsideClaimToken.Unauthorized.selector);
        UpsideClaimToken(address(token)).initialize("Reinitialized", "BAD", address(this), 18);

        vm.expectRevert(IUpsideClaimToken.Unauthorized.selector);
        token.mint(address(this), 1);
        vm.expectRevert(IUpsideClaimToken.Unauthorized.selector);
        token.burn(address(this), 1);
    }

    function test_Factory_MultipleExpiries_Coexist() public {
        uint256 exp1 = block.timestamp + 7 days;
        uint256 exp2 = block.timestamp + 14 days;

        uint256 r1 = factory.registerRound(_validConfig(address(stockA), feedA, exp1));
        uint256 r2 = factory.registerRound(_validConfig(address(stockA), feedA, exp2));

        address m1 = factory.createMarket(r1, 200e8);
        address m2 = factory.createMarket(r2, 200e8);

        assertTrue(m1 != m2, "Markets in different rounds have different addresses");
        assertEq(UpsideSeries(m1).expiry(), exp1);
        assertEq(UpsideSeries(m2).expiry(), exp2);
    }

    function test_Factory_RegistryDisableBlocksNewExposure_LeavesWithdrawals() public {
        uint256 exp = block.timestamp + 7 days;
        uint256 rId = factory.registerRound(_validConfig(address(stockA), feedA, exp));
        address seriesAddr = factory.createMarket(rId, 200e8);
        UpsideSeries series = UpsideSeries(seriesAddr);

        // User mints
        stockA.mint(user, 10 ether);
        vm.startPrank(user);
        stockA.approve(seriesAddr, 10 ether);
        series.mint(10 ether);
        vm.stopPrank();

        // Governance disables asset in registry
        registry.setAsset(block.chainid, address(stockA), false, feedA, 18, 8);

        // 1. Factory blocks new market creation for this round
        vm.expectRevert(IUpsideFactory.AssetNotSupported.selector);
        factory.createMarket(rId, 220e8);

        // 2. Existing series blocks new mints
        stockA.mint(user, 5 ether);
        vm.startPrank(user);
        stockA.approve(seriesAddr, 5 ether);
        vm.expectRevert(IUpsideSeries.AssetNotSupported.selector);
        series.mint(5 ether);

        // 3. But combineAndWithdraw still succeeds!
        uint256 withdrawn = series.combineAndWithdraw(4 ether);
        assertEq(withdrawn, 4 ether);
        vm.stopPrank();

        // 4. And after settlement, redemption still succeeds!
        uint256 seriesExp = series.expiry();
        vm.warp(seriesExp + 1);
        vm.prank(adapter);
        series.settleWithFixing(250e8, 10, seriesExp);

        vm.prank(user);
        uint256 uOut = series.redeemUpside(6 ether);
        vm.prank(user);
        uint256 rOut = series.redeemResidual(6 ether);
        assertEq(uOut + rOut, 6 ether);
    }

    function test_Factory_TwoStepOwnershipTransfer() public {
        uint256 roundId = factory.registerRound(_validConfig(address(stockA), feedA, block.timestamp + 7 days));
        factory.transferOwnership(newOwner);
        assertEq(factory.owner(), address(this));
        assertEq(factory.pendingOwner(), newOwner);

        // Non-pending owner cannot accept
        vm.prank(user);
        vm.expectRevert();
        factory.acceptOwnership();

        // Pending owner accepts
        vm.prank(newOwner);
        factory.acceptOwnership();
        assertEq(factory.owner(), newOwner);
        assertEq(factory.pendingOwner(), address(0));

        vm.expectRevert(IUpsideFactory.Unauthorized.selector);
        factory.createMarket(roundId, 200e8);
        vm.prank(newOwner);
        address series = factory.createMarket(roundId, 200e8);
        assertTrue(factory.isMarket(series));
    }
}
