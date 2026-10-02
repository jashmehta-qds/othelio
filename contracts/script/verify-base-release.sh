#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

: "${BASE_RPC_URL:?BASE_RPC_URL must be an archival Base RPC for the release gate}"

# Standard Foundry does not emulate Base's B20 precompile during forked
# simulation. Use Base Foundry by default; callers may override this explicitly
# when they have an equivalent Base-aware binary installed elsewhere.
FORGE_BIN="${FORGE_BIN:-base-forge}"
command -v "$FORGE_BIN" >/dev/null 2>&1 || {
  echo "Base-aware Foundry binary not found: $FORGE_BIN" >&2
  echo "Install Base Foundry or set FORGE_BIN to an equivalent Base-aware forge binary." >&2
  exit 1
}

REQUIRE_BASE_RELEASE_TESTS=true \
  "$FORGE_BIN" test \
    --match-contract BaseReleasePreflightForkTest \
    --match-test testFork_ProductionLaunchManifestAndB20Execution \
    -vvv
