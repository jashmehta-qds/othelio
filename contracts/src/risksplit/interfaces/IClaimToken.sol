// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title IClaimToken
/// @notice Interface for RiskSplit Protected and Upside ERC20 claim tokens.
interface IClaimToken is IERC20, IERC20Metadata {
    // Custom Errors
    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();

    /// @notice Returns the address of the series vault authorized to mint and burn
    function seriesVault() external view returns (address);

    /// @notice Mints tokens to `to`. Only callable by `seriesVault`.
    /// @param to Recipient address
    /// @param amount Number of claim tokens to mint
    function mint(address to, uint256 amount) external;

    /// @notice Burns tokens from `from`. Only callable by `seriesVault`.
    /// @param from Address whose tokens are burned
    /// @param amount Number of claim tokens to burn
    function burn(address from, uint256 amount) external;
}
