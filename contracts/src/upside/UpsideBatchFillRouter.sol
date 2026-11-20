// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

struct LimitOrder {
    address makerToken;
    address takerToken;
    uint128 makerAmount;
    uint128 takerAmount;
    uint128 takerTokenFeeAmount;
    address maker;
    address taker;
    address sender;
    address feeRecipient;
    bytes32 pool;
    uint64 expiry;
    uint256 salt;
}

struct Signature {
    uint8 signatureType;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

interface IZeroExExchangeProxy {
    function fillLimitOrder(LimitOrder calldata order, Signature calldata signature, uint128 takerTokenFillAmount)
        external
        payable
        returns (uint128 takerTokenFilledAmount, uint128 makerTokenFilledAmount);

    function cancelLimitOrder(LimitOrder calldata order) external;
}

/// @notice Atomic multi-level sweep router for 0x v4 limit orders.
/// Fills multiple resting orders sequentially on the 0x ExchangeProxy with all-or-revert atomicity.
contract UpsideBatchFillRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable exchangeProxy;

    error IncompleteFill(uint256 orderIndex, uint128 expected, uint128 actual);
    error ZeroLengthArray();
    error LengthMismatch();
    error ZeroAddress();

    constructor(address exchangeProxy_) {
        if (exchangeProxy_ == address(0)) revert ZeroAddress();
        exchangeProxy = exchangeProxy_;
    }

    function batchFillLimitOrders(
        LimitOrder[] calldata orders,
        Signature[] calldata signatures,
        uint128[] calldata takerTokenFillAmounts,
        bool revertIfIncomplete
    )
        external
        nonReentrant
        returns (uint128[] memory takerTokenFilledAmounts, uint128[] memory makerTokenFilledAmounts)
    {
        uint256 count = orders.length;
        if (count == 0) revert ZeroLengthArray();
        if (count != signatures.length || count != takerTokenFillAmounts.length) revert LengthMismatch();

        takerTokenFilledAmounts = new uint128[](count);
        makerTokenFilledAmounts = new uint128[](count);

        for (uint256 i = 0; i < count; i++) {
            LimitOrder calldata order = orders[i];
            uint128 fillAmount = takerTokenFillAmounts[i];

            IERC20 takerToken = IERC20(order.takerToken);
            uint256 balanceBefore = takerToken.balanceOf(address(this));
            uint256 maxFee = uint256(fillAmount) * order.takerTokenFeeAmount / order.takerAmount;
            uint256 totalInput = uint256(fillAmount) + maxFee;
            takerToken.safeTransferFrom(msg.sender, address(this), totalInput);
            takerToken.forceApprove(exchangeProxy, totalInput);

            // 3. Fill on 0x Exchange Proxy
            (uint128 filledTaker, uint128 filledMaker) =
                IZeroExExchangeProxy(exchangeProxy).fillLimitOrder(order, signatures[i], fillAmount);

            takerToken.forceApprove(exchangeProxy, 0);

            if (revertIfIncomplete && filledTaker < fillAmount) {
                revert IncompleteFill(i, fillAmount, filledTaker);
            }

            takerTokenFilledAmounts[i] = filledTaker;
            makerTokenFilledAmounts[i] = filledMaker;

            // 4. Send makerToken (acquired claims/proceeds) to msg.sender
            if (filledMaker > 0) {
                IERC20(order.makerToken).safeTransfer(msg.sender, filledMaker);
            }

            // 5. Refund any unspent takerToken
            uint256 unspent = takerToken.balanceOf(address(this)) - balanceBefore;
            if (unspent > 0) {
                IERC20(order.takerToken).safeTransfer(msg.sender, unspent);
            }
        }
    }
}
