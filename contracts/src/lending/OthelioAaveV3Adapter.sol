// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAaveV3AccountData {
    function getUserAccountData(address user) external view returns (uint256, uint256, uint256, uint256, uint256, uint256);
}

/// @notice Stateless Aave V3 call builder and post-condition reader. It never has basket-module authority.
contract OthelioAaveV3Adapter {
    address public immutable pool;

    constructor(address pool_) {
        require(pool_ != address(0), "ZERO_AAVE_POOL");
        pool = pool_;
    }

    function supplyCall(address asset, uint256 amount, address basket) external view returns (address target, bytes memory data) {
        require(asset != address(0) && amount > 0 && basket != address(0), "INVALID_AAVE_SUPPLY");
        return (pool, abi.encodeWithSignature("supply(address,uint256,address,uint16)", asset, amount, basket, uint16(0)));
    }

    function repayCall(address asset, uint256 amount, address basket) external view returns (address target, bytes memory data) {
        require(asset != address(0) && amount > 0 && basket != address(0), "INVALID_AAVE_REPAY");
        return (pool, abi.encodeWithSignature("repay(address,uint256,uint256,address)", asset, amount, uint256(2), basket));
    }

    function withdrawCall(address asset, uint256 amount, address basket) external view returns (address target, bytes memory data) {
        require(asset != address(0) && amount > 0 && basket != address(0), "INVALID_AAVE_WITHDRAW");
        return (pool, abi.encodeWithSignature("withdraw(address,uint256,address)", asset, amount, basket));
    }

    function healthFactor(address basket) external view returns (uint256) {
        (,,,,, uint256 factor) = IAaveV3AccountData(pool).getUserAccountData(basket);
        return factor;
    }
}
