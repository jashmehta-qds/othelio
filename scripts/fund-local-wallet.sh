#!/usr/bin/env bash
set -euo pipefail

# Funds an existing local wallet (works for both standalone Anvil and Base fork).
# Usage: ./scripts/fund-local-wallet.sh <wallet-address> [usdc-whole-units]

TASK_RECIPIENT="${1:?Usage: $0 <wallet-address> [usdc-whole-units]}"
TASK_USDC_UNITS="${2:-100000}"
TASK_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
TASK_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
TASK_CAST="${CAST_BIN:-cast}"
TASK_USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913"
USDC_WHALE="0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"

if ! [[ "$TASK_USDC_UNITS" =~ ^[0-9]+$ ]]; then
  echo "USDC whole units must be a non-negative integer." >&2
  exit 1
fi

TASK_AMOUNT=$((TASK_USDC_UNITS * 1000000))
CHAIN_ID=$("$TASK_CAST" chain-id --rpc-url "$TASK_RPC_URL" 2>/dev/null || echo "31337")

if [ "$CHAIN_ID" = "8453" ]; then
  echo "Funding $TASK_RECIPIENT via Base USDC whale transfer on chain 8453..."
  "$TASK_CAST" rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$TASK_RPC_URL" >/dev/null
  "$TASK_CAST" rpc anvil_setBalance "$USDC_WHALE" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL" >/dev/null
  "$TASK_CAST" send "$TASK_USDC" "transfer(address,uint256)" "$TASK_RECIPIENT" "$TASK_AMOUNT" \
    --from "$USDC_WHALE" --unlocked --rpc-url "$TASK_RPC_URL" >/dev/null
  "$TASK_CAST" rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$TASK_RPC_URL" >/dev/null
else
  echo "Funding $TASK_RECIPIENT via mock mint on chain $CHAIN_ID..."
  "$TASK_CAST" send "$TASK_USDC" "mint(address,uint256)" "$TASK_RECIPIENT" "$TASK_AMOUNT" \
    --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL" >/dev/null
fi

"$TASK_CAST" rpc anvil_setBalance "$TASK_RECIPIENT" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL" >/dev/null
echo "Funded $TASK_RECIPIENT with ${TASK_USDC_UNITS} USDC and 100 local ETH on chain $CHAIN_ID."
