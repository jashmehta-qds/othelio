// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";
import {IOthelioAccountCapabilities} from "../interfaces/IOthelioAccountCapabilities.sol";
import {OthelioAssetRegistry} from "../registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../oracle/BasketOracle.sol";

interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success);
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success, bytes memory returnData);

    function isOwner(address owner) external view returns (bool);
}

interface IOthelioBasketFactory {
    function isOthelioBasket(address basket) external view returns (bool);
}

/// @notice Abstract base module providing Safe authorization, oracle integration, and shared execution primitives.
abstract contract OthelioBaseModule is IOthelioEvents, IOthelioAccountCapabilities, ReentrancyGuard {
    using SafeERC20 for IERC20;

    BasketOracle public immutable oracle;
    OthelioAssetRegistry internal immutable assetRegistry;
    address public immutable factorySetter;
    address public factory;

    modifier onlySafeOwner(address safe) {
        require(safe != address(this) && safe != address(oracle), "INVALID_SAFE");
        require(safe.code.length > 0, "INVALID_SAFE");
        require(factory != address(0), "FACTORY_NOT_SET");
        require(IOthelioBasketFactory(factory).isOthelioBasket(safe), "UNREGISTERED_BASKET");
        require(ISafe(safe).isOwner(msg.sender), "NOT_SAFE_OWNER");
        _;
    }

    constructor(address oracle_) {
        require(oracle_ != address(0), "ZERO_ORACLE");
        oracle = BasketOracle(oracle_);
        assetRegistry = BasketOracle(oracle_).registry();
        factorySetter = msg.sender;
    }

    function moduleVersion() external pure virtual returns (uint256) {
        return 3;
    }

    function supportsBoundedExecution() external pure virtual returns (bool) {
        return true;
    }

    function enforcesPortfolioOnly() external pure virtual returns (bool) {
        return false;
    }

    function setFactory(address factory_) external {
        require(msg.sender == factorySetter, "NOT_FACTORY_SETTER");
        require(factory == address(0), "FACTORY_ALREADY_SET");
        require(factory_ != address(0), "ZERO_FACTORY");
        factory = factory_;
    }

    function _validateTarget(address safe, address target) internal view {
        require(target != address(0), "ZERO_TARGET");
        require(target.code.length > 0, "TARGET_NOT_CONTRACT");
        require(target != safe, "CANNOT_TARGET_SAFE");
        require(target != address(this), "CANNOT_TARGET_MODULE");
        require(target != address(oracle), "CANNOT_TARGET_ORACLE");
        if (factory != address(0) && target == factory) revert("CANNOT_TARGET_FACTORY");
    }

    function _executeTokenCall(address safe, address token, bytes memory data, string memory errorMessage) internal {
        (bool success, bytes memory returnData) = ISafe(safe).execTransactionFromModuleReturnData(token, 0, data, 0);
        require(success, errorMessage);
        require(returnData.length == 0 || (returnData.length == 32 && abi.decode(returnData, (bool))), errorMessage);
    }

    /// @dev B20 tokenized stocks are Base-native precompiles and intentionally have no EVM bytecode.
    /// The configured asset registry is the authority for basket constituents; code checks remain
    /// appropriate only for executable infrastructure such as Safes, routers, and price feeds.
    function _validateSupportedAsset(address asset) internal view {
        require(asset != address(0), "ZERO_TOKEN");
        require(assetRegistry.isSupported(block.chainid, asset), "UNSUPPORTED_ASSET");
    }

    function _validateBasketTokens(address[] memory basketTokens) internal view {
        uint256 len = basketTokens.length;
        for (uint256 i = 0; i < len; ++i) {
            _validateSupportedAsset(basketTokens[i]);
            for (uint256 j = 0; j < i; ++j) {
                require(basketTokens[i] != basketTokens[j], "DUPLICATE_TOKEN");
            }
        }
    }

    /// @notice Withdraws basket constituents in-kind from the Safe
    function withdrawInKind(
        address safe,
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address[] calldata remainingTokens
    ) external nonReentrant onlySafeOwner(safe) returns (uint256 remainingListedAssetsNavUsdc) {
        uint256 tokensLen = tokens.length;
        require(tokensLen == amounts.length, "LENGTH_MISMATCH");
        require(tokensLen > 0, "EMPTY_TOKENS");
        require(recipient != address(0), "ZERO_RECIPIENT");
        _validateBasketTokens(remainingTokens);

        for (uint256 i = 0; i < tokensLen; ++i) {
            _validateSupportedAsset(tokens[i]);
            require(amounts[i] > 0, "ZERO_AMOUNT");
            for (uint256 k = 0; k < i; ++k) {
                require(tokens[i] != tokens[k], "DUPLICATE_TOKEN");
            }
            bytes memory transferData = abi.encodeWithSelector(IERC20.transfer.selector, recipient, amounts[i]);
            _executeTokenCall(safe, tokens[i], transferData, "TRANSFER_FAILED");
        }

        uint256 redeemedNAV;
        try oracle.calculateNAV(tokens, amounts) returns (uint256 nav) {
            redeemedNAV = nav;
        } catch {}

        uint256 remLen = remainingTokens.length;
        uint256[] memory remainingBalances = new uint256[](remLen);
        for (uint256 i = 0; i < remLen; ++i) {
            remainingBalances[i] = IERC20(remainingTokens[i]).balanceOf(safe);
        }
        // This is intentionally limited to caller-supplied remaining tokens. The
        // indexer block snapshot, rather than this event field, is authoritative NAV.
        try oracle.calculateNAV(remainingTokens, remainingBalances) returns (uint256 nav) {
            remainingListedAssetsNavUsdc = nav;
        } catch {}

        emit BasketWithdrawn(safe, msg.sender, address(0), redeemedNAV, tokens, amounts, remainingListedAssetsNavUsdc);
    }

    receive() external payable virtual {}
}
