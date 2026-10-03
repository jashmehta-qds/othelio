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
    r#"[function balanceOf(address account) view returns (uint256)]"#
);

abigen!(
    SnapshotAggregator,
    r#"[function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)]"#
);
