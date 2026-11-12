#!/usr/bin/env bash
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSTANTS="$ROOT/contracts/src/constants/TokenizedAssetConstants.sol"
KEYSTORE_ACCOUNT="${RISK_SPLIT_KEYSTORE_ACCOUNT:-othelio-base-deployer}"
MAX_STALENESS="${RISK_SPLIT_MAX_STALENESS_SECONDS:-86400}"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ ! -e "$ROOT/contracts/deployments/base-mainnet-risksplit.json" ]] || fail 'A Base Risk Split deployment manifest already exists; inspect it before attempting another deployment.'
[[ -z "${PRIVATE_KEY:-}" ]] || fail 'PRIVATE_KEY is set in this shell. Unset it and use the encrypted Foundry keystore account.'
[[ -f "$ROOT/.env.base" ]] || fail 'Missing .env.base. Copy .env.base.example and set the Base RPC URL.'
while IFS= read -r profile_line || [[ -n "$profile_line" ]]; do
  profile_line="${profile_line#"${profile_line%%[![:space:]]*}"}"
  profile_line="${profile_line#export }"
  if [[ "$profile_line" =~ ^PRIVATE_KEY[[:space:]]*= ]]; then
    fail 'PRIVATE_KEY is present in .env.base. Remove it; this deploy flow only supports encrypted keystores.'
  fi
done < "$ROOT/.env.base"

