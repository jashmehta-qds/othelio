// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketAccount} from "../src/safe/OthelioBasketAccount.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../src/lending/OthelioAaveV3Adapter.sol";
import {MockAavePool} from "../src/mock/MockAavePool.sol";
import {MockPriceFeed} from "../src/mock/MockPriceFeed.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../src/dex/AerodromeRouteTypes.sol";

contract AaveTestToken is ERC20 {
    constructor() ERC20("Aave test token", "ATST") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockFactory {
    function getPool(address, address, int24) external view returns (address) {
        return address(this);
    }
}

contract OthelioPortfolioModuleTest is Test {
    address private owner = address(0xA11CE);
    OthelioPortfolioModule private portfolio;
    OthelioPortfolioModule private enabledPortfolio;
    OthelioBasketAccount private basket;
    OthelioBasketAccount private enabledBasket;
    OthelioSafeFactory private basketFactory;
    OthelioSafeFactory private enabledBasketFactory;
    OthelioAaveV3Adapter private adapter;
    AaveTestToken private asset;
    AaveTestToken private outputToken;
    MockAavePool private pool;
    OthelioAssetRegistry private registry;
    BasketOracle private oracle;
    OthelioAerodromeRouteRegistry private routeRegistry;
    MockDEXRouter private router;

    function setUp() public {
        vm.startPrank(owner);
        registry = new OthelioAssetRegistry(owner);
        oracle = new BasketOracle(address(registry), address(0));
        pool = new MockAavePool();
        adapter = new OthelioAaveV3Adapter(address(pool));
        router = new MockDEXRouter();
        MockFactory factory = new MockFactory();
        routeRegistry = new OthelioAerodromeRouteRegistry(owner, address(factory));

        asset = new AaveTestToken();
        outputToken = new AaveTestToken();

        OthelioAerodromeSlipstreamAdapter dexAdapter = new OthelioAerodromeSlipstreamAdapter(
            address(router),
            address(asset),
            address(routeRegistry)
        );
        portfolio = new OthelioPortfolioModule(address(oracle), address(adapter), address(dexAdapter), false, 1.25e18);
        enabledPortfolio = new OthelioPortfolioModule(address(oracle), address(adapter), address(dexAdapter), true, 1.25e18);
        basketFactory = new OthelioSafeFactory(address(portfolio), address(registry));
        enabledBasketFactory = new OthelioSafeFactory(address(enabledPortfolio), address(registry));
        portfolio.setFactory(address(basketFactory));
        enabledPortfolio.setFactory(address(enabledBasketFactory));
        basket = OthelioBasketAccount(payable(basketFactory.createBasket("Test basket")));
        enabledBasket = OthelioBasketAccount(payable(enabledBasketFactory.createBasket("Enabled test basket")));

        pool.configureReserve(address(asset), 18, 1e8);
        registry.configure(block.chainid, address(asset), address(new MockPriceFeed(1e8)), true, 18, 8, false);
        registry.configure(block.chainid, address(outputToken), address(new MockPriceFeed(1e8)), true, 18, 8, false);

        routeRegistry.setPoolApproval(block.chainid, address(asset), address(outputToken), 100, address(factory), true);
        vm.stopPrank();
    }

    function testOnlyPortfolioModuleHasAccountAuthority() public view {
        assertTrue(basket.isModuleEnabled(address(portfolio)));
        assertFalse(basket.isModuleEnabled(address(adapter)));
    }

    function testNewAaveSupplyIsDisabledByDeploymentPolicy() public {
        vm.prank(owner);
        vm.expectRevert("NEW_AAVE_SUPPLY_DISABLED");
        portfolio.supplyAave(address(basket), address(asset), 1 ether);
    }

    function testPortfolioHasNoGenericLendingEntryPoint() public {
        bytes4 generic = bytes4(keccak256("executeLending(address,address,bytes,address,uint256)"));
        (bool success,) = address(portfolio).call(abi.encodeWithSelector(generic, address(basket), address(adapter), bytes(""), address(0), 0));
        assertFalse(success);
    }

    function testCachedPoolDoesNotCallGetterDuringAaveLifecycle() public {
        vm.mockCallRevert(address(adapter), abi.encodeWithSignature("pool()"), "");
        testEnabledAaveLifecycleSuppliesAndWithdrawsToBasketOnly();
    }

    function testEnabledAaveLifecycleSuppliesAndWithdrawsToBasketOnly() public {
        asset.mint(address(enabledBasket), 10 ether);

        vm.prank(owner);
        enabledPortfolio.supplyAave(address(enabledBasket), address(asset), 10 ether);
        assertEq(pool.userSupplied(address(asset), address(enabledBasket)), 10 ether);
        assertEq(asset.balanceOf(address(enabledBasket)), 0);

        vm.prank(owner);
        uint256 withdrawn = enabledPortfolio.withdrawAaveCollateral(address(enabledBasket), address(asset), 4 ether, 1.25e18);
        assertEq(withdrawn, 4 ether);
        assertEq(asset.balanceOf(address(enabledBasket)), 4 ether);
        assertEq(pool.userSupplied(address(asset), address(enabledBasket)), 6 ether);
    }

    function testWalletRepayClearsExistingDebtAndRefundsUnusedAmount() public {
        asset.mint(address(enabledBasket), 10 ether);
        vm.prank(owner);
        enabledPortfolio.supplyAave(address(enabledBasket), address(asset), 10 ether);
        pool.accrueDebt(address(asset), address(enabledBasket), 3 ether);
        asset.mint(owner, 5 ether);

        vm.startPrank(owner);
        asset.approve(address(enabledPortfolio), 5 ether);
        uint256 repaid = enabledPortfolio.repayAaveFromWallet(address(enabledBasket), address(asset), 5 ether);
        vm.stopPrank();

        assertEq(repaid, 3 ether);
        assertEq(pool.userBorrowed(address(asset), address(enabledBasket)), 0);
        assertEq(asset.balanceOf(owner), 2 ether);
    }

    function testTypedAerodromePortfolioFundingPullsExactInputAndPaysBasket() public {
        asset.mint(owner, 10 ether);
        outputToken.mint(address(router), 10 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: address(asset),
            tokenOut: address(outputToken),
            firstTickSpacing: 100,
            secondTickSpacing: 0,
            amountIn: 10 ether,
            minimumAmountOut: 9.9 ether
        });

        vm.startPrank(owner);
        asset.approve(address(portfolio), 10 ether);
        portfolio.fundAerodromePortfolio(
            address(basket), address(asset), 10 ether, routes, block.timestamp + 1
        );
        vm.stopPrank();

        assertEq(outputToken.balanceOf(address(basket)), 9.9 ether);
        assertEq(asset.allowance(address(basket), portfolio.aerodromeAdapter().router()), 0);
    }

    function testInKindWithdrawalAcceptsRegistryApprovedNoBytecodeB20Address() public {
        // B20 stocks are native Base precompiles, which deliberately report no EVM bytecode.
        address nativeB20 = 0xB200000000000000000000000000000000000000;
        assertEq(nativeB20.code.length, 0);
        MockPriceFeed nativeB20Feed = new MockPriceFeed(1e8);

        vm.prank(owner);
        registry.configure(block.chainid, nativeB20, address(nativeB20Feed), true, 18, 8, true);

        vm.mockCall(nativeB20, abi.encodeWithSelector(IERC20.transfer.selector, owner, 1 ether), abi.encode(true));

        address[] memory tokens = new address[](1);
        tokens[0] = nativeB20;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;
        address[] memory remainingTokens = new address[](0);

        vm.prank(owner);
        uint256 remainingNAV = portfolio.withdrawInKind(
            address(basket), owner, tokens, amounts, remainingTokens
        );

        assertEq(remainingNAV, 0);
    }
}
