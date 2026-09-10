// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketModule, ISafe} from "../src/safe/OthelioBasketModule.sol";
import {MockV3Aggregator} from "./BasketOracle.t.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockSafe is ISafe {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isOwner(address owner_) external view override returns (bool) {
        return owner_ == owner;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 /* operation */
    )
        external
        override
        returns (bool success)
    {
        (success,) = to.call{value: value}(data);
    }

    function execTransactionFromModuleReturnData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 /* operation */
    )
        external
        override
        returns (bool success, bytes memory returnData)
    {
        (success, returnData) = to.call{value: value}(data);
    }
}

contract NoOpTarget {
    function execute() external {}
}

contract AllowanceObservingRouter {
    uint256 public observedAllowance;

    function swap(address tokenIn, address tokenOut, address safe, uint256 amountIn, uint256 amountOut) external {
        observedAllowance = MockERC20(tokenIn).allowance(safe, address(this));
        MockERC20(tokenIn).transferFrom(safe, address(this), amountIn);
        MockERC20(tokenOut).transfer(safe, amountOut);
    }
}

contract FalseReturnERC20 is ERC20 {
    constructor() ERC20("False", "FALSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}

contract OthelioBasketModuleTest is Test {
    OthelioAssetRegistry public registry;
    BasketOracle public oracle;
    OthelioBasketModule public module;

    MockSafe public safe;
    MockDEXRouter public dexRouter;

    MockERC20 public tokenNVDA;
    MockERC20 public tokenGOOG;
    MockV3Aggregator public feedNVDA;
    MockV3Aggregator public feedGOOG;

    address public owner = address(0x111);
    address public recipient = address(0x222);

    function setUp() public {
        registry = new OthelioAssetRegistry(owner, address(0));
        oracle = new BasketOracle(address(registry));
        module = new OthelioBasketModule(address(oracle));
        safe = new MockSafe(owner);
        dexRouter = new MockDEXRouter();

        tokenNVDA = new MockERC20("NVIDIA", "NVDAc");
        tokenGOOG = new MockERC20("Alphabet", "GOOGc");

        feedNVDA = new MockV3Aggregator(8, 100 * 1e8); // $100
        feedGOOG = new MockV3Aggregator(8, 150 * 1e8); // $150

        vm.startPrank(owner);
        registry.configure(block.chainid, address(tokenNVDA), address(feedNVDA), true, 18, 8, true);
        registry.configure(block.chainid, address(tokenGOOG), address(feedGOOG), true, 18, 8, true);
        vm.stopPrank();

        // Seed initial balances to Safe
        tokenNVDA.mint(address(safe), 10 * 1e18); // 10 NVDA ($1000)
        tokenGOOG.mint(address(safe), 0);
        // Strict router outputs must be funded; module tests intentionally begin with no Safe allowance.
        tokenGOOG.mint(address(dexRouter), 10 * 1e18);
    }

    function testRebalancePrePostDeltaAccounting() public {
        address[] memory soldAssets = new address[](1);
        soldAssets[0] = address(tokenNVDA);

        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenGOOG);

        uint256[] memory minBought = new uint256[](1);
        minBought[0] = 1.9 * 1e18; // min 1.9 GOOG

        // Simulate swap calldata: Sell 3 NVDA ($300) to Buy 1.95 GOOG ($292.50 after fee/slippage)
        bytes memory dexCalldata = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenNVDA),
            address(tokenGOOG),
            address(safe),
            3 * 1e18,
            1.95 * 1e18
        );

        address[] memory basketTokens = new address[](2);
        basketTokens[0] = address(tokenNVDA);
        basketTokens[1] = address(tokenGOOG);

        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](1);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 3 * 1e18,
            dexCalldata: dexCalldata
        });

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: legs,
            soldAssets: soldAssets,
            maxSoldAmounts: _singleAmount(3 * 1e18),
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
            deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256[] memory soldAmounts, uint256[] memory boughtAmounts, uint256 totalNAV) = module.rebalance(params);

        assertEq(soldAmounts[0], 3 * 1e18);
        assertEq(boughtAmounts[0], 1.95 * 1e18);
        // NAV = 7 NVDA ($700) + 1.95 GOOG ($292.50) = $992.50 = 992500000 (6 decimals)
        assertEq(totalNAV, 992500000);
        assertEq(tokenNVDA.allowance(address(safe), address(dexRouter)), 0);
    }

    function testRebalanceUsesExactTemporaryAllowanceFromZero() public {
        AllowanceObservingRouter observingRouter = new AllowanceObservingRouter();
        tokenGOOG.mint(address(observingRouter), 1 ether);
        assertEq(tokenNVDA.allowance(address(safe), address(observingRouter)), 0);

        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](1);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: address(observingRouter),
            allowanceSpender: address(observingRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 3 ether,
            dexCalldata: abi.encodeWithSignature(
                "swap(address,address,address,uint256,uint256)",
                address(tokenNVDA), address(tokenGOOG), address(safe), 2 ether, 1 ether
            )
        });

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: legs,
            soldAssets: _singleAddress(address(tokenNVDA)),
            maxSoldAmounts: _singleAmount(3 ether),
            boughtAssets: _singleAddress(address(tokenGOOG)),
            minBoughtAmounts: _singleAmount(1 ether),
            basketTokens: new address[](0),
            deadline: block.timestamp
        });

        vm.prank(owner);
        module.rebalance(params);

        assertEq(observingRouter.observedAllowance(), 3 ether);
        assertEq(tokenNVDA.allowance(address(safe), address(observingRouter)), 0);
        assertEq(tokenNVDA.balanceOf(address(safe)), 8 ether);
    }

    function testRebalanceFailureLeavesNoAllowanceFromZero() public {
        MockDEXRouter unfundedRouter = new MockDEXRouter();
        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](1);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: address(unfundedRouter),
            allowanceSpender: address(unfundedRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 2 ether,
            dexCalldata: abi.encodeWithSignature(
                "swap(address,address,address,uint256,uint256)",
                address(tokenNVDA), address(tokenGOOG), address(safe), 2 ether, 1 ether
            )
        });

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: legs,
            soldAssets: _singleAddress(address(tokenNVDA)),
            maxSoldAmounts: _singleAmount(2 ether),
            boughtAssets: _singleAddress(address(tokenGOOG)),
            minBoughtAmounts: _singleAmount(1 ether),
            basketTokens: new address[](0),
            deadline: block.timestamp
        });

        vm.prank(owner);
        vm.expectRevert("DEX_SWAP_FAILED");
        module.rebalance(params);

        assertEq(tokenNVDA.allowance(address(safe), address(unfundedRouter)), 0);
        assertEq(tokenNVDA.balanceOf(address(safe)), 10 ether);
    }

    function testRebalanceRejectsAggregateLegInputAboveDeclaredSellLimit() public {
        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](2);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 2 ether,
            dexCalldata: abi.encodeWithSignature(
                "swap(address,address,address,uint256,uint256)",
                address(tokenNVDA), address(tokenGOOG), address(safe), 2 ether, 1 ether
            )
        });
        legs[1] = OthelioBasketModule.RebalanceLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 2 ether,
            dexCalldata: abi.encodeWithSignature(
                "swap(address,address,address,uint256,uint256)",
                address(tokenNVDA), address(tokenGOOG), address(safe), 2 ether, 1 ether
            )
        });

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: legs,
            soldAssets: _singleAddress(address(tokenNVDA)),
            maxSoldAmounts: _singleAmount(3 ether),
            boughtAssets: _singleAddress(address(tokenGOOG)),
            minBoughtAmounts: _singleAmount(1 ether),
            basketTokens: new address[](0),
            deadline: block.timestamp
        });

        vm.prank(owner);
        vm.expectRevert("LEG_INPUT_EXCEEDS_TOTAL");
        module.rebalance(params);
        assertEq(tokenNVDA.allowance(address(safe), address(dexRouter)), 0);
    }

    function testWithdrawInKind() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tokenNVDA);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2 * 1e18;

        address[] memory remainingTokens = new address[](1);
        remainingTokens[0] = address(tokenNVDA);

        vm.prank(owner);
        uint256 remainingNAV = module.withdrawInKind(address(safe), recipient, tokens, amounts, remainingTokens);

        assertEq(tokenNVDA.balanceOf(recipient), 2 * 1e18);
        assertEq(tokenNVDA.balanceOf(address(safe)), 8 * 1e18);
        assertEq(remainingNAV, 800 * 1e6); // 8 NVDA * $100 = $800
    }

    function testFundWithSwaps() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 500 * 1e18); // $500 USDC held by owner caller

        vm.prank(owner);
        tokenUSDC.approve(address(module), type(uint256).max);

        tokenUSDC.mint(address(safe), 500 * 1e18); // $500 USDC in Safe for DEX swap

        vm.prank(address(safe));
        tokenUSDC.approve(address(dexRouter), type(uint256).max);

        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenGOOG);

        uint256[] memory minBought = new uint256[](1);
        minBought[0] = 3.2 * 1e18; // min 3.2 GOOG ($480)

        bytes memory dexCalldata = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenUSDC),
            address(tokenGOOG),
            address(safe),
            500 * 1e18,
            3.3 * 1e18 // 3.3 GOOG ($495 value)
        );

        address[] memory basketTokens = new address[](2);
        basketTokens[0] = address(tokenNVDA);
        basketTokens[1] = address(tokenGOOG);

        OthelioBasketModule.SwapLeg[] memory legs = new OthelioBasketModule.SwapLeg[](1);
        legs[0] = OthelioBasketModule.SwapLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            inputAmount: 500 * 1e18,
            dexCalldata: dexCalldata
        });

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 500 * 1e18,
            legs: legs,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
        deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256[] memory boughtAmounts, uint256 totalNAV) = module.fundWithSwaps(params);

        assertEq(boughtAmounts[0], 3.3 * 1e18);
        // NAV = 10 NVDA ($1000) + 3.3 GOOG ($495) = $1495 = 1495000000 (6 decimals)
        assertEq(totalNAV, 1495000000);
        assertEq(tokenUSDC.allowance(address(safe), address(dexRouter)), 0);
    }

    function testNoSwapFundingReportsDepositDeltaAndChecksMinimum() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 200 * 1e18);
        tokenUSDC.mint(address(safe), 75 * 1e18);

        vm.prank(owner);
        tokenUSDC.approve(address(module), type(uint256).max);

        address[] memory assets = new address[](1);
        assets[0] = address(tokenUSDC);
        uint256[] memory minimums = _singleAmount(200 * 1e18);

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 200 * 1e18,
            legs: new OthelioBasketModule.SwapLeg[](0),
            boughtAssets: assets,
            minBoughtAmounts: minimums,
            basketTokens: new address[](0),
        deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256[] memory acquired,) = module.fundWithSwaps(params);

        assertEq(acquired[0], 200 * 1e18);
        assertEq(tokenUSDC.balanceOf(address(safe)), 275 * 1e18);
    }

    function testNoSwapFundingRevertsBelowMinimum() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 200 * 1e18);
        vm.prank(owner);
        tokenUSDC.approve(address(module), type(uint256).max);

        address[] memory assets = new address[](1);
        assets[0] = address(tokenUSDC);
        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 200 * 1e18,
            legs: new OthelioBasketModule.SwapLeg[](0),
            boughtAssets: assets,
            minBoughtAmounts: _singleAmount(201 * 1e18),
            basketTokens: new address[](0),
        deadline: block.timestamp
        });

        vm.prank(owner);
        vm.expectRevert("SLIPPAGE_EXCEEDED");
        module.fundWithSwaps(params);
        assertEq(tokenUSDC.balanceOf(owner), 200 * 1e18);
        assertEq(tokenUSDC.balanceOf(address(safe)), 0);
    }

    function testFundingCanRetainListedInputAssetDuringSwap() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 500 * 1e18);
        tokenUSDC.mint(address(safe), 50 * 1e18);

        vm.prank(owner);
        tokenUSDC.approve(address(module), type(uint256).max);
        vm.prank(address(safe));
        tokenUSDC.approve(address(dexRouter), type(uint256).max);

        address[] memory assets = new address[](2);
        assets[0] = address(tokenUSDC);
        assets[1] = address(tokenGOOG);
        uint256[] memory minimums = new uint256[](2);
        minimums[0] = 100 * 1e18;
        minimums[1] = 2 * 1e18;

        bytes memory dexCalldata = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenUSDC),
            address(tokenGOOG),
            address(safe),
            400 * 1e18,
            2 * 1e18
        );

        OthelioBasketModule.SwapLeg[] memory legs = new OthelioBasketModule.SwapLeg[](1);
        legs[0] = OthelioBasketModule.SwapLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            inputAmount: 500 * 1e18,
            dexCalldata: dexCalldata
        });

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 500 * 1e18,
            legs: legs,
            boughtAssets: assets,
            minBoughtAmounts: minimums,
            basketTokens: new address[](0),
        deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256[] memory acquired,) = module.fundWithSwaps(params);

        assertEq(acquired[0], 100 * 1e18);
        assertEq(acquired[1], 2 * 1e18);
    }

    function testCreateAndSeedBasket() public {
        OthelioSafeFactory factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));
        bytes32 clientSalt = bytes32(uint256(1));
        address predictedBasket = factory.predictBasketAddress(owner, clientSalt);

        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 1000 * 1e18);

        MockV3Aggregator feedUSDC = new MockV3Aggregator(8, 1 * 1e8);
        vm.prank(owner);
        registry.configure(block.chainid, address(tokenUSDC), address(feedUSDC), true, 18, 8, false);

        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenGOOG);
        uint256[] memory minBought = new uint256[](1);
        minBought[0] = 3.3 * 1e18;

        address[] memory basketTokens = new address[](1);
        basketTokens[0] = address(tokenGOOG);

        OthelioBasketModule.SwapLeg[] memory legs = new OthelioBasketModule.SwapLeg[](1);
        legs[0] = OthelioBasketModule.SwapLeg({
            target: address(dexRouter), allowanceSpender: address(dexRouter), inputAmount: 500 * 1e18,
            dexCalldata: abi.encodeWithSignature(
                "swap(address,address,address,uint256,uint256)", address(tokenUSDC), address(tokenGOOG),
                predictedBasket, 500 * 1e18, 3.3 * 1e18
            )
        });

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(0),
            inputAsset: address(tokenUSDC),
            inputAmount: 500 * 1e18,
            legs: legs,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
        deadline: block.timestamp
        });

        vm.startPrank(owner);
        tokenUSDC.approve(address(module), 500 * 1e18);
        OthelioSafeFactory.CreateAndSeedParams memory createParams = OthelioSafeFactory.CreateAndSeedParams({
            clientSalt: clientSalt, mint: params
        });
        (address basket,, uint256 totalNAV) = factory.createAndSeedBasket("Tech Basket", createParams);
        vm.stopPrank();

        assertTrue(basket != address(0));
        assertEq(tokenGOOG.balanceOf(basket), 3.3 * 1e18);
        assertTrue(factory.isOthelioBasket(basket));
        assertEq(totalNAV, 495 * 1e6);
    }

    function testWithdrawWithSwaps() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(address(dexRouter), 500 * 1e18);

        vm.prank(address(safe));
        tokenNVDA.approve(address(dexRouter), type(uint256).max);

        address[] memory soldAssets = new address[](1);
        soldAssets[0] = address(tokenNVDA);

        address[] memory remainingTokens = new address[](1);
        remainingTokens[0] = address(tokenNVDA);

        bytes memory dexCalldata = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenNVDA),
            address(tokenUSDC),
            address(safe),
            5 * 1e18,
            500 * 1e18
        );

        OthelioBasketModule.WithdrawWithSwapsParams memory params = OthelioBasketModule.WithdrawWithSwapsParams({
            safe: address(safe),
            recipient: recipient,
            outAsset: address(tokenUSDC),
            minOutAssetAmount: 500 * 1e18,
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            dexCalldata: dexCalldata,
            soldAssets: soldAssets,
            maxSoldAmounts: _singleAmount(5 * 1e18),
            remainingTokens: remainingTokens,
            deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256 outAmount, uint256 remainingNAV) = module.withdrawWithSwaps(params);

        assertEq(outAmount, 500 * 1e18);
        assertEq(tokenUSDC.balanceOf(recipient), 500 * 1e18);
        assertEq(remainingNAV, 500 * 1e6);
        assertEq(tokenNVDA.allowance(address(safe), address(dexRouter)), 0);
    }

    function testWithdrawDoesNotSweepPreexistingOutputOnZeroOutputCall() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(address(safe), 500 * 1e18);
        NoOpTarget target = new NoOpTarget();

        OthelioBasketModule.WithdrawWithSwapsParams memory params = OthelioBasketModule.WithdrawWithSwapsParams({
            safe: address(safe),
            recipient: recipient,
            outAsset: address(tokenUSDC),
            minOutAssetAmount: 1,
            target: address(target),
            allowanceSpender: address(target),
            dexCalldata: abi.encodeCall(NoOpTarget.execute, ()),
            soldAssets: new address[](0),
            maxSoldAmounts: new uint256[](0),
            remainingTokens: new address[](0),
            deadline: block.timestamp
        });

        vm.prank(owner);
        vm.expectRevert("SLIPPAGE_EXCEEDED");
        module.withdrawWithSwaps(params);

        assertEq(tokenUSDC.balanceOf(address(safe)), 500 * 1e18);
        assertEq(tokenUSDC.balanceOf(recipient), 0);
    }

    function testRebalanceRejectsExcessiveInputSpend() public {
        address[] memory soldAssets = new address[](1);
        soldAssets[0] = address(tokenNVDA);
        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenGOOG);

        bytes memory dexCalldata = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenNVDA),
            address(tokenGOOG),
            address(safe),
            3 * 1e18,
            2 * 1e18
        );

        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](1);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 2 * 1e18,
            dexCalldata: dexCalldata
        });

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: legs,
            soldAssets: soldAssets,
            maxSoldAmounts: _singleAmount(2 * 1e18),
            boughtAssets: boughtAssets,
            minBoughtAmounts: _singleAmount(1 * 1e18),
            basketTokens: new address[](0),
            deadline: block.timestamp
        });

        vm.prank(owner);
        vm.expectRevert("DEX_SWAP_FAILED");
        module.rebalance(params);

        assertEq(tokenNVDA.balanceOf(address(safe)), 10 * 1e18);
    }

    function testRebalanceRejectsExpiredAndInvalidRoutes() public {
        vm.warp(100);
        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: new OthelioBasketModule.RebalanceLeg[](0),
            soldAssets: new address[](0),
            maxSoldAmounts: new uint256[](0),
            boughtAssets: new address[](0),
            minBoughtAmounts: new uint256[](0),
            basketTokens: new address[](0),
            deadline: 99
        });

        vm.prank(owner);
        vm.expectRevert("QUOTE_EXPIRED");
        module.rebalance(params);

        params.deadline = block.timestamp;
        vm.prank(owner);
        vm.expectRevert("INVALID_REBALANCE_LEGS");
        module.rebalance(params);
    }

    function testFalseReturnTokenTransferReverts() public {
        FalseReturnERC20 token = new FalseReturnERC20();
        token.mint(address(safe), 10 ether);
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        vm.prank(owner);
        vm.expectRevert("TRANSFER_FAILED");
        module.withdrawInKind(address(safe), recipient, tokens, _singleAmount(1 ether), new address[](0));

        assertEq(token.balanceOf(address(safe)), 10 ether);
        assertEq(token.balanceOf(recipient), 0);
    }

    function testRevertNonOwnerFundWithSwaps() public {
        address stranger = address(0x999);
        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenGOOG);
        uint256[] memory minBought = new uint256[](1);
        minBought[0] = 1;
        address[] memory basketTokens = new address[](1);
        basketTokens[0] = address(tokenGOOG);

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(0),
            inputAmount: 0,
            legs: new OthelioBasketModule.SwapLeg[](0),
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
        deadline: block.timestamp
        });

        vm.prank(stranger);
        vm.expectRevert("NOT_SAFE_OWNER");
        module.fundWithSwaps(params);
    }

    function testRevertSlippageExceeded() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 500 * 1e18);
        vm.prank(owner);
        tokenUSDC.approve(address(module), 500 * 1e18);

        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenGOOG);

        uint256[] memory minBought = new uint256[](1);
        minBought[0] = 10 * 1e18; // Request 10 GOOG minimum, but swap only yields 3.3 GOOG

        bytes memory dexCalldata = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenUSDC),
            address(tokenGOOG),
            address(safe),
            500 * 1e18,
            3.3 * 1e18
        );

        address[] memory basketTokens = new address[](2);
        basketTokens[0] = address(tokenNVDA);
        basketTokens[1] = address(tokenGOOG);

        OthelioBasketModule.SwapLeg[] memory legs = new OthelioBasketModule.SwapLeg[](1);
        legs[0] = OthelioBasketModule.SwapLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            inputAmount: 500 * 1e18,
            dexCalldata: dexCalldata
        });

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 500 * 1e18,
            legs: legs,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
        deadline: block.timestamp
        });

        vm.prank(owner);
        vm.expectRevert("SLIPPAGE_EXCEEDED");
        module.fundWithSwaps(params);
    }

    function testRevertFactoryAlreadySet() public {
        OthelioSafeFactory factory1 = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory1));

        OthelioSafeFactory factory2 = new OthelioSafeFactory(address(module), address(registry));
        vm.expectRevert("FACTORY_ALREADY_SET");
        module.setFactory(address(factory2));
    }

    function testOnlyModuleDeployerCanInitializeFactory() public {
        OthelioSafeFactory factory = new OthelioSafeFactory(address(module), address(registry));

        vm.prank(address(0xBAD));
        vm.expectRevert("NOT_FACTORY_SETTER");
        module.setFactory(address(factory));

        module.setFactory(address(factory));
        assertEq(module.factory(), address(factory));
    }

    function testRevertZeroRecipientWithdraw() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tokenNVDA);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 * 1e18;
        address[] memory remaining = new address[](1);
        remaining[0] = address(tokenNVDA);

        vm.prank(owner);
        vm.expectRevert("ZERO_RECIPIENT");
        module.withdrawInKind(address(safe), address(0), tokens, amounts, remaining);
    }

    function testFundWithMultiLegSwaps() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(owner, 1000 * 1e18);
        tokenNVDA.mint(address(dexRouter), 10 * 1e18);
        tokenGOOG.mint(address(dexRouter), 10 * 1e18);

        vm.prank(owner);
        tokenUSDC.approve(address(module), 1000 * 1e18);

        bytes memory calldata0 = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenUSDC),
            address(tokenNVDA),
            address(safe),
            500 * 1e18,
            5 * 1e18
        );

        bytes memory calldata1 = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenUSDC),
            address(tokenGOOG),
            address(safe),
            500 * 1e18,
            3.3 * 1e18
        );

        OthelioBasketModule.SwapLeg[] memory legs = new OthelioBasketModule.SwapLeg[](2);
        legs[0] = OthelioBasketModule.SwapLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            inputAmount: 500 * 1e18,
            dexCalldata: calldata0
        });
        legs[1] = OthelioBasketModule.SwapLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            inputAmount: 500 * 1e18,
            dexCalldata: calldata1
        });

        address[] memory boughtAssets = new address[](2);
        boughtAssets[0] = address(tokenNVDA);
        boughtAssets[1] = address(tokenGOOG);

        uint256[] memory minBought = new uint256[](2);
        minBought[0] = 5 * 1e18;
        minBought[1] = 3.3 * 1e18;

        address[] memory basketTokens = new address[](2);
        basketTokens[0] = address(tokenNVDA);
        basketTokens[1] = address(tokenGOOG);

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 1000 * 1e18,
            legs: legs,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens,
        deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256[] memory acquired,) = module.fundWithSwaps(params);

        assertEq(acquired[0], 5 * 1e18);
        assertEq(acquired[1], 3.3 * 1e18);
        assertEq(tokenNVDA.balanceOf(address(safe)), 15 * 1e18); // 10 initial + 5 bought
        assertEq(tokenGOOG.balanceOf(address(safe)), 3.3 * 1e18);
    }

    function testRebalanceWithMultiLegSwaps() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(address(dexRouter), 600 * 1e18);
        tokenGOOG.mint(address(safe), 10 * 1e18);

        MockV3Aggregator feedUSDC = new MockV3Aggregator(8, 1 * 1e8);
        vm.prank(owner);
        registry.configure(block.chainid, address(tokenUSDC), address(feedUSDC), true, 18, 8, false);

        bytes memory calldata0 = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenNVDA),
            address(tokenUSDC),
            address(safe),
            3 * 1e18,
            300 * 1e18
        );

        bytes memory calldata1 = abi.encodeWithSignature(
            "swap(address,address,address,uint256,uint256)",
            address(tokenGOOG),
            address(tokenUSDC),
            address(safe),
            2 * 1e18,
            300 * 1e18
        );

        OthelioBasketModule.RebalanceLeg[] memory legs = new OthelioBasketModule.RebalanceLeg[](2);
        legs[0] = OthelioBasketModule.RebalanceLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            soldAsset: address(tokenNVDA),
            maxSoldAmount: 3 * 1e18,
            dexCalldata: calldata0
        });
        legs[1] = OthelioBasketModule.RebalanceLeg({
            target: address(dexRouter),
            allowanceSpender: address(dexRouter),
            soldAsset: address(tokenGOOG),
            maxSoldAmount: 2 * 1e18,
            dexCalldata: calldata1
        });

        address[] memory soldAssets = new address[](2);
        soldAssets[0] = address(tokenNVDA);
        soldAssets[1] = address(tokenGOOG);

        uint256[] memory maxSoldAmounts = new uint256[](2);
        maxSoldAmounts[0] = 3 * 1e18;
        maxSoldAmounts[1] = 2 * 1e18;

        address[] memory boughtAssets = new address[](1);
        boughtAssets[0] = address(tokenUSDC);

        uint256[] memory minBoughtAmounts = new uint256[](1);
        minBoughtAmounts[0] = 600 * 1e18;

        address[] memory basketTokens = new address[](3);
        basketTokens[0] = address(tokenNVDA);
        basketTokens[1] = address(tokenGOOG);
        basketTokens[2] = address(tokenUSDC);

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            legs: legs,
            soldAssets: soldAssets,
            maxSoldAmounts: maxSoldAmounts,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBoughtAmounts,
            basketTokens: basketTokens,
            deadline: block.timestamp
        });

        vm.prank(owner);
        (uint256[] memory soldAmounts, uint256[] memory boughtAmounts,) = module.rebalance(params);

        assertEq(soldAmounts[0], 3 * 1e18);
        assertEq(soldAmounts[1], 2 * 1e18);
        assertEq(boughtAmounts[0], 600 * 1e18);
        assertEq(tokenNVDA.balanceOf(address(safe)), 7 * 1e18);
        assertEq(tokenUSDC.balanceOf(address(safe)), 600 * 1e18);
    }

    function _singleAmount(uint256 amount) private pure returns (uint256[] memory values) {
        values = new uint256[](1);
        values[0] = amount;
    }

    function _singleAddress(address asset) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = asset;
    }
}
