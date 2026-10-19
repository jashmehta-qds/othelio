# Human-run Base governance transaction handoff

Use this reference only after code, asset evidence, and target addresses are concrete. The assistant prepares; the human executes.

1. Read Base chain ID, deployed registry and route-registry addresses, both `owner()` values, current asset configs, current route approvals, and the proposed post-state. If either owner is a Safe, encode calls for that Safe. Do not assume the deployer's private key still owns the contracts.
2. For every enabled B20, verify current feed code and round, token supply, canonical Aerodrome factory pool, selected tick, buy and sell quotes, and Othelio's `MAX_SWAP_VALUE_LOSS_BPS` simulation. Stage unsupported assets without enabling a route. Pin the block used for evidence and repeat live checks immediately before human execution.
3. Write a narrow Foundry governance script or a decoded calldata bundle that targets **existing** contracts. Validate array lengths and include expected old values. Produce a dry-run simulation and the exact addresses/values to be changed. Do not mix deployment of new protocol contracts into an asset-onboarding transaction.
4. Hand over one of the following execution paths. Do not execute it as the assistant.

## Safe owner

Provide each destination, value (`0`), calldata, decoded function and arguments, call order, Base chain ID `8453`, and expected state changes for entry in the Safe UI. If registry and route registry have different owners, split bundles by owner. The human signs and executes in Safe. No private key prompt is needed.

## EOA owner

Provide a reviewed, task-specific `bash` runner in the repository and ask the human to run that file. The runner may use this input pattern after loading a trusted RPC URL; adapt the Foundry script path and arguments to the actual change:

```bash
#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."
: "${BASE_RPC_URL:?Set BASE_RPC_URL in your shell before running this file}"
IFS= read -r -s -p 'Governance private key (input hidden): ' PRIVATE_KEY </dev/tty
printf '\n' >/dev/tty
trap 'unset PRIVATE_KEY' EXIT
[[ "$PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo 'Invalid private key format' >&2; exit 1; }
export PRIVATE_KEY
base-forge script script/ConfigureReviewedAssets.s.sol:ConfigureReviewedAssets \
  --rpc-url "$BASE_RPC_URL" --broadcast
```

The human runs `BASE_RPC_URL` from their trusted environment and types the key only at the hidden prompt. Do not use Foundry's `--private-key` argument or `PRIVATE_KEY=...` inline command syntax. The key is held briefly in the runner's process environment, so a Safe or hardware-backed signer is preferable if available. Never print or persist the key. If the local Base-aware Foundry command differs, verify the binary before handing over the runner.

## Verification after human execution

Given transaction hashes, verify chain ID, receipt success, emitted `AssetConfigured` and `AerodromePoolApprovalUpdated` events, `getAsset`, `getSupportedB20Tokens`, and `requireApprovedPool`. Confirm the indexer observes fresh prices, the API returns the intended metadata and `tradeable` values, and quote planning accepts only enabled assets. Report any failed or partial step with the exact remaining state and a safe corrective transaction; do not rebroadcast automatically.
