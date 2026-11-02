// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRiskSplitSeries} from "./interfaces/IRiskSplitSeries.sol";
import {IClaimToken} from "./interfaces/IClaimToken.sol";

contract RiskSplitSeries is IRiskSplitSeries, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WAD = 1e18;

    IERC20 public immutable override underlying;
    IClaimToken public override protectedToken;
    IClaimToken public override upsideToken;
    address public immutable override settlementAdapter;

    uint256 public immutable override floorPrice;
    uint256 public immutable override capPrice;
    uint256 public immutable override expiry;

    bool public override isSettled;
    uint256 public override settledPrice;
    uint256 public override protectedFraction;
    uint256 public override upsideFraction;

    bool private _claimTokensInitialized;

    constructor(
        address underlying_,
        address settlementAdapter_,
        uint256 floorPrice_,
        uint256 capPrice_,
        uint256 expiry_
    ) {
        if (underlying_ == address(0) || settlementAdapter_ == address(0)) revert ZeroAddress();
        if (floorPrice_ > capPrice_ || capPrice_ == 0) revert InvalidParameters();
        if (expiry_ <= block.timestamp) revert InvalidParameters();

        underlying = IERC20(underlying_);
        settlementAdapter = settlementAdapter_;
        floorPrice = floorPrice_;
        capPrice = capPrice_;
        expiry = expiry_;
    }

    function initializeTokens(address protectedToken_, address upsideToken_) external {
        if (_claimTokensInitialized) revert AlreadySettled();
        if (protectedToken_ == address(0) || upsideToken_ == address(0)) revert ZeroAddress();

        protectedToken = IClaimToken(protectedToken_);
        upsideToken = IClaimToken(upsideToken_);
        _claimTokensInitialized = true;
    }

    function mint(uint256 amount) external override nonReentrant returns (uint256) {
        if (!_claimTokensInitialized) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp >= expiry) revert SeriesExpired();
        if (isSettled) revert AlreadySettled();

        uint256 balanceBefore = underlying.balanceOf(address(this));
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = underlying.balanceOf(address(this));
        if (balanceAfter - balanceBefore != amount) revert FeeOnTransferNotSupported();

        protectedToken.mint(msg.sender, amount);
        upsideToken.mint(msg.sender, amount);

        emit Minted(msg.sender, amount);
        return amount;
    }

    function combineAndRedeem(uint256 amount) external override nonReentrant returns (uint256) {
        if (!_claimTokensInitialized) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();

        // Burn equal quantities of both claim tokens
        protectedToken.burn(msg.sender, amount);
        upsideToken.burn(msg.sender, amount);

        // Return exact underlying amount
        underlying.safeTransfer(msg.sender, amount);

        emit PairRedeemed(msg.sender, amount);
        return amount;
    }

    function settle(uint256 settlementPrice_) external override nonReentrant {
        if (msg.sender != settlementAdapter) revert Unauthorized();
        if (block.timestamp < expiry) revert ExpiryNotReached();
        if (isSettled) revert AlreadySettled();

        isSettled = true;
        settledPrice = settlementPrice_;

        uint256 F = floorPrice;
        uint256 C = capPrice;
        uint256 S = settlementPrice_;

        if (S == 0) {
            protectedFraction = 0;
            upsideFraction = 0;
        } else if (S < F) {
            protectedFraction = WAD;
            upsideFraction = 0;
        } else if (S < 2 * F) {
            uint256 pFrac = (F * WAD) / S;
            if (pFrac > WAD) pFrac = WAD;
            protectedFraction = pFrac;
            upsideFraction = WAD - pFrac;
        } else if (S < 2 * C) {
            protectedFraction = WAD / 2;
            upsideFraction = WAD - (WAD / 2);
        } else {
            uint256 pFrac = (C * WAD) / S;
            protectedFraction = pFrac;
            upsideFraction = WAD - pFrac;
        }

        emit Settled(settlementPrice_, protectedFraction, upsideFraction);
    }

    function redeemProtected(uint256 amount) external override nonReentrant returns (uint256) {
        if (!isSettled) revert NotSettled();
        if (amount == 0) revert ZeroAmount();

        protectedToken.burn(msg.sender, amount);

        uint256 underlyingOut = (amount * protectedFraction) / WAD;
        if (underlyingOut > 0) {
            underlying.safeTransfer(msg.sender, underlyingOut);
        }

        emit ProtectedRedeemed(msg.sender, amount, underlyingOut);
        return underlyingOut;
    }

    function redeemUpside(uint256 amount) external override nonReentrant returns (uint256) {
        if (!isSettled) revert NotSettled();
        if (amount == 0) revert ZeroAmount();

        upsideToken.burn(msg.sender, amount);

        uint256 underlyingOut = (amount * upsideFraction) / WAD;
        if (underlyingOut > 0) {
            underlying.safeTransfer(msg.sender, underlyingOut);
        }

        emit UpsideRedeemed(msg.sender, amount, underlyingOut);
        return underlyingOut;
    }
}
