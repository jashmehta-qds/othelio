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

# RPC providers can briefly return 429s (especially while the indexer is
# catching up). Probe the configured endpoint first, then fall back to Base's
# public endpoint so a transient provider limit does not tear down the whole
# dev stack.
RPC_ENDPOINTS=("$BASE_RPC_URL")
if [[ "$BASE_RPC_URL" != "https://mainnet.base.org" ]]; then
  RPC_ENDPOINTS+=("https://mainnet.base.org")
fi
ACTIVE_RPC=""
for candidate in "${RPC_ENDPOINTS[@]}"; do
  for attempt in 1 2 3; do
    if RPC_CHAIN_ID="$(base-cast chain-id --rpc-url "$candidate" 2>/dev/null)" \
      && [[ "$RPC_CHAIN_ID" == "8453" ]] \
      && RPC_HEAD="$(base-cast block-number --rpc-url "$candidate" 2>/dev/null)" \
      && [[ "$RPC_HEAD" =~ ^[0-9]+$ ]]; then
      ACTIVE_RPC="$candidate"
      break 2
    fi
    sleep "$attempt"
  done
done
if [[ -z "$ACTIVE_RPC" ]]; then
  echo "Unable to reach a Base RPC endpoint (the configured provider may be rate limited)."
  exit 1
fi
if [[ "$ACTIVE_RPC" != "$BASE_RPC_URL" ]]; then
  echo "Configured Base RPC is rate limited; using $ACTIVE_RPC for this session."
  export BASE_RPC_URL="$ACTIVE_RPC"
  export RPC_URL="$ACTIVE_RPC"
  export NEXT_PUBLIC_BASE_RPC_URL="$ACTIVE_RPC"
fi

if [[ "${START_BLOCK:-}" == "latest" ]]; then
  LATEST_BLOCK=""
  for attempt in 1 2 3; do
    if LATEST_BLOCK="$(base-cast block-number --rpc-url "$BASE_RPC_URL" 2>/dev/null)" && [[ "$LATEST_BLOCK" =~ ^[0-9]+$ ]]; then
      break
    fi
    sleep "$attempt"
  done
  if ! [[ "$LATEST_BLOCK" =~ ^[0-9]+$ ]]; then
    echo "Could not resolve the current Base block from the RPC."
    exit 1
  fi
  # The Rust indexer treats START_BLOCK as an inclusive anchor and subtracts
  # one internally, so use head + 1 to begin at the current head.
  export START_BLOCK="$((LATEST_BLOCK + 1))"
  INDEXER_START_BLOCK="$LATEST_BLOCK"
  echo "Base indexer will begin at block $INDEXER_START_BLOCK."
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.staging.yml up -d postgres
docker compose --env-file "$ENV_FILE" -f docker-compose.staging.yml run --rm database-migrations

if [[ -n "${INDEXER_START_BLOCK:-}" ]]; then
  docker compose --env-file "$ENV_FILE" -f docker-compose.staging.yml stop indexer
  docker compose --env-file "$ENV_FILE" -f docker-compose.staging.yml exec -T postgres \
    psql -U othelio -d othelio -v ON_ERROR_STOP=1 <<SQL
BEGIN;
INSERT INTO indexer_state (chain_id, next_block) VALUES (8453, $INDEXER_START_BLOCK)
  ON CONFLICT (chain_id) DO UPDATE SET next_block=EXCLUDED.next_block, updated_at=NOW();
INSERT INTO indexer_worker_state (chain_id, worker_name, next_block) VALUES (8453, 'events', $INDEXER_START_BLOCK)
  ON CONFLICT (chain_id, worker_name) DO UPDATE SET next_block=EXCLUDED.next_block,
    last_success_block=NULL, last_success_hash=NULL, last_error=NULL, updated_at=NOW();
COMMIT;
SQL
fi

# Keep the host services independent: an indexer restart or crash should not
# tear down the backend and frontend while developing against Base RPC.
exec "$ROOT_DIR/node_modules/.bin/concurrently" \
  -n "indexer,backend,frontend" \
  -c "cyan,magenta,green" \
  "docker compose --env-file '$ENV_FILE' -f docker-compose.staging.yml up --force-recreate indexer" \
  "npm run dev:base -w @othelio/backend" \
  "npm run dev -w @othelio/fe"
