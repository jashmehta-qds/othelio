# Base Launch Runbook: Stock Upside Markets

This runbook guides operators through the deployment and launch verification of Stock Upside Markets on Base Mainnet (`chainId: 8453`).

## 1. Prerequisites

- Base Mainnet RPC configured in `.env.base`.
- Encrypted Foundry keystore account with deployer wallet (e.g. `cast wallet import othelio-base-deployer`).
- Deployer wallet holds sufficient ETH for gas on Base.
- Never set or expose plaintext `PRIVATE_KEY` in environment or shell history.

## 2. Pinned Infrastructure & Dependencies

- Pinned `OthelioAssetRegistry`: `0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC` on Base.
- Underlying MSFTc: `0xB200000000000000000000Ab99cFa739E253872B`.
- Chainlink MSFT Feed: `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`.
- Native USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- 0x v4 ExchangeProxy: `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`.

## 3. Deployment Procedure

1. Simulate deployment:
   ```bash
   ./scripts/deploy-upside-base.sh
   ```
2. Broadcast deployment with encrypted keystore:
   ```bash
   base-forge script contracts/script/upside/DeployUpside.s.sol:DeployUpside \
     --root contracts \
     --rpc-url "$BASE_RPC_URL" \
     --account othelio-base-deployer \
     --broadcast \
     --verify
   ```
3. Record output addresses and block in `contracts/deployments/base-mainnet-upside.json`.

## 4. Weekly Round Setup & Launch

1. Configure `UPSIDE_FACTORY_ADDRESS` on the API and indexer. Configure the API's `ASSET_REGISTRY_ADDRESS` to match the factory's registry and set `UPSIDE_SETTLEMENT_ADAPTER_ADDRESS` or `UPSIDE_SETTLEMENT_ADAPTERS_JSON` (feed address to adapter address).
2. Open the Admin Console (`fe-admin`) with the Upside factory owner wallet. Select an enabled B20 asset, such as MSFTc, with a matching adapter and a fresh reference feed.
3. Verify calendar alignment (Friday 16:00 ET US regular market close).
4. Review 4 preset strikes: Starting price, Reach, Strong move, Long shot.
5. Sign round registration and market creation transactions. If a strike fails or is skipped, retry from the launch dialog or use **Finish preset strikes** on the indexed round. The panel checks for each onchain market before requesting a signature.
6. Verify indexing status and book display in the public UI. Transaction confirmation does not mean the indexer has caught up.

### Enable an additional Base B20 asset

1. Independently review the Coinbase contract address and its Chainlink B20 total-return proxy, then add the pair to the API's `B20_REVIEWED_FEEDS_JSON` map. An ordinary equity feed is not a substitute.
2. Sign in with the asset registry owner and open **Assets**. Enter the token address and review the verified token/feed pair before signing the registry transaction.
3. Check the registry and wait for price indexing. The asset can back markets after its market-specific settlement adapter is configured. Basket trading remains off for new assets until a reviewed route is configured in the quote planner and separately approved by the route registry owner; the panel does not approve routes.

Coinbase metadata is required for initial enablement, not for assets already enabled with a matching reviewed feed. Risk Split settlement verifies the adapter against the feed recorded when the series was created.

## 5. Indexer Operations & Legacy Risk Split Switch

- `RISK_SPLIT_INDEXING_ENABLED` (default: `true`):
  Controls whether legacy Risk Split series events are indexed.
  When set to `false`, the indexer omits Risk Split filter addresses, skips state loading and log processing for Risk Split, while continuing to index baskets, price feeds, and Upside markets without interruption.
  Risk Split retains its own independent resume cursor in `indexer_worker_state` (`worker_name = 'risksplit'`).
  When re-enabled, it resumes from its last indexed block and catches up independently without rewinding the basket or Upside event cursors.
- `NEXT_PUBLIC_RISK_SPLIT_NAV_ENABLED` (default: `true`):
  Shows Risk Split in the public app navigation. Setting it to `false` hides the navigation item while direct URLs, backend routes and admin tools remain available. Keep it `true` for the current Base development profile. After a future indexing pause, re-enable indexing and verify catch-up and API freshness before restoring public navigation. Rebuild or restart the frontend after changing this `NEXT_PUBLIC_` value.
- `UPSIDE_FACTORY_ADDRESS`:
  Configure this with the deployed `UpsideFactory` address to index Upside rounds, series markets, mints, pair withdrawals, ERC20 claim transfers, fixing settlement, and redemptions.
