#!/usr/bin/env bash
set -euo pipefail

PATH="$HOME/.foundry/bin:$PATH"
export PATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "[dev-fork-infra] Starting Postgres in Docker (fork project)..."
docker compose -f docker-compose.dev.yml up -d postgres
npm run dev:db:migrate:fork

CURRENT_CHAIN_ID="$(base-cast chain-id --rpc-url http://127.0.0.1:8545 2>/dev/null || true)"
if [ "$CURRENT_CHAIN_ID" != "31337" ] || ! base-cast call 0xB20f000000000000000000000000000000000000 "isB20(address)(bool)" 0xb200000000000000000000C2e324d24d7eEcd1fb --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo "[dev-fork-infra] Starting canonical Base fork on chain 31337..."
  pkill -f anvil 2>/dev/null || true
  pkill -f base-anvil 2>/dev/null || true
  sleep 1
  nohup base-anvil --host 127.0.0.1 --port 8545 --fork-url "${BASE_RPC_URL:-https://mainnet.base.org}" --fork-block-number 51166844 --chain-id 31337 >/dev/null 2>&1 &
  sleep 3
fi

echo "[dev-fork-infra] Deploying Base-fork contracts on chain 31337..."
TASK_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
TASK_RECIPIENT="${1:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
TASK_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
GOVERNANCE_OWNER="${GOVERNANCE_OWNER_ADDRESS:-0x0000000000000000000000000000000000009999}"
TASK_CAST="${CAST_BIN:-base-cast}"
TASK_FORGE="${FORGE_BIN:-base-forge}"
TASK_USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
USDC_WHALE="0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"

(
  cd contracts
  PRIVATE_KEY="$TASK_KEY" GOVERNANCE_OWNER_ADDRESS="$GOVERNANCE_OWNER" \
    "$TASK_FORGE" script script/DeployBaseForkOthelio.s.sol \
      --tc DeployBaseForkOthelio \
      --rpc-url "$TASK_RPC_URL" \
      --broadcast \
      --slow
)

echo "[dev-fork-infra] Funding recipient $TASK_RECIPIENT with Base USDC and ETH..."
"$TASK_CAST" rpc anvil_impersonateAccount "$USDC_WHALE" --rpc-url "$TASK_RPC_URL" >/dev/null
"$TASK_CAST" rpc anvil_setBalance "$USDC_WHALE" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL" >/dev/null
"$TASK_CAST" send "$TASK_USDC" "transfer(address,uint256)" "$TASK_RECIPIENT" 100000000000 \
  --from "$USDC_WHALE" --unlocked --rpc-url "$TASK_RPC_URL" >/dev/null
"$TASK_CAST" rpc anvil_stopImpersonatingAccount "$USDC_WHALE" --rpc-url "$TASK_RPC_URL" >/dev/null
"$TASK_CAST" rpc anvil_setBalance "$TASK_RECIPIENT" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL" >/dev/null

echo "[dev-fork-infra] Creating initial sample basket on Base fork..."
DEPLOYMENT_JSON="contracts/broadcast/DeployBaseForkOthelio.s.sol/31337/run-latest.json"
if [ ! -f "$DEPLOYMENT_JSON" ]; then
  echo "[dev-fork-infra] Missing fork deployment manifest: $DEPLOYMENT_JSON" >&2
  exit 1
fi
FACTORY_TO_CALL="$(node -p "JSON.parse(require('fs').readFileSync('$DEPLOYMENT_JSON', 'utf8')).returns.factoryAddr.value")"
"$TASK_CAST" send "$FACTORY_TO_CALL" "createBasket(string)" "Tech 7 Index Basket" \
  --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL" >/dev/null || true

echo "[dev-fork-infra] Successfully bootstrapped Base fork environment on chain 31337 for $TASK_RECIPIENT!"
echo "[dev-fork-infra] Othelio factory: $FACTORY_TO_CALL"
