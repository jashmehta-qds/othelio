# Two-network environment design

## Intent

Keep exactly two supported runtime environments across Othelio:

- `31337`: a local Base fork at `http://127.0.0.1:8545`, with Base protocol state and locally deployed Othelio contracts.
- `8453`: real Base mainnet, with production Othelio deployments and a real Base RPC.

The visible frontend UI is out of scope. Existing screens, labels, and copy remain unchanged.

## Source of truth

`packages/shared` will own the cross-layer TypeScript network contract:

- supported chain IDs and their type;
- canonical network classification helpers;
- shared deployment-address shape;
- shared external infrastructure address shape where the frontend/backend need the same values.

RPC URLs and deployment addresses remain runtime configuration because the fork and mainnet have different endpoints and Othelio deployments.

## Runtime behavior

The fork bootstrap will always start Base-compatible Anvil with chain ID `31337`. The fork deployment path will deploy the Base Othelio contracts against that fork while using Base infrastructure addresses from forked state. The production deployment path remains guarded to `8453` and will not accept `31337`.

The fork and mainnet must use separate environment/database configuration and separate Othelio deployment addresses. The indexer must reject an RPC whose observed chain ID does not match its configured chain ID.

## Layer changes

- Shared: add the canonical network contract and export it from the package entry point.
- Contracts: separate Base-fork deployment authorization from production Base authorization; preserve Base protocol addresses and avoid local mock protocol deployment in the fork path.
- Indexer: consume the two-chain contract in its TypeScript-facing configuration where applicable, retain strict RPC chain validation, and remove assumptions that `31337` means mock Anvil.
- Backend: route both supported chain IDs through Base-compatible Aave/Aerodrome/USDC configuration and remove local-only protocol behavior from the fork runtime.
- Frontend: update internal wagmi transports and contract-address selection only; do not change visible UI components or copy.
- Docker/scripts/env: make `dev:fork` the canonical local workflow, use `31337` for the fork, and document the two RPC/chain combinations.
- Tests: add regression coverage for the shared network contract, fork-vs-mainnet deployment guards, and RPC chain mismatch behavior. Existing unit-test mocks may remain as test fixtures and do not constitute a third runtime environment.

## Explicit non-goals

- No UI redesign or user-facing network-label changes.
- No Base mainnet deployment or migration.
- No deletion of historical broadcast artifacts.
- No removal of isolated unit-test mocks where tests need them.
- No support for Base Sepolia (`84532`) in the active application runtime.

## Verification

Run shared/backend/frontend typechecks, targeted contract tests, indexer checks, and a local fork smoke test. Verify that MetaMask transactions on `31337` use localhost and that `8453` remains the only real Base path. Do not claim fork verification if the local RPC is unavailable.
