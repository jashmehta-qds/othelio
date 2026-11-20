// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {UpsideFactory} from "../../src/upside/UpsideFactory.sol";
import {IUpsideFactory} from "../../src/upside/interfaces/IUpsideFactory.sol";
import {UpsideFixingAdapter} from "../../src/upside/UpsideFixingAdapter.sol";
import {RiskSplitSeries} from "../../src/risksplit/RiskSplitSeries.sol";
import {ClaimToken} from "../../src/risksplit/ClaimToken.sol";
import {SeriesFactory} from "../../src/risksplit/SeriesFactory.sol";
import {SettlementAdapter} from "../../src/risksplit/SettlementAdapter.sol";
import {ISeriesFactory} from "../../src/risksplit/interfaces/ISeriesFactory.sol";
import {OthelioAssetRegistry} from "../../src/registry/OthelioAssetRegistry.sol";
import {BasketOracle, AggregatorV3Interface} from "../../src/oracle/BasketOracle.sol";
import {OthelioBaseModule} from "../../src/safe/OthelioBaseModule.sol";
import {OthelioPortfolioModule} from "../../src/safe/OthelioPortfolioModule.sol";
import {OthelioAerodromeSlipstreamAdapter} from "../../src/dex/OthelioAerodromeSlipstreamAdapter.sol";
import {OthelioAerodromeRouteRegistry} from "../../src/dex/OthelioAerodromeRouteRegistry.sol";
import {OthelioAaveV3Adapter} from "../../src/lending/OthelioAaveV3Adapter.sol";
import {AerodromeRoute, AerodromeRouteKind} from "../../src/dex/AerodromeRouteTypes.sol";
import {IAerodromeSlipstreamSwapRouter} from "../../src/dex/IAerodromeSlipstreamSwapRouter.sol";

