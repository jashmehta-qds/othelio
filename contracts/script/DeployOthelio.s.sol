// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketModule} from "../src/safe/OthelioBasketModule.sol";
import {OthelioBasketGuard} from "../src/safe/OthelioBasketGuard.sol";
import {OthelioBorrowModule} from "../src/safe/OthelioBorrowModule.sol";
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

contract DeployOthelio is Script {
    function run()
        external
        returns (
            address registryAddr,
            address oracleAddr,
            address moduleAddr,
            address guardAddr,
            address factoryAddr,
            address dexRouterAddr,
            address borrowModuleAddr
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
            address guardAddr,
            address factoryAddr,
            address dexRouterAddr,
            address borrowModuleAddr
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
            address guardAddr,
            address factoryAddr,
            address dexRouterAddr,
            address borrowModuleAddr
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

        // 3. Deploy Othelio Basket Module
        OthelioBasketModule module = new OthelioBasketModule(oracleAddr);
        moduleAddr = address(module);

        // 4. Deploy Othelio Basket Guard (MultiSend router set or address(0) for default)
        address multiSend = vm.envOr("MULTISEND_ADDRESS", address(0));
        OthelioBasketGuard guard = new OthelioBasketGuard(registryAddr, moduleAddr, multiSend);
        guardAddr = address(guard);

        // 5. Deploy Othelio Safe Factory
        OthelioSafeFactory factory = new OthelioSafeFactory(moduleAddr, registryAddr);
        factoryAddr = address(factory);

        if (installLocalMocks) {
            require(block.chainid == 31337, "LOCAL_MOCKS_REQUIRE_31337");
            // The local quote adapter uses a stable router address. Etching keeps
            // it stable regardless of the forked deployer account nonce.
            dexRouterAddr = 0xBD606f1dAE0285D55113eFC11501677B2221A4dd;
            vm.etch(dexRouterAddr, type(MockDEXRouter).runtimeCode);
        }

        // 7. Deploy Othelio Borrow Module
        OthelioBorrowModule borrowModule = new OthelioBorrowModule(oracleAddr);
        borrowModuleAddr = address(borrowModule);

        // 8. Connect Factory to Module
        module.setFactory(factoryAddr);

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

        if (installLocalMocks) {
            address aavePoolAddr = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
            // A fork already contains the real Aave pool. Preserve it; only install
            // the mock on an empty local chain.
            if (aavePoolAddr.code.length == 0) {
                vm.etch(aavePoolAddr, type(MockAavePool).runtimeCode);
            }
        }

        registry.configureBatch(
            block.chainid, tokens, priceFeeds, supporteds, tokenDecimals, feedDecimals, isCoinbaseB20s
        );

        // Approve Base Mainnet lending pools for protocol-agnostic execution
        registry.setApprovedLendingPool(0xA238Dd80C259a72e81d7e4664a9801593F98d1c5, true); // Aave v3
        registry.setApprovedLendingPool(0xb125E6687d4313864e53df431d5425969c15Eb2F, true); // Compound v3
        registry.setApprovedLendingPool(0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22, true); // Moonwell
        registry.setApprovedLendingPool(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb, true); // Morpho Blue

        if (dexRouterAddr != address(0)) console.log("MockDEXRouter deployed at:", dexRouterAddr);
        console.log("OthelioBorrowModule deployed at:", borrowModuleAddr);

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
