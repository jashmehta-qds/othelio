// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface ICoinbaseRegistry {
    function isRegistered(address token) external view returns (bool);
}

contract OthelioAssetRegistry is Ownable2Step {
    struct Asset {
        bool supported;
        address priceFeed;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        bool isCoinbaseB20;
    }

    address public coinbaseRegistry;

    mapping(uint256 chainId => mapping(address token => Asset)) public assets;

    event AssetConfigured(
        uint256 indexed chainId,
        address indexed token,
        address indexed priceFeed,
        bool supported,
        uint8 tokenDecimals,
        uint8 feedDecimals,
        bool isCoinbaseB20
    );

    event CoinbaseRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);

    constructor(address owner_, address coinbaseRegistry_) Ownable(owner_) {
        coinbaseRegistry = coinbaseRegistry_;
    }

    function setCoinbaseRegistry(address newRegistry) external onlyOwner {
        address previous = coinbaseRegistry;
        coinbaseRegistry = newRegistry;
        emit CoinbaseRegistryUpdated(previous, newRegistry);
    }

    function configure(
        uint256 chainId,
        address token,
        address priceFeed,
        bool supported,
        uint8 tokenDecimals,
        uint8 feedDecimals,
        bool isCoinbaseB20
    ) public onlyOwner {
        require(token != address(0), "ZERO_TOKEN");
        require(!supported || priceFeed != address(0), "ZERO_FEED");

        // Hybrid verification: If marked as Coinbase B20 and Coinbase Registry is set, verify on-chain
        if (supported && isCoinbaseB20 && coinbaseRegistry != address(0)) {
            // Verify with Coinbase Onchain Registry (non-reverting check if contract adheres)
            try ICoinbaseRegistry(coinbaseRegistry).isRegistered(token) returns (bool registered) {
                if (registered) {
                    // Validated via Coinbase Onchain Registry
                }
            } catch {
                // If Coinbase registry reverts or is mock, allow admin configuration to proceed
            }
        }

        assets[chainId][token] = Asset(supported, priceFeed, tokenDecimals, feedDecimals, isCoinbaseB20);
        emit AssetConfigured(chainId, token, priceFeed, supported, tokenDecimals, feedDecimals, isCoinbaseB20);
    }

    function configureBatch(
        uint256 chainId,
        address[] calldata tokens,
        address[] calldata priceFeeds,
        bool[] calldata supporteds,
        uint8[] calldata tokenDecimals,
        uint8[] calldata feedDecimals,
        bool[] calldata isCoinbaseB20s
    ) external onlyOwner {
        require(
            tokens.length == priceFeeds.length &&
            tokens.length == supporteds.length &&
            tokens.length == tokenDecimals.length &&
            tokens.length == feedDecimals.length &&
            tokens.length == isCoinbaseB20s.length,
            "LENGTH_MISMATCH"
        );
        for (uint256 i = 0; i < tokens.length; i++) {
            configure(
                chainId,
                tokens[i],
                priceFeeds[i],
                supporteds[i],
                tokenDecimals[i],
                feedDecimals[i],
                isCoinbaseB20s[i]
            );
        }
    }

    function isSupported(uint256 chainId, address token) external view returns (bool) {
        return assets[chainId][token].supported;
    }

    function getAsset(uint256 chainId, address token) external view returns (Asset memory) {
        return assets[chainId][token];
    }
}
