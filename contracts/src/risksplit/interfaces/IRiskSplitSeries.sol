// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IClaimToken} from "./IClaimToken.sol";

/// @title IRiskSplitSeries
/// @notice Interface for the RiskSplit series vault escrows underlying and coordinates claim redemption.
interface IRiskSplitSeries {
    // Events
    event Minted(address indexed caller, uint256 amount);
    event PairRedeemed(address indexed caller, uint256 amount);
    event Settled(uint256 settlementPrice, uint256 protectedFraction, uint256 upsideFraction);
    event SettledWithFixing(
        uint256 settlementPrice,
        uint80 roundId,
        uint256 observedTimestamp,
        uint256 protectedFraction,
        uint256 upsideFraction
    );
    event ProtectedRedeemed(address indexed caller, uint256 amount, uint256 underlyingOut);
    event UpsideRedeemed(address indexed caller, uint256 amount, uint256 underlyingOut);

    // Custom Errors
    error AlreadySettled();
    error NotSettled();
    error ExpiryNotReached();
    error SeriesExpired();
    error Unauthorized();
    error ZeroAmount();
    error ZeroAddress();
    error InvalidParameters();
    error FeeOnTransferNotSupported();

    // View Functions
    function underlying() external view returns (IERC20);
    function floorPrice() external view returns (uint256);
    function capPrice() external view returns (uint256);
    function expiry() external view returns (uint256);
    function settlementAdapter() external view returns (address);
    function protectedToken() external view returns (IClaimToken);
    function upsideToken() external view returns (IClaimToken);
    function isSettled() external view returns (bool);
    function settledPrice() external view returns (uint256);
    function settledRoundId() external view returns (uint80);
    function settledTimestamp() external view returns (uint256);
    function protectedFraction() external view returns (uint256);
    function upsideFraction() external view returns (uint256);

    // State Changing Functions
    function mint(uint256 amount) external returns (uint256);
    function combineAndRedeem(uint256 amount) external returns (uint256);
    function settle(uint256 settlementPrice) external;
    function settleWithFixing(uint256 settlementPrice, uint80 roundId, uint256 observedTimestamp) external;
    function redeemProtected(uint256 amount) external returns (uint256);
    function redeemUpside(uint256 amount) external returns (uint256);
}
