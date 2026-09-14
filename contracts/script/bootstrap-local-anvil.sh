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
OTHELIO_INSTALL_LOCAL_MOCKS=true COINBASE_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000 \
  "$TASK_FORGE" script script/DeployOthelio.s.sol --tc DeployOthelio --rpc-url "$TASK_RPC_URL" --broadcast

TASK_FACTORY=$(node -e '
  try {
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync("broadcast/DeployOthelio.s.sol/31337/run-latest.json"));
    const tx = data.transactions.find(t => t.contractName === "OthelioSafeFactory");
    console.log(tx ? tx.contractAddress : "0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3");
  } catch (e) {
    console.log("0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3");
  }
')

TASK_USDC_CODE=$("$TASK_FORGE" inspect MockUSDC deployedBytecode)
TASK_TOKEN_CODE=$("$TASK_FORGE" inspect DeployMockERC20 deployedBytecode)
TASK_ROUTER_CODE=$("$TASK_FORGE" inspect MockDEXRouter deployedBytecode)
"$TASK_CAST" rpc anvil_setCode "$TASK_USDC" "$TASK_USDC_CODE" --rpc-url "$TASK_RPC_URL"
"$TASK_CAST" rpc anvil_setCode "$TASK_ROUTER" "$TASK_ROUTER_CODE" --rpc-url "$TASK_RPC_URL"
"$TASK_CAST" send "$TASK_USDC" "mint(address,uint256)" "$TASK_RECIPIENT" 100000000000 --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL"
"$TASK_CAST" send "$TASK_USDC" "mint(address,uint256)" "$TASK_ROUTER" 100000000000 --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL"
"$TASK_CAST" rpc anvil_setBalance "$TASK_RECIPIENT" 0x56BC75E2D63100000 --rpc-url "$TASK_RPC_URL"

for TASK_TOKEN in 0xb200000000000000000000C2e324d24d7eEcd1fb 0xb200000000000000000000d9192b6B456483C2E8 0xb200000000000000000000c85a31389D71F3ecfb 0xB20000000000000000000019f6E7C675b73C2e4D 0xb2000000000000000000002D0BA3164cc74f58B7 0xB2000000000000000000004AFF16039bA04bdFBc 0xb2000000000000000000008bC8786B856E61707C 0xb200000000000000000000Ab99cFa739E253872B 0xb2000000000000000000004884b426556b92883d 0xb20000000000000000000078ee7ce2fE4908108C 0xb200000000000000000000397293Cb8cda9a10c5 0xb2000000000000000000007b9fcbd005511aCBd5 0xb2000000000000000000001e800a7f5189430cD0; do
  "$TASK_CAST" rpc anvil_setCode "$TASK_TOKEN" "$TASK_TOKEN_CODE" --rpc-url "$TASK_RPC_URL"
  "$TASK_CAST" send "$TASK_TOKEN" "mint(address,uint256)" "$TASK_ROUTER" 1000000000000000000000000 --private-key "$TASK_KEY" --rpc-url "$TASK_RPC_URL" >/dev/null
done

"$TASK_CAST" code "$TASK_FACTORY" --rpc-url "$TASK_RPC_URL" | grep -qv '^0x$'
echo "Local Anvil bootstrap complete for $TASK_RECIPIENT"
