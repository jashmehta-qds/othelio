# Risk Split Base Mainnet Deployment Design

## Goal

Provide a repeatable, reviewable terminal workflow to deploy the Risk Split factory and settlement adapter to Base mainnet, then create a first series as a separate explicitly configured action. The workflow must resolve MSFTc from the project's reviewed asset metadata and verify it onchain rather than requiring the user to look up or paste the token address.

## User workflow

1. Source the existing `.env.base` profile for the Base RPC endpoint; keep credentials out of output and shell history.
2. Import the deployer key once into a locally encrypted Foundry keystore using Cast's interactive hidden-input prompt. Scripts use the keystore account and sender address; they never accept or export `PRIVATE_KEY`.
3. Run a preflight for chain ID 8453, deployer address and ETH balance, MSFTc token bytecode/symbol/decimals, configured Chainlink feed bytecode and a fresh, valid answer. Resolve addresses from the reviewed Base asset registry/constants in the repository.
4. Simulate deployment, show the exact chain, deployer, token and feed, then require the user to type `DEPLOY BASE MAINNET` before broadcasting.
5. Record factory/adapter addresses, transaction hashes and block number in a public deployment manifest, and show the two address values to add to the ignored `.env.base` runtime config. Never write or print the private key.
6. Run a separate series-creation command after deployment. It takes explicit floor, cap, expiry and reference-price policy inputs, previews the resulting parameters and requires a separate typed confirmation. It must not silently choose default risk terms or create a series as a side effect of deployment.

## Asset resolution

Use the canonical Base MSFTc entry already maintained in the shared Risk Split asset registry / Solidity token constants. Treat backend discovery as informational only: backend metadata is not the source of truth for contract deployment. The script verifies the resolved token address against Base RPC (`eth_getCode`, `symbol`, and `decimals`) and verifies the associated feed contract and latest round. Fail closed on missing code, mismatched token metadata, invalid feed answer, or stale feed data. Keep token and feed address overrides out of the default path; any override must be explicit and receive the same onchain checks.

## Secret handling

- Use Foundry's encrypted keystore account (`cast wallet import ... --interactive`, then `forge script --account ... --sender ...`). The key is entered only into Cast's hidden terminal prompt and stored encrypted locally.
- Reject a non-empty `PRIVATE_KEY` in the deployment environment so an accidentally sourced plaintext key cannot be used.
- Do not put secrets in command arguments, `.env.base`, generated manifests, logs, or shell history.
- Use `.env.base` only for the RPC URL and non-secret public configuration.

## Script boundaries

- `scripts/deploy-risksplit-base.sh`: chain/config checks, asset/feed validation, simulation, explicit confirmation, broadcast, and deployment result recording.
- `scripts/create-risksplit-series-base.sh`: independent series preview and creation against the recorded factory/adapter. Require floor, cap, expiry and any necessary reference data policy explicitly; validate `floor < reference price < cap`, expiry and contract constraints before broadcast.
- Solidity Foundry scripts remain the source of transaction construction. Shell wrappers orchestrate safe prompts and checks; they do not contain signing logic.
- Add a Base deployment runbook with the exact setup, deploy, verify, and first-series commands.

## Event ABI before production deployment

The current factory emits both a basic `SeriesCreated` event and a richer `SeriesCreatedWithReference` event for the same series. Before deploying the production factory, use one canonical rich `SeriesCreated` event containing the reference feed, round, price, block and claim-token addresses. Update the indexer and shared ABI to decode the new event while retaining support for both existing event signatures for historical deployments. This avoids duplicate series-created log rows on the new deployment and ensures the ABI being deployed matches the indexer.

## Safety and validation

- Refuse any chain ID other than 8453; do not silently fall back to local, fork, or test networks.
- Require the expected deployer address and sufficient Base ETH for gas; show both before confirmation.
- Run the same Foundry simulation before broadcast. The confirmation phrase is required for each broadcast command independently.
- After deployment, verify factory owner, configured feed/asset, and adapter/factory linkage with read-only calls, then record the resulting addresses and transaction metadata.
- The first-series command validates that expiry is in the future and meets contract constraints. Market-hours and holiday correctness must come from a reviewed calendar policy; do not infer a trading date with Unix-week arithmetic. If no calendar source/policy is configured, stop and request an explicit valid expiry rather than inventing one.
- Mainnet deployment itself is not executed by this design document; the user runs the guarded terminal commands locally so the key remains private.

## Out of scope

- Creating a Safe or changing ownership after deployment.
- Deploying an order book or enabling public market creation.
- Automatically selecting risk terms, expiry, or a first series.
- Backend metadata as the authority for token/feed addresses.

## Acceptance criteria

- No workflow requires a plaintext key in a command, environment variable, or project file.
- An invalid chain, unknown/mismatched MSFTc contract, invalid/stale feed, or missing deployer funds prevents broadcast.
- Deployment simulation and typed confirmation happen before any mainnet write.
- Factory and adapter deploy as one operation; series creation is separately previewed and confirmed.
- Successful deployment produces a reproducible manifest sufficient for FE/backend configuration and later verification.
- The indexer supports legacy event signatures and the canonical rich event emitted by the newly deployed factory.
