// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUpsideClaimToken} from "./interfaces/IUpsideClaimToken.sol";

contract UpsideClaimToken is ERC20, IUpsideClaimToken {
    address private immutable _factory;
    address public override seriesVault;
    uint8 private _tokenDecimals;
    string private _tokenName;
    string private _tokenSymbol;
    bool private _initialized;

    modifier onlySeries() {
        if (msg.sender != seriesVault) revert Unauthorized();
        _;
    }

    constructor(string memory name_, string memory symbol_, address seriesVault_, uint8 decimals_)
        ERC20("", "")
    {
        if (seriesVault_ == address(0)) revert ZeroAddress();
        _factory = seriesVault_;
        seriesVault = seriesVault_;
        _tokenDecimals = decimals_;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        _initialized = true;
    }

    function initialize(string memory name_, string memory symbol_, address seriesVault_, uint8 decimals_) external {
        if (_initialized || msg.sender != _factory) revert Unauthorized();
        if (seriesVault_ == address(0)) revert ZeroAddress();
        _initialized = true;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        seriesVault = seriesVault_;
        _tokenDecimals = decimals_;
    }

    function name() public view override(ERC20, IERC20Metadata) returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override(ERC20, IERC20Metadata) returns (string memory) {
        return _tokenSymbol;
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
