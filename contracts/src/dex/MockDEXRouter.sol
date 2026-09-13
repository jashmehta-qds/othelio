// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAerodromeSlipstreamSwapRouter} from "./IAerodromeSlipstreamSwapRouter.sol";

contract MockDEXRouter is IAerodromeSlipstreamSwapRouter {
    using SafeERC20 for IERC20;

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        require(block.timestamp <= p.deadline, "EXPIRED");
        IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
        IERC20(p.tokenOut).safeTransfer(p.recipient, p.amountOutMinimum);
        return p.amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        require(block.timestamp <= p.deadline, "EXPIRED");
        bytes memory path = p.path;
        address tokenIn;
        address tokenOut;

        if (path.length == 43) {
            tokenIn = _decodeAddress(path, 0);
            int24 tick = _decodeInt24(path, 20);
            tokenOut = _decodeAddress(path, 23);
            require(tick != 0, "INVALID_TICK");

            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
            IERC20(tokenOut).safeTransfer(p.recipient, p.amountOutMinimum);
            return p.amountOutMinimum;
        } else if (path.length == 66) {
            tokenIn = _decodeAddress(path, 0);
            int24 tick1 = _decodeInt24(path, 20);
            address usdcToken = _decodeAddress(path, 23);
            int24 tick2 = _decodeInt24(path, 43);
            tokenOut = _decodeAddress(path, 46);

            require(tick1 != 0 && tick2 != 0, "INVALID_TICK");
            require(usdcToken != address(0), "INVALID_INTERMEDIATE_TOKEN");

            // Step 1: tokenIn -> usdcToken (pull tokenIn into router)
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);

            // Step 2: usdcToken -> tokenOut
            // Deduct intermediate USDC liquidity from router to simulate step 2 consumption
            uint256 usdcBalance = IERC20(usdcToken).balanceOf(address(this));

            // Calculate intermediate USDC consumption scaled to trade size (18-decimal tokenIn maps via /1e12 to 6-decimal USDC)
            uint256 expectedIntermediateUsdc = p.amountIn >= 1e12 ? p.amountIn / 1e12 : p.amountIn;
            if (expectedIntermediateUsdc == 0) {
                expectedIntermediateUsdc = 1;
            }

            require(usdcBalance >= expectedIntermediateUsdc, "INSUFFICIENT_INTERMEDIATE_USDC");
            IERC20(usdcToken).safeTransfer(address(0x000000000000000000000000000000000000dEaD), expectedIntermediateUsdc);

            // Transfer final tokenOut to recipient
            IERC20(tokenOut).safeTransfer(p.recipient, p.amountOutMinimum);
            return p.amountOutMinimum;
        } else {
            revert("INVALID_MOCK_PATH_LENGTH");
        }
    }

    function _decodeAddress(bytes memory path, uint256 offset) internal pure returns (address addr) {
        require(path.length >= offset + 20, "INVALID_PATH_OFFSET");
        assembly {
            addr := shr(96, mload(add(add(path, 0x20), offset)))
        }
    }

    function _decodeInt24(bytes memory path, uint256 offset) internal pure returns (int24 tick) {
        require(path.length >= offset + 3, "INVALID_PATH_OFFSET");
        assembly {
            tick := signextend(2, shr(232, mload(add(add(path, 0x20), offset))))
        }
    }

    /// @notice Swap tokenIn for tokenOut
    function swap(address tokenIn, address tokenOut, address safe, uint256 amountIn, uint256 amountOut) external {
        require(tokenIn != address(0) && tokenOut != address(0), "ZERO_TOKEN");
        require(safe != address(0), "ZERO_RECIPIENT");
        require(amountIn > 0 && amountOut > 0, "ZERO_AMOUNT");

        IERC20(tokenIn).safeTransferFrom(safe, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(safe, amountOut);
    }

    /// @notice Swap tokenIn for multiple tokensOut with specified amountsOut
    function swapMulti(
        address tokenIn,
        address[] calldata tokensOut,
        address safe,
        uint256 amountIn,
        uint256[] calldata amountsOut
    ) external {
        require(tokensOut.length == amountsOut.length, "LENGTH_MISMATCH");
        require(tokenIn != address(0), "ZERO_TOKEN");
        require(safe != address(0), "ZERO_RECIPIENT");
        require(amountIn > 0, "ZERO_AMOUNT");

        IERC20(tokenIn).safeTransferFrom(safe, address(this), amountIn);
        for (uint256 i = 0; i < tokensOut.length; i++) {
            require(tokensOut[i] != address(0), "ZERO_TOKEN");
            require(amountsOut[i] > 0, "ZERO_AMOUNT");
            IERC20(tokensOut[i]).safeTransfer(safe, amountsOut[i]);
        }
    }
}
