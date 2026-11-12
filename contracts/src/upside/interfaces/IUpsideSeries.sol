// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUpsideClaimToken} from "./IUpsideClaimToken.sol";

interface IUpsideSeries {
    error ZeroAddress();
    error ZeroAmount();
    error InvalidParameters();
    error Unauthorized();
    error AlreadyInitialized();
    error SeriesExpired();
    error ExpiryNotReached();
    error AlreadySettled();
    error NotSettled();
    error FeeOnTransferNotSupported();
    error AssetNotSupported();
    error ExceedsSupply();
    error UnsupportedDecimals(uint8 decimals);

    event TokensInitialized(address upsideToken, address residualToken);
    event Minted(address indexed user, uint256 amount);
    event PairWithdrawn(address indexed user, uint256 amount);
    event SettledWithFixing(
        uint256 settlementPrice,
        uint80 roundId,
        uint256 observedTimestamp,
        uint256 upsideAllocation,
        uint256 residualAllocation
    );
    event Settled(uint256 settlementPrice, uint256 upsideAllocation, uint256 residualAllocation);
    event UpsideRedeemed(address indexed user, uint256 claimAmount, uint256 underlyingOut);
    event ResidualRedeemed(address indexed user, uint256 claimAmount, uint256 underlyingOut);

    function factory() external view returns (address);
    function assetRegistry() external view returns (address);
    function underlying() external view returns (IERC20);
    function settlementAdapter() external view returns (address);
    function strikePrice() external view returns (uint256);
    function expiry() external view returns (uint256);
    function referenceFeed() external view returns (address);
    function referenceRoundId() external view returns (uint80);
    function referencePrice() external view returns (uint256);
    function referenceBlock() external view returns (uint256);
    function roundId() external view returns (uint256);
    function formulaVersion() external view returns (uint256);

    function upsideToken() external view returns (IUpsideClaimToken);
    function residualToken() external view returns (IUpsideClaimToken);

    function isSettled() external view returns (bool);
    function settledPrice() external view returns (uint256);
    function settledRoundId() external view returns (uint80);
    function settledTimestamp() external view returns (uint256);

    function collateralSnapshot() external view returns (uint256);
    function totalClaimSupplySnapshot() external view returns (uint256);
    function upsideAllocation() external view returns (uint256);
    function residualAllocation() external view returns (uint256);
    function totalUpsideRedeemed() external view returns (uint256);
    function totalResidualRedeemed() external view returns (uint256);

    function initializeTokens(address upsideToken_, address residualToken_) external;
    function mint(uint256 amount) external returns (uint256);
    function combineAndWithdraw(uint256 amount) external returns (uint256);
    function combineAndRedeem(uint256 amount) external returns (uint256);
    function settleWithFixing(uint256 settlementPrice_, uint80 roundId_, uint256 observedTimestamp_) external;
    function redeemUpside(uint256 amount) external returns (uint256);
    function redeemResidual(uint256 amount) external returns (uint256);
}
