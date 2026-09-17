// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {TokenizedAssetConstants} from "../src/constants/TokenizedAssetConstants.sol";
import {OthelioDeploymentAssets} from "./OthelioDeploymentAssets.sol";
import {OthelioAssetRegistry} from "../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../src/oracle/BasketOracle.sol";
import {OthelioPortfolioModule} from "../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../src/lending/OthelioAaveV3Adapter.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry, IAerodromeSlipstreamFactory} from "../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioSafeFactory} from "../src/factory/OthelioSafeFactory.sol";

/// @notice Base-mainnet deployment only. This file intentionally imports no mocks
/// and contains no state-injection cheatcodes.
contract DeployBaseOthelio is Script {
    uint256 private constant BASE_CHAIN_ID = 8453;
    address private constant AERODROME_FACTORY = 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A;
    address private constant AERODROME_ROUTER = 0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5;
    bytes32 private constant AERODROME_ROUTER_CODEHASH = 0x8ca2876cc2c509da1648ef2ad21a8849c261cf7316b675119b98ba298c8657e7;
    address private constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address private constant BASE_AAVE_V3_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    function run() external returns (address registryAddr, address oracleAddr, address moduleAddr, address factoryAddr) {
        require(block.chainid == BASE_CHAIN_ID, "PRODUCTION_REQUIRES_BASE");
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address governance = vm.envAddress("GOVERNANCE_OWNER_ADDRESS");
        address coinbaseRegistry = TokenizedAssetConstants.COINBASE_ONCHAIN_REGISTRY;
        require(governance != address(0) && governance != deployer, "INVALID_GOVERNANCE_OWNER");
        _requireInfrastructure();

        vm.startBroadcast(deployerPrivateKey);
        OthelioAssetRegistry registry = new OthelioAssetRegistry(deployer, coinbaseRegistry);
        BasketOracle oracle = new BasketOracle(address(registry));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(deployer, AERODROME_FACTORY);
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(BASE_AAVE_V3_POOL);
        OthelioAerodromeSlipstreamAdapter aerodromeAdapter = new OthelioAerodromeSlipstreamAdapter(AERODROME_ROUTER, BASE_USDC, address(routeRegistry));
        OthelioPortfolioModule module = new OthelioPortfolioModule(address(oracle), address(aaveAdapter), address(aerodromeAdapter), false, 1.25e18);
        OthelioSafeFactory factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));

        (address[] memory tokens, address[] memory feeds) = OthelioDeploymentAssets.tokensAndBaseFeeds();
        _configureAssetsAndRoutes(registry, routeRegistry, tokens, feeds);
        registry.setApprovedLendingPool(BASE_AAVE_V3_POOL, true);
        registry.transferOwnership(governance);
        routeRegistry.transferOwnership(governance);
        vm.stopBroadcast();

        require(registry.pendingOwner() == governance && routeRegistry.pendingOwner() == governance, "GOVERNANCE_HANDOFF_FAILED");
        console.log("Governance ownership pending acceptance by:", governance);
        return (address(registry), address(oracle), address(module), address(factory));
    }

    function _requireInfrastructure() private view {
        require(TokenizedAssetConstants.COINBASE_ONCHAIN_REGISTRY.code.length > 0, "MISSING_COINBASE_REGISTRY");
        require(AERODROME_FACTORY.code.length > 0, "MISSING_AERODROME_FACTORY");
        require(AERODROME_ROUTER.codehash == AERODROME_ROUTER_CODEHASH, "UNEXPECTED_AERODROME_ROUTER_CODE");
        require(BASE_USDC.code.length > 0, "MISSING_USDC");
        require(BASE_AAVE_V3_POOL.code.length > 0, "MISSING_AAVE_POOL");
    }

    function _configureAssetsAndRoutes(
        OthelioAssetRegistry registry,
        OthelioAerodromeRouteRegistry routeRegistry,
        address[] memory tokens,
        address[] memory feeds
    ) private {
        uint256 length = tokens.length;
        bool[] memory supported = new bool[](length);
        uint8[] memory tokenDecimals = new uint8[](length);
        uint8[] memory feedDecimals = new uint8[](length);
        bool[] memory isB20 = new bool[](length);
        int24[4] memory ticks = [int24(100), int24(200), int24(500), int24(2000)];
        for (uint256 i; i < length; i++) {
            require(feeds[i].code.length > 0, "MISSING_PRICE_FEED");
            supported[i] = true; tokenDecimals[i] = 18; feedDecimals[i] = 8; isB20[i] = true;
            bool routeRegistered;
            for (uint256 j; j < ticks.length; j++) {
                address pool = IAerodromeSlipstreamFactory(AERODROME_FACTORY).getPool(BASE_USDC, tokens[i], ticks[j]);
                if (pool != address(0) && pool.code.length > 0) {
                    routeRegistry.setPoolApproval(block.chainid, BASE_USDC, tokens[i], ticks[j], AERODROME_FACTORY, true);
                    routeRegistered = true;
                }
            }
            require(routeRegistered, "MISSING_REQUIRED_AERODROME_ROUTE");
        }
        registry.configureBatch(block.chainid, tokens, feeds, supported, tokenDecimals, feedDecimals, isB20);
    }
}
