// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    UpsideBatchFillRouter,
    LimitOrder,
    Signature
} from "../../src/upside/UpsideBatchFillRouter.sol";
import {UpsideFixingAdapter} from "../../src/upside/UpsideFixingAdapter.sol";
import {IUpsideFixingAdapter} from "../../src/upside/interfaces/IUpsideFixingAdapter.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {ISettlementAdapter} from "../../src/risksplit/interfaces/ISettlementAdapter.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";

contract AuditToken is ERC20 {
    constructor(string memory name_) ERC20(name_, name_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Mirrors the relevant 0x v4 partial-fill accounting: maker output and
/// taker fee are both rounded down pro-rata from the requested fill.
contract RealisticZeroExMock {
    function fillLimitOrder(LimitOrder calldata order, Signature calldata, uint128 requested)
        external
        returns (uint128 filledTaker, uint128 filledMaker)
    {
        require(order.takerAmount != 0, "ZERO_TAKER_AMOUNT");
        filledTaker = requested > order.takerAmount ? order.takerAmount : requested;
        filledMaker = uint128(uint256(filledTaker) * order.makerAmount / order.takerAmount);
        uint256 fee = uint256(filledTaker) * order.takerTokenFeeAmount / order.takerAmount;

        require(IERC20(order.makerToken).transferFrom(order.maker, msg.sender, filledMaker), "MAKER_TRANSFER");
        require(IERC20(order.takerToken).transferFrom(msg.sender, order.maker, filledTaker), "TAKER_TRANSFER");
        if (fee != 0) {
            require(IERC20(order.takerToken).transferFrom(msg.sender, order.feeRecipient, fee), "FEE_TRANSFER");
        }
    }
}

/// @dev Deliberately violates the exchange-proxy postcondition to test the
/// router's trust boundary. It reports maker output without transferring it.
contract LyingZeroExMock {
    uint128 public reportedMaker;

    constructor(uint128 reportedMaker_) {
        reportedMaker = reportedMaker_;
    }

    function fillLimitOrder(LimitOrder calldata order, Signature calldata, uint128 requested)
        external
        pure
        returns (uint128 filledTaker, uint128 filledMaker)
    {
        filledTaker = requested;
        filledMaker = order.makerAmount;
    }
}

contract ReentrantTakerToken is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public attempted;
    bool public callbackSucceeded;

    constructor() ERC20("Reentrant", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool result = super.transferFrom(from, to, amount);
        if (!attempted && callbackTarget != address(0)) {
            attempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        return result;
    }
}

/// @dev Reports a larger router balance only after the initial pull. A safe
/// router should fail closed rather than pay a balance it does not possess.
contract LyingBalanceToken is ERC20 {
    address public router;
    bool public lie;

    constructor() ERC20("Liar", "LIAR") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(address router_) external {
        router = router_;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 actual = super.balanceOf(account);
        return lie && account == router ? actual + 1_000 : actual;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        bool result = super.transferFrom(from, to, amount);
        lie = true;
        return result;
    }
}

contract FalseReturnToken is ERC20 {
    constructor() ERC20("False", "FALSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

contract RoundFeedMock {
    struct Round {
        uint80 returnedId;
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
        bool exists;
    }

    mapping(uint80 => Round) public rounds;
    uint80 public latestRound;
    uint80 public latestReturnedId;
    bool public latestReturnedIdOverride;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "audit feed";
    }

    function version() external pure returns (uint256) {
        return 1;
    }

    function setRound(
        uint80 key,
        uint80 returnedId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        rounds[key] = Round(returnedId, answer, startedAt, updatedAt, answeredInRound, true);
        latestRound = key;
    }

    function setLatestReturnedId(uint80 returnedId_) external {
        latestReturnedId = returnedId_;
        latestReturnedIdOverride = true;
    }

    function getRoundData(uint80 key)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round memory r = rounds[key];
        require(r.exists, "MISSING_ROUND");
        return (r.returnedId, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latestRound];
        uint80 id = latestReturnedIdOverride ? latestReturnedId : r.returnedId;
        return (id, r.answer, r.startedAt, r.updatedAt, r.answeredInRound);
    }
}

contract MockUpsideSettlementTarget {
    address public immutable referenceFeed;
    uint256 public immutable expiry;
    bool public isSettled;
    uint256 public settledPrice;
    uint80 public settledRound;
    uint256 public settledTimestamp;

    constructor(address feed_, uint256 expiry_) {
        referenceFeed = feed_;
        expiry = expiry_;
    }

    function settleWithFixing(uint256 price, uint80 roundId, uint256 timestamp) external {
        isSettled = true;
        settledPrice = price;
        settledRound = roundId;
        settledTimestamp = timestamp;
    }
}

contract MockRiskSettlementTarget {
    uint256 public immutable expiry;
    bool public isSettled;
    uint256 public settledPrice;
    uint80 public settledRound;
    uint256 public settledTimestamp;

    constructor(uint256 expiry_) {
        expiry = expiry_;
    }

    function settleWithFixing(uint256 price, uint80 roundId, uint256 timestamp) external {
        isSettled = true;
        settledPrice = price;
        settledRound = roundId;
        settledTimestamp = timestamp;
    }
}

contract AuditRegistryMock {
    function isSupported(uint256, address) external pure returns (bool) {
        return true;
    }
}

contract PR4AttackerAuditTest is Test {
    AuditToken internal maker;
    AuditToken internal taker;
    RealisticZeroExMock internal exchange;
    UpsideBatchFillRouter internal router;
    address internal makerAccount = address(0xA11CE);
    address internal attacker = address(0xBEEF);
    address internal victim = address(0xCAFE);

    function setUp() public {
        maker = new AuditToken("Maker");
        taker = new AuditToken("Taker");
        exchange = new RealisticZeroExMock();
        router = new UpsideBatchFillRouter(address(exchange), address(exchange).codehash);
        maker.mint(makerAccount, 10_000);
        taker.mint(attacker, 10_000);
        vm.prank(makerAccount);
        maker.approve(address(exchange), type(uint256).max);
        vm.prank(attacker);
        taker.approve(address(router), type(uint256).max);
    }

    function _order(address makerToken, address takerToken, uint128 makerAmount, uint128 takerAmount)
        internal
        view
        returns (LimitOrder memory order)
    {
        order = LimitOrder({
            makerToken: makerToken,
            takerToken: takerToken,
            makerAmount: makerAmount,
            takerAmount: takerAmount,
            takerTokenFeeAmount: 0,
            maker: makerAccount,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0xFEE),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 1 days),
            salt: 1
        });
    }

    function test_Router_SameTokenDoesNotRefundPreexistingBalance() public {
        AuditToken token = new AuditToken("Same");
        token.mint(makerAccount, 10_000);
        token.mint(attacker, 100);
        token.mint(address(router), 777);
        vm.prank(makerAccount);
        token.approve(address(exchange), type(uint256).max);
        vm.prank(attacker);
        token.approve(address(router), type(uint256).max);

        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(token), address(token), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertEq(token.balanceOf(address(router)), 777, "preexisting same-token funds drained");
        assertEq(token.balanceOf(attacker), 100, "attacker should receive only maker output");
    }

    function test_Router_MakerTokenAlreadyHeldDoesNotDoublePay() public {
        maker.mint(address(router), 333);
        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(maker), address(taker), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertEq(maker.balanceOf(address(router)), 333, "held maker balance was refunded");
        assertEq(maker.balanceOf(attacker), 100);
    }

    function test_Router_ReentrantTakerTokenIsBlocked() public {
        ReentrantTakerToken reentrant = new ReentrantTakerToken();
        reentrant.mint(attacker, 100);
        maker.mint(address(exchange), 100);
        vm.prank(makerAccount);
        maker.approve(address(exchange), type(uint256).max);
        vm.prank(attacker);
        reentrant.approve(address(router), type(uint256).max);
        LimitOrder[] memory emptyOrders = new LimitOrder[](0);
        Signature[] memory emptySigs = new Signature[](0);
        uint128[] memory emptyFills = new uint128[](0);
        reentrant.configureCallback(
            address(router), abi.encodeWithSelector(router.batchFillLimitOrders.selector, emptyOrders, emptySigs, emptyFills, false)
        );

        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(maker), address(reentrant), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertTrue(reentrant.attempted(), "malicious token did not try reentry");
        assertFalse(reentrant.callbackSucceeded(), "reentry should be blocked");
        assertEq(reentrant.balanceOf(attacker), 0);
    }

    function test_Router_ReentrantMakerTokenIsBlocked() public {
        ReentrantTakerToken reentrantMaker = new ReentrantTakerToken();
        reentrantMaker.mint(makerAccount, 100);
        vm.prank(makerAccount);
        reentrantMaker.approve(address(exchange), type(uint256).max);
        LimitOrder[] memory emptyOrders = new LimitOrder[](0);
        Signature[] memory emptySigs = new Signature[](0);
        uint128[] memory emptyFills = new uint128[](0);
        reentrantMaker.configureCallback(
            address(router), abi.encodeWithSelector(router.batchFillLimitOrders.selector, emptyOrders, emptySigs, emptyFills, false)
        );

        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(reentrantMaker), address(taker), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertTrue(reentrantMaker.attempted(), "malicious maker token did not try reentry");
        assertFalse(reentrantMaker.callbackSucceeded(), "maker-token reentry should be blocked");
        assertEq(reentrantMaker.balanceOf(attacker), 100);
    }

    function test_Router_LyingBalanceTokenFailsClosed() public {
        LyingBalanceToken liar = new LyingBalanceToken();
        liar.configure(address(router));
        liar.mint(attacker, 100);
        liar.mint(address(router), 500);
        vm.prank(attacker);
        liar.approve(address(router), type(uint256).max);
        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(maker), address(liar), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        vm.expectRevert();
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertEq(liar.balanceOf(address(router)), 500, "the reverted lie must not persist");
        assertEq(liar.balanceOf(attacker), 100);
    }

    function test_Router_FalseReturnTakerTokenIsRejected() public {
        FalseReturnToken falseToken = new FalseReturnToken();
        falseToken.mint(attacker, 100);
        vm.prank(attacker);
        falseToken.approve(address(router), type(uint256).max);
        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(maker), address(falseToken), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        vm.expectRevert();
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertEq(falseToken.balanceOf(attacker), 100, "false return token was charged");
    }

    function test_Router_RealisticZeroExUsesFloorTakerFee() public {
        taker.mint(attacker, 3);
        LimitOrder memory order = _order(address(maker), address(taker), 10, 10);
        order.takerTokenFeeAmount = 1;
        order.feeRecipient = address(0xFEE);
        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = order;
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 3;

        vm.prank(attacker);
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertEq(taker.balanceOf(address(0xFEE)), 0, "fee should floor to zero");
        assertEq(taker.balanceOf(makerAccount), 3, "maker received the filled taker amount");
        assertEq(taker.balanceOf(attacker), 10_000);
    }

    function test_Router_LyingProxyCannotBeWiredWithWrongCodeHash() public {
        LyingZeroExMock badProxy = new LyingZeroExMock(100);
        vm.expectRevert(
            abi.encodeWithSelector(
                UpsideBatchFillRouter.InvalidExchangeCodeHash.selector,
                address(exchange).codehash,
                address(badProxy).codehash
            )
        );
        new UpsideBatchFillRouter(address(badProxy), address(exchange).codehash);
    }

    function test_Router_CannotPullFromVictimWithoutMsgSenderAllowance() public {
        vm.prank(attacker);
        taker.transfer(victim, 10_000);
        taker.mint(victim, 100);
        vm.prank(victim);
        taker.approve(address(router), 100);
        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = _order(address(maker), address(taker), 100, 100);
        Signature[] memory signatures = new Signature[](1);
        uint128[] memory fills = new uint128[](1);
        fills[0] = 100;

        vm.prank(attacker);
        vm.expectRevert();
        router.batchFillLimitOrders(orders, signatures, fills, true);

        assertEq(taker.balanceOf(victim), 10_100, "victim was charged");
    }

    function test_Upside_NominatedRoundWithMismatchedReturnedIdIsRejected() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 999, 99e8, 1900, 1900, 999);
        feed.setLatestReturnedId(10);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);
        MockUpsideSettlementTarget target = new MockUpsideSettlementTarget(address(feed), 2_000);
        vm.warp(3_000);

        vm.expectRevert(IUpsideFixingAdapter.RoundNotComplete.selector);
        adapter.settleSeries(address(target), 10);
        assertFalse(target.isSettled(), "malformed round must not settle");
    }

    function test_RiskSplit_NominatedRoundWithMismatchedReturnedIdIsRejected() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 999, 99e8, 1900, 1900, 999);
        feed.setLatestReturnedId(10);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);
        MockRiskSettlementTarget target = new MockRiskSettlementTarget(2_000);
        vm.warp(3_000);

        vm.expectRevert(ISettlementAdapter.RoundNotComplete.selector);
        adapter.settleSeries(address(target), 10);
        assertFalse(target.isSettled());
    }

    function test_Upside_SuccessorWithZeroAnswerIsSkipped() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, 0, 1950, 1950, 11);
        feed.setRound(12, 12, 60e8, 2100, 2100, 12);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);
        vm.warp(3_000);

        IUpsideFixingAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.roundId, 10);
    }

    function test_RiskSplit_SuccessorWithZeroAnswerIsSkipped() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, 0, 1950, 1950, 11);
        feed.setRound(12, 12, 60e8, 2100, 2100, 12);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);
        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.roundId, 10);
    }

    function test_Upside_SuccessorWithZeroTimestampIsSkipped() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, 60e8, 1950, 0, 11);
        feed.setRound(12, 12, 70e8, 2100, 2100, 12);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);

        IUpsideFixingAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.roundId, 10);
    }

    function test_RiskSplit_SuccessorWithZeroTimestampIsSkipped() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, 60e8, 1950, 0, 11);
        feed.setRound(12, 12, 70e8, 2100, 2100, 12);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);

        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.roundId, 10);
    }

    function test_Upside_PhaseBoundaryMissingNextPhaseFirstRoundSkipsGap() public {
        RoundFeedMock feed = new RoundFeedMock();
        uint80 candidate = (uint80(1) << 64) | 100;
        uint80 laterPhaseRound = (uint80(2) << 64) | 2;
        feed.setRound(candidate, candidate, 50e8, 1900, 1900, candidate);
        feed.setRound(laterPhaseRound, laterPhaseRound, 70e8, 2100, 2100, laterPhaseRound);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);

        IUpsideFixingAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, candidate);
        assertEq(fixing.roundId, candidate);
    }

    function test_RiskSplit_PhaseBoundaryMissingNextPhaseFirstRoundSkipsGap() public {
        RoundFeedMock feed = new RoundFeedMock();
        uint80 candidate = (uint80(1) << 64) | 100;
        uint80 laterPhaseRound = (uint80(2) << 64) | 2;
        feed.setRound(candidate, candidate, 50e8, 1900, 1900, candidate);
        feed.setRound(laterPhaseRound, laterPhaseRound, 70e8, 2100, 2100, laterPhaseRound);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);

        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, candidate);
        assertEq(fixing.roundId, candidate);
    }

    function test_Upside_ValidPreExpiryRoundAfterBadSuccessorStillBlocksOlderCandidate() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1500, 1500, 10);
        feed.setRound(11, 11, 0, 1800, 1800, 11);
        feed.setRound(12, 12, 60e8, 1900, 1900, 12);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);

        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        adapter.verifyFixingRound(2_000, 10);
    }

    function test_RiskSplit_ValidPreExpiryRoundAfterBadSuccessorStillBlocksOlderCandidate() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1500, 1500, 10);
        feed.setRound(11, 11, 0, 1800, 1800, 11);
        feed.setRound(12, 12, 60e8, 1900, 1900, 12);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);

        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        adapter.verifyFixingRound(2_000, 10);
    }

    function test_Upside_NegativeSuccessorIsSkipped() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, -1, 1950, 1950, 11);
        feed.setRound(12, 12, 60e8, 2100, 2100, 12);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);

        IUpsideFixingAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.roundId, 10);
    }

    function test_RiskSplit_NegativeSuccessorIsSkipped() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, -1, 1950, 1950, 11);
        feed.setRound(12, 12, 60e8, 2100, 2100, 12);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);

        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.roundId, 10);
    }

    function test_Upside_OlderRoundCannotBeNominatedWhenLaterPreExpiryExists() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1500, 1500, 10);
        feed.setRound(11, 11, 60e8, 1900, 1900, 11);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);

        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        adapter.verifyFixingRound(2_000, 10);
    }

    function test_RiskSplit_OlderRoundCannotBeNominatedWhenLaterPreExpiryExists() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1500, 1500, 10);
        feed.setRound(11, 11, 60e8, 1900, 1900, 11);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);

        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        adapter.verifyFixingRound(2_000, 10);
    }

    function test_Upside_RoundUpdatedAtExactlyExpiryIsAccepted() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 2_000, 2_000, 10);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);

        IUpsideFixingAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.updatedAt, 2_000);
    }

    function test_RiskSplit_RoundUpdatedAtExactlyExpiryIsAccepted() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 2_000, 2_000, 10);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);

        ISettlementAdapter.FixingData memory fixing = adapter.verifyFixingRound(2_000, 10);
        assertEq(fixing.updatedAt, 2_000);
    }

    function _assertBothDiscoverAndSettle(RoundFeedMock feed, uint80 expectedRound) internal {
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        assertEq(upsideAdapter.getFixingRound(2_000).roundId, expectedRound);
        assertEq(riskAdapter.getFixingRound(2_000).roundId, expectedRound);
        MockUpsideSettlementTarget upsideTarget = new MockUpsideSettlementTarget(address(feed), 2_000);
        MockRiskSettlementTarget riskTarget = new MockRiskSettlementTarget(2_000);
        vm.warp(3_000);
        upsideAdapter.settleSeries(address(upsideTarget));
        riskAdapter.settleSeries(address(riskTarget));
        assertTrue(upsideTarget.isSettled());
        assertTrue(riskTarget.isSettled());
        assertEq(upsideTarget.settledRound(), expectedRound);
        assertEq(riskTarget.settledRound(), expectedRound);
    }

    function test_Both_DiscoverySkipsMalformedNegativeAndMissingRounds() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 999, 99e8, 1950, 1950, 999);
        feed.setRound(12, 12, -1, 1960, 1960, 12);
        feed.setRound(13, 13, 60e8, 1970, 0, 13);
        feed.setRound(14, 14, 60e8, 1990, 1980, 14);
        feed.setRound(16, 16, 70e8, 2100, 2100, 16);
        _assertBothDiscoverAndSettle(feed, 10);
    }

    function test_Both_LatestPostExpiryBeyondSuccessorScanFailsClosed() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(40, 40, 70e8, 2100, 2100, 40);
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.verifyFixingRound(2_000, 10);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.verifyFixingRound(2_000, 10);
    }

    function test_Both_LatestCandidateWithoutSuccessorsSettles() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        _assertBothDiscoverAndSettle(feed, 10);
    }

    function test_Both_ValidPreExpiryAfterGapAtScanBoundaryBlocksOlderCandidate() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1500, 1500, 10);
        feed.setRound(30, 30, 60e8, 1900, 1900, 30);
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.verifyFixingRound(2_000, 10);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.verifyFixingRound(2_000, 10);
        _assertBothDiscoverAndSettle(feed, 30);
    }

    function test_Both_NextPhaseValidPreExpiryAfterGapBlocksOlderCandidate() public {
        RoundFeedMock feed = new RoundFeedMock();
        uint80 candidate = (uint80(1) << 64) | 100;
        uint80 successor = (uint80(2) << 64) | 20;
        feed.setRound(candidate, candidate, 50e8, 1500, 1500, candidate);
        feed.setRound(successor, successor, 60e8, 1900, 1900, successor);
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.verifyFixingRound(2_000, candidate);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.verifyFixingRound(2_000, candidate);
        _assertBothDiscoverAndSettle(feed, successor);
    }

    function test_Both_InvalidLatestWithinScannedRangeAcceptsCandidate() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        feed.setRound(11, 11, 0, 1950, 1950, 11);
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        assertEq(upsideAdapter.verifyFixingRound(2_000, 10).roundId, 10);
        assertEq(riskAdapter.verifyFixingRound(2_000, 10).roundId, 10);
    }

    function test_Both_ValidPreExpiryBeyondScanWindowBlocksOldCandidate() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1500, 1500, 10);
        for (uint80 roundId = 11; roundId <= 31; roundId++) {
            feed.setRound(roundId, roundId, 0, 1600, 1600, roundId);
        }
        feed.setRound(32, 32, 60e8, 1900, 1900, 32);
        feed.setRound(33, 33, 70e8, 2100, 2100, 33);

        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.verifyFixingRound(2_000, 10);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.verifyFixingRound(2_000, 10);
    }

    function test_Both_CrossPhaseLatestCannotSkipUnscannedOldPhaseRound() public {
        RoundFeedMock feed = new RoundFeedMock();
        uint80 candidate = (uint80(1) << 64) | 10;
        uint80 latest = (uint80(2) << 64) | 1;
        feed.setRound(candidate, candidate, 50e8, 1500, 1500, candidate);
        for (uint64 aggRoundId = 11; aggRoundId <= 31; aggRoundId++) {
            uint80 roundId = (uint80(1) << 64) | aggRoundId;
            feed.setRound(roundId, roundId, 0, 1600, 1600, roundId);
        }
        uint80 oldPhasePreExpiry = (uint80(1) << 64) | 32;
        feed.setRound(oldPhasePreExpiry, oldPhasePreExpiry, 60e8, 1900, 1900, oldPhasePreExpiry);
        feed.setRound(latest, latest, 0, 2100, 2100, latest);

        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.verifyFixingRound(2_000, candidate);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.verifyFixingRound(2_000, candidate);
    }

    function _assertBothNominateAndSettle(RoundFeedMock feed, uint80 candidate) internal {
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        assertEq(upsideAdapter.verifyFixingRound(2_000, candidate).roundId, candidate);
        assertEq(riskAdapter.verifyFixingRound(2_000, candidate).roundId, candidate);
        MockUpsideSettlementTarget upsideTarget = new MockUpsideSettlementTarget(address(feed), 2_000);
        MockRiskSettlementTarget riskTarget = new MockRiskSettlementTarget(2_000);
        vm.warp(3_000);
        upsideAdapter.settleSeries(address(upsideTarget), candidate);
        riskAdapter.settleSeries(address(riskTarget), candidate);
        assertTrue(upsideTarget.isSettled());
        assertTrue(riskTarget.isSettled());
        assertEq(upsideTarget.settledRound(), candidate);
        assertEq(riskTarget.settledRound(), candidate);
    }

    function _assertCrossPhaseHiddenRoundRejected(bool validLatest) internal {
        RoundFeedMock feed = new RoundFeedMock();
        uint80 candidate = (uint80(1) << 64) | 10;
        feed.setRound(candidate, candidate, 50e8, 1500, 1500, candidate);
        for (uint80 offset = 1; offset <= 20; offset++) {
            uint80 invalidRound = candidate + offset;
            feed.setRound(invalidRound, invalidRound, 0, 1600, 1600, invalidRound);
        }
        uint80 hiddenRound = candidate + 21;
        feed.setRound(hiddenRound, hiddenRound, 60e8, 1900, 1900, hiddenRound);
        uint80 latest = (uint80(2) << 64) | 20;
        feed.setRound(latest, latest, validLatest ? int256(70e8) : int256(0), 2100, 2100, latest);

        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1_000);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.verifyFixingRound(2_000, candidate);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.verifyFixingRound(2_000, candidate);

        MockUpsideSettlementTarget upsideTarget = new MockUpsideSettlementTarget(address(feed), 2_000);
        MockRiskSettlementTarget riskTarget = new MockRiskSettlementTarget(2_000);
        vm.warp(3_000);
        vm.expectRevert(IUpsideFixingAdapter.NotLastPreExpiryRound.selector);
        upsideAdapter.settleSeries(address(upsideTarget), candidate);
        vm.expectRevert(ISettlementAdapter.NotLastPreExpiryRound.selector);
        riskAdapter.settleSeries(address(riskTarget), candidate);
        assertFalse(upsideTarget.isSettled());
        assertFalse(riskTarget.isSettled());
    }

    function test_Both_CrossPhaseInvalidLatestCannotHideUnscannedPreExpiryRound() public {
        _assertCrossPhaseHiddenRoundRejected(false);
    }

    function test_Both_CrossPhasePostExpirySuccessorCannotHideUnscannedPreExpiryRound() public {
        _assertCrossPhaseHiddenRoundRejected(true);
    }

    function _rolloverFeed(uint80 aggRoundId, uint8 missingKind, bool validLatest)
        internal
        returns (RoundFeedMock feed, uint80 candidate)
    {
        feed = new RoundFeedMock();
        candidate = (uint80(1) << 64) | aggRoundId;
        feed.setRound(candidate, candidate, 50e8, 1900, 1900, candidate);
        for (uint80 offset = 1; offset < 20; offset++) {
            uint80 invalidRound = candidate + offset;
            feed.setRound(invalidRound, invalidRound, 0, 1950, 1950, invalidRound);
        }
        uint80 missingRound = candidate + 20;
        if (missingKind == 1) {
            feed.setRound(missingRound, 0, 60e8, 1960, 1960, missingRound);
        } else if (missingKind == 2) {
            feed.setRound(missingRound, missingRound, 60e8, 1960, 0, missingRound);
        }
        uint80 latest = (uint80(2) << 64) | 20;
        feed.setRound(latest, latest, validLatest ? int256(70e8) : int256(0), 2100, 2100, latest);
    }

    function test_Both_CrossPhaseInvalidLatestSettlesWithScannedPhaseEnd() public {
        for (uint8 missingKind; missingKind < 3; missingKind++) {
            (RoundFeedMock feed, uint80 candidate) = _rolloverFeed(100, missingKind, false);
            _assertBothNominateAndSettle(feed, candidate);
        }
    }

    function test_Both_CrossPhasePostExpirySuccessorSettlesWithScannedPhaseEnd() public {
        for (uint8 missingKind; missingKind < 3; missingKind++) {
            (RoundFeedMock feed, uint80 candidate) = _rolloverFeed(100, missingKind, true);
            _assertBothNominateAndSettle(feed, candidate);
        }
    }

    function test_Both_SamePhaseInvalidLatestAtScanBoundaryStillSettles() public {
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 1900, 1900, 10);
        for (uint80 roundId = 11; roundId <= 30; roundId++) {
            feed.setRound(roundId, roundId, 0, 1950, 1950, roundId);
        }
        _assertBothDiscoverAndSettle(feed, 10);
    }

    function test_RiskSplit_DiscoveryAcrossScannedPhaseEndStillSettles() public {
        (RoundFeedMock feed, uint80 candidate) = _rolloverFeed(990, 0, true);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);
        assertEq(adapter.getFixingRound(2_000).roundId, candidate);
        MockRiskSettlementTarget target = new MockRiskSettlementTarget(2_000);
        vm.warp(3_000);
        adapter.settleSeries(address(target));
        assertTrue(target.isSettled());
        assertEq(target.settledRound(), candidate);
    }

    function test_Upside_DiscoveryAcrossScannedPhaseEndStillSettles() public {
        (RoundFeedMock feed, uint80 candidate) = _rolloverFeed(90, 0, true);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);
        assertEq(adapter.getFixingRound(2_000).roundId, candidate);
        MockUpsideSettlementTarget target = new MockUpsideSettlementTarget(address(feed), 2_000);
        vm.warp(3_000);
        adapter.settleSeries(address(target));
        assertTrue(target.isSettled());
        assertEq(target.settledRound(), candidate);
    }

    function test_Upside_NoEligibleRoundLeavesSingleSidedHolderLocked() public {
        vm.warp(1_000);
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 500, 500, 10);
        UpsideFixingAdapter adapter = new UpsideFixingAdapter(address(feed), 1_000);
        AuditRegistryMock registry = new AuditRegistryMock();
        AuditToken underlying = new AuditToken("Underlying");
        UpsideSeries series = new UpsideSeries(
            address(this), address(registry), address(underlying), address(adapter), 50e8, 2_000, address(feed), 10, 50e8, 1
        );
        UpsideClaimToken up = new UpsideClaimToken("UP", "UP", address(series), 18);
        UpsideClaimToken residual = new UpsideClaimToken("RES", "RES", address(series), 18);
        series.initializeTokens(address(up), address(residual));
        address holder = address(0x1234);
        underlying.mint(holder, 1e18);
        vm.startPrank(holder);
        underlying.approve(address(series), 1e18);
        series.mint(1e18);
        up.transfer(address(0x5678), 1e18);
        vm.stopPrank();

        vm.warp(2_001);
        vm.expectRevert(IUpsideFixingAdapter.StalePrice.selector);
        adapter.settleSeries(address(series));
        vm.prank(address(0x5678));
        vm.expectRevert();
        series.redeemUpside(1e18);
    }

    function test_RiskSplit_NoEligibleRoundLeavesSingleSidedHolderLocked() public {
        vm.warp(1_000);
        RoundFeedMock feed = new RoundFeedMock();
        feed.setRound(10, 10, 50e8, 500, 500, 10);
        SettlementAdapter adapter = new SettlementAdapter(address(feed), 1_000);
        AuditToken underlying = new AuditToken("Risk underlying");
        RiskSplitSeries series = new RiskSplitSeries(
            address(underlying), address(adapter), 45e8, 55e8, 2_000, address(feed), 10, 50e8
        );
        ClaimToken protectedToken = new ClaimToken("PROT", "PROT", address(series), 18);
        ClaimToken upsideToken = new ClaimToken("UP", "UP", address(series), 18);
        series.initializeTokens(address(protectedToken), address(upsideToken));
        address holder = address(0x2345);
        underlying.mint(holder, 1e18);
        vm.startPrank(holder);
        underlying.approve(address(series), 1e18);
        series.mint(1e18);
        upsideToken.transfer(address(0x6789), 1e18);
        vm.stopPrank();

        vm.warp(2_001);

        vm.expectRevert(ISettlementAdapter.StalePrice.selector);
        adapter.settleSeries(address(series));
        assertFalse(series.isSettled(), "risk split remains unsettled");
        vm.prank(address(0x6789));
        vm.expectRevert();
        series.redeemUpside(1e18);
    }
}
