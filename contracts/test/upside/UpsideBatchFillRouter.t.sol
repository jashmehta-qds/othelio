// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UpsideBatchFillRouter, LimitOrder, Signature} from "../../src/upside/UpsideBatchFillRouter.sol";

contract RouterTestToken is ERC20 {
    constructor() ERC20("Token", "TOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FeeChargingExchange {
    uint128 public fill = 100;

    function setFill(uint128 amount) external {
        fill = amount;
    }

    function fillLimitOrder(LimitOrder calldata order, Signature calldata, uint128 requested)
        external
        payable
        returns (uint128 filled, uint128 makerFilled)
    {
        filled = fill < requested ? fill : requested;
        uint256 fee = uint256(filled) * order.takerTokenFeeAmount / order.takerAmount;
        IERC20(order.takerToken).transferFrom(msg.sender, address(this), filled);
        IERC20(order.takerToken).transferFrom(msg.sender, order.feeRecipient, fee);
        makerFilled = uint128(uint256(filled) * order.makerAmount / order.takerAmount);
        IERC20(order.makerToken).transfer(msg.sender, makerFilled);
    }
}

contract UpsideBatchFillRouterTest is Test {
    RouterTestToken internal taker;
    RouterTestToken internal maker;
    FeeChargingExchange internal exchange;
    UpsideBatchFillRouter internal router;
    address internal recipient = address(0xFEE);

    function setUp() public {
        taker = new RouterTestToken();
        maker = new RouterTestToken();
        exchange = new FeeChargingExchange();
        router = new UpsideBatchFillRouter(address(exchange), address(exchange).codehash);
        taker.mint(address(this), 1000);
        taker.mint(address(router), 7);
        maker.mint(address(exchange), 1000);
        taker.approve(address(router), type(uint256).max);
    }

    function _fill(uint128 fee, bool strict) internal {
        LimitOrder[] memory orders = new LimitOrder[](1);
        orders[0] = LimitOrder(
            address(maker),
            address(taker),
            200,
            100,
            fee,
            address(this),
            address(0),
            address(0),
            recipient,
            bytes32(0),
            type(uint64).max,
            1
        );
        uint128[] memory amounts = new uint128[](1);
        amounts[0] = 100;
        router.batchFillLimitOrders(orders, new Signature[](1), amounts, strict);
    }

    function test_FeeFullFill() public {
        _fill(11, true);
        assertEq(taker.balanceOf(address(this)), 889);
        assertEq(taker.balanceOf(recipient), 11);
        assertEq(maker.balanceOf(address(this)), 200);
        assertEq(taker.balanceOf(address(router)), 7);
        assertEq(taker.allowance(address(router), address(exchange)), 0);
    }

    function test_FeePartialFillRefundsBalanceDeltaAndRoundsDown() public {
        exchange.setFill(33);
        _fill(11, false);
        assertEq(taker.balanceOf(address(this)), 964);
        assertEq(taker.balanceOf(recipient), 3);
        assertEq(maker.balanceOf(address(this)), 66);
        assertEq(taker.balanceOf(address(router)), 7);
        assertEq(taker.allowance(address(router), address(exchange)), 0);
    }

    function test_ZeroFeeAndZeroFillRefund() public {
        exchange.setFill(0);
        _fill(0, false);
        assertEq(taker.balanceOf(address(this)), 1000);
        assertEq(taker.balanceOf(address(router)), 7);
        assertEq(taker.allowance(address(router), address(exchange)), 0);
    }

    function test_IncompleteFeeFillRevertsAtomically() public {
        exchange.setFill(33);
        vm.expectRevert(
            abi.encodeWithSelector(UpsideBatchFillRouter.IncompleteFill.selector, 0, uint128(100), uint128(33))
        );
        _fill(11, true);
        assertEq(taker.balanceOf(address(this)), 1000);
        assertEq(taker.balanceOf(recipient), 0);
    }

    function test_EmptyBatchReverts() public {
        vm.expectRevert(UpsideBatchFillRouter.ZeroLengthArray.selector);
        router.batchFillLimitOrders(new LimitOrder[](0), new Signature[](0), new uint128[](0), false);
    }
}
