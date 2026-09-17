#!/usr/bin/env bash
set -euo pipefail

: "${BASE_RPC_URL:?BASE_RPC_URL must be an archival Base RPC for the release gate}"

REQUIRE_BASE_RELEASE_TESTS=true \
  "${FORGE_BIN:-forge}" test \
    --match-contract BaseReleasePreflightForkTest \
    --match-test testFork_ProductionLaunchManifestAndB20Execution \
    -vvv
