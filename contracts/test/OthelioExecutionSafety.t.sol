// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioBasketModule} from "../src/safe/OthelioBasketModule.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";

contract ExecutionTarget {
    uint256 public calls;

    function execute() external {
        calls++;
    }
}

contract OthelioExecutionSafetyTest is Test {
    address private owner = address(0xA11CE);
    address private stranger = address(0xBAD);
    OthelioAssetRegistry private registry;
    BasketOracle private oracle;
    OthelioBasketModule private module;
    OthelioSafeFactory private factory;

    function setUp() public {
        registry = new OthelioAssetRegistry(address(this), address(0));
        oracle = new BasketOracle(address(registry));
        module = new OthelioBasketModule(address(oracle));
        factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));
    }

    function testFreshModulePublishesTruthfulExecutionCapabilities() public view {
        assertEq(module.moduleVersion(), 3);
        assertTrue(module.supportsBoundedExecution());
        assertFalse(module.enforcesPortfolioOnly());
    }

    function testOwnerCanDisableAndRecoverPrimaryModuleAuthorization() public {
        vm.prank(owner);
        address basketAddress = factory.createBasket("Recovery");
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketAddress));
        ExecutionTarget target = new ExecutionTarget();

        vm.prank(owner);
        basket.disableModule(address(module));
        assertFalse(basket.isModuleEnabled(address(module)));

        vm.prank(address(module));
        vm.expectRevert("NOT_AUTHORIZED_MODULE");
        basket.execTransactionFromModule(address(target), 0, abi.encodeCall(ExecutionTarget.execute, ()), 0);

        vm.prank(owner);
        basket.enableModule(address(module));
        vm.prank(address(module));
        basket.execTransactionFromModule(address(target), 0, abi.encodeCall(ExecutionTarget.execute, ()), 0);
        assertEq(target.calls(), 1);
    }

    function testRegistrationRejectsEOAAndUnrelatedCaller() public {
        vm.prank(owner);
        vm.expectRevert("SAFE_NOT_CONTRACT");
        factory.registerBasket(stranger, owner, "EOA");

        OthelioBasketAccount account = new OthelioBasketAccount(owner, address(module), address(registry));
        vm.prank(stranger);
        vm.expectRevert("OWNER_MUST_REGISTER");
        factory.registerBasket(address(account), owner, "Wrong caller");
    }

    function testOwnerCanRegisterOwnedContractAccount() public {
        OthelioBasketAccount account = new OthelioBasketAccount(owner, address(module), address(registry));

        vm.prank(owner);
        factory.registerBasket(address(account), owner, "Imported");

        assertTrue(factory.isOthelioBasket(address(account)));
        address[] memory baskets = factory.basketsOf(owner);
        assertEq(baskets.length, 1);
        assertEq(baskets[0], address(account));
    }

    function testRegistrationRejectsAccountWithDifferentExecutionConfiguration() public {
        OthelioBasketAccount account = new OthelioBasketAccount(owner, stranger, address(registry));

        vm.prank(owner);
        vm.expectRevert("MODULE_MISMATCH");
        factory.registerBasket(address(account), owner, "Incompatible");
    }
}
