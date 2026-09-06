// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISafeAccount {
    function isOwner(address owner) external view returns (bool);
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external returns (bool success);
}

contract OthelioBasketAccount is ISafeAccount {
    address public owner;
    address public immutable module;
    address public immutable registry;

    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyModule() {
        require(msg.sender == module, "NOT_AUTHORIZED_MODULE");
        _;
    }

    constructor(address owner_, address module_, address registry_) {
        require(owner_ != address(0) && module_ != address(0), "ZERO_ADDRESS");
        owner = owner_;
        module = module_;
        registry = registry_;
    }

    function isOwner(address owner_) external view override returns (bool) {
        return owner_ == owner;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 /* operation */
    ) external override onlyModule returns (bool success) {
        (success, ) = to.call{value: value}(data);
        require(success, "EXEC_MODULE_FAILED");
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_ADDRESS");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    receive() external payable {}
}
