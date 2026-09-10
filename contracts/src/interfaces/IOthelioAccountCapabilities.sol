// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Runtime identity used by callers to distinguish bounded fresh deployments from legacy modules.
interface IOthelioAccountCapabilities {
    function moduleVersion() external pure returns (uint256);
    function supportsBoundedExecution() external pure returns (bool);
    function enforcesPortfolioOnly() external pure returns (bool);
}
