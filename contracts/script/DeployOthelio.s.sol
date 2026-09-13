// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../src/lending/OthelioAaveV3Adapter.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry, IAerodromeSlipstreamFactory} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";
import {MockDEXRouter} from "../src/dex/MockDEXRouter.sol";
import {MockAavePool} from "../src/mock/MockAavePool.sol";
import {MockPriceFeed} from "../src/mock/MockPriceFeed.sol";

contract DeployMockERC20 is ERC20 {
    constructor() ERC20("Mock Stock Asset", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract MockAerodromeFactory {
    function getPool(address, address, int24) external view returns (address) {
        return address(this);
    }
}

contract DeployOthelio is Script {
    function run()
        external
        returns (
            address registryAddr,
            address oracleAddr,
            address moduleAddr,
            address factoryAddr,
            address dexRouterAddr,
            address aaveAdapterAddr
        )
    {
        return _run(vm.envOr("OTHELIO_INSTALL_LOCAL_MOCKS", false));
    }

    function runWithLocalMocks(bool installLocalMocks)
        external
        returns (
            address registryAddr,
            address oracleAddr,
            address moduleAddr,
            address factoryAddr,
            address dexRouterAddr,
            address aaveAdapterAddr
        )
    {
        return _run(installLocalMocks);
    }

    function _run(bool installLocalMocks)
        internal
        returns (
            address registryAddr,
            address oracleAddr,
            address moduleAddr,
            address factoryAddr,
            address dexRouterAddr,
            address aaveAdapterAddr
        )
    {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        address coinbaseRegistry =
            vm.envOr("COINBASE_REGISTRY_ADDRESS", TokenizedAssetConstants.COINBASE_ONCHAIN_REGISTRY);

        // 1. Deploy Hybrid Asset Registry
        OthelioAssetRegistry registry = new OthelioAssetRegistry(deployer, coinbaseRegistry);
        registryAddr = address(registry);

        // 2. Deploy Basket Oracle
        BasketOracle oracle = new BasketOracle(registryAddr);
        oracleAddr = address(oracle);

        if (installLocalMocks) {
            require(block.chainid == 31337, "LOCAL_MOCKS_REQUIRE_31337");
            dexRouterAddr = 0xBD606f1dAE0285D55113eFC11501677B2221A4dd;
            vm.etch(dexRouterAddr, type(MockDEXRouter).runtimeCode);
        }

        // 3. Deploy Route Registry
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(deployer);

        // 4. Deploy Adapters and Portfolio Module
        address aavePoolAddr = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(aavePoolAddr);
        aaveAdapterAddr = address(aaveAdapter);
        address aerodromeSlipstreamRouter = installLocalMocks ? dexRouterAddr : 0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5;
        if (aerodromeSlipstreamRouter.code.length == 0) {
            vm.etch(aerodromeSlipstreamRouter, type(MockDEXRouter).runtimeCode);
        }
        address usdcAddress = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

        OthelioAerodromeSlipstreamAdapter aerodromeAdapter = new OthelioAerodromeSlipstreamAdapter(
            aerodromeSlipstreamRouter,
            usdcAddress,
            address(routeRegistry)
        );

        OthelioPortfolioModule module = new OthelioPortfolioModule(
            oracleAddr,
            aaveAdapterAddr,
            address(aerodromeAdapter),
            false,
            1.25e18
        );
        moduleAddr = address(module);

        // 5. Deploy Othelio Safe Factory
        OthelioSafeFactory factory = new OthelioSafeFactory(moduleAddr, registryAddr);
        factoryAddr = address(factory);

        // 6. Connect Factory to Module
        module.setFactory(factoryAddr);

        // 7. Configure Route Registry Pool Approvals across candidate factories
        address[] memory candidateFactories;
        if (installLocalMocks) {
            address extraMock = vm.envOr("ADDITIONAL_AERODROME_FACTORY", address(0));
            if (extraMock != address(0)) {
                candidateFactories = new address[](2);
                candidateFactories[0] = address(new MockAerodromeFactory());
                candidateFactories[1] = extraMock;
            } else {
                candidateFactories = new address[](1);
                candidateFactories[0] = address(new MockAerodromeFactory());
            }
        } else {
            address extraFactory = vm.envOr("ADDITIONAL_AERODROME_FACTORY", address(0));
            if (extraFactory != address(0) && extraFactory != 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A) {
                candidateFactories = new address[](2);
                candidateFactories[0] = 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A;
                candidateFactories[1] = extraFactory;
            } else {
                candidateFactories = new address[](1);
                candidateFactories[0] = 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A;
            }
        }

        // 8. Batch Configure Coinbase B20 Tokens and Chainlink Price Feeds
        address[] memory tokens = new address[](13);
        address[] memory priceFeeds = new address[](13);
        bool[] memory supporteds = new bool[](13);
        uint8[] memory tokenDecimals = new uint8[](13);
        uint8[] memory feedDecimals = new uint8[](13);
        bool[] memory isCoinbaseB20s = new bool[](13);

        tokens[0] = TokenizedAssetConstants.AAPLc;
        priceFeeds[0] = TokenizedAssetConstants.FEED_AAPL;
        tokens[1] = TokenizedAssetConstants.AMZNc;
        priceFeeds[1] = TokenizedAssetConstants.FEED_AMZN;
        tokens[2] = TokenizedAssetConstants.COINc;
        priceFeeds[2] = TokenizedAssetConstants.FEED_COIN;
        tokens[3] = TokenizedAssetConstants.CRCLc;
        priceFeeds[3] = TokenizedAssetConstants.FEED_CRCL;
        tokens[4] = TokenizedAssetConstants.GOOGLc;
        priceFeeds[4] = TokenizedAssetConstants.FEED_GOOGL;
        tokens[5] = TokenizedAssetConstants.INTCc;
        priceFeeds[5] = TokenizedAssetConstants.FEED_INTC;
        tokens[6] = TokenizedAssetConstants.METAc;
        priceFeeds[6] = TokenizedAssetConstants.FEED_META;
        tokens[7] = TokenizedAssetConstants.MSFTc;
        priceFeeds[7] = TokenizedAssetConstants.FEED_MSFT;
        tokens[8] = TokenizedAssetConstants.MSTRc;
        priceFeeds[8] = TokenizedAssetConstants.FEED_MSTR;
        tokens[9] = TokenizedAssetConstants.NVDAc;
        priceFeeds[9] = TokenizedAssetConstants.FEED_NVDA;
        tokens[10] = TokenizedAssetConstants.SNDKc;
        priceFeeds[10] = TokenizedAssetConstants.FEED_SNDK;
        tokens[11] = TokenizedAssetConstants.SPCXc;
        priceFeeds[11] = TokenizedAssetConstants.FEED_SPCX;
        tokens[12] = TokenizedAssetConstants.TSLAc;
        priceFeeds[12] = TokenizedAssetConstants.FEED_TSLA;

        int24[4] memory candidateTicks = [int24(100), int24(200), int24(500), int24(2000)];

        for (uint256 i = 0; i < 13; i++) {
            supporteds[i] = true;
            tokenDecimals[i] = 18;
            feedDecimals[i] = 8;
            isCoinbaseB20s[i] = (coinbaseRegistry != address(0));
            if (installLocalMocks) priceFeeds[i] = address(new MockPriceFeed(_localPriceUsdE8(i)));

            if (installLocalMocks) {
                vm.etch(tokens[i], type(DeployMockERC20).runtimeCode);
            }
        }

        for (uint256 f = 0; f < candidateFactories.length; f++) {
            address factory = candidateFactories[f];
            if (factory.code.length == 0) {
                if (installLocalMocks) {
                    vm.etch(factory, type(MockAerodromeFactory).runtimeCode);
                } else {
                    continue;
                }
            }

            for (uint256 i = 0; i < 13; i++) {
                for (uint256 t = 0; t < candidateTicks.length; t++) {
                    int24 tickSpacing = candidateTicks[t];
                    address pool = IAerodromeSlipstreamFactory(factory).getPool(usdcAddress, tokens[i], tickSpacing);
                    if (pool != address(0) && pool.code.length > 0) {
                        routeRegistry.setPoolApproval(
                            block.chainid,
                            usdcAddress,
                            tokens[i],
                            tickSpacing,
                            factory,
                            true
                        );
                    }
                }
            }
        }

        if (installLocalMocks) {
            // A fork already contains the real Aave pool. Preserve it; only install
            // the mock on an empty local chain.
            if (aavePoolAddr.code.length == 0) {
                vm.etch(aavePoolAddr, type(MockAavePool).runtimeCode);
            }
        }

        registry.configureBatch(
            block.chainid, tokens, priceFeeds, supporteds, tokenDecimals, feedDecimals, isCoinbaseB20s
        );
        if (installLocalMocks) {
            registry.configure(
                block.chainid,
                usdcAddress,
                address(new MockPriceFeed(1e8)),
                true,
                6,
                8,
                false
            );
        }

        // Aave is pinned by the dedicated lending module.
        registry.setApprovedLendingPool(0xA238Dd80C259a72e81d7e4664a9801593F98d1c5, true); // Aave v3

        address govOwner = vm.envOr("GOVERNANCE_OWNER_ADDRESS", address(0));
        if (!installLocalMocks) {
            require(govOwner != address(0), "GOVERNANCE_OWNER_ADDRESS_REQUIRED");
            require(govOwner != deployer, "GOVERNANCE_OWNER_MUST_NOT_BE_DEPLOYER");
            registry.transferOwnership(govOwner);
            routeRegistry.transferOwnership(govOwner);
            console.log("Transferred registry ownership to governance:", govOwner);
        } else {
            if (govOwner != address(0) && govOwner != deployer) {
                registry.transferOwnership(govOwner);
                routeRegistry.transferOwnership(govOwner);
                console.log("Transferred registry ownership to governance:", govOwner);
            }
        }

        if (dexRouterAddr != address(0)) console.log("MockDEXRouter deployed at:", dexRouterAddr);
        console.log("OthelioAaveV3Adapter deployed at:", aaveAdapterAddr);
        console.log("OthelioAerodromeRouteRegistry deployed at:", address(routeRegistry));

        vm.stopBroadcast();
    }

    function _localPriceUsdE8(uint256 index) private pure returns (int256) {
        int256[13] memory prices = [
            int256(224_50e6), int256(180e8), int256(200e8), int256(28_50e6), int256(175e8),
            int256(31_20e6), int256(500e8), int256(415_20e6), int256(135e8), int256(125_40e6),
            int256(65e8), int256(42e8), int256(250e8)
        ];
        return prices[index];
    }
}
