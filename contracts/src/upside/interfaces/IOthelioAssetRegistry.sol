// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOthelioAssetRegistry {
    struct Asset {
        bool supported;
        address priceFeed;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        bool isCoinbaseB20;
    }

    function isSupported(uint256 chainId, address token) external view returns (bool);
    function getAsset(uint256 chainId, address token) external view returns (Asset memory);
    function getSupportedTokens(uint256 chainId) external view returns (address[] memory);
}
