// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract OthelioAssetRegistry is Ownable2Step {
    struct Asset { bool supported; address priceFeed; uint8 tokenDecimals; uint8 feedDecimals; }
    mapping(uint256 chainId => mapping(address token => Asset)) public assets;
    event AssetConfigured(uint256 indexed chainId, address indexed token, address indexed priceFeed, bool supported, uint8 tokenDecimals, uint8 feedDecimals);

    constructor(address owner_) Ownable(owner_) {}

    function configure(uint256 chainId, address token, address priceFeed, bool supported, uint8 tokenDecimals, uint8 feedDecimals) external onlyOwner {
        require(token != address(0), "ZERO_TOKEN");
        require(!supported || priceFeed != address(0), "ZERO_FEED");
        assets[chainId][token] = Asset(supported, priceFeed, tokenDecimals, feedDecimals);
        emit AssetConfigured(chainId, token, priceFeed, supported, tokenDecimals, feedDecimals);
    }

    function isSupported(uint256 chainId, address token) external view returns (bool) { return assets[chainId][token].supported; }
}

