// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OthelioAssetRegistry} from "../registry/OthelioAssetRegistry.sol";
import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";

interface ITransactionGuard {
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external;

    function checkAfterExecution(bytes32 txHash, bool success) external;
}

contract OthelioBasketGuard is ITransactionGuard, IOthelioEvents {
    OthelioAssetRegistry public immutable registry;
    address public immutable authorizedModule;
    address public immutable multiSend;

    // Standard ERC20 and permit selectors
    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;           // transfer(address,uint256)
    bytes4 private constant TRANSFER_FROM_SELECTOR = 0x23b872dd;      // transferFrom(address,address,uint256)
    bytes4 private constant APPROVE_SELECTOR = 0x095ea7b3;            // approve(address,uint256)
    bytes4 private constant INCREASE_ALLOWANCE_SELECTOR = 0x39509351;  // increaseAllowance(address,uint256)
    bytes4 private constant DECREASE_ALLOWANCE_SELECTOR = 0xa457c2d7;  // decreaseAllowance(address,uint256)
    bytes4 private constant PERMIT_SELECTOR = 0xd505accf;              // permit(address,address,uint256,uint256,uint8,bytes32,bytes32)

    constructor(address registry_, address authorizedModule_, address multiSend_) {
        require(registry_ != address(0) && authorizedModule_ != address(0), "ZERO_ADDRESS");
        registry = OthelioAssetRegistry(registry_);
        authorizedModule = authorizedModule_;
        multiSend = multiSend_;
    }

    function checkTransaction(
        address to,
        uint256, /* value */
        bytes memory data,
        uint8 operation,
        uint256, /* safeTxGas */
        uint256, /* baseGas */
        uint256, /* gasPrice */
        address, /* gasToken */
        address payable, /* refundReceiver */
        bytes memory, /* signatures */
        address msgSender
    ) external view override {
        require(to != address(0), "OthelioGuard: Zero destination");

        // Operation 1 = DelegateCall. Block DelegateCall unless calling canonical MultiSend router
        if (operation == 1) {
            require(multiSend != address(0) && to == multiSend, "OthelioGuard: Unauthorized DelegateCall");
        }

        // If data contains an ERC-20 transfer/approve call
        if (data.length >= 4) {
            bytes4 selector;
            assembly {
                selector := mload(add(data, 32))
            }

            if (
                selector == TRANSFER_SELECTOR ||
                selector == TRANSFER_FROM_SELECTOR ||
                selector == APPROVE_SELECTOR ||
                selector == INCREASE_ALLOWANCE_SELECTOR ||
                selector == DECREASE_ALLOWANCE_SELECTOR ||
                selector == PERMIT_SELECTOR
            ) {
                bool isTracked = registry.isSupported(block.chainid, to);
                if (isTracked) {
                    // Tracked tokens MUST only be moved or approved via authorized OthelioBasketModule
                    require(
                        msgSender == authorizedModule,
                        "OthelioGuard: Tracked assets must be managed via OthelioBasketModule"
                    );
                }
                // If untracked asset, allow direct transfer/approve (enables direct owner sweep)
            }
        }
    }

    function checkAfterExecution(bytes32, bool) external pure override {
        // No post-execution checks required
    }
}
