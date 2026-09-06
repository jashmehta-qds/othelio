// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketModule, ISafe} from "../src/safe/OthelioBasketModule.sol";
import {MockV3Aggregator} from "./BasketOracle.t.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockSafe is ISafe {
    address public owner;

    constructor(address owner_) { owner = owner_; }

    function isOwner(address owner_) external view override returns (bool) {
        return owner_ == owner;
    }

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 /* operation */
    ) external override returns (bool success) {
        (success, ) = to.call{value: value}(data);
    }
}

contract MockDEXRouter {
    function swap(address tokenIn, address tokenOut, address safe, uint256 amountIn, uint256 amountOut) external {
        MockERC20(tokenIn).transferFrom(safe, address(this), amountIn);
        MockERC20(tokenOut).mint(safe, amountOut);
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

        // Approve DEX router from Safe
        vm.prank(address(safe));
        tokenNVDA.approve(address(dexRouter), type(uint256).max);
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

        OthelioBasketModule.RebalanceParams memory params = OthelioBasketModule.RebalanceParams({
            safe: address(safe),
            target: address(dexRouter),
            dexCalldata: dexCalldata,
            soldAssets: soldAssets,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens
        });

        vm.prank(owner);
        (uint256[] memory soldAmounts, uint256[] memory boughtAmounts, uint256 totalNAV) = module.rebalance(params);

        assertEq(soldAmounts[0], 3 * 1e18);
        assertEq(boughtAmounts[0], 1.95 * 1e18);
        // NAV = 7 NVDA ($700) + 1.95 GOOG ($292.50) = $992.50 = 992500000 (6 decimals)
        assertEq(totalNAV, 992500000);
    }

    function testWithdrawInKind() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tokenNVDA);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 2 * 1e18;

        address[] memory remainingTokens = new address[](1);
        remainingTokens[0] = address(tokenNVDA);

        vm.prank(owner);
        uint256 remainingNAV = module.withdrawInKind(
            address(safe),
            recipient,
            tokens,
            amounts,
            remainingTokens
        );

        assertEq(tokenNVDA.balanceOf(recipient), 2 * 1e18);
        assertEq(tokenNVDA.balanceOf(address(safe)), 8 * 1e18);
        assertEq(remainingNAV, 800 * 1e6); // 8 NVDA * $100 = $800
    }

    function testFundWithSwaps() public {
        MockERC20 tokenUSDC = new MockERC20("USD Coin", "USDC");
        tokenUSDC.mint(address(safe), 500 * 1e18); // $500 USDC in Safe
        
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

        OthelioBasketModule.MintParams memory params = OthelioBasketModule.MintParams({
            safe: address(safe),
            inputAsset: address(tokenUSDC),
            inputAmount: 500 * 1e18,
            target: address(dexRouter),
            dexCalldata: dexCalldata,
            boughtAssets: boughtAssets,
            minBoughtAmounts: minBought,
            basketTokens: basketTokens
        });

        vm.prank(owner);
        (uint256[] memory boughtAmounts, uint256 totalNAV) = module.fundWithSwaps(params);

        assertEq(boughtAmounts[0], 3.3 * 1e18);
        // NAV = 10 NVDA ($1000) + 3.3 GOOG ($495) = $1495 = 1495000000 (6 decimals)
        assertEq(totalNAV, 1495000000);
    }
}
