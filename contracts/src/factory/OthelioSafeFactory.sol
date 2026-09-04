// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";

contract OthelioSafeFactory is IOthelioEvents {
    address public immutable module;
    address public immutable registry;

    mapping(address => bool) public isOthelioBasket;
    mapping(address => address[]) private _userBaskets;

    constructor(address module_, address registry_) {
        require(module_ != address(0) && registry_ != address(0), "ZERO_ADDRESS");
        module = module_;
        registry = registry_;
    }

    function registerBasket(address safe, address owner, string calldata name) external {
        require(!isOthelioBasket[safe], "ALREADY_REGISTERED");
        require(safe != address(0) && owner != address(0), "ZERO_ADDRESS");

        isOthelioBasket[safe] = true;
        _userBaskets[owner].push(safe);

        emit BasketCreated(safe, owner, name, block.timestamp);
    }

    function basketsOf(address owner) external view returns (address[] memory) {
        return _userBaskets[owner];
    }
}
