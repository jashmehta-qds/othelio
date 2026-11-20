// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {UpsideBatchFillRouter, LimitOrder, Signature} from "../../src/upside/UpsideBatchFillRouter.sol";

enum OrderStatus {
    INVALID,
    FILLABLE,
    FILLED,
    CANCELLED,
    EXPIRED
}

struct OrderInfo {
    bytes32 orderHash;
    OrderStatus status;
    uint128 takerTokenFilledAmount;
}

interface IZeroExFullExchangeProxy {
    function fillLimitOrder(LimitOrder calldata order, Signature calldata signature, uint128 takerTokenFillAmount)
        external
        payable
        returns (uint128 takerTokenFilledAmount, uint128 makerTokenFilledAmount);

    function cancelLimitOrder(LimitOrder calldata order) external;

    function getLimitOrderInfo(LimitOrder calldata order) external view returns (OrderInfo memory orderInfo);

    function getLimitOrderHash(LimitOrder calldata order) external view returns (bytes32 orderHash);
}

contract Upside0xVenueForkTest is Test {
    uint256 public constant BASE_FORK_BLOCK = 53_400_000;
    address public constant ZERO_EX_EXCHANGE_PROXY = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    string public constant ZERO_EX_DOMAIN_NAME = "ZeroEx";
    string public constant ZERO_EX_DOMAIN_VERSION = "1.0.0";

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant LIMIT_ORDER_TYPEHASH = keccak256(
        "LimitOrder("
        "address makerToken,"
        "address takerToken,"
        "uint128 makerAmount,"
        "uint128 takerAmount,"
        "uint128 takerTokenFeeAmount,"
        "address maker,"
        "address taker,"
        "address sender,"
        "address feeRecipient,"
        "bytes32 pool,"
        "uint64 expiry,"
        "uint256 salt"
        ")"
    );

    IZeroExFullExchangeProxy internal exchangeProxy;
    UpsideBatchFillRouter internal router;
    bytes32 internal domainSeparator;

    uint256 internal maker1PrivateKey = 0xA11CE;
    address internal maker1;

    uint256 internal maker2PrivateKey = 0xB0B;
    address internal maker2;

    uint256 internal takerPrivateKey = 0xCAFE;
    address internal taker;

    UpsideClaimToken internal claimToken;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl, BASE_FORK_BLOCK);

        exchangeProxy = IZeroExFullExchangeProxy(ZERO_EX_EXCHANGE_PROXY);
        router = new UpsideBatchFillRouter(ZERO_EX_EXCHANGE_PROXY, ZERO_EX_EXCHANGE_PROXY.codehash);

        domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(ZERO_EX_DOMAIN_NAME)),
                keccak256(bytes(ZERO_EX_DOMAIN_VERSION)),
                block.chainid,
                ZERO_EX_EXCHANGE_PROXY
            )
        );

        maker1 = vm.addr(maker1PrivateKey);
        maker2 = vm.addr(maker2PrivateKey);
        taker = vm.addr(takerPrivateKey);

        // Deploy upside claim token with 8 decimals (matching MSFTc)
        claimToken = new UpsideClaimToken("MSFTc Upside Claim", "UP-MSFTc", address(this), 8);

        // Mint claims to makers: 10 claims each (10 * 1e8)
        claimToken.mint(maker1, 10 * 1e8);
        claimToken.mint(maker2, 10 * 1e8);

        // Deal USDC to taker: 100 USDC (100 * 1e6)
        deal(USDC, taker, 100 * 1e6);

        // Approve 0x Exchange Proxy
        vm.prank(maker1);
        claimToken.approve(ZERO_EX_EXCHANGE_PROXY, type(uint256).max);

        vm.prank(maker2);
        claimToken.approve(ZERO_EX_EXCHANGE_PROXY, type(uint256).max);

        // Taker approves router and 0x proxy
        vm.prank(taker);
        IERC20(USDC).approve(address(router), type(uint256).max);

        vm.prank(taker);
        IERC20(USDC).approve(ZERO_EX_EXCHANGE_PROXY, type(uint256).max);
    }

    function _signOrder(LimitOrder memory order, uint256 privateKey) internal view returns (Signature memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                LIMIT_ORDER_TYPEHASH,
                order.makerToken,
                order.takerToken,
                order.makerAmount,
                order.takerAmount,
                order.takerTokenFeeAmount,
                order.maker,
                order.taker,
                order.sender,
                order.feeRecipient,
                order.pool,
                order.expiry,
                order.salt
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        return Signature({signatureType: 2, v: v, r: r, s: s});
    }

    function test_Fork_SingleOrderFillDirectOnExchangeProxy() public {
        LimitOrder memory order = LimitOrder({
            makerToken: address(claimToken),
            takerToken: USDC,
            makerAmount: 50_000_000, // 0.5 claims
            takerAmount: 2_050_000,  // 2.05 USDC
            takerTokenFeeAmount: 0,
            maker: maker1,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 3600),
            salt: 10
        });
        Signature memory sig = _signOrder(order, maker1PrivateKey);

        vm.prank(taker);
        (uint128 filledTaker, uint128 filledMaker) =
            exchangeProxy.fillLimitOrder(order, sig, 2_050_000);

        assertEq(filledTaker, 2_050_000);
        assertEq(filledMaker, 50_000_000);
        assertEq(claimToken.balanceOf(taker), 50_000_000);
        assertEq(IERC20(USDC).balanceOf(maker1), 2_050_000);
    }

    function test_Fork_BatchFillRouter_MultiLevelSweep() public {
        // Level 1 (Maker 1): Sell 0.5 claims (0.5 * 1e8 = 50,000,000) for 2.05 USDC (2,050,000) -> $4.10/unit
        LimitOrder memory order1 = LimitOrder({
            makerToken: address(claimToken),
            takerToken: USDC,
            makerAmount: 50_000_000,
            takerAmount: 2_050_000,
            takerTokenFeeAmount: 0,
            maker: maker1,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 3600),
            salt: 101
        });
        Signature memory sig1 = _signOrder(order1, maker1PrivateKey);

        // Level 2 (Maker 2): Sell 0.7 claims (0.7 * 1e8 = 70,000,000) for 2.94 USDC (2,940,000) -> $4.20/unit
        LimitOrder memory order2 = LimitOrder({
            makerToken: address(claimToken),
            takerToken: USDC,
            makerAmount: 70_000_000,
            takerAmount: 2_940_000,
            takerTokenFeeAmount: 0,
            maker: maker2,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 3600),
            salt: 102
        });
        Signature memory sig2 = _signOrder(order2, maker2PrivateKey);

        // Prepare batch fill sweep
        LimitOrder[] memory orders = new LimitOrder[](2);
        orders[0] = order1;
        orders[1] = order2;

        Signature[] memory signatures = new Signature[](2);
        signatures[0] = sig1;
        signatures[1] = sig2;

        // Taker fills full amount on both orders: total cost = 2.05 + 2.94 = 4.99 USDC
        uint128[] memory takerFillAmounts = new uint128[](2);
        takerFillAmounts[0] = 2_050_000;
        takerFillAmounts[1] = 2_940_000;

        uint256 gasBefore = gasleft();
        vm.prank(taker);
        (uint128[] memory filledTakers, uint128[] memory filledMakers) =
            router.batchFillLimitOrders(orders, signatures, takerFillAmounts, true);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for 2-level batchFillLimitOrders via router:", gasUsed);

        assertEq(filledTakers.length, 2);
        assertEq(filledTakers[0], 2_050_000, "Level 1 taker fill mismatch");
        assertEq(filledTakers[1], 2_940_000, "Level 2 taker fill mismatch");

        assertEq(filledMakers[0], 50_000_000, "Level 1 maker fill mismatch");
        assertEq(filledMakers[1], 70_000_000, "Level 2 maker fill mismatch");

        // Verify balances:
        // Taker received 0.5 + 0.7 = 1.2 claims (120,000,000)
        assertEq(claimToken.balanceOf(taker), 120_000_000, "Taker should have 1.2 claims");
        // Taker spent exactly 4.99 USDC
        assertEq(IERC20(USDC).balanceOf(taker), 100 * 1e6 - 4_990_000, "Taker should have spent $4.99 USDC");

        // Maker 1 received 2.05 USDC
        assertEq(IERC20(USDC).balanceOf(maker1), 2_050_000, "Maker 1 should have 2.05 USDC");
        // Maker 2 received 2.94 USDC
        assertEq(IERC20(USDC).balanceOf(maker2), 2_940_000, "Maker 2 should have 2.94 USDC");
    }

    function test_Fork_BatchFillRouter_PartialFill() public {
        // Maker 1 sells 1.0 claim (100,000,000) for 4.10 USDC (4,100,000)
        LimitOrder memory order = LimitOrder({
            makerToken: address(claimToken),
            takerToken: USDC,
            makerAmount: 100_000_000,
            takerAmount: 4_100_000,
            takerTokenFeeAmount: 0,
            maker: maker1,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 3600),
            salt: 201
        });
        Signature memory sig = _signOrder(order, maker1PrivateKey);

        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = order;

        Signature[] memory signatures = new Signature[](1);
        signatures[0] = sig;

        // Taker buys half amount: 2.05 USDC
        uint128[] memory takerFillAmounts = new uint128[](1);
        takerFillAmounts[0] = 2_050_000;

        vm.prank(taker);
        (uint128[] memory filledTakers, uint128[] memory filledMakers) =
            router.batchFillLimitOrders(orders, signatures, takerFillAmounts, true);

        assertEq(filledTakers[0], 2_050_000, "Partial taker fill mismatch");
        assertEq(filledMakers[0], 50_000_000, "Partial maker fill mismatch");

        assertEq(claimToken.balanceOf(taker), 50_000_000, "Taker should have 0.5 claims");
        assertEq(IERC20(USDC).balanceOf(maker1), 2_050_000, "Maker 1 should have 2.05 USDC");
    }

    function test_Fork_BatchFillRouter_RevertIfIncompleteOnCancelledOrder() public {
        LimitOrder memory order1 = LimitOrder({
            makerToken: address(claimToken),
            takerToken: USDC,
            makerAmount: 50_000_000,
            takerAmount: 2_050_000,
            takerTokenFeeAmount: 0,
            maker: maker1,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 3600),
            salt: 301
        });
        Signature memory sig1 = _signOrder(order1, maker1PrivateKey);

        LimitOrder memory order2 = LimitOrder({
            makerToken: address(claimToken),
            takerToken: USDC,
            makerAmount: 70_000_000,
            takerAmount: 2_940_000,
            takerTokenFeeAmount: 0,
            maker: maker2,
            taker: address(0),
            sender: address(0),
            feeRecipient: address(0),
            pool: bytes32(0),
            expiry: uint64(block.timestamp + 3600),
            salt: 302
        });
        Signature memory sig2 = _signOrder(order2, maker2PrivateKey);

        // Maker 1 cancels her order on 0x Exchange Proxy
        vm.prank(maker1);
        exchangeProxy.cancelLimitOrder(order1);

        LimitOrder[] memory orders = new LimitOrder[](2);
        orders[0] = order1;
        orders[1] = order2;

        Signature[] memory signatures = new Signature[](2);
        signatures[0] = sig1;
        signatures[1] = sig2;

        uint128[] memory takerFillAmounts = new uint128[](2);
        takerFillAmounts[0] = 2_050_000;
        takerFillAmounts[1] = 2_940_000;

        // Calling batchFillLimitOrders via router with revertIfIncomplete=true MUST revert
        vm.prank(taker);
        vm.expectRevert();
        router.batchFillLimitOrders(orders, signatures, takerFillAmounts, true);

        // Verify zero tokens were lost or transferred
        assertEq(claimToken.balanceOf(taker), 0, "Taker should have 0 claims");
        assertEq(IERC20(USDC).balanceOf(taker), 100 * 1e6, "Taker should retain full 100 USDC");
    }
}