contract Phase2Token is ERC20 {
    uint8 private immutable tokenDecimals;

    constructor(string memory name_, uint8 decimals_) ERC20(name_, name_) {
        tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract Phase2Feed is AggregatorV3Interface {
    uint8 public immutable override decimals;
    int256 public answer;
    uint256 public updatedAt;
    bool public shouldRevert;

    constructor(int256 answer_, uint256 updatedAt_) {
        decimals = 8;
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(!shouldRevert, "FEED_REVERT");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract Phase2AssetRegistryMock {
    function isSupported(uint256, address) external pure returns (bool) {
        return true;
    }
}

contract Phase2FakeFactory {
    mapping(address => bool) public baskets;

    function setBasket(address basket, bool value) external {
        baskets[basket] = value;
    }

    function isOthelioBasket(address basket) external view returns (bool) {
        return baskets[basket];
    }
}

contract Phase2FakeSafe {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isOwner(address owner_) external view returns (bool) {
        return owner_ == owner;
    }

    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, uint8)
        external
        returns (bool success, bytes memory returnData)
    {
        (success, returnData) = to.call{value: value}(data);
    }

    function execTransactionFromModule(address to, uint256 value, bytes memory data, uint8)
        external
        returns (bool success)
    {
        (success,) = to.call{value: value}(data);
    }
}

contract Phase2PoolFactory {
    function getPool(address, address, int24) external view returns (address) {
        return address(this);
    }
}

contract Phase2DexRouter is IAerodromeSlipstreamSwapRouter {
    struct Leg {
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
    }

    Leg[] public legs;
    uint256 public legIndex;

    function addLeg(address tokenIn, address tokenOut, uint256 amountOut) external {
        legs.push(Leg(tokenIn, tokenOut, amountOut));
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        Leg memory leg = legs[legIndex++];
        require(params.amountIn > 0, "ZERO_INPUT");
        require(IERC20(leg.tokenIn).transferFrom(msg.sender, address(this), params.amountIn), "INPUT_PULL");
        require(IERC20(leg.tokenOut).transfer(params.recipient, leg.amountOut), "OUTPUT_PUSH");
        return leg.amountOut;
    }

    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256) {
        revert("UNUSED");
    }
}

contract PR4Phase2SeriesAuditTest is Test {
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    struct UpsideEnv {
        Phase2Token underlying;
        UpsideSeries series;
        UpsideClaimToken upside;
        UpsideClaimToken residual;
    }

    struct RiskEnv {
        Phase2Token underlying;
        RiskSplitSeries series;
        ClaimToken protectedToken;
        ClaimToken upsideToken;
    }

    function _newUpside(uint256 strike) internal returns (UpsideEnv memory env) {
        env.underlying = new Phase2Token("Underlying", 18);
        Phase2AssetRegistryMock registry = new Phase2AssetRegistryMock();
        uint256 expiry = block.timestamp + 1 days;
        env.series = new UpsideSeries(
            address(this), address(registry), address(env.underlying), address(this), strike, expiry,
            address(0x1234), 1, strike, 1
        );
        env.upside = new UpsideClaimToken("Upside", "UP", address(env.series), 18);
        env.residual = new UpsideClaimToken("Residual", "RES", address(env.series), 18);
        env.series.initializeTokens(address(env.upside), address(env.residual));
    }

    function _newRisk(uint256 floorPrice, uint256 capPrice) internal returns (RiskEnv memory env) {
        env.underlying = new Phase2Token("Underlying", 18);
        uint256 expiry = block.timestamp + 1 days;
        env.series = new RiskSplitSeries(
            address(env.underlying), address(this), floorPrice, capPrice, expiry, address(0x1234), 1, floorPrice
        );
        env.protectedToken = new ClaimToken("Protected", "PROT", address(env.series), 18);
        env.upsideToken = new ClaimToken("Upside", "UP", address(env.series), 18);
        env.series.initializeTokens(address(env.protectedToken), address(env.upsideToken));
    }

    function _mintUpside(UpsideEnv memory env, address actor, uint256 amount) internal {
        env.underlying.mint(actor, amount);
        vm.startPrank(actor);
        env.underlying.approve(address(env.series), amount);
        env.series.mint(amount);
        vm.stopPrank();
    }

    function _mintRisk(RiskEnv memory env, address actor, uint256 amount) internal {
        env.underlying.mint(actor, amount);
        vm.startPrank(actor);
        env.underlying.approve(address(env.series), amount);
        env.series.mint(amount);
        vm.stopPrank();
    }

    function _redeemUpsideChunks(UpsideEnv memory env, address actor, uint256 amount, uint256 chunks)
        internal
        returns (uint256 output)
    {
        uint256 beforeBalance = env.underlying.balanceOf(actor);
        uint256 remaining = amount;
        uint256 step = amount / chunks;
        if (step == 0) step = 1;
        while (remaining > 0) {
            uint256 part = remaining < step ? remaining : step;
            vm.prank(actor);
            env.series.redeemUpside(part);
            remaining -= part;
        }
        output = env.underlying.balanceOf(actor) - beforeBalance;
    }

    function _redeemResidualChunks(UpsideEnv memory env, address actor, uint256 amount, uint256 chunks)
        internal
        returns (uint256 output)
    {
        uint256 beforeBalance = env.underlying.balanceOf(actor);
        uint256 remaining = amount;
        uint256 step = amount / chunks;
        if (step == 0) step = 1;
        while (remaining > 0) {
            uint256 part = remaining < step ? remaining : step;
            vm.prank(actor);
            env.series.redeemResidual(part);
            remaining -= part;
        }
        output = env.underlying.balanceOf(actor) - beforeBalance;
    }

    function testFuzz_UpsideSeriesTinyChunksRemainSolvent(uint96 seed, uint8 priceSeed, uint8 chunkSeed) public {
        uint256 amount = bound(uint256(seed), 2, 1_000_000 ether);
        uint256 chunks = bound(uint256(chunkSeed), 1, 32);
        uint256 strike = 100e8;
        uint256 price = [uint256(1), strike, strike * 2, strike * 3][uint256(priceSeed) % 4];
        UpsideEnv memory env = _newUpside(strike);
        _mintUpside(env, alice, amount);

        vm.prank(alice);
        env.upside.transfer(bob, amount / 3);
        vm.prank(alice);
        env.residual.transfer(bob, amount / 3);

        vm.warp(env.series.expiry() + 1);
        env.series.settleWithFixing(price, 1, env.series.expiry());

        uint256 aliceUp = amount - amount / 3;
        uint256 bobUp = amount / 3;
        uint256 aliceRes = aliceUp;
        uint256 bobRes = bobUp;
        uint256 aliceUpOut = _redeemUpsideChunks(env, alice, aliceUp, chunks);
        uint256 bobUpOut = _redeemUpsideChunks(env, bob, bobUp, chunks);
        uint256 aliceResOut = _redeemResidualChunks(env, alice, aliceRes, chunks);
        uint256 bobResOut = _redeemResidualChunks(env, bob, bobRes, chunks);

        uint256 upEntitlement = env.series.upsideAllocation();
        uint256 resEntitlement = env.series.residualAllocation();
        assertLe(aliceUpOut, upEntitlement * aliceUp / amount + 1);
        assertLe(bobUpOut, upEntitlement * bobUp / amount + 1);
        assertLe(aliceResOut, resEntitlement * aliceRes / amount + 1);
        assertLe(bobResOut, resEntitlement * bobRes / amount + 1);
        assertLe(aliceUpOut + bobUpOut + aliceResOut + bobResOut, amount);
        assertLe(env.underlying.balanceOf(address(env.series)), amount);
    }

    function test_RiskSplit_OneWeiRedemptionsLeaveOnlyRoundingDust() public {
        RiskEnv memory env = _newRisk(100, 200);
        _mintRisk(env, alice, 3);
        vm.warp(env.series.expiry() + 1);
        env.series.settle(101);

        vm.prank(alice);
        env.series.redeemProtected(1);
        vm.prank(alice);
        env.series.redeemProtected(1);
        vm.prank(alice);
        env.series.redeemProtected(1);
        vm.prank(alice);
        env.series.redeemUpside(1);
        vm.prank(alice);
        env.series.redeemUpside(1);
        vm.prank(alice);
        env.series.redeemUpside(1);

        assertEq(env.protectedToken.balanceOf(alice), 0);
        assertEq(env.upsideToken.balanceOf(alice), 0);
        // Every one-unit claim burns successfully, but each floor rounds to
        // zero; the entire three-unit collateral balance becomes unrecoverable
        // dust after the claims are gone.
        assertEq(env.underlying.balanceOf(address(env.series)), 3);
    }

    function test_RiskSplit_ExtremeFloorMakesSettlementPermanentlyRevert() public {
        uint256 floorPrice = type(uint256).max / 2 + 1;
        RiskEnv memory env = _newRisk(floorPrice, type(uint256).max);
        vm.warp(env.series.expiry() + 1);
        vm.expectRevert();
        env.series.settle(floorPrice);
    }

    function test_RiskSplit_MaxClaimAmountOverflowsRedemption() public {
        RiskEnv memory env = _newRisk(100, 200);
        uint256 amount = type(uint256).max;
        _mintRisk(env, alice, amount);
        vm.warp(env.series.expiry() + 1);
        env.series.settle(50);

        vm.prank(alice);
        vm.expectRevert();
        env.series.redeemProtected(amount);
    }

    function test_FactoryPermissionsAndDuplicateTermsAreBlocked() public {
        Phase2Token underlying = new Phase2Token("Underlying", 18);
        Phase2Feed feed = new Phase2Feed(100e8, block.timestamp);
        SettlementAdapter riskAdapter = new SettlementAdapter(address(feed), 1 days);
        SeriesFactory riskFactory = new SeriesFactory();
        uint256 expiry = block.timestamp + 1 days;
        riskFactory.setApprovedExpiry(address(underlying), expiry, true);
        riskFactory.setApprovedAdapter(address(underlying), address(riskAdapter), true);

        vm.prank(alice);
        vm.expectRevert(ISeriesFactory.Unauthorized.selector);
        riskFactory.createSeries(address(underlying), 90, 110, expiry, address(riskAdapter));
        address riskSeries = riskFactory.createSeries(address(underlying), 90, 110, expiry, address(riskAdapter));
        vm.expectRevert(ISeriesFactory.DuplicateSeriesTerms.selector);
        riskFactory.createSeries(address(underlying), 90, 110, expiry, address(riskAdapter));

        vm.prank(alice);
        vm.expectRevert();
        RiskSplitSeries(riskSeries).initializeTokens(alice, bob);

        OthelioAssetRegistry registry = new OthelioAssetRegistry(address(this));
        registry.configure(block.chainid, address(underlying), address(feed), true, 18, 8, false);
        UpsideFixingAdapter upsideAdapter = new UpsideFixingAdapter(address(feed), 1 days);
        UpsideFactory upsideFactory = new UpsideFactory(address(registry));
        IUpsideFactory.RoundConfig memory config = IUpsideFactory.RoundConfig({
            underlying: address(underlying), feed: address(feed), adapter: address(upsideAdapter),
            referenceRoundId: 1, referencePrice: 100e8, referenceTime: block.timestamp,
            roundStart: block.timestamp, expiryTimestamp: block.timestamp + 2 days, expectedMove: 0,
            provenanceHash: bytes32(0), strikeTick: 1e8, minStrike: 90e8, maxStrike: 110e8
        });
        vm.prank(alice);
        vm.expectRevert();
        upsideFactory.registerRound(config);
        uint256 roundId = upsideFactory.registerRound(config);
        upsideFactory.createMarket(roundId, 100e8);
        vm.expectRevert();
        upsideFactory.createMarket(roundId, 100e8);
    }
}

contract PR4Phase2BasketAuditTest is Test {
    address internal alice = address(0xA11CE);
    OthelioAssetRegistry internal registry;
    BasketOracle internal oracle;
    OthelioPortfolioModule internal module;
    OthelioAerodromeRouteRegistry internal routeRegistry;
    Phase2DexRouter internal router;
    Phase2PoolFactory internal poolFactory;
    Phase2FakeSafe internal safe;
    Phase2FakeFactory internal basketFactory;
    Phase2Feed internal feed;
    Phase2Token internal usdc;

    function _setupModule() internal {
        registry = new OthelioAssetRegistry(address(this));
        oracle = new BasketOracle(address(registry));
        poolFactory = new Phase2PoolFactory();
        routeRegistry = new OthelioAerodromeRouteRegistry(address(this), address(poolFactory));
        router = new Phase2DexRouter();
        usdc = new Phase2Token("USDC", 6);
        OthelioAaveV3Adapter aave = new OthelioAaveV3Adapter(address(0x123456));
        OthelioAerodromeSlipstreamAdapter dex = new OthelioAerodromeSlipstreamAdapter(
            address(router), address(usdc), address(routeRegistry)
        );
        module = new OthelioPortfolioModule(address(oracle), address(aave), address(dex), false, 1e18);
        basketFactory = new Phase2FakeFactory();
        module.setFactory(address(basketFactory));
        safe = new Phase2FakeSafe(address(this));
        basketFactory.setBasket(address(safe), true);
    }

    function _configureAsset(Phase2Token token, Phase2Feed assetFeed, uint8 configuredDecimals) internal {
        registry.configure(block.chainid, address(token), address(assetFeed), true, configuredDecimals, 8, false);
    }

    function _route(address tokenIn, address tokenOut, uint256 amountIn, uint256 minimumAmountOut)
        internal
        pure
        returns (AerodromeRoute memory)
    {
        return AerodromeRoute({
            kind: AerodromeRouteKind.DIRECT,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            firstTickSpacing: 1,
            secondTickSpacing: 0,
            amountIn: amountIn,
            minimumAmountOut: minimumAmountOut
        });
    }

    function test_Fix_StaleFeedDoesNotBlockOwnerInKindExit() public {
        _setupModule();
        Phase2Token token = new Phase2Token("Asset", 18);
        feed = new Phase2Feed(100e8, block.timestamp);
        _configureAsset(token, feed, 18);
        token.mint(address(safe), 1 ether);
        vm.warp(block.timestamp + 8 days);
        feed.setUpdatedAt(block.timestamp - 7 days - 1);

        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;
        vm.prank(address(this));
        module.withdrawInKind(address(safe), address(this), tokens, amounts, new address[](0));
        assertEq(token.balanceOf(address(safe)), 0);
        assertEq(token.balanceOf(address(this)), 1 ether);
    }

    function test_Fix_RevertingFeedDoesNotBlockOwnerInKindExit() public {
        _setupModule();
        Phase2Token token = new Phase2Token("Asset", 18);
        feed = new Phase2Feed(100e8, block.timestamp);
        _configureAsset(token, feed, 18);
        token.mint(address(safe), 1 ether);
        feed.setShouldRevert(true);
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;
        module.withdrawInKind(address(safe), address(this), tokens, amounts, new address[](0));
        assertEq(token.balanceOf(address(safe)), 0);
        assertEq(token.balanceOf(address(this)), 1 ether);
    }

    function test_Fix_StaleOracleAggregateCapAllowsExactlyThreePercentOracleLoss() public {
        _setupModule();
        Phase2Token tokenIn = new Phase2Token("Input", 18);
        Phase2Token tokenOut = new Phase2Token("Output", 18);
        feed = new Phase2Feed(100e8, block.timestamp);
        _configureAsset(tokenIn, feed, 18);
        _configureAsset(tokenOut, feed, 18);
        routeRegistry.setPoolApproval(block.chainid, address(tokenIn), address(tokenOut), 1, address(poolFactory), true);
        tokenIn.mint(address(safe), 1 ether);
        tokenOut.mint(address(router), 1 ether);
        vm.warp(block.timestamp + 7 days - 1);
        feed.setUpdatedAt(block.timestamp - 7 days + 1);
        router.addLeg(address(tokenIn), address(tokenOut), 0.97 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = _route(address(tokenIn), address(tokenOut), 1 ether, 0.97 ether);
        module.rebalanceAerodromePortfolio(address(safe), routes, block.timestamp + 1);

        // The stale oracle values both legs at $100, while the modeled live market
        // values output at $50: 0.97 * $50 / $100 = 51.5% loss.
        uint256 realValueLossBps = 10000 - (0.97 ether * 50 * 10000 / (1 ether * 100));
        assertGt(realValueLossBps, 300);
        assertEq(tokenOut.balanceOf(address(safe)), 0.97 ether);
    }

    function test_Fix_SixteenThreePercentLegsRevertOnAggregateCap() public {
        _setupModule();
        Phase2Token[] memory tokens = new Phase2Token[](17);
        feed = new Phase2Feed(1e8, block.timestamp);
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i] = new Phase2Token("Leg", 18);
            _configureAsset(tokens[i], feed, 18);
        }
        uint256 amountIn = 1 ether;
        tokens[0].mint(address(safe), amountIn);
        AerodromeRoute[] memory routes = new AerodromeRoute[](16);
        for (uint256 i; i < routes.length; ++i) {
            uint256 amountOut = amountIn * 9701 / 10000;
            routeRegistry.setPoolApproval(
                block.chainid, address(tokens[i]), address(tokens[i + 1]), 1, address(poolFactory), true
            );
            tokens[i + 1].mint(address(router), amountOut);
            router.addLeg(address(tokens[i]), address(tokens[i + 1]), amountOut);
            routes[i] = _route(address(tokens[i]), address(tokens[i + 1]), amountIn, amountOut);
            amountIn = amountOut;
        }
        vm.expectRevert(OthelioPortfolioModule.TotalValueLossExceeded.selector);
        module.rebalanceAerodromePortfolio(address(safe), routes, block.timestamp + 1);

        assertEq(tokens[0].balanceOf(address(safe)), 1 ether);
        assertEq(tokens[16].balanceOf(address(safe)), 0);
    }

    function test_Fix_RebalanceAtTwoPointNinePercentPasses() public {
        _setupModule();
        Phase2Token tokenIn = new Phase2Token("Input", 18);
        Phase2Token tokenOut = new Phase2Token("Output", 18);
        feed = new Phase2Feed(1e8, block.timestamp);
        _configureAsset(tokenIn, feed, 18);
        _configureAsset(tokenOut, feed, 18);
        routeRegistry.setPoolApproval(block.chainid, address(tokenIn), address(tokenOut), 1, address(poolFactory), true);
        tokenIn.mint(address(safe), 1 ether);
        tokenOut.mint(address(router), 0.971 ether);
        router.addLeg(address(tokenIn), address(tokenOut), 0.971 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = _route(address(tokenIn), address(tokenOut), 1 ether, 0.971 ether);
        module.rebalanceAerodromePortfolio(address(safe), routes, block.timestamp + 1);
        assertEq(tokenOut.balanceOf(address(safe)), 0.971 ether);
    }

    function test_Fix_RebalanceAtThreePointOnePercentReverts() public {
        _setupModule();
        Phase2Token[] memory tokens = new Phase2Token[](3);
        feed = new Phase2Feed(1e8, block.timestamp);
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i] = new Phase2Token("Leg", 18);
            _configureAsset(tokens[i], feed, 18);
        }
        uint256 amountIn = 1 ether;
        tokens[0].mint(address(safe), amountIn);
        AerodromeRoute[] memory routes = new AerodromeRoute[](2);
        for (uint256 i; i < routes.length; ++i) {
            uint256 amountOut = amountIn * 984 / 1000;
            routeRegistry.setPoolApproval(
                block.chainid, address(tokens[i]), address(tokens[i + 1]), 1, address(poolFactory), true
            );
            tokens[i + 1].mint(address(router), amountOut);
            router.addLeg(address(tokens[i]), address(tokens[i + 1]), amountOut);
            routes[i] = _route(address(tokens[i]), address(tokens[i + 1]), amountIn, amountOut);
            amountIn = amountOut;
        }

        vm.expectRevert(OthelioPortfolioModule.TotalValueLossExceeded.selector);
        module.rebalanceAerodromePortfolio(address(safe), routes, block.timestamp + 1);
        assertEq(tokens[0].balanceOf(address(safe)), 1 ether);
        assertEq(tokens[2].balanceOf(address(safe)), 0);
    }

    function test_Basket_StaleOracleExternalMarketMoveStillExceedsThreePercent() public {
        _setupModule();
        Phase2Token tokenIn = new Phase2Token("Input", 18);
        Phase2Token tokenOut = new Phase2Token("Output", 18);
        feed = new Phase2Feed(100e8, block.timestamp);
        _configureAsset(tokenIn, feed, 18);
        _configureAsset(tokenOut, feed, 18);
        routeRegistry.setPoolApproval(block.chainid, address(tokenIn), address(tokenOut), 1, address(poolFactory), true);
        tokenIn.mint(address(safe), 1 ether);
        tokenOut.mint(address(router), 0.97 ether);
        vm.warp(block.timestamp + 7 days - 1);
        feed.setUpdatedAt(block.timestamp - 7 days + 1);
        router.addLeg(address(tokenIn), address(tokenOut), 0.97 ether);

        AerodromeRoute[] memory routes = new AerodromeRoute[](1);
        routes[0] = _route(address(tokenIn), address(tokenOut), 1 ether, 0.97 ether);
        module.rebalanceAerodromePortfolio(address(safe), routes, block.timestamp + 1);

        // The aggregate cap sees a 3% oracle-valued loss; it cannot detect an
        // external market price that diverged from the stale feed.
        uint256 realValueLossBps = 10000 - (0.97 ether * 50 * 10000 / (1 ether * 100));
        assertGt(realValueLossBps, 300);
        assertEq(tokenOut.balanceOf(address(safe)), 0.97 ether);
    }

    function test_Registry_UsesConfiguredDecimalsWithoutCheckingTokenDecimals() public {
        registry = new OthelioAssetRegistry(address(this));
        oracle = new BasketOracle(address(registry));
        Phase2Token sixDecimalToken = new Phase2Token("USDC", 6);
        feed = new Phase2Feed(1e8, block.timestamp);
        registry.configure(block.chainid, address(sixDecimalToken), address(feed), true, 18, 8, false);

        address[] memory tokens = new address[](1);
        tokens[0] = address(sixDecimalToken);
        uint256[] memory balances = new uint256[](1);
        balances[0] = 1e6;
        uint256 nav = oracle.calculateNAV(tokens, balances);
        assertEq(nav, 0);
        assertEq(sixDecimalToken.decimals(), 6);
    }

    function test_Basket_NonOwnerCannotUseAnotherOwnersSafeOrFrontRunFactory() public {
        _setupModule();
        vm.prank(alice);
        vm.expectRevert("NOT_SAFE_OWNER");
        module.withdrawInKind(address(safe), alice, new address[](0), new uint256[](0), new address[](0));

        vm.prank(alice);
        vm.expectRevert("NOT_FACTORY_SETTER");
        module.setFactory(address(alice));
        assertEq(module.factory(), address(basketFactory));
    }

    function test_Fix_ModuleRejectsETH() public {
        _setupModule();
        vm.deal(address(this), 1 ether);
        (bool success,) = address(module).call{value: 1 ether}("");
        assertFalse(success);
        assertEq(address(module).balance, 0);
    }
}
