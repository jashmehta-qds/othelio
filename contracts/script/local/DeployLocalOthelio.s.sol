// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OthelioDeploymentAssets} from "../OthelioDeploymentAssets.sol";
import {OthelioAssetRegistry} from "../../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle} from "../../src/oracle/BasketOracle.sol";
import {OthelioPortfolioModule} from "../../src/safe/OthelioPortfolioModule.sol";
import {OthelioAaveV3Adapter} from "../../src/lending/OthelioAaveV3Adapter.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioSafeFactory} from "../../src/factory/OthelioSafeFactory.sol";
import {MockPriceFeed} from "../../src/mock/MockPriceFeed.sol";

/// @dev Artifact used only by scripts/seed-anvil-pools.js to provide local ERC-20 semantics.
contract DeployMockERC20 is ERC20 {
    constructor() ERC20("Mock Stock Asset", "MOCK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burnFrom(address from, uint256 amount) external { _burn(from, amount); }
}

contract LocalMockAerodromeFactory {
    function getPool(address, address, int24) external view returns (address) { return address(this); }
}

/// @notice Anvil-only protocol deployment. It deploys the same Othelio protocol
/// contracts as Base, but never mutates chain state with vm.etch; the separate
/// local fixture process owns Anvil-only external-dependency simulation.
contract DeployLocalOthelio is Script {
    address internal constant LOCAL_ROUTER = 0xBD606f1dAE0285D55113eFC11501677B2221A4dd;
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant BASE_AAVE_V3_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    function run() external returns (address registryAddr, address oracleAddr, address moduleAddr, address factoryAddr) {
        require(block.chainid == 31337, "LOCAL_DEPLOY_REQUIRES_ANVIL");
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);
        LocalMockAerodromeFactory canonicalFactory = new LocalMockAerodromeFactory();
        OthelioAssetRegistry registry = new OthelioAssetRegistry(deployer);
        BasketOracle oracle = new BasketOracle(address(registry));
        OthelioAerodromeRouteRegistry routeRegistry = new OthelioAerodromeRouteRegistry(deployer, address(canonicalFactory));
        OthelioAaveV3Adapter aaveAdapter = new OthelioAaveV3Adapter(BASE_AAVE_V3_POOL);
        OthelioAerodromeSlipstreamAdapter aerodromeAdapter = new OthelioAerodromeSlipstreamAdapter(LOCAL_ROUTER, BASE_USDC, address(routeRegistry));
        OthelioPortfolioModule module = new OthelioPortfolioModule(address(oracle), address(aaveAdapter), address(aerodromeAdapter), false, 1.25e18);
        OthelioSafeFactory factory = new OthelioSafeFactory(address(module), address(registry));
        module.setFactory(address(factory));

        (address[] memory tokens,) = OthelioDeploymentAssets.tokensAndBaseFeeds();
        address[] memory feeds = new address[](tokens.length);
        bool[] memory supported = new bool[](tokens.length);
        uint8[] memory tokenDecimals = new uint8[](tokens.length);
        uint8[] memory feedDecimals = new uint8[](tokens.length);
        bool[] memory isB20 = new bool[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            feeds[i] = address(new MockPriceFeed(OthelioDeploymentAssets.localPriceUsdE8(i)));
            supported[i] = true; tokenDecimals[i] = 18; feedDecimals[i] = 8; isB20[i] = true;
            routeRegistry.setPoolApproval(block.chainid, BASE_USDC, tokens[i], 100, address(canonicalFactory), true);
        }
        registry.configureBatch(block.chainid, tokens, feeds, supported, tokenDecimals, feedDecimals, isB20);
        registry.configure(block.chainid, BASE_USDC, address(new MockPriceFeed(1e8)), true, 6, 8, false);
        registry.setApprovedLendingPool(BASE_AAVE_V3_POOL, true);
        vm.stopBroadcast();
        return (address(registry), address(oracle), address(module), address(factory));
    }
}
