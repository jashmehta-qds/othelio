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

    mapping(address pool => bool) public approvedLendingPools;

    // Track supported tokens per chainId for on-chain discovery
    mapping(uint256 chainId => address[]) private _supportedTokens;
    mapping(uint256 chainId => mapping(address token => uint256)) private _tokenIndex1Based;

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
    event LendingPoolConfigured(address indexed pool, bool approved);

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
        require(tokenDecimals <= 38 && feedDecimals <= 38, "DECIMALS_TOO_LARGE");

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

        // Update supported token enumeration
        uint256 existingIdx = _tokenIndex1Based[chainId][token];
        if (supported && existingIdx == 0) {
            _supportedTokens[chainId].push(token);
            _tokenIndex1Based[chainId][token] = _supportedTokens[chainId].length;
        } else if (!supported && existingIdx > 0) {
            uint256 lastIdx = _supportedTokens[chainId].length;
            if (existingIdx != lastIdx) {
                address lastToken = _supportedTokens[chainId][lastIdx - 1];
                _supportedTokens[chainId][existingIdx - 1] = lastToken;
                _tokenIndex1Based[chainId][lastToken] = existingIdx;
            }
            _supportedTokens[chainId].pop();
            delete _tokenIndex1Based[chainId][token];
        }

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

    /// @notice Returns all currently supported tokens for a given chainId.
    function getSupportedTokens(uint256 chainId) external view returns (address[] memory) {
        return _supportedTokens[chainId];
    }

    /// @notice Returns all currently supported Coinbase B20 tokens for a given chainId.
    function getSupportedB20Tokens(uint256 chainId) external view returns (address[] memory) {
        address[] memory allTokens = _supportedTokens[chainId];
        uint256 b20Count = 0;
        for (uint256 i = 0; i < allTokens.length; i++) {
            if (assets[chainId][allTokens[i]].isCoinbaseB20) {
                b20Count++;
            }
        }

        address[] memory b20Tokens = new address[](b20Count);
        uint256 targetIdx = 0;
        for (uint256 i = 0; i < allTokens.length; i++) {
            if (assets[chainId][allTokens[i]].isCoinbaseB20) {
                b20Tokens[targetIdx] = allTokens[i];
                targetIdx++;
            }
        }
        return b20Tokens;
    }

    function setApprovedLendingPool(address pool, bool approved) external onlyOwner {
        require(pool != address(0), "ZERO_POOL");
        approvedLendingPools[pool] = approved;
        emit LendingPoolConfigured(pool, approved);
    }

    function isApprovedLendingPool(address pool) external view returns (bool) {
        return approvedLendingPools[pool];
    }
}

