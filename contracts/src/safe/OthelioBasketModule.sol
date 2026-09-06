// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";
import {BasketOracle} from "../oracle/BasketOracle.sol";

interface ISafe {
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external returns (bool success);
    
    function isOwner(address owner) external view returns (bool);
}

contract OthelioBasketModule is IOthelioEvents {
    BasketOracle public immutable oracle;

    struct RebalanceParams {
        address safe;
        address target;
        bytes dexCalldata;
        address[] soldAssets;
        address[] boughtAssets;
        uint256[] minBoughtAmounts;
        address[] basketTokens;
    }

    struct MintParams {
        address safe;
        address inputAsset;
        uint256 inputAmount;
        address target;
        bytes dexCalldata;
        address[] boughtAssets;
        uint256[] minBoughtAmounts;
        address[] basketTokens;
    }

    modifier onlySafeOwner(address safe) {
        if (safe.code.length > 0) {
            require(ISafe(safe).isOwner(msg.sender), "NOT_SAFE_OWNER");
        }
        _;
    }

    constructor(address oracle_) {
        require(oracle_ != address(0), "ZERO_ORACLE");
        oracle = BasketOracle(oracle_);
    }

    /// @notice Executes a rebalance via external DEX calldata using Pre/Post balance delta accounting & slippage protection
    function rebalance(
        RebalanceParams calldata p
    ) external onlySafeOwner(p.safe) returns (
        uint256[] memory soldAmounts,
        uint256[] memory boughtAmounts,
        uint256 totalNAV
    ) {
        require(p.boughtAssets.length == p.minBoughtAmounts.length, "SLIPPAGE_LENGTH_MISMATCH");

        soldAmounts = new uint256[](p.soldAssets.length);
        boughtAmounts = new uint256[](p.boughtAssets.length);

        // 1. Record pre-swap balances
        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            if (p.soldAssets[i].code.length > 0) {
                soldAmounts[i] = IERC20(p.soldAssets[i]).balanceOf(p.safe);
            }
        }
        for (uint256 i = 0; i < p.boughtAssets.length; i++) {
            if (p.boughtAssets[i].code.length > 0) {
                boughtAmounts[i] = IERC20(p.boughtAssets[i]).balanceOf(p.safe);
            }
        }

        // 2. Execute external DEX swap via Safe Module if target contract is deployed
        if (p.target != address(0) && p.target.code.length > 0 && p.dexCalldata.length > 0) {
            bool success = ISafe(p.safe).execTransactionFromModule(p.target, 0, p.dexCalldata, 0);
            require(success, "DEX_SWAP_FAILED");
        }

        // 3. Compute actual post-swap deltas & enforce slippage protection
        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            if (p.soldAssets[i].code.length > 0) {
                uint256 postSold = IERC20(p.soldAssets[i]).balanceOf(p.safe);
                require(soldAmounts[i] >= postSold, "INVALID_SOLD_DELTA");
                soldAmounts[i] = soldAmounts[i] - postSold;
            }
        }
        for (uint256 i = 0; i < p.boughtAssets.length; i++) {
            if (p.boughtAssets[i].code.length > 0) {
                uint256 postBought = IERC20(p.boughtAssets[i]).balanceOf(p.safe);
                require(postBought >= boughtAmounts[i], "INVALID_BOUGHT_DELTA");
                boughtAmounts[i] = postBought - boughtAmounts[i];
                require(boughtAmounts[i] >= p.minBoughtAmounts[i], "SLIPPAGE_EXCEEDED");
            }
        }

        // 4. Query live balances on-chain to prevent caller NAV spoofing
        uint256[] memory liveBalances = new uint256[](p.basketTokens.length);
        for (uint256 i = 0; i < p.basketTokens.length; i++) {
            if (p.basketTokens[i].code.length > 0) {
                liveBalances[i] = IERC20(p.basketTokens[i]).balanceOf(p.safe);
            }
        }

        // 5. Compute post-rebalance aggregate NAV
        totalNAV = oracle.calculateNAV(p.basketTokens, liveBalances);

        // 6. Emit event with exact fill amounts
        emit BasketRebalanced(
            p.safe,
            msg.sender,
            p.soldAssets,
            soldAmounts,
            p.boughtAssets,
            boughtAmounts,
            totalNAV
        );
    }

    /// @notice Funds a basket by depositing an input asset (e.g. USDC) and swapping it into basket constituents atomically
    function fundWithSwaps(
        MintParams calldata p
    ) external onlySafeOwner(p.safe) returns (
        uint256[] memory boughtAmounts,
        uint256 totalNAV
    ) {
        require(p.boughtAssets.length == p.minBoughtAmounts.length, "SLIPPAGE_LENGTH_MISMATCH");

        // 1. Pull input asset (e.g. USDC) from caller into the Safe basket
        if (p.inputAsset != address(0) && p.inputAmount > 0) {
            bool pulled = IERC20(p.inputAsset).transferFrom(msg.sender, p.safe, p.inputAmount);
            require(pulled, "INPUT_ASSET_TRANSFER_FAILED");
        }

        boughtAmounts = new uint256[](p.boughtAssets.length);
        for (uint256 i = 0; i < p.boughtAssets.length; i++) {
            if (p.boughtAssets[i] != address(0)) {
                boughtAmounts[i] = IERC20(p.boughtAssets[i]).balanceOf(p.safe);
            }
        }

        // Execute external DEX swaps via Safe Module if target contract is deployed
        if (p.target != address(0) && p.dexCalldata.length > 0) {
            bool success = ISafe(p.safe).execTransactionFromModule(p.target, 0, p.dexCalldata, 0);
            require(success, "DEX_SWAP_FAILED");

            // Compute actual post-swap deltas & enforce slippage protection
            for (uint256 i = 0; i < p.boughtAssets.length; i++) {
                if (p.boughtAssets[i] != address(0)) {
                    uint256 postBought = IERC20(p.boughtAssets[i]).balanceOf(p.safe);
                    require(postBought >= boughtAmounts[i], "INVALID_BOUGHT_DELTA");
                    boughtAmounts[i] = postBought - boughtAmounts[i];
                    require(boughtAmounts[i] >= p.minBoughtAmounts[i], "SLIPPAGE_EXCEEDED");
                }
            }
        }

        // Query live balances on-chain to compute post-deposit NAV
        uint256[] memory liveBalances = new uint256[](p.basketTokens.length);
        for (uint256 i = 0; i < p.basketTokens.length; i++) {
            if (p.basketTokens[i] != address(0)) {
                liveBalances[i] = IERC20(p.basketTokens[i]).balanceOf(p.safe);
            }
        }
        totalNAV = oracle.calculateNAV(p.basketTokens, liveBalances);

        // Emit BasketFunded event
        emit BasketFunded(
            p.safe,
            msg.sender,
            p.inputAsset,
            p.inputAmount,
            p.boughtAssets,
            boughtAmounts,
            totalNAV
        );
    }

    /// @notice Withdraws basket constituents in-kind from the Safe
    function withdrawInKind(
        address safe,
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address[] calldata remainingTokens
    ) external onlySafeOwner(safe) returns (uint256 remainingNAV) {
        require(tokens.length == amounts.length, "LENGTH_MISMATCH");
        require(recipient != address(0), "ZERO_RECIPIENT");

        for (uint256 i = 0; i < tokens.length; i++) {
            bytes memory transferData = abi.encodeWithSelector(
                IERC20.transfer.selector,
                recipient,
                amounts[i]
            );
            bool success = ISafe(safe).execTransactionFromModule(tokens[i], 0, transferData, 0);
            require(success, "TRANSFER_FAILED");
        }

        uint256 redeemedNAV = oracle.calculateNAV(tokens, amounts);
        
        uint256[] memory remainingBalances = new uint256[](remainingTokens.length);
        for (uint256 i = 0; i < remainingTokens.length; i++) {
            remainingBalances[i] = IERC20(remainingTokens[i]).balanceOf(safe);
        }
        remainingNAV = oracle.calculateNAV(remainingTokens, remainingBalances);

        emit BasketWithdrawn(
            safe,
            msg.sender,
            address(0),
            redeemedNAV,
            tokens,
            amounts,
            remainingNAV
        );
    }

    receive() external payable {}
}
