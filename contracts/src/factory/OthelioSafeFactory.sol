// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";
import {OthelioBasketAccount} from "../safe/OthelioBasketAccount.sol";
import {OthelioBaseModule} from "../safe/OthelioBaseModule.sol";

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

    function createBasket(string calldata name) external returns (address basket) {
        require(bytes(name).length > 0 && bytes(name).length <= 128, "INVALID_NAME");
        require(OthelioBaseModule(payable(module)).enforcesPortfolioOnly(), "UNSUPPORTED_MODULE_ARCHITECTURE");
        OthelioBasketAccount account = new OthelioBasketAccount(msg.sender, module, registry);
        basket = address(account);

        isOthelioBasket[basket] = true;
        _userBaskets[msg.sender].push(basket);

        emit BasketCreated(basket, msg.sender, name, block.timestamp);
    }

    function basketsOf(address owner) external view returns (address[] memory) {
        return _userBaskets[owner];
    }
}
