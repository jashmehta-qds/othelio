// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUpsideSeries} from "./interfaces/IUpsideSeries.sol";
import {IUpsideClaimToken} from "./interfaces/IUpsideClaimToken.sol";
import {IOthelioAssetRegistry} from "./interfaces/IOthelioAssetRegistry.sol";

contract UpsideSeries is IUpsideSeries, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable override factory;
    address public immutable override assetRegistry;
    IERC20 public immutable override underlying;
    address public immutable override settlementAdapter;
    uint256 public immutable override strikePrice;
    uint256 public immutable override expiry;

    address public immutable override referenceFeed;
    uint80 public immutable override referenceRoundId;
    uint256 public immutable override referencePrice;
    uint256 public immutable override referenceBlock;
    uint256 public immutable override roundId;
    uint256 public constant override formulaVersion = 2;

    IUpsideClaimToken public override upsideToken;
    IUpsideClaimToken public override residualToken;

    bool public override isSettled;
    uint256 public override settledPrice;
    uint80 public override settledRoundId;
    uint256 public override settledTimestamp;

    uint256 public override collateralSnapshot;
    uint256 public override totalClaimSupplySnapshot;
    uint256 public override upsideAllocation;
    uint256 public override residualAllocation;

    uint256 public override totalUpsideRedeemed;
    uint256 public override totalResidualRedeemed;

    constructor(
        address factory_,
        address assetRegistry_,
        address underlying_,
        address settlementAdapter_,
        uint256 strikePrice_,
        uint256 expiry_,
        address referenceFeed_,
        uint80 referenceRoundId_,
        uint256 referencePrice_,
        uint256 roundId_
    ) {
        if (
            factory_ == address(0) || assetRegistry_ == address(0) || underlying_ == address(0)
                || settlementAdapter_ == address(0)
        ) revert ZeroAddress();
        if (strikePrice_ == 0 || expiry_ <= block.timestamp) revert InvalidParameters();

        uint8 dec = IERC20Metadata(underlying_).decimals();
        if (dec > 18) revert UnsupportedDecimals(dec);

        if (!IOthelioAssetRegistry(assetRegistry_).isSupported(block.chainid, underlying_)) {
            revert AssetNotSupported();
        }

        factory = factory_;
        assetRegistry = assetRegistry_;
        underlying = IERC20(underlying_);
        settlementAdapter = settlementAdapter_;
        strikePrice = strikePrice_;
        expiry = expiry_;

        referenceFeed = referenceFeed_;
        referenceRoundId = referenceRoundId_;
        referencePrice = referencePrice_;
        referenceBlock = block.number;
        roundId = roundId_;
    }

    function initializeTokens(address upsideToken_, address residualToken_) external override {
        if (msg.sender != factory) revert Unauthorized();
        if (address(upsideToken) != address(0) || address(residualToken) != address(0)) {
            revert AlreadyInitialized();
        }
        if (upsideToken_ == address(0) || residualToken_ == address(0)) revert ZeroAddress();
        if (upsideToken_ == residualToken_) revert InvalidParameters();
        if (IUpsideClaimToken(upsideToken_).seriesVault() != address(this)) revert InvalidParameters();
        if (IUpsideClaimToken(residualToken_).seriesVault() != address(this)) revert InvalidParameters();

        upsideToken = IUpsideClaimToken(upsideToken_);
        residualToken = IUpsideClaimToken(residualToken_);

        emit TokensInitialized(upsideToken_, residualToken_);
    }

    function mint(uint256 amount) external override nonReentrant returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= expiry) revert SeriesExpired();
        if (isSettled) revert AlreadySettled();

        if (!IOthelioAssetRegistry(assetRegistry).isSupported(block.chainid, address(underlying))) {
            revert AssetNotSupported();
        }

        uint256 balanceBefore = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = underlying.balanceOf(address(this));

        if (balanceAfter - balanceBefore != amount) revert FeeOnTransferNotSupported();

        upsideToken.mint(msg.sender, amount);
        residualToken.mint(msg.sender, amount);

        emit Minted(msg.sender, amount);
        return amount;
    }

    function combineAndWithdraw(uint256 amount) public override nonReentrant returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        if (isSettled) revert AlreadySettled();

        upsideToken.burn(msg.sender, amount);
        residualToken.burn(msg.sender, amount);

        underlying.safeTransfer(msg.sender, amount);

        emit PairWithdrawn(msg.sender, amount);
        return amount;
    }

    function combineAndRedeem(uint256 amount) external override returns (uint256) {
        return combineAndWithdraw(amount);
    }

    function settleWithFixing(uint256 settlementPrice_, uint80 roundId_, uint256 observedTimestamp_)
        external
        override
        nonReentrant
    {
        if (msg.sender != settlementAdapter) revert Unauthorized();
        if (block.timestamp < expiry) revert ExpiryNotReached();
        if (isSettled) revert AlreadySettled();

        isSettled = true;
        settledPrice = settlementPrice_;
        settledRoundId = roundId_;
        settledTimestamp = observedTimestamp_;

        uint256 collateral = underlying.balanceOf(address(this));
        uint256 supply = upsideToken.totalSupply();

        collateralSnapshot = collateral;
        totalClaimSupplySnapshot = supply;

        if (supply == 0 || collateral == 0) {
            upsideAllocation = 0;
            residualAllocation = 0;
        } else if (settlementPrice_ == 0) {
            upsideAllocation = 0;
            residualAllocation = collateral;
        } else {
            uint256 upsideVal = settlementPrice_ > strikePrice ? settlementPrice_ - strikePrice : 0;
            uint256 uAlloc = Math.mulDiv(collateral, upsideVal, settlementPrice_);
            upsideAllocation = uAlloc;
            residualAllocation = collateral - uAlloc;
        }

        emit SettledWithFixing(
            settlementPrice_, roundId_, observedTimestamp_, upsideAllocation, residualAllocation
        );
        emit Settled(settlementPrice_, upsideAllocation, residualAllocation);
    }

    function redeemUpside(uint256 amount) external override nonReentrant returns (uint256) {
        if (!isSettled) revert NotSettled();
        if (amount == 0) revert ZeroAmount();

        uint256 oldRedeemed = totalUpsideRedeemed;
        uint256 newRedeemed = oldRedeemed + amount;
        if (newRedeemed > totalClaimSupplySnapshot) revert ExceedsSupply();

        totalUpsideRedeemed = newRedeemed;
        upsideToken.burn(msg.sender, amount);

        uint256 prevCumulative = Math.mulDiv(upsideAllocation, oldRedeemed, totalClaimSupplySnapshot);
        uint256 newCumulative = Math.mulDiv(upsideAllocation, newRedeemed, totalClaimSupplySnapshot);
        uint256 underlyingOut = newCumulative - prevCumulative;

        if (underlyingOut > 0) {
            underlying.safeTransfer(msg.sender, underlyingOut);
        }

        emit UpsideRedeemed(msg.sender, amount, underlyingOut);
        return underlyingOut;
    }

    function redeemResidual(uint256 amount) external override nonReentrant returns (uint256) {
        if (!isSettled) revert NotSettled();
        if (amount == 0) revert ZeroAmount();

        uint256 oldRedeemed = totalResidualRedeemed;
        uint256 newRedeemed = oldRedeemed + amount;
        if (newRedeemed > totalClaimSupplySnapshot) revert ExceedsSupply();

        totalResidualRedeemed = newRedeemed;
        residualToken.burn(msg.sender, amount);

        uint256 prevCumulative = Math.mulDiv(residualAllocation, oldRedeemed, totalClaimSupplySnapshot);
        uint256 newCumulative = Math.mulDiv(residualAllocation, newRedeemed, totalClaimSupplySnapshot);
        uint256 underlyingOut = newCumulative - prevCumulative;

        if (underlyingOut > 0) {
            underlying.safeTransfer(msg.sender, underlyingOut);
        }

        emit ResidualRedeemed(msg.sender, amount, underlyingOut);
        return underlyingOut;
    }
}
