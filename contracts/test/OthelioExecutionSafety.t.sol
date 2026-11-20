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
import {AerodromeRoute} from "../src/dex/AerodromeRouteTypes.sol";

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

/// @dev Deliberately mimics the minimum Safe-facing surface but is never registered.
contract LookalikeBasketAccount {
    function isOwner(address) external pure returns (bool) {
        return true;
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
        registry = new OthelioAssetRegistry(address(this));
        oracle = new BasketOracle(address(registry), address(0));
        MockAavePool pool = new MockAavePool();
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(address(pool));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(address(this), address(pool));
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

    function testEveryOwnerGatedActionRejectsModuleOracleAndUnregisteredLookalike() public {
        LookalikeBasketAccount lookalike = new LookalikeBasketAccount();
        address[] memory emptyTokens = new address[](0);
        uint256[] memory emptyAmounts = new uint256[](0);
        AerodromeRoute[] memory emptyRoutes = new AerodromeRoute[](0);
        address[3] memory invalidSafes = [address(module), address(oracle), address(lookalike)];

        for (uint256 s; s < invalidSafes.length; s++) {
            bytes[] memory calls = new bytes[](7);
            calls[0] = abi.encodeCall(module.supplyAave, (invalidSafes[s], address(1), 1));
            calls[1] = abi.encodeCall(module.repayAave, (invalidSafes[s], address(1), 1));
            calls[2] = abi.encodeCall(module.repayAaveFromWallet, (invalidSafes[s], address(1), 1));
            calls[3] = abi.encodeCall(module.withdrawAaveCollateral, (invalidSafes[s], address(1), 1, 1e18));
            calls[4] = abi.encodeCall(module.fundAerodromePortfolio, (invalidSafes[s], address(1), 1, emptyRoutes, 0));
            calls[5] = abi.encodeCall(module.rebalanceAerodromePortfolio, (invalidSafes[s], emptyRoutes, 0));
            calls[6] = abi.encodeCall(module.withdrawInKind, (invalidSafes[s], owner, emptyTokens, emptyAmounts, emptyTokens));

            for (uint256 i; i < calls.length; i++) {
                vm.prank(owner);
                (bool success,) = address(module).call(calls[i]);
                assertFalse(success, "owner-gated action accepted an invalid basket");
            }
        }
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

    function testOwnerCanRecoverDelistedVerifiedNativeB20() public {
        vm.prank(owner);
        address basketAddress = factory.createBasket("Delisted B20");
        OthelioBasketAccount basket = OthelioBasketAccount(payable(basketAddress));
        address nativeB20 = 0xB200000000000000000000000000000000000000;
        assertEq(nativeB20.code.length, 0);

        registry.configure(block.chainid, nativeB20, address(0x1234), true, 18, 8, true);
        registry.configure(block.chainid, nativeB20, address(0x1234), false, 18, 8, true);
        assertFalse(registry.isSupported(block.chainid, nativeB20));
        assertTrue(registry.isVerifiedCoinbaseB20(block.chainid, nativeB20));

        vm.mockCall(
            nativeB20,
            abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), owner, 1 ether),
            abi.encode(true)
        );
        vm.prank(owner);
        basket.recoverUntrackedToken(nativeB20, owner, 1 ether);
    }

    function testFactoryCreatesTheOnlyRegisterableBasketType() public {
        vm.prank(owner);
        address basketAddress = factory.createBasket("Factory basket");
        OthelioBasketAccount account = OthelioBasketAccount(payable(basketAddress));

        assertTrue(factory.isOthelioBasket(basketAddress));
        assertEq(account.owner(), owner);
        assertEq(account.module(), address(module));
        assertEq(account.registry(), address(registry));
        address[] memory baskets = factory.basketsOf(owner);
        assertEq(baskets.length, 1);
        assertEq(baskets[0], basketAddress);
    }

}
