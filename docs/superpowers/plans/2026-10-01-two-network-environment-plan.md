# Two-network environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize Othelio on a local Base fork at chain ID `31337` and real Base at chain ID `8453`, with `packages/shared` as the TypeScript source of truth and no visible UI changes.

**Architecture:** The shared package will define the supported-chain contract and network classification. Each runtime consumes that contract while retaining its own RPC and deployment-address environment values. The local bootstrap will use Base-compatible fork infrastructure and a fork-specific deployment script; the production deployment path remains restricted to `8453`.

**Tech Stack:** TypeScript, npm workspaces, Next.js/wagmi, NestJS, Rust/ethers indexer, Foundry/Solidity, Docker Compose, Vitest, Foundry tests.

**Spec:** `docs/superpowers/specs/2026-10-01-two-network-environment-design.md`

## Global Constraints

- `31337` is the local Base fork and must use `http://127.0.0.1:8545`.
- `8453` is real Base and must use a real Base RPC.
- Visible frontend screens, labels, and copy must not change.
- Production deployment must remain guarded to `8453`.
- Existing unit-test mocks may remain fixtures; they are not runtime environments.
- Do not deploy, migrate, or automatically commit the dirty workspace.

## Review Focus

- A local RPC reporting `8453` or a mainnet RPC reporting `31337` must fail fast at the runtime boundary; test in the indexer and backend configuration paths.
- The fork deployment must use Base infrastructure addresses rather than the old local mock router/feed path; test the fork deployment guard/configuration.
- The frontend must select fork deployment addresses on `31337` and mainnet deployment addresses on `8453` without changing rendered UI; test internal address selection.
- Fork and mainnet indexer state must remain separated by chain ID; test configured chain selection and database key usage.
- Base Sepolia (`84532`) must not remain in active runtime configuration; test supported-chain validation and audit remaining configuration references.

### Task 1: Add the shared two-network contract

**Files:**
- Create: `packages/shared/src/networks.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `backend/src/config/network-config.spec.ts`
- Modify: `packages/shared/package.json` only if a test/build export requires it

**Interfaces:**
- Produce `BASE_FORK_CHAIN_ID = 31337`, `BASE_MAINNET_CHAIN_ID = 8453`.
- Produce `SUPPORTED_CHAIN_IDS` as a readonly tuple and `SupportedChainId` as its derived union.
- Produce `isSupportedChainId(value: number): value is SupportedChainId`.
- Produce `networkKindForChainId(value: number): 'base-fork' | 'base-mainnet'` and a clear error for unsupported IDs.
- Produce a shared `NetworkDeploymentAddresses` type used by frontend/backend configuration.

- [ ] Write a failing backend/shared test for both supported IDs, rejection of `84532`, and exact network classification.
- [ ] Run the targeted test and confirm it fails because the shared network contract does not exist.
- [ ] Implement the minimal shared module and export it from `packages/shared/src/index.ts`.
- [ ] Run the targeted test and shared typecheck.

### Task 2: Make the fork bootstrap and contract deployments canonical

**Files:**
- Modify: `scripts/dev-fork-infra.sh`
- Modify: `docker-compose.yml` and `docker-compose.fork.yml`
- Create or modify: `contracts/script/DeployBaseForkOthelio.s.sol`
- Modify: `contracts/script/DeployBaseOthelio.s.sol` only to keep production guard/config shared and strict
- Modify: `contracts/test/DeployOthelioIsolation.t.sol` or add a focused deployment-guard test
- Modify: `scripts/fund-local-wallet.sh` if its network assumptions are runtime-visible

**Interfaces:**
- Fork bootstrap starts Base-compatible Anvil with `--chain-id 31337`.
- Fork deployment accepts only `block.chainid == 31337` and uses Base USDC, Aave, Chainlink, Aerodrome, and Base token addresses from forked state.
- Production deployment accepts only `block.chainid == 8453`.

- [ ] Add failing Foundry coverage proving the fork path accepts `31337` and the production path rejects it.
- [ ] Run the focused Foundry test to confirm the guard failure before implementation.
- [ ] Implement the fork deployment path without reintroducing local mock protocol infrastructure.
- [ ] Update bootstrap/dependency wiring so `npm run dev:fork` starts only the canonical `31337` Base fork path.
- [ ] Run focused Foundry tests and a no-RPC static bootstrap check.

### Task 3: Align indexer and backend runtime configuration

**Files:**
- Modify: `indexer/src/main.rs`
- Modify: `docker-compose.fork.yml`
- Modify: backend network/configuration consumers found by the chain-ID audit, including lending and DEX adapters where they distinguish `31337` from `8453`.
- Add targeted backend tests beside the affected configuration/adapters.

**Interfaces:**
- Both `31337` and `8453` are supported runtime chain IDs.
- `31337` is treated as Base-compatible fork state, not as a local mock-only market.
- Indexer RPC chain mismatch remains a hard error.
- Indexer state remains keyed by the configured chain ID.

- [ ] Add failing tests for Base-compatible adapter selection on `31337`, real Base selection on `8453`, and rejection of unsupported IDs.
- [ ] Run them and confirm current local/mock assumptions fail.
- [ ] Implement the smallest configuration changes using shared network constants where the TypeScript boundary allows.
- [ ] Set fork Docker environment to `CHAIN_ID=31337` and fork deployment addresses.
- [ ] Run backend targeted tests, backend typecheck, and `cargo check`.

### Task 4: Align frontend internal chain and address configuration

**Files:**
- Modify: `fe/src/lib/wagmi.ts`
- Modify: `fe/src/lib/contracts.ts`
- Modify: `fe/.env.local` (ignored local file) and `.env.example`
- Modify only internal chain/config references in `fe/src/components/app-shell/AppShell.tsx` if required for correct RPC selection; do not alter visible UI output.
- Add or update focused frontend tests for address selection/config validation.

**Interfaces:**
- `31337` uses `http://127.0.0.1:8545` and fork deployment addresses.
- `8453` uses the configured real Base RPC and production deployment addresses.
- No `84532` active runtime chain remains.

- [ ] Add a failing test for selecting fork versus mainnet deployment addresses by chain ID.
- [ ] Run it and confirm current hardcoded mappings fail the intended fork-address assertion.
- [ ] Implement internal wagmi transport/address selection using the shared network contract.
- [ ] Preserve all existing visible components, labels, and copy.
- [ ] Run focused frontend tests and typecheck/build checks as available.

### Task 5: Environment templates, documentation, and end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `README.md`
- Modify: relevant Docker and npm scripts only where needed to make `dev:fork` the documented local workflow.
- Add/update verification notes under `.trellis/tasks/09-09-portfolio-first-remediation/` if required by the existing task.

- [ ] Audit all active code/config references for `84532`, mock-only `31337` assumptions, and conflicting fork RPC values.
- [ ] Run shared/backend/frontend typechecks, focused Foundry tests, indexer `cargo check`, and available workspace tests.
- [ ] If the local RPC is available, run the fork smoke test and verify the observed chain ID is `31337` before any transaction test.
- [ ] Confirm no visible UI files changed except unavoidable internal configuration references.
- [ ] Report any pre-existing or environment-blocked failures explicitly; do not claim successful fork verification without a live fork RPC.

## Execution Notes

Implement task-by-task with tests first. Preserve all existing staged and unstaged user changes. Do not run destructive cleanup, rewrite broadcast history, or create commits automatically.
