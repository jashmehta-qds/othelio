// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAerodromeSlipstreamSwapRouter} from "./IAerodromeSlipstreamSwapRouter.sol";
import {OthelioAerodromeRouteRegistry} from "./OthelioAerodromeRouteRegistry.sol";
import {AerodromeRoute, AerodromeRouteKind} from "./AerodromeRouteTypes.sol";

/// @notice Stateless call builder for direct and via-USDC Slipstream pool routes.
contract OthelioAerodromeSlipstreamAdapter {
    address public immutable router;
    address public immutable usdc;
    OthelioAerodromeRouteRegistry public immutable routeRegistry;

    constructor(address router_, address usdc_, address routeRegistry_) {
        require(router_ != address(0), "INVALID_AERODROME_ROUTER");
        require(usdc_ != address(0), "INVALID_USDC");
        require(routeRegistry_ != address(0), "INVALID_ROUTE_REGISTRY");
        router = router_;
        usdc = usdc_;
        routeRegistry = OthelioAerodromeRouteRegistry(routeRegistry_);
    }

    function exactInputCall(
        AerodromeRoute calldata route,
        address basket,
        uint256 deadline
    ) external view returns (address target, bytes memory data) {
        require(route.tokenIn != address(0) && route.tokenOut != address(0), "INVALID_SWAP_TOKENS");
        require(route.tokenIn != route.tokenOut, "SAME_TOKENS");
        require(basket != address(0), "INVALID_BASKET");
        require(route.amountIn > 0 && route.minimumAmountOut > 0, "INVALID_SWAP_LIMITS");

        bytes memory path;

        if (route.kind == AerodromeRouteKind.DIRECT) {
            require(route.firstTickSpacing != 0, "INVALID_TICK_SPACING");
            require(route.secondTickSpacing == 0, "INVALID_SECOND_TICK_SPACING");

            routeRegistry.requireApprovedPool(
                block.chainid,
                route.tokenIn,
                route.tokenOut,
                route.firstTickSpacing
            );

            path = abi.encodePacked(route.tokenIn, route.firstTickSpacing, route.tokenOut);
        } else if (route.kind == AerodromeRouteKind.VIA_USDC) {
            require(route.tokenIn != usdc && route.tokenOut != usdc, "ENDPOINT_CANNOT_BE_USDC");
            require(route.firstTickSpacing != 0 && route.secondTickSpacing != 0, "INVALID_TICK_SPACINGS");

            routeRegistry.requireApprovedPool(
                block.chainid,
                route.tokenIn,
                usdc,
                route.firstTickSpacing
            );

            routeRegistry.requireApprovedPool(
                block.chainid,
                usdc,
                route.tokenOut,
                route.secondTickSpacing
            );

            path = abi.encodePacked(
                route.tokenIn,
                route.firstTickSpacing,
                usdc,
                route.secondTickSpacing,
                route.tokenOut
            );
        } else {
            revert("UNSUPPORTED_ROUTE_KIND");
        }

        IAerodromeSlipstreamSwapRouter.ExactInputParams memory p = IAerodromeSlipstreamSwapRouter.ExactInputParams({
            path: path,
            recipient: basket,
            deadline: deadline,
            amountIn: route.amountIn,
            amountOutMinimum: route.minimumAmountOut
        });

        return (router, abi.encodeCall(IAerodromeSlipstreamSwapRouter.exactInput, (p)));
    }
}
