// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IClaimToken} from "./interfaces/IClaimToken.sol";

contract ClaimToken is ERC20, IClaimToken {
    address public immutable override seriesVault;
    uint8 private immutable _tokenDecimals;

    modifier onlySeries() {
        if (msg.sender != seriesVault) revert Unauthorized();
        _;
    }

    constructor(string memory name_, string memory symbol_, address seriesVault_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        if (seriesVault_ == address(0)) revert ZeroAddress();
        seriesVault = seriesVault_;
        _tokenDecimals = decimals_;
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external override onlySeries {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external override onlySeries {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
    }
}