read_profile_value() {
  local name="$1" line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#export }"
    [[ "$line" == "$name="* ]] || continue
    value="${line#*=}"
    value="${value%$'\r'}"
    if [[ "$value" == \"*\" ]]; then value="${value#\"}"; value="${value%\"}"; fi
    if [[ "$value" == \'*\' ]]; then value="${value#\'}"; value="${value%\'}"; fi
    printf '%s' "$value"
    return 0
  done < "$ROOT/.env.base"
}

PROFILE_BASE_RPC_URL="$(read_profile_value BASE_RPC_URL)"
PROFILE_RPC_URL="$(read_profile_value RPC_URL)"
RPC_URL="${BASE_RPC_URL:-${PROFILE_BASE_RPC_URL:-${RPC_URL:-$PROFILE_RPC_URL}}}"
[[ -n "$RPC_URL" ]] || fail 'Set BASE_RPC_URL or RPC_URL in .env.base.'
command -v python3 >/dev/null || fail 'Python 3 is required for preflight validation.'
normalize_scalar() { awk 'NF { print $1; exit }' | tr -d '[]" ,\r\n'; }
python3 - "$RPC_URL" <<'PY'
import ipaddress, sys
from urllib.parse import urlparse
host = (urlparse(sys.argv[1]).hostname or "").lower()
try:
    local_ip = ipaddress.ip_address(host).is_loopback or ipaddress.ip_address(host).is_private
except ValueError:
    local_ip = host in {"localhost", "host.docker.internal", "anvil"} or host.endswith((".local", ".internal"))
if local_ip:
    raise SystemExit("ERROR: Local/private RPC hosts are refused; use a Base mainnet RPC endpoint.")
PY
[[ -f "$CONSTANTS" ]] || fail 'Cannot find TokenizedAssetConstants.sol.'
command -v forge >/dev/null || fail 'Foundry forge is required.'
command -v cast >/dev/null || fail 'Foundry cast is required.'
command -v jq >/dev/null || fail 'jq is required to record the deployment result.'

sol_constant() {
  local name="$1" value
  value="$(awk -v n="$name" '$0 ~ "constant[[:space:]]+" n "[[:space:]]*=" { sub(/.*=[[:space:]]*/, ""); sub(/;.*/, ""); print; exit }' "$CONSTANTS")"
  [[ "$value" =~ ^0x[0-9A-Fa-f]{40}$ ]] || fail "Could not resolve $name from TokenizedAssetConstants.sol."
  printf '%s' "$value"
}

TOKEN_ADDRESS="$(sol_constant MSFTc)"
FEED_ADDRESS="$(sol_constant FEED_MSFT)"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$CHAIN_ID" == 8453 ]] || fail "RPC reports chain ID $CHAIN_ID; this script only broadcasts to Base mainnet (8453)."

DEPLOYER="$(cast wallet address --account "$KEYSTORE_ACCOUNT" 2>/dev/null | normalize_scalar)" || fail "Foundry keystore account '$KEYSTORE_ACCOUNT' not found. First run: cast wallet import $KEYSTORE_ACCOUNT --interactive"
[[ "$DEPLOYER" =~ ^0x[0-9A-Fa-f]{40}$ ]] || fail 'Could not read a valid deployer address from the Foundry keystore.'

token_code="$(cast code "$TOKEN_ADDRESS" --rpc-url "$RPC_URL")"
feed_code="$(cast code "$FEED_ADDRESS" --rpc-url "$RPC_URL")"
[[ "$token_code" != '0x' && -n "$token_code" ]] || fail 'No contract code at the reviewed MSFTc address on Base.'
[[ "$feed_code" != '0x' && -n "$feed_code" ]] || fail 'No contract code at the reviewed MSFT/USD feed address on Base.'

TOKEN_SYMBOL="$(cast call "$TOKEN_ADDRESS" 'symbol()(string)' --rpc-url "$RPC_URL" | normalize_scalar)"
TOKEN_DECIMALS="$(cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL" | normalize_scalar)"
FEED_DECIMALS="$(cast call "$FEED_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$TOKEN_SYMBOL" == MSFTc ]] || fail "The reviewed token address returned symbol '$TOKEN_SYMBOL', expected MSFTc."
[[ "$TOKEN_DECIMALS" == 8 ]] || fail "MSFTc returned $TOKEN_DECIMALS decimals, expected 8."
[[ "$FEED_DECIMALS" == 8 ]] || fail "MSFT/USD feed returned $FEED_DECIMALS decimals, expected 8."

FEED_ROUND="$(cast call "$FEED_ADDRESS" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC_URL" | python3 -c 'import sys; lines=[line.split()[0] for line in sys.stdin if line.strip()]; len(lines)==5 or sys.exit("ERROR: Could not parse Chainlink latestRoundData output from cast."); [int(value) for value in lines]; print(" ".join(lines))')"
read -r ROUND_ID ANSWER STARTED_AT UPDATED_AT ANSWERED_IN_ROUND <<< "$FEED_ROUND"
python3 - "$ROUND_ID" "$ANSWER" "$STARTED_AT" "$UPDATED_AT" "$ANSWERED_IN_ROUND" "$MAX_STALENESS" <<'PY'
import sys, time
round_id, answer, started, updated, answered, max_staleness = map(int, sys.argv[1:])
if round_id <= 0 or answer <= 0 or updated <= 0 or answered < round_id or started > updated:
    raise SystemExit("ERROR: Chainlink latest round is invalid or incomplete.")
if updated > int(time.time()):
    raise SystemExit("ERROR: Chainlink latest round timestamp is in the future.")
if int(time.time()) - updated > max_staleness:
    raise SystemExit("ERROR: Chainlink MSFT/USD feed is stale for the configured max staleness.")
PY

BALANCE_WEI="$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL")"
BALANCE_ETH="$(python3 - "$BALANCE_WEI" <<'PY'
import sys
from decimal import Decimal, InvalidOperation
try:
    balance = Decimal(sys.argv[1].strip().strip("[]").strip())
except InvalidOperation:
    raise SystemExit("ERROR: Could not parse the deployer balance returned by cast.")
if balance <= 0:
    raise SystemExit("ERROR: Deployer has no ETH on Base to pay transaction fees.")
print(f"{balance / Decimal(10**18):.6f}")
PY
)"

printf '\nBase mainnet deployment preflight\n'
printf '  Chain:          Base mainnet (8453)\n'
printf '  Deployer:       %s\n' "$DEPLOYER"
printf '  Balance:        %s ETH\n' "$BALANCE_ETH"
printf '  Asset:          %s (%s decimals)\n' "$TOKEN_SYMBOL" "$TOKEN_DECIMALS"
printf '  Token address:  %s\n' "$TOKEN_ADDRESS"
printf '  Chainlink feed: %s (round %s)\n' "$FEED_ADDRESS" "$ROUND_ID"
printf '  Max staleness:  %s seconds\n' "$MAX_STALENESS"
printf '\nSimulating deployment; no transaction will be sent in this step.\n'
cd "$ROOT/contracts"
RISK_SPLIT_FEED_ADDRESS="$FEED_ADDRESS" \
RISK_SPLIT_MAX_STALENESS_SECONDS="$MAX_STALENESS" \
forge script script/risksplit/DeployRiskSplit.s.sol:DeployRiskSplit \
  --rpc-url "$RPC_URL" --account "$KEYSTORE_ACCOUNT" --sender "$DEPLOYER" --slow

printf '\nThis will broadcast two contract deployments to Base mainnet.\n'
read -r -p 'Type DEPLOY BASE MAINNET to continue: ' confirmation
[[ "$confirmation" == 'DEPLOY BASE MAINNET' ]] || fail 'Confirmation did not match; no transaction was broadcast.'

RISK_SPLIT_FEED_ADDRESS="$FEED_ADDRESS" \
RISK_SPLIT_MAX_STALENESS_SECONDS="$MAX_STALENESS" \
forge script script/risksplit/DeployRiskSplit.s.sol:DeployRiskSplit \
  --rpc-url "$RPC_URL" --account "$KEYSTORE_ACCOUNT" --sender "$DEPLOYER" --slow --broadcast

RUN_JSON="$ROOT/contracts/broadcast/DeployRiskSplit.s.sol/8453/run-latest.json"
[[ -f "$RUN_JSON" ]] || fail "Broadcast returned; Foundry result file not found at $RUN_JSON. Record addresses from the Foundry output before proceeding."
FACTORY_ADDRESS="$(jq -r '.returns.factoryAddr.value // empty' "$RUN_JSON")"
ADAPTER_ADDRESS="$(jq -r '.returns.adapterAddr.value // empty' "$RUN_JSON")"
[[ "$FACTORY_ADDRESS" =~ ^0x[0-9A-Fa-f]{40}$ ]] || fail 'Broadcast result is missing the SeriesFactory address.'
[[ "$ADAPTER_ADDRESS" =~ ^0x[0-9A-Fa-f]{40}$ ]] || fail 'Broadcast result is missing the SettlementAdapter address.'

FACTORY_TX="$(jq -r '[.transactions[] | select(.contractName == "SeriesFactory") | (.hash // .transactionHash // empty)][0] // empty' "$RUN_JSON")"
ADAPTER_TX="$(jq -r '[.transactions[] | select(.contractName == "SettlementAdapter") | (.hash // .transactionHash // empty)][0] // empty' "$RUN_JSON")"
BLOCK_NUMBER="$(cast block-number --rpc-url "$RPC_URL")"
FACTORY_BLOCK_RAW="$(jq -r --arg address "$FACTORY_ADDRESS" '[.receipts[] | select((.contractAddress // "" | ascii_downcase) == ($address | ascii_downcase))][0].blockNumber // empty' "$RUN_JSON")"
ADAPTER_BLOCK_RAW="$(jq -r --arg address "$ADAPTER_ADDRESS" '[.receipts[] | select((.contractAddress // "" | ascii_downcase) == ($address | ascii_downcase))][0].blockNumber // empty' "$RUN_JSON")"
FACTORY_BLOCK="$(python3 - "$FACTORY_BLOCK_RAW" <<'PY'
import sys
raw = sys.argv[1]
if not raw:
    print("")
    raise SystemExit(0)
try:
    print(int(raw, 16) if raw.startswith("0x") else int(raw))
except ValueError as error:
    raise SystemExit(f"Invalid deployment receipt block: {error}")
PY
)"
ADAPTER_BLOCK="$(python3 - "$ADAPTER_BLOCK_RAW" <<'PY'
import sys
raw = sys.argv[1]
if not raw:
    print("")
    raise SystemExit(0)
