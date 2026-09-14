#!/usr/bin/env bash
set -euo pipefail

# Funds an existing local-Anvil wallet. This does not reset Anvil or redeploy
# contracts; use it after `npm run dev:chain` / `npm run dev:reset`.
# Usage: ./scripts/fund-local-wallet.sh <wallet-address> [usdc-whole-units]

TASK_RECIPIENT="${1:?Usage: $0 <wallet-address> [usdc-whole-units]}"
TASK_USDC_UNITS="${2:-100000}"
TASK_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
TASK_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
TASK_CAST="${CAST_BIN:-cast}"
TASK_USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913"

if ! [[ "$TASK_USDC_UNITS" =~ ^[0-9]+$ ]]; then
  echo "USDC whole units must be a non-negative integer." >&2
  exit 1
fi

TASK_AMOUNT=$((TASK_USDC_UNITS * 1000000))
"$TASK_CAST" send "$TASK_USDC" "mint(address,uint256)" "$TASK_RECIPIENT" "$TASK_AMOUNT" \
  --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL"
"$TASK_CAST" rpc anvil_setBalance "$TASK_RECIPIENT" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL"
echo "Funded $TASK_RECIPIENT with ${TASK_USDC_UNITS} mock USDC and 100 local ETH."
