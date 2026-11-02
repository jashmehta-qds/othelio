use ethers::prelude::*;

abigen!(
    IOthelioEvents,
    r#"[
        event BasketCreated(address indexed safe, address indexed owner, string name, uint256 createdAt)
        event BasketFunded(address indexed safe, address indexed funder, address inputAsset, uint256 inputAmount, address[] acquiredAssets, uint256[] acquiredAmounts, uint256 acquiredOutputNavUsdc)
        event BasketRebalanced(address indexed safe, address indexed controller, address[] soldAssets, uint256[] soldAmounts, address[] boughtAssets, uint256[] boughtAmounts, uint256 tradedOutputNavUsdc)
        event BasketWithdrawn(address indexed safe, address indexed owner, address outputAsset, uint256 navRedeemed, address[] withdrawnAssets, uint256[] withdrawnAmounts, uint256 remainingListedAssetsNavUsdc)
        event BasketSwapWithdrawn(address indexed safe, address indexed owner, address indexed recipient, address outputAsset, uint256 outputAmount, address[] soldAssets, uint256[] soldAmounts, uint256 remainingListedAssetsNavUsdc)
        event UntrackedAssetSwept(address indexed safe, address indexed owner, address indexed token, uint256 amount)
        event BasketSuppliedToLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount, uint256 supplyApyBps)
        event BasketBorrowedFromLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount, uint256 borrowApyBps)
        event BasketRepaidToLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount)
        event BasketWithdrawnFromLending(address indexed safe, address indexed provider, address indexed asset, uint256 amount)
        event AerodromeRouteExecuted(address indexed basket, address indexed tokenIn, address indexed tokenOut, uint8 kind, uint256 amountIn, uint256 amountOut, int24 firstTickSpacing, int24 secondTickSpacing)
        event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)
        event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)
        event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)
        event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)
    ]"#
);

abigen!(
    SnapshotMulticall3,
    r#"[
        struct Call3 { address target; bool allowFailure; bytes callData; }
        struct Result3 { bool success; bytes returnData; }
        function aggregate3(Call3[] calls) external payable returns (Result3[])
    ]"#
);

abigen!(
    OthelioAssetRegistry,
    r#"[
        function getSupportedTokens(uint256 chainId) view returns (address[])
        function getAsset(uint256 chainId, address token) view returns (bool supported, address priceFeed, uint8 tokenDecimals, uint8 feedDecimals, bool isCoinbaseB20)
    ]"#
);

abigen!(
    SnapshotErc20,
    r#"[
        function balanceOf(address account) view returns (uint256)
        function decimals() view returns (uint8)
    ]"#
);

abigen!(
    SnapshotAggregator,
    r#"[function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)]"#
);

abigen!(
    IRiskSplitEvents,
    r#"[
        event SeriesCreated(address indexed series, address indexed underlying, uint256 floorPrice, uint256 capPrice, uint256 expiry, address settlementAdapter)
        event SeriesCreatedWithReference(address indexed series, address indexed underlying, uint256 floorPrice, uint256 capPrice, uint256 expiry, address settlementAdapter, address referenceFeed, uint80 referenceRoundId, uint256 referencePrice, uint256 referenceBlock)
        event TokensInitialized(address protectedToken, address upsideToken)
        event Minted(address indexed user, uint256 amount)
        event PairRedeemed(address indexed user, uint256 amount)
        event Settled(uint256 settlementPrice, uint256 protectedFraction, uint256 upsideFraction)
        event SettledWithFixing(uint256 settlementPrice, uint80 roundId, uint256 observedTimestamp, uint256 protectedFraction, uint256 upsideFraction)
        event ProtectedRedeemed(address indexed user, uint256 amount, uint256 underlyingReturned)
        event UpsideRedeemed(address indexed user, uint256 amount, uint256 underlyingReturned)
        event Transfer(address indexed from, address indexed to, uint256 value)
    ]"#
);

abigen!(
    SeriesFactoryView,
    r#"[
        function allSeriesLength() view returns (uint256)
        function allSeries(uint256 index) view returns (address)
        function isSeries(address series) view returns (bool)
    ]"#
);

abigen!(
    RiskSplitSeriesView,
    r#"[
        function protectedToken() view returns (address)
        function upsideToken() view returns (address)
        function referenceFeed() view returns (address)
        function referenceRoundId() view returns (uint80)
        function referencePrice() view returns (uint256)
        function referenceBlock() view returns (uint256)
        function formulaVersion() view returns (uint256)
        function factory() view returns (address)
        function isSettled() view returns (bool)
        function settledPrice() view returns (uint256)
        function settledRoundId() view returns (uint80)
        function settledTimestamp() view returns (uint256)
        function protectedFraction() view returns (uint256)
        function upsideFraction() view returns (uint256)
    ]"#
);

