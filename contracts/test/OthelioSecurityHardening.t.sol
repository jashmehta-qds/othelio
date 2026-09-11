// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketModule, ISafe} from "../src/safe/OthelioBasketModule.sol";
import {OthelioBorrowModule} from "../src/safe/OthelioBorrowModule.sol";
import {OthelioBasketGuard} from "../src/safe/OthelioBasketGuard.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {MockV3Aggregator} from "./BasketOracle.t.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";

contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract NoOpTarget {
    function execute() external {}
}

contract OthelioSecurityHardeningTest is Test {
    OthelioAssetRegistry public registry;
    BasketOracle public oracle;
    OthelioBasketModule public module;
    OthelioBorrowModule public borrowModule;
    OthelioSafeFactory public factory;
    OthelioBasketGuard public guard;

    TestToken public tokenA;
    TestToken public tokenB;
    MockV3Aggregator public feedA;
    MockV3Aggregator public feedB;
    MockDEXRouter public router;

    address public owner = address(0xAA11);
    address public attacker = address(0xBAD);
    address public basketAddr;
    OthelioBasketAccount public basket;

    function setUp() public {
        vm.startPrank(owner);

        registry = new OthelioAssetRegistry(owner, address(0));
        oracle = new BasketOracle(address(registry));
        module = new OthelioBasketModule(address(oracle));
        borrowModule = new OthelioBorrowModule(address(oracle));
        factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));

        guard = new OthelioBasketGuard(address(registry), address(module), address(0));

        tokenA = new TestToken("Token A", "TKNA");
        tokenB = new TestToken("Token B", "TKNB");
        feedA = new MockV3Aggregator(8, 100 * 1e8);
        feedB = new MockV3Aggregator(8, 1 * 1e8);

        registry.configure(block.chainid, address(tokenA), address(feedA), true, 18, 8, false);
        registry.configure(block.chainid, address(tokenB), address(feedB), true, 18, 8, false);

        router = new MockDEXRouter();

        basketAddr = factory.createBasket("Security Test Basket");
        basket = OthelioBasketAccount(payable(basketAddr));

        tokenA.mint(basketAddr, 100 * 1e18);
        tokenB.mint(basketAddr, 100 * 1e18);

        vm.stopPrank();
    }

    // 1. Verify onlySafeOwner cannot be bypassed with EOA / empty code address
    function testCannotBypassOnlySafeOwnerWithEmptySafe() public {
        address emptySafe = address(0x1234567890123456789012345678901234567890);
        require(emptySafe.code.length == 0, "must be empty");

        vm.prank(attacker);
        vm.expectRevert("INVALID_SAFE");
        module.executeTransaction(emptySafe, address(router), 0, "");

        vm.prank(attacker);
        vm.expectRevert("INVALID_SAFE");
        borrowModule.executeLending(emptySafe, address(router), "", address(0), 0);
    }

    // 2. Verify executeTransaction rejects targeting the Safe itself (self-call hijacking)
    function testCannotTargetSafeInExecuteTransaction() public {
        bytes memory hijackData = abi.encodeWithSelector(OthelioBasketAccount.setOwner.selector, attacker);

        vm.prank(owner);
        vm.expectRevert("CANNOT_TARGET_SAFE");
        module.executeTransaction(basketAddr, basketAddr, 0, hijackData);
    }

    // 3. Verify executeTransaction rejects targeting the module itself
    function testCannotTargetModuleInExecuteTransaction() public {
        vm.prank(owner);
        vm.expectRevert("CANNOT_TARGET_MODULE");
        module.executeTransaction(basketAddr, address(module), 0, "");
    }

    // 4. Verify swap routes reject targeting the Safe itself
    function testCannotTargetSafeInRebalanceSwapRoute() public {
        address[] memory sold = new address[](1);
        sold[0] = address(tokenA);
        uint256[] memory maxSold = new uint256[](1);
        maxSold[0] = 10 * 1e18;

        address[] memory bought = new address[](1);
        bought[0] = address(tokenB);
        uint256[] memory minBought = new uint256[](1);
        minBought[0] = 10 * 1e18;

        address[] memory basketTokens = new address[](2);
        basketTokens[0] = address(tokenA);
        basketTokens[1] = address(tokenB);

        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](1);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: basketAddr, // Exploiting self-call
            allowanceSpender: address(router),
            soldAsset: address(tokenA),
            maxSoldAmount: 10 * 1e18,
            dexCalldata: abi.encodeWithSelector(OthelioBasketAccount.setOwner.selector, attacker)
        });

        OthelioBasketModule.RebalanceParams memory p = OthelioBasketModule.RebalanceParams({
            safe: basketAddr,
            legs: legs,
            soldAssets: sold,
            maxSoldAmounts: maxSold,
            boughtAssets: bought,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(owner);
        vm.expectRevert("CANNOT_TARGET_SAFE");
        module.rebalance(p);
    }

    // 5. Verify withdrawWithSwaps enforces slippage on zero delta
    function testWithdrawWithSwapsEnforcesSlippageOnZeroDelta() public {
        address[] memory emptySold = new address[](0);
        uint256[] memory emptyMax = new uint256[](0);
        address[] memory remaining = new address[](1);
        remaining[0] = address(tokenB);
        NoOpTarget noOp = new NoOpTarget();

        OthelioBasketModule.WithdrawWithSwapsParams memory p = OthelioBasketModule.WithdrawWithSwapsParams({
            safe: basketAddr,
            recipient: owner,
            outAsset: address(tokenB),
            minOutAssetAmount: 1,
            target: address(noOp),
            allowanceSpender: address(noOp),
            dexCalldata: abi.encodeCall(NoOpTarget.execute, ()),
            soldAssets: emptySold,
            maxSoldAmounts: emptyMax,
            remainingTokens: remaining,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(owner);
        vm.expectRevert("SLIPPAGE_EXCEEDED");
        module.withdrawWithSwaps(p);
    }

    // 6. Verify withdrawWithSwaps rejects duplicate soldAssets
    function testWithdrawWithSwapsRejectsDuplicateSoldAssets() public {
        address[] memory dupSold = new address[](2);
        dupSold[0] = address(tokenA);
        dupSold[1] = address(tokenA);

        uint256[] memory maxSold = new uint256[](2);
        maxSold[0] = 5 * 1e18;
        maxSold[1] = 5 * 1e18;

        address[] memory remaining = new address[](1);
        remaining[0] = address(tokenB);

        OthelioBasketModule.WithdrawWithSwapsParams memory p = OthelioBasketModule.WithdrawWithSwapsParams({
            safe: basketAddr,
            recipient: owner,
            outAsset: address(tokenB),
            minOutAssetAmount: 1,
            target: address(router),
            allowanceSpender: address(router),
            dexCalldata: hex"1234",
            soldAssets: dupSold,
            maxSoldAmounts: maxSold,
            remainingTokens: remaining,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(owner);
        vm.expectRevert("DUPLICATE_SOLD_ASSET");
        module.withdrawWithSwaps(p);
    }

    // 7. Verify withdrawWithSwaps rejects targeting the Safe
    function testWithdrawWithSwapsRejectsTargetingSafe() public {
        address[] memory sold = new address[](1);
        sold[0] = address(tokenA);
        uint256[] memory maxSold = new uint256[](1);
        maxSold[0] = 5 * 1e18;

        address[] memory remaining = new address[](1);
        remaining[0] = address(tokenB);

        OthelioBasketModule.WithdrawWithSwapsParams memory p = OthelioBasketModule.WithdrawWithSwapsParams({
            safe: basketAddr,
            recipient: owner,
            outAsset: address(tokenB),
            minOutAssetAmount: 1,
            target: basketAddr, // Cannot target safe
            allowanceSpender: address(router),
            dexCalldata: hex"1234",
            soldAssets: sold,
            maxSoldAmounts: maxSold,
            remainingTokens: remaining,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(owner);
        vm.expectRevert("CANNOT_TARGET_SAFE");
        module.withdrawWithSwaps(p);
    }

    // 8. Verify withdrawInKind rejects duplicate tokens
    function testWithdrawInKindRejectsDuplicateTokens() public {
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenA);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10 * 1e18;
        amounts[1] = 10 * 1e18;

        address[] memory remaining = new address[](1);
        remaining[0] = address(tokenB);

        vm.prank(owner);
        vm.expectRevert("DUPLICATE_TOKEN");
        module.withdrawInKind(basketAddr, owner, tokens, amounts, remaining);
    }

    // 9. Verify OthelioBasketAccount rejects operation != 0 (DelegateCall rejection)
    function testBasketAccountRejectsUnsupportedOperation() public {
        vm.prank(address(module));
        vm.expectRevert("UNSUPPORTED_OPERATION");
        basket.execTransactionFromModule(address(tokenA), 0, "", 1);

        vm.prank(address(module));
        vm.expectRevert("UNSUPPORTED_OPERATION");
        basket.execTransactionFromModuleReturnData(address(tokenA), 0, "", 1);
    }

    // 10. Verify OthelioBasketAccount rejects zero target
    function testBasketAccountRejectsZeroTarget() public {
        vm.prank(address(module));
        vm.expectRevert("ZERO_TARGET");
        basket.execTransactionFromModule(address(0), 0, "", 0);
    }

    // 11. Verify SafeFactory enforces name bounds
    function testSafeFactoryEnforcesNameBounds() public {
        vm.prank(owner);
        vm.expectRevert("INVALID_NAME");
        factory.createBasket("");

        vm.prank(owner);
        vm.expectRevert("INVALID_NAME");
        factory.registerBasket(basketAddr, owner, "");
    }

    // 12. Verify OthelioBasketGuard blocks decreaseAllowance and permit on tracked tokens
    function testGuardBlocksDecreaseAllowanceAndPermit() public {
        bytes memory decreaseData = abi.encodeWithSignature("decreaseAllowance(address,uint256)", attacker, 100);
        vm.expectRevert("OthelioGuard: Tracked assets must be managed via OthelioBasketModule");
        guard.checkTransaction(
            address(tokenA),
            0,
            decreaseData,
            0,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            attacker
        );

        bytes memory permitData = abi.encodeWithSignature(
            "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
            owner,
            attacker,
            100,
            block.timestamp + 1 hours,
            27,
            bytes32(0),
            bytes32(0)
        );
        vm.expectRevert("OthelioGuard: Tracked assets must be managed via OthelioBasketModule");
        guard.checkTransaction(
            address(tokenA),
            0,
            permitData,
            0,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            attacker
        );
    }

    // 13. Verify borrowAndReinvest target validation in BorrowModule
    function testBorrowModuleRejectsSafeAsTarget() public {
        vm.prank(owner);
        basket.enableModule(address(borrowModule));

        vm.prank(owner);
        registry.setApprovedLendingPool(address(router), true);

        vm.prank(owner);
        vm.expectRevert("CANNOT_TARGET_SAFE");
        borrowModule.borrowAndReinvest(basketAddr, address(router), address(tokenA), 10 * 1e18, basketAddr, hex"1234");
    }
}
