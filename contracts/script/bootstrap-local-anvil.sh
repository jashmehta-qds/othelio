#!/usr/bin/env bash
set -euo pipefail

# Local development only: installs mock code at canonical Base addresses on Anvil.
# Usage: ./script/bootstrap-local-anvil.sh [wallet-address]
TASK_RPC_URL="${ANVIL_RPC_URL:-http://127.0.0.1:8545}"
TASK_RECIPIENT="${1:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
TASK_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
TASK_CAST="${CAST_BIN:-cast}"
TASK_FORGE="${FORGE_BIN:-forge}"
TASK_ROUTER="0xBD606f1dAE0285D55113eFC11501677B2221A4dd"
TASK_USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

"$TASK_CAST" rpc anvil_reset --rpc-url "$TASK_RPC_URL"
"$TASK_FORGE" build
RPC_URL="$TASK_RPC_URL" node ../scripts/seed-anvil-pools.js --tokens-only
"$TASK_FORGE" script script/local/DeployLocalOthelio.s.sol --tc DeployLocalOthelio --rpc-url "$TASK_RPC_URL" --broadcast

TASK_FACTORY=$(node -e '
  try {
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync("broadcast/DeployLocalOthelio.s.sol/31337/run-latest.json"));
    const tx = data.transactions.find(t => t.contractName === "OthelioSafeFactory");
    console.log(tx ? tx.contractAddress : "0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3");
  } catch (e) {
    console.log("0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3");
  }
')

RPC_URL="$TASK_RPC_URL" node ../scripts/seed-anvil-pools.js
"$TASK_CAST" send "$TASK_USDC" "mint(address,uint256)" "$TASK_RECIPIENT" 100000000000 --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL"
"$TASK_CAST" rpc anvil_setBalance "$TASK_RECIPIENT" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL"

"$TASK_CAST" code "$TASK_FACTORY" --rpc-url "$TASK_RPC_URL" | grep -qv '^0x$'
echo "Local Anvil bootstrap complete for $TASK_RECIPIENT"
