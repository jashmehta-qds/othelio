// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";
import {IOthelioAccountCapabilities} from "../interfaces/IOthelioAccountCapabilities.sol";
import {BasketOracle} from "../oracle/BasketOracle.sol";

interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success);
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success, bytes memory returnData);

    function isOwner(address owner) external view returns (bool);
}

contract OthelioBasketModule is IOthelioEvents, IOthelioAccountCapabilities, ReentrancyGuard {
    using SafeERC20 for IERC20;

    BasketOracle public immutable oracle;
    address public immutable factorySetter;
    address public factory;

    function moduleVersion() external pure returns (uint256) {
        return 3;
    }

    function supportsBoundedExecution() external pure returns (bool) {
        return true;
    }

    function enforcesPortfolioOnly() external pure returns (bool) {
        return false;
    }

    function setFactory(address factory_) external {
        require(msg.sender == factorySetter, "NOT_FACTORY_SETTER");
        require(factory == address(0), "FACTORY_ALREADY_SET");
        require(factory_ != address(0), "ZERO_FACTORY");
        factory = factory_;
    }

    struct RebalanceLeg {
        address target;
        address allowanceSpender;
        address soldAsset;
        uint256 maxSoldAmount;
        bytes dexCalldata;
    }

    struct RebalanceParams {
        address safe;
        RebalanceLeg[] legs;
        address[] soldAssets;
        uint256[] maxSoldAmounts;
        address[] boughtAssets;
        uint256[] minBoughtAmounts;
        address[] basketTokens;
        uint256 deadline;
    }

    struct SwapLeg {
        address target;
        address allowanceSpender;
        uint256 inputAmount;
        bytes dexCalldata;
    }

    struct MintParams {
        address safe;
        address inputAsset;
        uint256 inputAmount;
        SwapLeg[] legs;
        address[] boughtAssets;
        uint256[] minBoughtAmounts;
        address[] basketTokens;
        uint256 deadline;
    }

    struct WithdrawWithSwapsParams {
        address safe;
        address recipient;
        address outAsset;
        uint256 minOutAssetAmount;
        address target;
        address allowanceSpender;
        bytes dexCalldata;
        address[] soldAssets;
        uint256[] maxSoldAmounts;
        address[] remainingTokens;
        uint256 deadline;
    }

    modifier onlySafeOwner(address safe) {
        require(safe.code.length > 0, "INVALID_SAFE");
        require(ISafe(safe).isOwner(msg.sender), "NOT_SAFE_OWNER");
        _;
    }

    constructor(address oracle_) {
        require(oracle_ != address(0), "ZERO_ORACLE");
        oracle = BasketOracle(oracle_);
        factorySetter = msg.sender;
    }

    function _validateTarget(address safe, address target) private view {
        require(target != address(0), "ZERO_TARGET");
        require(target.code.length > 0, "TARGET_NOT_CONTRACT");
        require(target != safe, "CANNOT_TARGET_SAFE");
        require(target != address(this), "CANNOT_TARGET_MODULE");
        require(target != address(oracle), "CANNOT_TARGET_ORACLE");
        if (factory != address(0)) {
            require(target != factory, "CANNOT_TARGET_FACTORY");
        }
    }

    function _executeTokenCall(address safe, address token, bytes memory data, string memory errorMessage) private {
        (bool success, bytes memory returnData) = ISafe(safe).execTransactionFromModuleReturnData(token, 0, data, 0);
        require(success, errorMessage);
        require(returnData.length == 0 || (returnData.length == 32 && abi.decode(returnData, (bool))), errorMessage);
    }

    /// @dev Every DEX route receives a bounded, one-call allowance. Resetting to zero first supports
    /// tokens that require zeroing an existing allowance before setting a new nonzero value.
    function _setDexAllowance(address safe, address token, address spender, uint256 amount) private {
        require(spender != address(0), "ZERO_SPENDER");
        require(spender != safe, "CANNOT_SPEND_TO_SAFE");
        require(spender != address(this), "CANNOT_SPEND_TO_MODULE");
        _executeTokenCall(safe, token, abi.encodeWithSelector(IERC20.approve.selector, spender, 0), "DEX_APPROVE_FAILED");
        if (amount > 0) {
            _executeTokenCall(
                safe, token, abi.encodeWithSelector(IERC20.approve.selector, spender, amount), "DEX_APPROVE_FAILED"
            );
        }
    }

    function _approveToken(address safe, address token, address spender, uint256 amount) private {
        require(spender != address(0), "ZERO_SPENDER");
        require(spender != safe, "CANNOT_SPEND_TO_SAFE");
        require(spender != address(this), "CANNOT_SPEND_TO_MODULE");
        _executeTokenCall(safe, token, abi.encodeWithSelector(IERC20.approve.selector, spender, 0), "APPROVE_FAILED");
        if (amount > 0) {
            _executeTokenCall(safe, token, abi.encodeWithSelector(IERC20.approve.selector, spender, amount), "APPROVE_FAILED");
        }
    }

    function _validateBasketTokens(address[] memory basketTokens) private view {
        for (uint256 i = 0; i < basketTokens.length; i++) {
            require(basketTokens[i].code.length > 0, "INVALID_BASKET_TOKEN");
            for (uint256 j = 0; j < i; j++) {
                require(basketTokens[i] != basketTokens[j], "DUPLICATE_BASKET_TOKEN");
            }
        }
    }

    /// @notice Executes a rebalance via external DEX calldata using Pre/Post balance delta accounting & slippage protection
    function rebalance(RebalanceParams calldata p)
        external
        onlySafeOwner(p.safe)
        nonReentrant
        returns (uint256[] memory soldAmounts, uint256[] memory boughtAmounts, uint256 totalNAV)
    {
        require(p.boughtAssets.length == p.minBoughtAmounts.length, "SLIPPAGE_LENGTH_MISMATCH");
        require(p.soldAssets.length == p.maxSoldAmounts.length, "SOLD_LENGTH_MISMATCH");
        require(block.timestamp <= p.deadline, "QUOTE_EXPIRED");
        require(p.legs.length > 0, "INVALID_REBALANCE_LEGS");
        require(p.boughtAssets.length > 0, "INVALID_BOUGHT_ASSETS");
        _validateBasketTokens(p.basketTokens);

        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            require(p.soldAssets[i].code.length > 0, "INVALID_SOLD_ASSET");
            require(p.maxSoldAmounts[i] > 0, "INVALID_SOLD_LIMIT");
            for (uint256 k = 0; k < i; k++) {
                require(p.soldAssets[i] != p.soldAssets[k], "DUPLICATE_SOLD_ASSET");
            }
            for (uint256 j = 0; j < p.boughtAssets.length; j++) {
                require(p.soldAssets[i] != p.boughtAssets[j], "OVERLAPPING_ASSET");
            }
        }
        for (uint256 i = 0; i < p.boughtAssets.length; i++) {
            require(p.boughtAssets[i].code.length > 0, "INVALID_BOUGHT_ASSET");
            require(p.minBoughtAmounts[i] > 0, "INVALID_BOUGHT_LIMIT");
            for (uint256 j = 0; j < i; j++) {
                require(p.boughtAssets[i] != p.boughtAssets[j], "DUPLICATE_BOUGHT_ASSET");
            }
        }

        // Aggregate route caps must never exceed the declared per-asset maximums.  A single
        // sell can have several routes, but the sum of their one-call allowances is bounded.
        uint256[] memory aggregateLegInputs = new uint256[](p.soldAssets.length);
        for (uint256 i = 0; i < p.legs.length; i++) {
            RebalanceLeg calldata leg = p.legs[i];
            _validateTarget(p.safe, leg.target);
            require(leg.dexCalldata.length > 0, "INVALID_SWAP_ROUTE");
            require(leg.allowanceSpender != address(0) && leg.allowanceSpender.code.length > 0, "INVALID_ALLOWANCE_SPENDER");
            require(leg.allowanceSpender != p.safe && leg.allowanceSpender != address(this), "INVALID_ALLOWANCE_SPENDER");
            require(leg.soldAsset.code.length > 0, "INVALID_SOLD_ASSET");
            require(leg.maxSoldAmount > 0, "INVALID_LEG_INPUT");

            bool declaredSoldAsset;
            for (uint256 j = 0; j < p.soldAssets.length; j++) {
                if (leg.soldAsset == p.soldAssets[j]) {
                    aggregateLegInputs[j] += leg.maxSoldAmount;
                    require(aggregateLegInputs[j] <= p.maxSoldAmounts[j], "LEG_INPUT_EXCEEDS_TOTAL");
                    declaredSoldAsset = true;
                    break;
                }
            }
            require(declaredSoldAsset, "UNDECLARED_LEG_SOLD_ASSET");
        }

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

        // 2. Execute each swap leg with temporary allowances
        for (uint256 i = 0; i < p.legs.length; i++) {
            RebalanceLeg calldata leg = p.legs[i];
            _setDexAllowance(p.safe, leg.soldAsset, leg.allowanceSpender, leg.maxSoldAmount);
            bool success = ISafe(p.safe).execTransactionFromModule(leg.target, 0, leg.dexCalldata, 0);
            require(success, "DEX_SWAP_FAILED");
            _setDexAllowance(p.safe, leg.soldAsset, leg.allowanceSpender, 0);
        }

        // 4. Compute actual post-swap deltas & enforce slippage protection
        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            if (p.soldAssets[i].code.length > 0) {
                uint256 postSold = IERC20(p.soldAssets[i]).balanceOf(p.safe);
                require(soldAmounts[i] >= postSold, "INVALID_SOLD_DELTA");
                soldAmounts[i] = soldAmounts[i] - postSold;
                require(soldAmounts[i] <= p.maxSoldAmounts[i], "MAX_SOLD_EXCEEDED");
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

        // 5. Query live balances on-chain to prevent caller NAV spoofing
        uint256[] memory liveBalances = new uint256[](p.basketTokens.length);
        for (uint256 i = 0; i < p.basketTokens.length; i++) {
            if (p.basketTokens[i].code.length > 0) {
                liveBalances[i] = IERC20(p.basketTokens[i]).balanceOf(p.safe);
            }
        }

        // 6. Compute post-rebalance aggregate NAV
        totalNAV = oracle.calculateNAV(p.basketTokens, liveBalances);

        // 7. Emit event with exact fill amounts
        emit BasketRebalanced(p.safe, msg.sender, p.soldAssets, soldAmounts, p.boughtAssets, boughtAmounts, totalNAV);
    }

    /// @notice Internal helper to handle basket funding, token pulls, DEX swaps, slippage, and NAV calculation
    function _fundWithSwaps(address funder, MintParams calldata p)
        internal
        returns (uint256[] memory boughtAmounts, uint256 totalNAV)
    {
        require(p.boughtAssets.length == p.minBoughtAmounts.length, "SLIPPAGE_LENGTH_MISMATCH");
        require((p.inputAsset == address(0)) == (p.inputAmount == 0), "INVALID_INPUT");
        require(block.timestamp <= p.deadline, "QUOTE_EXPIRED");
        require(p.boughtAssets.length > 0, "INVALID_BOUGHT_ASSETS");
        _validateBasketTokens(p.basketTokens);

        boughtAmounts = new uint256[](p.boughtAssets.length);
        for (uint256 i = 0; i < p.boughtAssets.length; i++) {
            require(p.boughtAssets[i] != address(0), "ZERO_BOUGHT_ASSET");
            require(p.boughtAssets[i].code.length > 0, "INVALID_BOUGHT_ASSET");
            require(p.minBoughtAmounts[i] > 0, "INVALID_BOUGHT_LIMIT");
            for (uint256 j = 0; j < i; j++) {
                require(p.boughtAssets[i] != p.boughtAssets[j], "DUPLICATE_BOUGHT_ASSET");
            }
            boughtAmounts[i] = IERC20(p.boughtAssets[i]).balanceOf(p.safe);
        }

        uint256 preInputBalance;
        uint256 depositedAmount;

        if (p.inputAsset != address(0) && p.inputAmount > 0) {
            preInputBalance = IERC20(p.inputAsset).balanceOf(p.safe);
            IERC20(p.inputAsset).safeTransferFrom(funder, p.safe, p.inputAmount);
            depositedAmount = IERC20(p.inputAsset).balanceOf(p.safe) - preInputBalance;
        }

        if (p.legs.length > 0) {
            require(p.inputAmount > 0, "INVALID_SWAP_INPUT");
            uint256 totalLegInput = 0;
            for (uint256 i = 0; i < p.legs.length; i++) {
                SwapLeg calldata leg = p.legs[i];
                _validateTarget(p.safe, leg.target);
                require(leg.dexCalldata.length > 0, "INVALID_SWAP_ROUTE");
                require(leg.allowanceSpender != address(0) && leg.allowanceSpender.code.length > 0, "INVALID_ALLOWANCE_SPENDER");
                require(leg.allowanceSpender != p.safe && leg.allowanceSpender != address(this), "INVALID_ALLOWANCE_SPENDER");
                require(leg.inputAmount > 0, "INVALID_LEG_INPUT");
                totalLegInput += leg.inputAmount;
                _setDexAllowance(p.safe, p.inputAsset, leg.allowanceSpender, leg.inputAmount);
                bool success = ISafe(p.safe).execTransactionFromModule(leg.target, 0, leg.dexCalldata, 0);
                require(success, "DEX_SWAP_FAILED");
                _setDexAllowance(p.safe, p.inputAsset, leg.allowanceSpender, 0);
            }
            require(totalLegInput <= p.inputAmount, "LEG_INPUT_EXCEEDS_TOTAL");
        }

        for (uint256 i = 0; i < p.boughtAssets.length; i++) {
            uint256 postBought = IERC20(p.boughtAssets[i]).balanceOf(p.safe);
            require(postBought >= boughtAmounts[i], "INVALID_BOUGHT_DELTA");
            boughtAmounts[i] = postBought - boughtAmounts[i];
            require(boughtAmounts[i] >= p.minBoughtAmounts[i], "SLIPPAGE_EXCEEDED");
        }

        uint256[] memory liveBalances = new uint256[](p.basketTokens.length);
        for (uint256 i = 0; i < p.basketTokens.length; i++) {
            if (p.basketTokens[i] != address(0)) {
                liveBalances[i] = IERC20(p.basketTokens[i]).balanceOf(p.safe);
            }
        }
        totalNAV = oracle.calculateNAV(p.basketTokens, liveBalances);

        emit BasketFunded(p.safe, funder, p.inputAsset, depositedAmount, p.boughtAssets, boughtAmounts, totalNAV);
    }

    /// @notice Funds a basket by depositing an input asset (e.g. USDC) and swapping it into basket constituents atomically
    function fundWithSwaps(MintParams calldata p)
        external
        onlySafeOwner(p.safe)
        nonReentrant
        returns (uint256[] memory boughtAmounts, uint256 totalNAV)
    {
        return _fundWithSwaps(msg.sender, p);
    }

    /// @notice Funds a newly created basket from Factory using pulled input asset (e.g. USDC)
    function fundWithSwapsFromFactory(address funder, MintParams calldata p)
        external
        nonReentrant
        returns (uint256[] memory boughtAmounts, uint256 totalNAV)
    {
        require(msg.sender == factory, "ONLY_FACTORY");
        return _fundWithSwaps(funder, p);
    }

    /// @notice Withdraws basket constituents by swapping them into a single output asset (e.g. USDC) and sending to recipient
    function withdrawWithSwaps(WithdrawWithSwapsParams calldata p)
        external
        onlySafeOwner(p.safe)
        nonReentrant
        returns (uint256 outAmount, uint256 remainingNAV)
    {
        require(p.recipient != address(0), "ZERO_RECIPIENT");
        require(p.outAsset != address(0), "ZERO_OUT_ASSET");
        require(p.outAsset.code.length > 0, "INVALID_OUT_ASSET");
        require(p.soldAssets.length == p.maxSoldAmounts.length, "SOLD_LENGTH_MISMATCH");
        require(block.timestamp <= p.deadline, "QUOTE_EXPIRED");
        _validateTarget(p.safe, p.target);
        require(p.dexCalldata.length > 0, "INVALID_SWAP_ROUTE");
        require(p.allowanceSpender != address(0) && p.allowanceSpender.code.length > 0, "INVALID_ALLOWANCE_SPENDER");
        require(p.allowanceSpender != p.safe && p.allowanceSpender != address(this), "INVALID_ALLOWANCE_SPENDER");
        _validateBasketTokens(p.remainingTokens);

        uint256[] memory preSoldBalances = new uint256[](p.soldAssets.length);
        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            require(p.soldAssets[i] != p.outAsset, "OUTPUT_IS_SOLD_ASSET");
            require(p.soldAssets[i].code.length > 0, "INVALID_SOLD_ASSET");
            require(p.maxSoldAmounts[i] > 0, "INVALID_SOLD_LIMIT");
            for (uint256 k = 0; k < i; k++) {
                require(p.soldAssets[i] != p.soldAssets[k], "DUPLICATE_SOLD_ASSET");
            }
            preSoldBalances[i] = IERC20(p.soldAssets[i]).balanceOf(p.safe);
        }

        uint256 preOutBalance = 0;
        if (p.outAsset != address(0)) {
            preOutBalance = IERC20(p.outAsset).balanceOf(p.safe);
        }

        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            _setDexAllowance(p.safe, p.soldAssets[i], p.allowanceSpender, p.maxSoldAmounts[i]);
        }

        bool success = ISafe(p.safe).execTransactionFromModule(p.target, 0, p.dexCalldata, 0);
        require(success, "DEX_SWAP_FAILED");

        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            _setDexAllowance(p.safe, p.soldAssets[i], p.allowanceSpender, 0);
        }

        for (uint256 i = 0; i < p.soldAssets.length; i++) {
            uint256 postSoldBalance = IERC20(p.soldAssets[i]).balanceOf(p.safe);
            require(preSoldBalances[i] >= postSoldBalance, "INVALID_SOLD_DELTA");
            require(preSoldBalances[i] - postSoldBalance <= p.maxSoldAmounts[i], "MAX_SOLD_EXCEEDED");
        }

        uint256 postOutBalance = 0;
        if (p.outAsset != address(0)) {
            postOutBalance = IERC20(p.outAsset).balanceOf(p.safe);
        }

        outAmount = postOutBalance >= preOutBalance ? postOutBalance - preOutBalance : 0;
        require(outAmount >= p.minOutAssetAmount, "SLIPPAGE_EXCEEDED");

        if (p.outAsset != address(0) && outAmount > 0) {
            bytes memory transferData = abi.encodeWithSelector(IERC20.transfer.selector, p.recipient, outAmount);
            _executeTokenCall(p.safe, p.outAsset, transferData, "TRANSFER_FAILED");
        }

        uint256[] memory remainingBalances = new uint256[](p.remainingTokens.length);
        for (uint256 i = 0; i < p.remainingTokens.length; i++) {
            if (p.remainingTokens[i] != address(0)) {
                remainingBalances[i] = IERC20(p.remainingTokens[i]).balanceOf(p.safe);
            }
        }
        remainingNAV = oracle.calculateNAV(p.remainingTokens, remainingBalances);

        address[] memory redeemedTokens = new address[](1);
        redeemedTokens[0] = p.outAsset;
        uint256[] memory redeemedAmounts = new uint256[](1);
        redeemedAmounts[0] = outAmount;

        emit BasketWithdrawn(p.safe, msg.sender, p.outAsset, outAmount, redeemedTokens, redeemedAmounts, remainingNAV);
    }

    /// @notice Withdraws basket constituents in-kind from the Safe
    function withdrawInKind(
        address safe,
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address[] calldata remainingTokens
    ) external onlySafeOwner(safe) nonReentrant returns (uint256 remainingNAV) {
        require(tokens.length == amounts.length, "LENGTH_MISMATCH");
        require(tokens.length > 0, "EMPTY_TOKENS");
        require(recipient != address(0), "ZERO_RECIPIENT");
        _validateBasketTokens(remainingTokens);

        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i].code.length > 0, "INVALID_TOKEN");
            require(amounts[i] > 0, "ZERO_AMOUNT");
            for (uint256 k = 0; k < i; k++) {
                require(tokens[i] != tokens[k], "DUPLICATE_TOKEN");
            }
            bytes memory transferData = abi.encodeWithSelector(IERC20.transfer.selector, recipient, amounts[i]);
            _executeTokenCall(safe, tokens[i], transferData, "TRANSFER_FAILED");
        }

        uint256 redeemedNAV = oracle.calculateNAV(tokens, amounts);

        uint256[] memory remainingBalances = new uint256[](remainingTokens.length);
        for (uint256 i = 0; i < remainingTokens.length; i++) {
            remainingBalances[i] = IERC20(remainingTokens[i]).balanceOf(safe);
        }
        remainingNAV = oracle.calculateNAV(remainingTokens, remainingBalances);

        emit BasketWithdrawn(safe, msg.sender, address(0), redeemedNAV, tokens, amounts, remainingNAV);
    }

    /// @notice Executes an arbitrary transaction on the Safe on behalf of the Safe owner (e.g. for protocol integrations like Aave)
    function executeTransaction(address safe, address target, uint256 value, bytes calldata data)
        external
        onlySafeOwner(safe)
        nonReentrant
        returns (bool success)
    {
        _validateTarget(safe, target);
        success = ISafe(safe).execTransactionFromModule(target, value, data, 0);
        require(success, "MODULE_EXEC_FAILED");
    }

    event BasketLendingExecuted(
        address indexed safe, address indexed caller, address indexed target, address asset, uint256 amount
    );

    /// @notice Internal helper to execute lending operations with zeroed-out residual allowance
    function _executeLending(address safe, address target, bytes memory data, address asset, uint256 amount)
        internal
        returns (bool success)
    {
        _validateTarget(safe, target);
        require(oracle.registry().isApprovedLendingPool(target), "UNAPPROVED_LENDING_TARGET");

        if (asset != address(0) && amount > 0) {
            require(asset.code.length > 0, "INVALID_ASSET");
            _approveToken(safe, asset, target, amount);
        }

        success = ISafe(safe).execTransactionFromModule(target, 0, data, 0);
        require(success, "LENDING_EXEC_FAILED");

        if (asset != address(0) && amount > 0) {
            _approveToken(safe, asset, target, 0);
        }

        emit BasketLendingExecuted(safe, msg.sender, target, asset, amount);
    }

    /// @notice Executes a protocol-agnostic lending operation against a whitelisted lending pool target
    function executeLending(address safe, address target, bytes memory data, address asset, uint256 amount)
        public
        onlySafeOwner(safe)
        nonReentrant
        returns (bool success)
    {
        return _executeLending(safe, target, data, asset, amount);
    }

    /// @notice Supplies collateral asset from Safe into Aave v3 Pool
    function supplyToAave(address safe, address aavePool, address asset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        bytes memory supplyData =
            abi.encodeWithSignature("supply(address,uint256,address,uint16)", asset, amount, safe, uint16(0));
        _executeLending(safe, aavePool, supplyData, asset, amount);
    }

    /// @notice Borrows debt asset from Aave v3 Pool against Safe collateral
    function borrowFromAave(address safe, address aavePool, address debtAsset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        bytes memory borrowData = abi.encodeWithSignature(
            "borrow(address,uint256,uint256,uint16,address)", debtAsset, amount, uint256(2), uint16(0), safe
        );
        _executeLending(safe, aavePool, borrowData, address(0), 0);
    }

    /// @notice Borrows debt asset from Aave v3 Pool and sweeps it directly to a recipient (e.g. EOA wallet)
    function borrowAndSweep(address safe, address aavePool, address debtAsset, uint256 amount, address recipient)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        require(recipient != address(0), "ZERO_RECIPIENT");
        require(debtAsset.code.length > 0, "INVALID_DEBT_ASSET");
        require(amount > 0, "ZERO_AMOUNT");
        bytes memory borrowData = abi.encodeWithSignature(
            "borrow(address,uint256,uint256,uint16,address)", debtAsset, amount, uint256(2), uint16(0), safe
        );
        _executeLending(safe, aavePool, borrowData, address(0), 0);

        bytes memory transferData = abi.encodeWithSelector(IERC20.transfer.selector, recipient, amount);
        _executeTokenCall(safe, debtAsset, transferData, "SWEEP_TRANSFER_FAILED");
    }

    /// @notice Borrows debt asset from Aave v3 Pool and reinvests it into basket constituent assets via DEX swap
    function borrowAndReinvest(
        address safe,
        address aavePool,
        address debtAsset,
        uint256 amount,
        address target,
        bytes memory dexCalldata
    ) external onlySafeOwner(safe) nonReentrant {
        require(debtAsset.code.length > 0, "INVALID_DEBT_ASSET");
        require(amount > 0, "ZERO_AMOUNT");
        if (target != address(0) || dexCalldata.length > 0) {
            _validateTarget(safe, target);
        }

        bytes memory borrowData = abi.encodeWithSignature(
            "borrow(address,uint256,uint256,uint16,address)", debtAsset, amount, uint256(2), uint16(0), safe
        );
        _executeLending(safe, aavePool, borrowData, address(0), 0);

        if (target != address(0) && dexCalldata.length > 0) {
            bool success = ISafe(safe).execTransactionFromModule(target, 0, dexCalldata, 0);
            require(success, "REINVEST_DEX_SWAP_FAILED");
        }
    }

    /// @notice Repays borrowed debt asset to Aave v3 Pool
    function repayAave(address safe, address aavePool, address debtAsset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        bytes memory repayData =
            abi.encodeWithSignature("repay(address,uint256,uint256,address)", debtAsset, amount, uint256(2), safe);
        _executeLending(safe, aavePool, repayData, debtAsset, amount);
    }

    /// @notice Withdraws collateral asset from Aave v3 Pool back to Safe or specified recipient
    function withdrawFromAave(address safe, address aavePool, address asset, uint256 amount, address to)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        require(to != address(0), "ZERO_RECIPIENT");
        bytes memory withdrawData = abi.encodeWithSignature("withdraw(address,uint256,address)", asset, amount, to);
        _executeLending(safe, aavePool, withdrawData, address(0), 0);
    }

    receive() external payable {}
}
