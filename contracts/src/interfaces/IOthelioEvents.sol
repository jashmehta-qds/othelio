// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOthelioEvents {

    /// @notice Emitted when a new Safe basket is initialized
    event BasketCreated(
        address indexed safe,
        address indexed owner,
        string name,
        uint256 createdAt
    );

    /// @notice Emitted when capital enters the basket
    event BasketFunded(
        address indexed safe,
        address indexed funder,
        address inputAsset,          // e.g. USDC or WETH
        uint256 inputAmount,         // Amount of input asset spent
        address[] acquiredAssets,    // Constituents acquired
        uint256[] acquiredAmounts,   // Quantities deposited into Safe (measured via pre/post delta)
        uint256 acquiredOutputNavUsdc // Oracle value of only this funding operation's acquired outputs; not whole-basket NAV
    );

    /// @notice Emitted when capital is withdrawn from the basket
    event BasketWithdrawn(
        address indexed safe,
        address indexed owner,
        address outputAsset,         // e.g. USDC or Address(0) for In-Kind
        uint256 navRedeemed,         // Total USD value of redeemed assets
        address[] withdrawnAssets,   // Constituents transferred out
        uint256[] withdrawnAmounts,  // Quantities transferred out
        uint256 remainingListedAssetsNavUsdc // Oracle value of caller-supplied remaining assets only; not whole-basket NAV
    );

    /// @notice Emitted when basket constituents are swapped into one output asset and paid to the recipient.
    event BasketSwapWithdrawn(
        address indexed safe,
        address indexed owner,
        address indexed recipient,
        address outputAsset,
        uint256 outputAmount,
        address[] soldAssets,
        uint256[] soldAmounts,
        uint256 remainingListedAssetsNavUsdc // Execution-scoped value only; not whole-basket NAV
    );

    /// @notice Emitted when internal holdings are rebalanced via external DEX swaps
    event BasketRebalanced(
        address indexed safe,
        address indexed controller,
        address[] soldAssets,        // Assets sold during rebalance (e.g. NVDAc)
        uint256[] soldAmounts,       // Actual quantities sold
        address[] boughtAssets,      // Assets bought during rebalance (e.g. GOOGc)
        uint256[] boughtAmounts,     // Actual quantities bought (after DEX fee/slippage)
        uint256 tradedOutputNavUsdc  // Oracle value of assets bought by these route legs only; not basket NAV
    );

    /// @notice Emitted for each route leg executed within a portfolio funding or rebalancing operation
    event AerodromeRouteExecuted(
        address indexed basket,
        address indexed tokenIn,
        address indexed tokenOut,
        uint8 kind,
        uint256 amountIn,
        uint256 amountOut,
        int24 firstTickSpacing,
        int24 secondTickSpacing
    );

    /// @notice Emitted when an owner sweeps accidental / untracked tokens
    event UntrackedAssetSwept(
        address indexed safe,
        address indexed owner,
        address indexed token,
        uint256 amount
    );

    /// @notice Emitted when basket assets are supplied into a lending market
    event BasketSuppliedToLending(
        address indexed safe,
        address indexed provider,
        address indexed asset,
        uint256 amount,
        uint256 supplyApyBps
    );

    /// @notice Emitted when USDC or stablecoins are borrowed against basket collateral
    event BasketBorrowedFromLending(
        address indexed safe,
        address indexed provider,
        address indexed asset,
        uint256 amount,
        uint256 borrowApyBps
    );

    /// @notice Emitted when debt is repaid to a lending market
    event BasketRepaidToLending(
        address indexed safe,
        address indexed provider,
        address indexed asset,
        uint256 amount
    );

    /// @notice Emitted when collateral is withdrawn from a lending market back to Safe
    event BasketWithdrawnFromLending(
        address indexed safe,
        address indexed provider,
        address indexed asset,
        uint256 amount
    );
}
