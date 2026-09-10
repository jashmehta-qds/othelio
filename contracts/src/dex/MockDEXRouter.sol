// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockDEXRouter {
    using SafeERC20 for IERC20;

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