try:
    print(int(raw, 16) if raw.startswith("0x") else int(raw))
except ValueError as error:
    raise SystemExit(f"Invalid deployment receipt block: {error}")
PY
)"
[[ "$(cast code "$FACTORY_ADDRESS" --rpc-url "$RPC_URL")" != '0x' ]] || fail 'Factory address has no deployed code after broadcast.'
[[ "$(cast code "$ADAPTER_ADDRESS" --rpc-url "$RPC_URL")" != '0x' ]] || fail 'Adapter address has no deployed code after broadcast.'
FACTORY_OWNER="$(cast call "$FACTORY_ADDRESS" 'owner()(address)' --rpc-url "$RPC_URL" | normalize_scalar)"
ADAPTER_FEED="$(cast call "$ADAPTER_ADDRESS" 'priceFeed()(address)' --rpc-url "$RPC_URL" | normalize_scalar)"
ADAPTER_STALENESS="$(cast call "$ADAPTER_ADDRESS" 'maxStaleness()(uint256)' --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$(printf '%s' "$FACTORY_OWNER" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$DEPLOYER" | tr '[:upper:]' '[:lower:]')" ]] || fail 'Deployed factory owner does not match the selected deployer.'
[[ "$(printf '%s' "$ADAPTER_FEED" | tr '[:upper:]' '[:lower:]')" == "$(printf '%s' "$FEED_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]] || fail 'Deployed adapter has an unexpected Chainlink feed.'
[[ "$ADAPTER_STALENESS" == "$MAX_STALENESS" ]] || fail 'Deployed adapter has an unexpected max staleness value.'
MANIFEST="$ROOT/contracts/deployments/base-mainnet-risksplit.json"
mkdir -p "$(dirname "$MANIFEST")"
jq -n \
  --argjson chainId 8453 \
  --arg networkName 'Base Mainnet' \
  --arg deployedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg deployer "$DEPLOYER" \
  --arg factoryAddress "$FACTORY_ADDRESS" \
  --arg adapterAddress "$ADAPTER_ADDRESS" \
  --arg factoryTransaction "$FACTORY_TX" \
  --arg adapterTransaction "$ADAPTER_TX" \
  --arg blockNumber "$BLOCK_NUMBER" \
  --arg factoryDeploymentBlock "$FACTORY_BLOCK" \
  --arg adapterDeploymentBlock "$ADAPTER_BLOCK" \
  --arg underlyingSymbol "$TOKEN_SYMBOL" \
  --arg underlyingTokenAddress "$TOKEN_ADDRESS" \
  --arg settlementFeedAddress "$FEED_ADDRESS" \
  --argjson maxStalenessSeconds "$MAX_STALENESS" \
  '{chainId:$chainId,networkName:$networkName,deployedAt:$deployedAt,deployer:$deployer,factoryAddress:$factoryAddress,settlementAdapterAddress:$adapterAddress,factoryTransaction:$factoryTransaction,adapterTransaction:$adapterTransaction,factoryDeploymentBlock:(if $factoryDeploymentBlock == "" then null else ($factoryDeploymentBlock|tonumber) end),adapterDeploymentBlock:(if $adapterDeploymentBlock == "" then null else ($adapterDeploymentBlock|tonumber) end),observedBlockNumber:($blockNumber|tonumber),underlyingSymbol:$underlyingSymbol,underlyingTokenAddress:$underlyingTokenAddress,settlementFeedAddress:$settlementFeedAddress,maxStalenessSeconds:$maxStalenessSeconds}' \
  > "$MANIFEST"

printf '\nDeployment recorded in %s\n' "$MANIFEST"
printf 'RISK_SPLIT_FACTORY_ADDRESS=%s\n' "$FACTORY_ADDRESS"
printf 'RISK_SPLIT_SETTLEMENT_ADAPTER=%s\n' "$ADAPTER_ADDRESS"
if [[ -n "$FACTORY_BLOCK" ]]; then printf 'RISK_SPLIT_FACTORY_START_BLOCK=%s\n' "$FACTORY_BLOCK"; fi
printf '\nUse the separate create-risksplit-series-base.sh command when you are ready to configure and create a series.\n'
