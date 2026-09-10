// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract MockAToken is ERC20 {
    address public immutable POOL;
    uint8 private immutable _tokenDecimals;

    constructor(address pool, uint8 tokenDecimals) ERC20("Strict Mock Aave Receipt", "smAToken") {
        POOL = pool;
        _tokenDecimals = tokenDecimals;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address account, uint256 amount) external {
        require(msg.sender == POOL, "ONLY_POOL");
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        require(msg.sender == POOL, "ONLY_POOL");
        _burn(account, amount);
    }
}

contract MockAavePool {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_UNIT = 1e8;
    uint256 public constant HEALTH_FACTOR_UNIT = 1e18;
    uint256 public constant LTV_BPS = 7500;
    uint256 public constant LIQUIDATION_THRESHOLD_BPS = 8000;

    struct ReserveData {
        uint256 configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate; // Supply APY (1e25 = 1%)
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate; // Borrow APY (1e25 = 1%)
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }

    mapping(address => ReserveData) public reserves;
    mapping(address => mapping(address => uint256)) public userSupplied;
    mapping(address => mapping(address => uint256)) public userBorrowed;
    mapping(address => uint256) public assetPriceBase;
    mapping(address => uint8) public assetDecimals;
    mapping(address => bool) public reserveConfigured;
    address[] private reserveAssets;

    constructor() {}

    /// @notice Configures only the valuation and receipt behavior needed by local tests.
    /// @dev This mock does not model interest accrual, liquidation execution, caps, or Aave modes.
    function configureReserve(address asset, uint8 decimals_, uint256 priceBase) external returns (address aToken) {
        require(asset != address(0), "ZERO_ASSET");
        require(decimals_ <= 18, "UNSUPPORTED_DECIMALS");
        require(priceBase > 0, "ZERO_PRICE");

        if (!reserveConfigured[asset]) {
            reserveConfigured[asset] = true;
            reserveAssets.push(asset);
            MockAToken receipt = new MockAToken(address(this), decimals_);
            aToken = address(receipt);
            reserves[asset].aTokenAddress = aToken;
        } else {
            aToken = reserves[asset].aTokenAddress;
        }

        assetDecimals[asset] = decimals_;
        assetPriceBase[asset] = priceBase;
    }

    function setReserveRates(address asset, uint128 supplyRate, uint128 borrowRate) external {
        reserves[asset].currentLiquidityRate = supplyRate;
        reserves[asset].currentVariableBorrowRate = borrowRate;
    }

    function getReserveData(address asset) external view returns (ReserveData memory) {
        ReserveData memory data = reserves[asset];
        if (data.currentLiquidityRate == 0) {
            // Default active rate for local fork testing (5.25% supply APY, 4.10% borrow APY)
            data.currentLiquidityRate = 52500000000000000000000000;
            data.currentVariableBorrowRate = 41000000000000000000000000;
        }
        return data;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        _requireConfigured(asset);
        require(amount > 0, "ZERO_AMOUNT");
        require(onBehalfOf != address(0), "ZERO_BENEFICIARY");

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        require(IERC20(asset).balanceOf(address(this)) - balanceBefore == amount, "INCOMPLETE_TRANSFER");
        userSupplied[asset][onBehalfOf] += amount;
        MockAToken(reserves[asset].aTokenAddress).mint(onBehalfOf, amount);
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16, address onBehalfOf) external {
        _requireConfigured(asset);
        require(amount > 0, "ZERO_AMOUNT");
        require(interestRateMode == 2, "VARIABLE_RATE_ONLY");
        require(onBehalfOf != address(0), "ZERO_BENEFICIARY");

        (uint256 collateralBase, uint256 debtBase,,,,) = _accountData(onBehalfOf);
        uint256 addedDebtBase = _valueInBase(asset, amount);
        require(debtBase + addedDebtBase <= Math.mulDiv(collateralBase, LTV_BPS, 10_000), "INSUFFICIENT_COLLATERAL");

        userBorrowed[asset][onBehalfOf] += amount;
        IERC20(asset).safeTransfer(onBehalfOf, amount);
    }

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256)
    {
        _requireConfigured(asset);
        require(interestRateMode == 2, "VARIABLE_RATE_ONLY");

        uint256 debt = userBorrowed[asset][onBehalfOf];
        uint256 repaid = amount == type(uint256).max || amount > debt ? debt : amount;
        if (repaid == 0) return 0;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), repaid);
        userBorrowed[asset][onBehalfOf] = debt - repaid;
        return repaid;
    }

    /// @notice Adds variable debt for recovery-path tests that need an accrued balance.
    /// @dev This is deliberately test-only behavior; production Aave debt accrues through its reserve indexes.
    function accrueDebt(address asset, address user, uint256 amount) external {
        _requireConfigured(asset);
        userBorrowed[asset][user] += amount;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        _requireConfigured(asset);
        require(to != address(0), "ZERO_RECIPIENT");

        uint256 toWithdraw = amount;
        if (amount == type(uint256).max || amount > userSupplied[asset][msg.sender]) {
            toWithdraw = userSupplied[asset][msg.sender];
        }
        require(toWithdraw > 0, "ZERO_AMOUNT");

        userSupplied[asset][msg.sender] -= toWithdraw;
        (uint256 collateralBase, uint256 debtBase,,,,) = _accountData(msg.sender);
        require(
            debtBase == 0 || Math.mulDiv(collateralBase, LIQUIDATION_THRESHOLD_BPS, 10_000) >= debtBase,
            "HEALTH_FACTOR_TOO_LOW"
        );

        MockAToken(reserves[asset].aTokenAddress).burn(msg.sender, toWithdraw);
        IERC20(asset).safeTransfer(to, toWithdraw);
        return toWithdraw;
    }

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
        )
    {
        return _accountData(user);
    }

    function _accountData(address user)
        internal
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        for (uint256 i = 0; i < reserveAssets.length; i++) {
            address asset = reserveAssets[i];
            totalCollateralBase += _valueInBase(asset, userSupplied[asset][user]);
            totalDebtBase += _valueInBase(asset, userBorrowed[asset][user]);
        }

        uint256 borrowLimitBase = Math.mulDiv(totalCollateralBase, LTV_BPS, 10_000);
        availableBorrowsBase = borrowLimitBase > totalDebtBase ? borrowLimitBase - totalDebtBase : 0;
        currentLiquidationThreshold = LIQUIDATION_THRESHOLD_BPS;
        ltv = LTV_BPS;
        healthFactor = totalDebtBase == 0
            ? type(uint256).max
            : Math.mulDiv(
                Math.mulDiv(totalCollateralBase, LIQUIDATION_THRESHOLD_BPS, 10_000), HEALTH_FACTOR_UNIT, totalDebtBase
            );
    }

    function _valueInBase(address asset, uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, assetPriceBase[asset], 10 ** assetDecimals[asset]);
    }

    function _requireConfigured(address asset) internal view {
        require(reserveConfigured[asset], "RESERVE_NOT_CONFIGURED");
    }
}
