#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OTHELIO_BASE_ENV_FILE:-$ROOT_DIR/.env.base}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Create it from .env.base.example and set BASE_RPC_URL to your Base RPC endpoint."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "${CHAIN_ID:-}" != "8453" || "${NEXT_PUBLIC_CHAIN_ID:-}" != "8453" ]]; then
  echo "Base profile requires CHAIN_ID=8453 and NEXT_PUBLIC_CHAIN_ID=8453."
  exit 1
fi
if [[ -z "${BASE_RPC_URL:-}" || "${BASE_RPC_URL}" == *"your-base-rpc"* ]]; then
  echo "Set BASE_RPC_URL in $ENV_FILE before starting the Base profile."
  exit 1
fi

export PATH="$HOME/.foundry/bin:$PATH"
cd "$ROOT_DIR"

RPC_CHAIN_ID="$(base-cast chain-id --rpc-url "$BASE_RPC_URL")"
if [[ "$RPC_CHAIN_ID" != "8453" ]]; then
  echo "RPC returned chain ID $RPC_CHAIN_ID; refusing to start the Base profile."
  exit 1
fi

if [[ "${START_BLOCK:-}" == "latest" ]]; then
  LATEST_BLOCK="$(base-cast block-number --rpc-url "$BASE_RPC_URL")"
  if ! [[ "$LATEST_BLOCK" =~ ^[0-9]+$ ]]; then
    echo "Could not resolve the current Base block from the RPC."
    exit 1
  fi
  # The Rust indexer treats START_BLOCK as an inclusive anchor and subtracts
  # one internally, so use head + 1 to begin at the current head.
  export START_BLOCK="$((LATEST_BLOCK + 1))"
  echo "Base indexer will begin at block $START_BLOCK."
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.base.yml up -d postgres
docker compose --env-file "$ENV_FILE" -f docker-compose.base.yml run --rm database-migrations

exec "$ROOT_DIR/node_modules/.bin/concurrently" -k \
  -n "indexer,backend,frontend" \
  -c "cyan,magenta,green" \
  "docker compose --env-file '$ENV_FILE' -f docker-compose.base.yml up --force-recreate indexer" \
  "npm run dev:base -w @othelio/backend" \
  "npm run dev -w @othelio/fe"
