// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum AerodromeRouteKind {
    DIRECT,
    VIA_USDC
}

struct AerodromeRoute {
    AerodromeRouteKind kind;
    address tokenIn;
    address tokenOut;
    int24 firstTickSpacing;
    int24 secondTickSpacing;
    uint256 amountIn;
    uint256 minimumAmountOut;
}
