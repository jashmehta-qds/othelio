// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OthelioAssetRegistry} from "../registry/OthelioAssetRegistry.sol";

interface ISafeAccount {
    function isOwner(address owner) external view returns (bool);
    function execTransactionFromModule(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success);
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, uint8 operation)
        external
        returns (bool success, bytes memory returnData);
}

contract OthelioBasketAccount is ISafeAccount {
    using SafeERC20 for IERC20;

    address public owner;
    address public immutable module;
    address public immutable registry;
    mapping(address => bool) public isModuleEnabled;

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    // Retained in the ABI for legacy event consumers. Module configuration is now immutable.
    event ModuleEnabled(address indexed module);
    event ModuleDisabled(address indexed module);
    event UntrackedTokenRecovered(address indexed token, address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyModule() {
        require(isModuleEnabled[msg.sender], "NOT_AUTHORIZED_MODULE");
        _;
    }

    constructor(address owner_, address module_, address registry_) {
        require(owner_ != address(0) && module_ != address(0) && registry_ != address(0), "ZERO_ADDRESS");
        owner = owner_;
        module = module_;
        registry = registry_;
        isModuleEnabled[module_] = true;
    }

    /// @notice Kept only to make legacy callers fail explicitly. Basket module configuration is immutable.
    function enableModule(address) external onlyOwner {
        revert("MODULE_CONFIGURATION_LOCKED");
    }

    /// @notice Kept only to make legacy callers fail explicitly. The primary module cannot be disabled.
    function disableModule(address) external onlyOwner {
        revert("MODULE_CONFIGURATION_LOCKED");
    }

    function isOwner(address owner_) external view override returns (bool) {
        return owner_ == owner;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    )
        external
        override
        onlyModule
        returns (bool success)
    {
        require(operation == 0, "UNSUPPORTED_OPERATION");
        require(to != address(0), "ZERO_TARGET");
        (success,) = to.call{value: value}(data);
        require(success, "EXEC_MODULE_FAILED");
    }

    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    )
        external
        override
        onlyModule
        returns (bool success, bytes memory returnData)
    {
        require(operation == 0, "UNSUPPORTED_OPERATION");
        require(to != address(0), "ZERO_TARGET");
        (success, returnData) = to.call{value: value}(data);
        require(success, "EXEC_MODULE_FAILED");
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_ADDRESS");
        require(newOwner != owner, "SAME_OWNER");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Recover an asset that is not a configured basket asset.
    /// @dev Supported assets must leave through reviewed portfolio operations on the immutable module.
    /// Native/precompile-backed Coinbase B20s are accepted only when they remain
    /// authenticated by the asset registry, even if governance has delisted them.
    function recoverUntrackedToken(address token, address recipient, uint256 amount) external onlyOwner {
        require(token != address(0), "INVALID_TOKEN");
        require(recipient != address(0), "ZERO_RECIPIENT");
        require(amount > 0, "ZERO_AMOUNT");
        require(!OthelioAssetRegistry(registry).isSupported(block.chainid, token), "TRACKED_ASSET");
        require(
            token.code.length > 0 || OthelioAssetRegistry(registry).isVerifiedCoinbaseB20(block.chainid, token),
            "INVALID_TOKEN"
        );

        IERC20(token).safeTransfer(recipient, amount);
        emit UntrackedTokenRecovered(token, recipient, amount);
    }

    receive() external payable {
        revert("NATIVE_ASSET_UNSUPPORTED");
    }
}
