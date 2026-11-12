#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OTHELIO_BASE_ENV_FILE:-$ROOT_DIR/.env.base}"
if [[ "$ENV_FILE" != /* ]]; then
  ENV_FILE="$ROOT_DIR/$ENV_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Create it from .env.base.example, then set Base RPC and backend configuration."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "${CHAIN_ID:-}" != "8453" || "${NEXT_PUBLIC_CHAIN_ID:-}" != "8453" ]]; then
  echo "Base admin profile requires CHAIN_ID=8453 and NEXT_PUBLIC_CHAIN_ID=8453."
  exit 1
fi
if [[ -z "${NEXT_PUBLIC_BASE_RPC_URL:-}" || "${NEXT_PUBLIC_BASE_RPC_URL}" == *"replace-with-browser-key"* ]]; then
  echo "Set NEXT_PUBLIC_BASE_RPC_URL in $ENV_FILE before starting the Base admin profile."
  exit 1
fi
if [[ -z "${NEXT_PUBLIC_BACKEND_URL:-}" ]]; then
  echo "Set NEXT_PUBLIC_BACKEND_URL in $ENV_FILE before starting the Base admin profile."
  exit 1
fi

export PATH="$HOME/.foundry/bin:$PATH"
cd "$ROOT_DIR"
exec npm run dev -w @othelio/fe-admin
