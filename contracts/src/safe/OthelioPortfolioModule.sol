// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OthelioBaseModule, ISafe} from "./OthelioBaseModule.sol";
import {OthelioAaveV3Adapter} from "../lending/OthelioAaveV3Adapter.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../dex/OthelioAerodromeSlipstreamAdapter.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../dex/AerodromeRouteTypes.sol";
import {OthelioAssetRegistry} from "../registry/OthelioAssetRegistry.sol";

/// @notice The sole basket executor. Protocol adapters prepare typed calls but never receive account authority.
contract OthelioPortfolioModule is OthelioBaseModule {
    using SafeERC20 for IERC20;

    OthelioAaveV3Adapter public immutable aaveAdapter;
    bool public immutable newAaveSupplyEnabled;
    uint256 public immutable minimumAaveHealthFactor;
    OthelioAerodromeSlipstreamAdapter public immutable aerodromeAdapter;

    uint256 public constant MAX_SWAP_VALUE_LOSS_BPS = 300; // 3% maximum allowed slippage/value-loss vs oracle

    event BasketAaveAction(address indexed safe, address indexed caller, address indexed asset, uint256 amount, bytes4 action);

    error InvalidAaveTarget();
    error AaveExecFailed();
    error InvalidRepayReturn();
    error InvalidRepayAmount();
    error InvalidWithdrawReturn();
    error HealthFactorBelowFloor();
    error QuoteExpired();
    error InvalidAerodromeTarget();
    error AerodromeSwapFailed();
    error SlippageExceeded();
    error ValueLossExceeded();

    constructor(
        address oracle_,
        address aaveAdapter_,
        address aerodromeAdapter_,
        bool newAaveSupplyEnabled_,
        uint256 minimumAaveHealthFactor_
    ) OthelioBaseModule(oracle_) {
        require(aaveAdapter_ != address(0) && aaveAdapter_.code.length > 0, "INVALID_AAVE_ADAPTER");
        require(minimumAaveHealthFactor_ >= 1e18, "HEALTH_FACTOR_FLOOR_TOO_LOW");
        aaveAdapter = OthelioAaveV3Adapter(aaveAdapter_);
        require(aerodromeAdapter_ != address(0) && aerodromeAdapter_.code.length > 0, "INVALID_AERODROME_ADAPTER");
        aerodromeAdapter = OthelioAerodromeSlipstreamAdapter(aerodromeAdapter_);
        newAaveSupplyEnabled = newAaveSupplyEnabled_;
        minimumAaveHealthFactor = minimumAaveHealthFactor_;
    }

    function enforcesPortfolioOnly() external pure override returns (bool) {
        return true;
    }

    /// @notice Returns true if the router and allowance spender are approved for module execution.
    function approvedDexRoutes(address target, address allowanceSpender) external view returns (bool) {
        address router = aerodromeAdapter.router();
        return target == router && allowanceSpender == router;
    }

    function _validateAaveAsset(address asset) private view {
        require(asset.code.length > 0, "INVALID_TOKEN");
        require(oracle.registry().isSupported(block.chainid, asset), "UNSUPPORTED_ASSET");
    }

    function _tokenCall(address safe, address token, bytes memory data, string memory errorMessage) private {
        (bool success, bytes memory returned) = ISafe(safe).execTransactionFromModuleReturnData(token, 0, data, 0);
        require(success && (returned.length == 0 || (returned.length == 32 && abi.decode(returned, (bool)))), errorMessage);
    }

    function _approveAave(address safe, address asset, uint256 amount) private {
        address pool = aaveAdapter.pool();
        _tokenCall(safe, asset, abi.encodeWithSelector(IERC20.approve.selector, pool, 0), "AAVE_APPROVE_FAILED");
        if (amount > 0) _tokenCall(safe, asset, abi.encodeWithSelector(IERC20.approve.selector, pool, amount), "AAVE_APPROVE_FAILED");
    }

    function _callAave(address safe, address target, bytes memory data) private returns (bytes memory returned) {
        if (target != aaveAdapter.pool()) revert InvalidAaveTarget();
        (bool success, bytes memory result) = ISafe(safe).execTransactionFromModuleReturnData(target, 0, data, 0);
        if (!success) revert AaveExecFailed();
        return result;
    }

    function supplyAave(address safe, address asset, uint256 amount) external nonReentrant onlySafeOwner(safe) {
        require(newAaveSupplyEnabled, "NEW_AAVE_SUPPLY_DISABLED");
        _validateAaveAsset(asset);
        _approveAave(safe, asset, amount);
        (address target, bytes memory data) = aaveAdapter.supplyCall(asset, amount, safe);
        _callAave(safe, target, data);
        _approveAave(safe, asset, 0);
        emit BasketAaveAction(safe, msg.sender, asset, amount, this.supplyAave.selector);
    }

    function repayAave(address safe, address asset, uint256 amount) external nonReentrant onlySafeOwner(safe) returns (uint256 repaid) {
        _validateAaveAsset(asset);
        _approveAave(safe, asset, amount);
        (address target, bytes memory data) = aaveAdapter.repayCall(asset, amount, safe);
        bytes memory returned = _callAave(safe, target, data);
        if (returned.length != 32) revert InvalidRepayReturn();
        repaid = abi.decode(returned, (uint256));
        if (repaid > amount) revert InvalidRepayAmount();
        _approveAave(safe, asset, 0);
        emit BasketAaveAction(safe, msg.sender, asset, repaid, this.repayAave.selector);
    }

    function repayAaveFromWallet(address safe, address asset, uint256 amount)
        external nonReentrant onlySafeOwner(safe) returns (uint256 repaid)
    {
        _validateAaveAsset(asset);
        require(amount > 0, "INVALID_AMOUNT");
        IERC20(asset).safeTransferFrom(msg.sender, safe, amount);
        _approveAave(safe, asset, amount);
        (address target, bytes memory data) = aaveAdapter.repayCall(asset, amount, safe);
        bytes memory returned = _callAave(safe, target, data);
        if (returned.length != 32) revert InvalidRepayReturn();
        repaid = abi.decode(returned, (uint256));
        if (repaid > amount) revert InvalidRepayAmount();
        _approveAave(safe, asset, 0);
        if (amount > repaid) {
            _tokenCall(safe, asset, abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amount - repaid), "REPAY_REFUND_FAILED");
        }
        emit BasketAaveAction(safe, msg.sender, asset, repaid, this.repayAaveFromWallet.selector);
    }

    function withdrawAaveCollateral(address safe, address asset, uint256 amount, uint256 minHealthFactor)
        external nonReentrant onlySafeOwner(safe) returns (uint256 withdrawn)
    {
        _validateAaveAsset(asset);
        require(minHealthFactor >= minimumAaveHealthFactor, "HEALTH_FACTOR_FLOOR_TOO_LOW");
        (address target, bytes memory data) = aaveAdapter.withdrawCall(asset, amount, safe);
        bytes memory returned = _callAave(safe, target, data);
        if (returned.length != 32) revert InvalidWithdrawReturn();
        withdrawn = abi.decode(returned, (uint256));
        if (aaveAdapter.healthFactor(safe) < minHealthFactor) revert HealthFactorBelowFloor();
        emit BasketAaveAction(safe, msg.sender, asset, withdrawn, this.withdrawAaveCollateral.selector);
    }

    function _verifyOracleValueLoss(address tokenIn, uint256 amountIn, address tokenOut, uint256 minimumAmountOut) private view {
        address[] memory singleIn = new address[](1);
        singleIn[0] = tokenIn;
        uint256[] memory amountsIn = new uint256[](1);
        amountsIn[0] = amountIn;

        address[] memory singleOut = new address[](1);
        singleOut[0] = tokenOut;
        uint256[] memory amountsOut = new uint256[](1);
        amountsOut[0] = minimumAmountOut;

        uint256 inputNAV = oracle.calculateNAV(singleIn, amountsIn);
        uint256 minOutputNAV = oracle.calculateNAV(singleOut, amountsOut);

        require(minOutputNAV >= (inputNAV * (10000 - MAX_SWAP_VALUE_LOSS_BPS)) / 10000, "VALUE_LOSS_EXCEEDED");
    }

    function _executeRoute(
        address safe,
        AerodromeRoute calldata route,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        _validateAaveAsset(route.tokenIn);
        _validateAaveAsset(route.tokenOut);

        _verifyOracleValueLoss(route.tokenIn, route.amountIn, route.tokenOut, route.minimumAmountOut);

        address router = aerodromeAdapter.router();
        _tokenCall(safe, route.tokenIn, abi.encodeWithSelector(IERC20.approve.selector, router, 0), "DEX_APPROVE_FAILED");
        _tokenCall(safe, route.tokenIn, abi.encodeWithSelector(IERC20.approve.selector, router, route.amountIn), "DEX_APPROVE_FAILED");

        (address target, bytes memory data) = aerodromeAdapter.exactInputCall(route, safe, deadline);
        if (target != router) revert InvalidAerodromeTarget();

        (bool success, bytes memory returned) = ISafe(safe).execTransactionFromModuleReturnData(target, 0, data, 0);
        if (!success || returned.length != 32) revert AerodromeSwapFailed();

        amountOut = abi.decode(returned, (uint256));
        if (amountOut < route.minimumAmountOut) revert SlippageExceeded();

        _tokenCall(safe, route.tokenIn, abi.encodeWithSelector(IERC20.approve.selector, router, 0), "DEX_APPROVE_FAILED");

        emit AerodromeRouteExecuted(
            safe,
            route.tokenIn,
            route.tokenOut,
            uint8(route.kind),
            route.amountIn,
            amountOut,
            route.firstTickSpacing,
            route.secondTickSpacing
        );
    }

    function fundAerodromePortfolio(
        address safe,
        address fundingToken,
        uint256 totalFundingAmount,
        AerodromeRoute[] calldata routes,
        uint256 deadline
    ) external nonReentrant onlySafeOwner(safe) {
        if (block.timestamp > deadline) revert QuoteExpired();
        require(deadline <= block.timestamp + 5 minutes, "DEADLINE_TOO_FAR");
        require(routes.length > 0 && routes.length <= 16, "INVALID_ROUTE_COUNT");
        require(totalFundingAmount > 0, "ZERO_FUNDING_AMOUNT");
        require(fundingToken == aerodromeAdapter.usdc(), "MUST_FUND_WITH_USDC");

        IERC20(fundingToken).safeTransferFrom(msg.sender, safe, totalFundingAmount);

        address[] memory acquiredAssets = new address[](routes.length);
        uint256[] memory acquiredAmounts = new uint256[](routes.length);

        uint256 sumInput = 0;
        for (uint256 i = 0; i < routes.length; i++) {
            require(routes[i].tokenIn == fundingToken, "FUNDING_TOKEN_MISMATCH");
            sumInput += routes[i].amountIn;
            acquiredAssets[i] = routes[i].tokenOut;
            acquiredAmounts[i] = _executeRoute(safe, routes[i], deadline);
        }

        require(sumInput == totalFundingAmount, "FUNDING_AMOUNT_MISMATCH");

        uint256 totalNAVAfter = oracle.calculateNAV(acquiredAssets, acquiredAmounts);
        emit BasketFunded(
            safe,
            msg.sender,
            fundingToken,
            totalFundingAmount,
            acquiredAssets,
            acquiredAmounts,
            totalNAVAfter
        );
    }

    function rebalanceAerodromePortfolio(
        address safe,
        AerodromeRoute[] calldata routes,
        uint256 deadline
    ) external nonReentrant onlySafeOwner(safe) {
        if (block.timestamp > deadline) revert QuoteExpired();
        require(deadline <= block.timestamp + 5 minutes, "DEADLINE_TOO_FAR");
        require(routes.length > 0 && routes.length <= 16, "INVALID_ROUTE_COUNT");

        address[] memory soldAssets = new address[](routes.length);
        uint256[] memory soldAmounts = new uint256[](routes.length);
        address[] memory boughtAssets = new address[](routes.length);
        uint256[] memory boughtAmounts = new uint256[](routes.length);

        for (uint256 i = 0; i < routes.length; i++) {
            soldAssets[i] = routes[i].tokenIn;
            soldAmounts[i] = routes[i].amountIn;
            boughtAssets[i] = routes[i].tokenOut;
            boughtAmounts[i] = _executeRoute(safe, routes[i], deadline);
        }

        uint256 totalNAV = oracle.calculateNAV(boughtAssets, boughtAmounts);
        emit BasketRebalanced(
            safe,
            msg.sender,
            soldAssets,
            soldAmounts,
            boughtAssets,
            boughtAmounts,
            totalNAV
        );
    }
}
