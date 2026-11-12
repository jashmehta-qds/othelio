#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/contracts/deployments/base-mainnet-upside.json"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ -f "$ROOT/.env.base" ]] || fail 'Missing .env.base'
[[ -z "${PRIVATE_KEY:-}" ]] || fail 'Do not pass plaintext PRIVATE_KEY in environment'

printf '=== Create Upside Round Script (Base Mainnet) ===\n'
printf 'Requires verified feed reference and owner wallet signature.\n'
printf 'Use the Othelio Admin Console or forge script with encrypted keystore.\n'
