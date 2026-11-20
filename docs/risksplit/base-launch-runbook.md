# Risk Split Base Mainnet Launch Runbook

**Target chain:** Base mainnet (`8453`)
**Initial asset:** Coinbase B20 MSFTc, resolved from `TokenizedAssetConstants.sol` and checked against Base RPC at runtime

This runbook deploys the factory and MSFT settlement adapter first. Creating the first series is a separate operation with explicit terms. The scripts never accept a plaintext private key and stop if the RPC is not Base mainnet.

## 1. Configure the RPC profile

Copy `.env.base.example` to `.env.base` if needed and set `BASE_RPC_URL` to your Base mainnet RPC endpoint. Keep RPC credentials private. Do not put a deployer private key in `.env.base`.

The scripts also accept `RPC_URL` as a fallback. They do not print the RPC URL.

## 2. Import the deployer key into Foundry's encrypted keystore

From the repository root, run:

```bash
cast wallet import othelio-base-deployer --interactive
```

Enter the private key only in Cast's interactive prompt. Cast saves an encrypted keystore locally and prompts for its password; the key must not be entered as a command argument or saved in `.env.base`. Keep the keystore password available for Foundry's signing prompt.

If the keystore already exists under another name, set `RISK_SPLIT_KEYSTORE_ACCOUNT` to that name before running the scripts.

## 3. Deploy factory and settlement adapter

```bash
./scripts/deploy-risksplit-base.sh
```

The script resolves MSFTc and the MSFT/USD Chainlink feed from the Solidity constants, checks chain ID, contract code, symbol, decimals, feed round freshness and deployer ETH, simulates both deployments, then requires the exact phrase `DEPLOY BASE MAINNET` before broadcasting. It uses Foundry's encrypted account for signing.

After deployment it verifies factory ownership and adapter feed/staleness, then writes the public result to:

```text
contracts/deployments/base-mainnet-risksplit.json
```

The result contains contract addresses, tx hashes and network metadata, never the private key. Do not rerun the deployment script if that manifest already exists; inspect and verify the existing deployment first.

## 4. Configure backend and local admin app

Copy the addresses printed by the deploy script into the appropriate local or hosted environment configuration:

```dotenv
RISK_SPLIT_FACTORY_ADDRESS=0x<factory>
RISK_SPLIT_SETTLEMENT_ADAPTER=0x<adapter>
RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS=0x<adapter>
RISK_SPLIT_FACTORY_START_BLOCK=<factory-deployment-block>
```

The `.env.base.example` names support local configuration. Hosted backend/indexer environments should receive the same verified factory and adapter addresses through their deployment configuration. Start or restart the indexer and backend, then check `/v1/risksplit/series?chainId=8453` and confirm the indexer is current.

The manifest records exact receipt blocks when Foundry provides them. If `factoryDeploymentBlock` is `null`, use the actual factory receipt block from the Foundry broadcast artifact or Basescan transaction page for `RISK_SPLIT_FACTORY_START_BLOCK`; do not substitute `observedBlockNumber`.

## 5. Create the first series separately

Choose floor/cap in USD with 8 decimals, based on the current MSFT/USD feed. Choose an expiry at exactly 4:00 PM New York time on a full NYSE trading day. The script rejects weekends, standard NYSE holidays, common early-close dates, past timestamps, stale reference data, and prices that do not bracket the live reference price.

Example command shape (replace all three values deliberately):

```bash
./scripts/create-risksplit-series-base.sh <floor-price-e8> <cap-price-e8> <expiry-unix-seconds>
```

For example, `$100.00` is `10000000000` in feed units. The script prints a preview, simulates the exact expiry approval and series creation, and requires `CREATE MSFTC SERIES ON OPEN TRADING DATE` before broadcasting. It creates the series as the factory owner and enables only that exact expiry before creation.

## 6. Verify the series and market flow

1. Confirm the factory's `allSeriesLength()` increased and inspect the new series in the admin Markets view.
2. Confirm indexer data includes the series, protected token, upside token, reference feed/round/price, and expiry.
3. Confirm the public Risk Split page displays the market and that market controls remain unavailable until the order-book venue is configured.

## Important operational notes

- Factory creation is owner-only after deployment.
- Factory and adapter are non-upgradeable contracts. A future code change requires a new deployment and explicit migration/configuration.
- A deployment does not create a series or configure the order book.
- The new factory emits one rich `SeriesCreated` event. The indexer also retains decoders for earlier factory event signatures.
