#!/usr/bin/env bash
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONSTANTS="$ROOT/contracts/src/constants/TokenizedAssetConstants.sol"
KEYSTORE_ACCOUNT="${UPSIDE_KEYSTORE_ACCOUNT:-othelio-base-deployer}"
MAX_STALENESS="${UPSIDE_MAX_STALENESS_SECONDS:-86400}"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ ! -e "$ROOT/contracts/deployments/base-mainnet-upside.json" ]] || fail 'A Base Upside deployment manifest already exists; inspect it before attempting another deployment.'
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

FORGE_BIN="$HOME/.foundry/bin/base-forge"
if [[ ! -x "$FORGE_BIN" ]]; then
  FORGE_BIN="forge"
fi

printf '=== Stock Upside Markets Base Mainnet Deployment ===\n'
printf 'RPC URL: %s\n' "$RPC_URL"
printf 'Keystore Account: %s\n' "$KEYSTORE_ACCOUNT"
printf 'Using Foundry Binary: %s\n' "$FORGE_BIN"

# Dry run first
printf 'Simulating deployment script...\n'
$FORGE_BIN script contracts/script/upside/DeployUpside.s.sol:DeployUpside \
  --root "$ROOT/contracts" \
  --rpc-url "$RPC_URL"

printf 'Simulation passed. To broadcast live to Base mainnet, run with --broadcast --account %s\n' "$KEYSTORE_ACCOUNT"
