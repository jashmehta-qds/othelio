// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IFeedDecimals {
    function decimals() external view returns (uint8);
}

interface IB20Factory {
    function isB20(address token) external view returns (bool);
    function isB20Initialized(address token) external view returns (bool);
}

contract OthelioAssetRegistry is Ownable2Step {
    /// @dev Base's singleton B20 factory precompile. It is intentionally not
    /// code-length checked: precompiles do not have conventional EVM bytecode.
    address private constant BASE_B20_FACTORY = 0xB20f000000000000000000000000000000000000;
    uint256 private constant BASE_CHAIN_ID = 8453;
    struct Asset {
        bool supported;
        address priceFeed;
        uint8 tokenDecimals;
        uint8 feedDecimals;
        bool isCoinbaseB20;
    }

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

    event LendingPoolConfigured(address indexed pool, bool approved);

    constructor(address owner_) Ownable(owner_) {}

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
        if (supported && priceFeed.code.length > 0) {
            try IFeedDecimals(priceFeed).decimals() returns (uint8 actualDecimals) {
                require(actualDecimals == feedDecimals, "FEED_DECIMALS_MISMATCH");
            } catch {
                revert("FEED_DECIMALS_MISMATCH");
            }
        }

        // B20 assets are native/precompile-backed, so code-length is not a valid
        // authenticity check. On Base, verify the official B20 factory's address
        // classification and initialized state. The owner-governed allowlist then
        // remains the product-level authority for which valid B20 assets Othelio
        // chooses to support.
        if (supported && isCoinbaseB20 && block.chainid == BASE_CHAIN_ID) {
            require(_isInitializedBaseB20(token), "UNVERIFIED_BASE_B20");
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

    /// @notice True when governance has classified `token` as a Coinbase B20 asset,
    /// including after it was disabled as a supported portfolio asset.
    /// @dev This is intentionally distinct from `isSupported` so owners can recover
    /// a delisted native/precompile-backed B20 from a basket.
    function isVerifiedCoinbaseB20(uint256 chainId, address token) external view returns (bool) {
        if (!assets[chainId][token].isCoinbaseB20) return false;
        return block.chainid != BASE_CHAIN_ID || _isInitializedBaseB20(token);
    }

    function _isInitializedBaseB20(address token) private view returns (bool) {
        try IB20Factory(BASE_B20_FACTORY).isB20(token) returns (bool isB20) {
            if (!isB20) return false;
        } catch {
            return false;
        }
        try IB20Factory(BASE_B20_FACTORY).isB20Initialized(token) returns (bool initialized) {
            return initialized;
        } catch {
            return false;
        }
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
