// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioBasketModule} from "../src/safe/OthelioBasketModule.sol";
import {OthelioBasketGuard} from "../src/safe/OthelioBasketGuard.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";

contract DeployOthelio is Script {
    function run() external returns (
        address registryAddr,
        address oracleAddr,
        address moduleAddr,
        address guardAddr,
        address factoryAddr
    ) {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        address coinbaseRegistry = vm.envOr("COINBASE_REGISTRY_ADDRESS", TokenizedAssetConstants.COINBASE_ONCHAIN_REGISTRY);

        // 1. Deploy Hybrid Asset Registry
        OthelioAssetRegistry registry = new OthelioAssetRegistry(
            deployer,
            coinbaseRegistry
        );
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
        OthelioSafeFactory factory = new OthelioSafeFactory(
            moduleAddr,
            registryAddr
        );
        factoryAddr = address(factory);

        // 6. Batch Configure Coinbase B20 Tokens and Chainlink Price Feeds
        address[] memory tokens = new address[](13);
        address[] memory priceFeeds = new address[](13);
        bool[] memory supporteds = new bool[](13);
        uint8[] memory tokenDecimals = new uint8[](13);
        uint8[] memory feedDecimals = new uint8[](13);
        bool[] memory isCoinbaseB20s = new bool[](13);

        tokens[0] = TokenizedAssetConstants.AAPLc;  priceFeeds[0] = TokenizedAssetConstants.FEED_AAPL;
        tokens[1] = TokenizedAssetConstants.AMZNc;  priceFeeds[1] = TokenizedAssetConstants.FEED_AMZN;
        tokens[2] = TokenizedAssetConstants.COINc;  priceFeeds[2] = TokenizedAssetConstants.FEED_COIN;
        tokens[3] = TokenizedAssetConstants.CRCLc;  priceFeeds[3] = TokenizedAssetConstants.FEED_CRCL;
        tokens[4] = TokenizedAssetConstants.GOOGLc; priceFeeds[4] = TokenizedAssetConstants.FEED_GOOGL;
        tokens[5] = TokenizedAssetConstants.INTCc;  priceFeeds[5] = TokenizedAssetConstants.FEED_INTC;
        tokens[6] = TokenizedAssetConstants.METAc;  priceFeeds[6] = TokenizedAssetConstants.FEED_META;
        tokens[7] = TokenizedAssetConstants.MSFTc;  priceFeeds[7] = TokenizedAssetConstants.FEED_MSFT;
        tokens[8] = TokenizedAssetConstants.MSTRc;  priceFeeds[8] = TokenizedAssetConstants.FEED_MSTR;
        tokens[9] = TokenizedAssetConstants.NVDAc;  priceFeeds[9] = TokenizedAssetConstants.FEED_NVDA;
        tokens[10] = TokenizedAssetConstants.SNDKc; priceFeeds[10] = TokenizedAssetConstants.FEED_SNDK;
        tokens[11] = TokenizedAssetConstants.SPCXc; priceFeeds[11] = TokenizedAssetConstants.FEED_SPCX;
        tokens[12] = TokenizedAssetConstants.TSLAc; priceFeeds[12] = TokenizedAssetConstants.FEED_TSLA;

        for (uint256 i = 0; i < 13; i++) {
            supporteds[i] = true;
            tokenDecimals[i] = 18;
            feedDecimals[i] = 8;
            isCoinbaseB20s[i] = (coinbaseRegistry != address(0));
        }

        registry.configureBatch(
            block.chainid,
            tokens,
            priceFeeds,
            supporteds,
            tokenDecimals,
            feedDecimals,
            isCoinbaseB20s
        );

        vm.stopBroadcast();
    }
}
