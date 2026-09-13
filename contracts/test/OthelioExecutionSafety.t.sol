// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../src/lending/OthelioAaveV3Adapter.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {MockAavePool} from "../src/mock/MockAavePool.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";

contract ExecutionTarget {
    uint256 public calls;

    function execute() external {
        calls++;
    }
}

contract RecoveryToken is ERC20 {
    constructor() ERC20("Recovery Token", "REC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract OthelioExecutionSafetyTest is Test {
    address private owner = address(0xA11CE);
    address private stranger = address(0xBAD);
    OthelioAssetRegistry private registry;
    BasketOracle private oracle;
    OthelioPortfolioModule private module;
    OthelioSafeFactory private factory;

    function setUp() public {
        registry = new OthelioAssetRegistry(address(this), address(0));
        oracle = new BasketOracle(address(registry));
        MockAavePool pool = new MockAavePool();
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(address(pool));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(address(this));
        OthelioAerodromeSlipstreamAdapter dexAdapter = new OthelioAerodromeSlipstreamAdapter(address(pool), address(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913), address(routeRegistry));
        module = new OthelioPortfolioModule(address(oracle), address(aaveAdapter), address(dexAdapter), false, 1.25e18);
        factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));
    }

    function testFreshModulePublishesTruthfulExecutionCapabilities() public view {
        assertEq(module.moduleVersion(), 3);
        assertTrue(module.supportsBoundedExecution());
        assertTrue(module.enforcesPortfolioOnly());
    }

    function testOwnerCannotChangePrimaryModuleAuthorization() public {
        vm.prank(owner);
        address basketAddress = factory.createBasket("Locked");
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketAddress));

        vm.prank(owner);
        vm.expectRevert("MODULE_CONFIGURATION_LOCKED");
        basket.disableModule(address(module));

        vm.prank(owner);
        vm.expectRevert("MODULE_CONFIGURATION_LOCKED");
        basket.enableModule(stranger);

        assertTrue(basket.isModuleEnabled(address(module)));
        assertFalse(basket.isModuleEnabled(stranger));
    }

    function testOnlyConfiguredModuleCanUseAccountExecution() public {
        vm.prank(owner);
        address basketAddress = factory.createBasket("Locked");
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketAddress));
        ExecutionTarget target = new ExecutionTarget();

        vm.prank(stranger);
        vm.expectRevert("NOT_AUTHORIZED_MODULE");
        basket.execTransactionFromModule(address(target), 0, abi.encodeCall(ExecutionTarget.execute, ()), 0);
    }

    function testOwnerCanRecoverOnlyUntrackedTokens() public {
        vm.prank(owner);
        address basketAddress = factory.createBasket("Recovery");
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketAddress));
        RecoveryToken untracked = new RecoveryToken();
        RecoveryToken tracked = new RecoveryToken();
        untracked.mint(basketAddress, 10 ether);
        tracked.mint(basketAddress, 10 ether);

        registry.configure(block.chainid, address(tracked), address(0x1234), true, 18, 8, false);

        vm.prank(owner);
        vm.expectRevert("TRACKED_ASSET");
        basket.recoverUntrackedToken(address(tracked), owner, 1 ether);

        vm.prank(owner);
        basket.recoverUntrackedToken(address(untracked), owner, 4 ether);

        assertEq(untracked.balanceOf(owner), 4 ether);
        assertEq(untracked.balanceOf(basketAddress), 6 ether);
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
