// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";
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

interface IAaveV3RecoveryPool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

/// @title OthelioBorrowModule
/// @notice Dedicated Safe Module for Money Market Protocol Credit Lines, Leverage, & Collateralization (Aave V3, Compound V3, Moonwell, Morpho Blue)
contract OthelioBorrowModule is IOthelioEvents, ReentrancyGuard {
    using SafeERC20 for IERC20;

    BasketOracle public immutable oracle;

    modifier onlySafeOwner(address safe) {
        require(safe.code.length > 0, "INVALID_SAFE");
        require(ISafe(safe).isOwner(msg.sender), "NOT_SAFE_OWNER");
        _;
    }

    constructor(address oracle_) {
        require(oracle_ != address(0), "ZERO_ORACLE");
        oracle = BasketOracle(oracle_);
    }

    function _validateTarget(address safe, address target) private view {
        require(target != address(0), "ZERO_TARGET");
        require(target.code.length > 0, "TARGET_NOT_CONTRACT");
        require(target != safe, "CANNOT_TARGET_SAFE");
        require(target != address(this), "CANNOT_TARGET_MODULE");
        require(target != address(oracle), "CANNOT_TARGET_ORACLE");
    }

    function _executeTokenCall(address safe, address token, bytes memory data, string memory errorMessage) private {
        (bool success, bytes memory returnData) = ISafe(safe).execTransactionFromModuleReturnData(token, 0, data, 0);
        require(success, errorMessage);
        require(returnData.length == 0 || (returnData.length == 32 && abi.decode(returnData, (bool))), errorMessage);
    }

    function _approveToken(address safe, address token, address spender, uint256 amount) private {
        require(spender != address(0), "ZERO_SPENDER");
        require(spender != safe, "CANNOT_SPEND_TO_SAFE");
        require(spender != address(this), "CANNOT_SPEND_TO_MODULE");
        _executeTokenCall(safe, token, abi.encodeWithSelector(IERC20.approve.selector, spender, 0), "LENDING_APPROVE_FAILED");
        if (amount > 0) {
            _executeTokenCall(safe, token, abi.encodeWithSelector(IERC20.approve.selector, spender, amount), "LENDING_APPROVE_FAILED");
        }
    }

    function _transferFromWallet(address token, address from, address to, uint256 amount) private {
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    function _transferFromSafe(address safe, address token, address to, uint256 amount, string memory errorMessage)
        private
    {
        bytes memory transferData = abi.encodeWithSelector(IERC20.transfer.selector, to, amount);
        _executeTokenCall(safe, token, transferData, errorMessage);
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

    /// @notice Supplies collateral asset from Safe into money market lending pool (Aave V3 / Compound V3 / Moonwell)
    function supplyCollateral(address safe, address pool, address asset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        bytes memory supplyData =
            abi.encodeWithSignature("supply(address,uint256,address,uint16)", asset, amount, safe, uint16(0));
        _executeLending(safe, pool, supplyData, asset, amount);
    }

    /// @notice Borrows debt asset into the Basket Safe reserve
    function borrowToSafe(address safe, address pool, address debtAsset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        require(debtAsset.code.length > 0, "INVALID_DEBT_ASSET");
        require(amount > 0, "ZERO_AMOUNT");
        bytes memory borrowData = abi.encodeWithSignature(
            "borrow(address,uint256,uint256,uint16,address)", debtAsset, amount, uint256(2), uint16(0), safe
        );
        _executeLending(safe, pool, borrowData, address(0), 0);
    }

    /// @notice Borrows debt asset and sweeps it directly to recipient (e.g. EOA wallet)
    function borrowToWallet(address safe, address pool, address debtAsset, uint256 amount, address recipient)
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
        _executeLending(safe, pool, borrowData, address(0), 0);

        bytes memory transferData = abi.encodeWithSelector(IERC20.transfer.selector, recipient, amount);
        _executeTokenCall(safe, debtAsset, transferData, "SWEEP_TRANSFER_FAILED");
    }

    /// @notice Borrows debt asset and reinvests it into basket constituent assets via DEX swap
    function borrowAndReinvest(
        address safe,
        address pool,
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
        _executeLending(safe, pool, borrowData, address(0), 0);

        if (target != address(0) && dexCalldata.length > 0) {
            bool success = ISafe(safe).execTransactionFromModule(target, 0, dexCalldata, 0);
            require(success, "REINVEST_DEX_SWAP_FAILED");
        }
    }

    /// @notice Repays borrowed debt asset to money market lending pool
    function repayDebt(address safe, address pool, address debtAsset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
    {
        bytes memory repayData =
            abi.encodeWithSignature("repay(address,uint256,uint256,address)", debtAsset, amount, uint256(2), safe);
        _executeLending(safe, pool, repayData, debtAsset, amount);
    }

    /// @notice Funds a repayment from the caller's wallet while leaving no residual pool approval or excess in the Safe.
    /// @dev The wallet approves this module for `amount`; any amount Aave does not consume is returned to the caller.
    function repayDebtFromWallet(address safe, address pool, address debtAsset, uint256 amount)
        external
        onlySafeOwner(safe)
        nonReentrant
        returns (uint256 repaid)
    {
        require(amount > 0, "ZERO_AMOUNT");
        require(pool != address(0), "ZERO_TARGET");
        require(debtAsset.code.length > 0, "INVALID_DEBT_ASSET");
        _validateTarget(safe, pool);
        require(oracle.registry().isApprovedLendingPool(pool), "UNAPPROVED_LENDING_TARGET");

        _transferFromWallet(debtAsset, msg.sender, safe, amount);
        _approveToken(safe, debtAsset, pool, amount);

        bytes memory repayData =
            abi.encodeWithSignature("repay(address,uint256,uint256,address)", debtAsset, amount, uint256(2), safe);
        (bool success, bytes memory returnData) = ISafe(safe).execTransactionFromModuleReturnData(pool, 0, repayData, 0);
        require(success, "LENDING_EXEC_FAILED");
        require(returnData.length == 32, "INVALID_REPAY_RETURN");
        repaid = abi.decode(returnData, (uint256));
        require(repaid <= amount, "INVALID_REPAY_AMOUNT");

        _approveToken(safe, debtAsset, pool, 0);
        if (amount > repaid) {
            _transferFromSafe(safe, debtAsset, msg.sender, amount - repaid, "REPAY_REFUND_FAILED");
        }

        emit BasketLendingExecuted(safe, msg.sender, pool, debtAsset, repaid);
    }

    /// @notice Releases Aave collateral to the Safe after Aave's own validation and a caller-selected health-factor floor.
    function withdrawCollateral(address safe, address pool, address asset, uint256 amount, uint256 minHealthFactor)
        external
        onlySafeOwner(safe)
        nonReentrant
        returns (uint256 withdrawn)
    {
        require(pool != address(0), "ZERO_TARGET");
        _validateTarget(safe, pool);
        require(oracle.registry().isApprovedLendingPool(pool), "UNAPPROVED_LENDING_TARGET");
        require(asset.code.length > 0, "INVALID_ASSET");
        require(amount > 0, "ZERO_AMOUNT");
        require(minHealthFactor >= 1e18, "HEALTH_FACTOR_FLOOR_TOO_LOW");

        bytes memory withdrawData = abi.encodeWithSignature("withdraw(address,uint256,address)", asset, amount, safe);
        (bool success, bytes memory returnData) =
            ISafe(safe).execTransactionFromModuleReturnData(pool, 0, withdrawData, 0);
        require(success, "LENDING_EXEC_FAILED");
        require(returnData.length == 32, "INVALID_WITHDRAW_RETURN");
        withdrawn = abi.decode(returnData, (uint256));

        (,,,,, uint256 healthFactor) = IAaveV3RecoveryPool(pool).getUserAccountData(safe);
        require(healthFactor >= minHealthFactor, "HEALTH_FACTOR_BELOW_FLOOR");

        emit BasketLendingExecuted(safe, msg.sender, pool, asset, withdrawn);
    }
}
