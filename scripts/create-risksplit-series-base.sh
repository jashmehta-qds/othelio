#!/usr/bin/env bash
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/contracts/deployments/base-mainnet-risksplit.json"
KEYSTORE_ACCOUNT="${RISK_SPLIT_KEYSTORE_ACCOUNT:-othelio-base-deployer}"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
lower() { tr '[:upper:]' '[:lower:]'; }
normalize_scalar() { tr -d '[]" ,\r\n'; }
[[ -z "${PRIVATE_KEY:-}" ]] || fail 'PRIVATE_KEY is set in this shell. Unset it and use the encrypted Foundry keystore account.'
[[ -f "$ROOT/.env.base" ]] || fail 'Missing .env.base. Set up the Base RPC profile first.'
[[ -f "$MANIFEST" ]] || fail "Missing deployment manifest $MANIFEST. Deploy the factory and adapter first."
while IFS= read -r profile_line || [[ -n "$profile_line" ]]; do
  profile_line="${profile_line#"${profile_line%%[![:space:]]*}"}"
  profile_line="${profile_line#export }"
  if [[ "$profile_line" =~ ^PRIVATE_KEY[[:space:]]*= ]]; then
    fail 'PRIVATE_KEY is present in .env.base. Remove it; this flow only supports encrypted keystores.'
  fi
done < "$ROOT/.env.base"
[[ $# == 3 ]] || fail "Usage: $0 <floor-price-e8> <cap-price-e8> <expiry-unix-seconds>"
command -v cast >/dev/null || fail 'Foundry cast is required.'
command -v forge >/dev/null || fail 'Foundry forge is required.'
command -v jq >/dev/null || fail 'jq is required.'
command -v python3 >/dev/null || fail 'Python 3 is required.'

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

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$CHAIN_ID" == 8453 ]] || fail "RPC reports chain ID $CHAIN_ID; this script only works on Base mainnet (8453)."
FACTORY_ADDRESS="$(jq -r '.factoryAddress' "$MANIFEST")"
ADAPTER_ADDRESS="$(jq -r '.settlementAdapterAddress' "$MANIFEST")"
TOKEN_ADDRESS="$(jq -r '.underlyingTokenAddress' "$MANIFEST")"
FEED_ADDRESS="$(jq -r '.settlementFeedAddress' "$MANIFEST")"
MAX_STALENESS="$(jq -r '.maxStalenessSeconds' "$MANIFEST")"
[[ "$FACTORY_ADDRESS" =~ ^0x[0-9A-Fa-f]{40}$ && "$ADAPTER_ADDRESS" =~ ^0x[0-9A-Fa-f]{40}$ ]] || fail 'Deployment manifest contains invalid contract addresses.'
[[ "$TOKEN_ADDRESS" =~ ^0x[0-9A-Fa-f]{40}$ && "$FEED_ADDRESS" =~ ^0x[0-9A-Fa-f]{40}$ ]] || fail 'Deployment manifest contains invalid token/feed addresses.'

FLOOR_PRICE="$1"
CAP_PRICE="$2"
EXPIRY_TIMESTAMP="$3"
python3 - "$FLOOR_PRICE" "$CAP_PRICE" "$EXPIRY_TIMESTAMP" <<'PY'
import calendar, datetime as dt, sys, time
from zoneinfo import ZoneInfo

floor, cap, expiry = map(int, sys.argv[1:])
if floor <= 0 or cap <= floor:
    raise SystemExit("ERROR: Prices must be positive integers in Chainlink feed units (USD × 1e8), with floor below cap.")
if expiry <= int(time.time()):
    raise SystemExit("ERROR: Expiry timestamp must be in the future.")

def observed(day):
    if day.weekday() == 5:
        return day - dt.timedelta(days=1)
    if day.weekday() == 6:
        return day + dt.timedelta(days=1)
    return day

def nth_weekday(year, month, weekday, n):
    first = dt.date(year, month, 1)
    return first + dt.timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))

def last_weekday(year, month, weekday):
    last_day = calendar.monthrange(year, month)[1]
    last = dt.date(year, month, last_day)
    return last - dt.timedelta(days=(last.weekday() - weekday) % 7)

def easter_sunday(year):
    a = year % 19; b = year // 100; c = year % 100
    d = b // 4; e = b % 4; f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30; i = c // 4; k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7; m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return dt.date(year, month, day)

expiry_et = dt.datetime.fromtimestamp(expiry, dt.timezone.utc).astimezone(ZoneInfo("America/New_York"))
if expiry_et.weekday() > 4 or (expiry_et.hour, expiry_et.minute, expiry_et.second) != (16, 0, 0):
    raise SystemExit("ERROR: Expiry must be 4:00:00 PM America/New_York on a Monday-Friday trading date.")

holidays = set()
for year in (expiry_et.year - 1, expiry_et.year, expiry_et.year + 1):
    for month, day in ((1, 1), (6, 19), (7, 4), (12, 25)):
        fixed = dt.date(year, month, day)
        if month != 6 or year >= 2022:
            holidays.add(observed(fixed))
    holidays.update((nth_weekday(year, 1, 0, 3), nth_weekday(year, 2, 0, 3),
                     last_weekday(year, 5, 0), nth_weekday(year, 9, 0, 1),
                     nth_weekday(year, 11, 3, 4), easter_sunday(year) - dt.timedelta(days=2)))
date = expiry_et.date()
if date in holidays:
    raise SystemExit("ERROR: Expiry falls on a standard NYSE market holiday.")

# NYSE early-close sessions do not trade through 4:00 PM ET.
thanksgiving = nth_weekday(date.year, 11, 3, 4)
independence_day = observed(dt.date(date.year, 7, 4))
independence_early_close = independence_day - dt.timedelta(days=3 if independence_day.weekday() == 0 else 1)
early_close = {
    thanksgiving + dt.timedelta(days=1),
    dt.date(date.year, 12, 24),
    independence_early_close,
}
if date in early_close:
    raise SystemExit("ERROR: Expiry is on a standard NYSE early-close date, before the requested 4:00 PM ET fixing.")
print(expiry_et.strftime("%Y-%m-%d %I:%M:%S %p %Z"))
PY

DEPLOYER="$(cast wallet address --account "$KEYSTORE_ACCOUNT" 2>/dev/null | normalize_scalar)" || fail "Foundry keystore account '$KEYSTORE_ACCOUNT' not found. First run: cast wallet import $KEYSTORE_ACCOUNT --interactive"
OWNER="$(cast call "$FACTORY_ADDRESS" 'owner()(address)' --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$(printf '%s' "$OWNER" | lower)" == "$(printf '%s' "$DEPLOYER" | lower)" ]] || fail 'The selected keystore account is not the factory owner.'
ADAPTER_FEED="$(cast call "$ADAPTER_ADDRESS" 'priceFeed()(address)' --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$(printf '%s' "$ADAPTER_FEED" | lower)" == "$(printf '%s' "$FEED_ADDRESS" | lower)" ]] || fail 'Settlement adapter feed does not match the manifest.'
[[ "$(cast code "$FACTORY_ADDRESS" --rpc-url "$RPC_URL")" != '0x' ]] || fail 'No factory code found at manifest address.'
[[ "$(cast code "$ADAPTER_ADDRESS" --rpc-url "$RPC_URL")" != '0x' ]] || fail 'No adapter code found at manifest address.'
[[ "$(cast code "$TOKEN_ADDRESS" --rpc-url "$RPC_URL")" != '0x' ]] || fail 'No MSFTc token code found at manifest address.'
TOKEN_SYMBOL="$(cast call "$TOKEN_ADDRESS" 'symbol()(string)' --rpc-url "$RPC_URL" | normalize_scalar)"
TOKEN_DECIMALS="$(cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL" | normalize_scalar)"
[[ "$TOKEN_SYMBOL" == MSFTc && "$TOKEN_DECIMALS" == 8 ]] || fail 'The manifest token no longer matches MSFTc with 8 decimals.'

FEED_ROUND="$(cast call "$FEED_ADDRESS" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC_URL" | python3 -c 'import sys; lines=[line.split()[0] for line in sys.stdin if line.strip()]; len(lines)==5 or sys.exit("ERROR: Could not parse Chainlink latestRoundData output from cast."); [int(value) for value in lines]; print(" ".join(lines))')"
read -r ROUND_ID ANSWER STARTED_AT UPDATED_AT ANSWERED_IN_ROUND <<< "$FEED_ROUND"
python3 - "$ROUND_ID" "$ANSWER" "$STARTED_AT" "$UPDATED_AT" "$ANSWERED_IN_ROUND" "$MAX_STALENESS" "$FLOOR_PRICE" "$CAP_PRICE" <<'PY'
import sys, time
round_id, answer, started, updated, answered, max_staleness, floor, cap = map(int, sys.argv[1:])
if round_id <= 0 or answer <= 0 or updated <= 0 or answered < round_id or started > updated:
    raise SystemExit("ERROR: Chainlink latest round is invalid or incomplete.")
if updated > int(time.time()) or int(time.time()) - updated > max_staleness:
    raise SystemExit("ERROR: Chainlink MSFT/USD feed is stale or has a future timestamp.")
if not floor < answer < cap:
    raise SystemExit("ERROR: Current MSFT/USD reference price must lie strictly between the floor and cap.")
PY

printf '\nSeries creation preview\n'
printf '  Chain:          Base mainnet (8453)\n  Deployer:       %s\n  Factory:        %s\n  Settlement:     %s\n  Underlying:     MSFTc (%s)\n  Floor (USD e8): %s\n  Cap (USD e8):   %s\n  Feed round:     %s\n  Expiry (ET):    ' "$DEPLOYER" "$FACTORY_ADDRESS" "$ADAPTER_ADDRESS" "$TOKEN_ADDRESS" "$FLOOR_PRICE" "$CAP_PRICE" "$ROUND_ID"
python3 - "$EXPIRY_TIMESTAMP" <<'PY'
import datetime as dt, sys
from zoneinfo import ZoneInfo
print(dt.datetime.fromtimestamp(int(sys.argv[1]), dt.timezone.utc).astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d %I:%M:%S %p %Z"))
PY

cd "$ROOT/contracts"
RISK_SPLIT_FACTORY_ADDRESS="$FACTORY_ADDRESS" \
RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS="$ADAPTER_ADDRESS" \
RISK_SPLIT_DEPLOYER_ADDRESS="$DEPLOYER" \
RISK_SPLIT_FLOOR_PRICE_E8="$FLOOR_PRICE" \
RISK_SPLIT_CAP_PRICE_E8="$CAP_PRICE" \
RISK_SPLIT_EXPIRY_TIMESTAMP="$EXPIRY_TIMESTAMP" \
forge script script/risksplit/CreateMsftcSeries.s.sol:CreateMsftcSeries \
  --rpc-url "$RPC_URL" --account "$KEYSTORE_ACCOUNT" --sender "$DEPLOYER" --slow

printf '\nThis approves the exact expiry and creates one MSFTc series on Base mainnet.\n'
read -r -p 'Type CREATE MSFTC SERIES ON OPEN TRADING DATE to continue: ' confirmation
[[ "$confirmation" == 'CREATE MSFTC SERIES ON OPEN TRADING DATE' ]] || fail 'Confirmation did not match; no transaction was broadcast.'

RISK_SPLIT_FACTORY_ADDRESS="$FACTORY_ADDRESS" \
RISK_SPLIT_SETTLEMENT_ADAPTER_ADDRESS="$ADAPTER_ADDRESS" \
RISK_SPLIT_DEPLOYER_ADDRESS="$DEPLOYER" \
RISK_SPLIT_FLOOR_PRICE_E8="$FLOOR_PRICE" \
RISK_SPLIT_CAP_PRICE_E8="$CAP_PRICE" \
RISK_SPLIT_EXPIRY_TIMESTAMP="$EXPIRY_TIMESTAMP" \
forge script script/risksplit/CreateMsftcSeries.s.sol:CreateMsftcSeries \
  --rpc-url "$RPC_URL" --account "$KEYSTORE_ACCOUNT" --sender "$DEPLOYER" --slow --broadcast
