# Risk Split Base Deployment Implementation Plan

**Goal:** Add guarded Base mainnet scripts to deploy the Risk Split factory and adapter, then separately create a specifically configured MSFTc series.

**Architecture:** Shell wrappers load the existing Base RPC profile, resolve and verify MSFTc and its Chainlink feed from the Solidity token registry, and use an encrypted Foundry keystore account. Foundry scripts construct deployment and series-creation transactions; every broadcast has an independent simulation and typed confirmation.

**Tech Stack:** Bash, Foundry `forge`/`cast`, Solidity, jq, Python 3 standard library.

**Spec:** `docs/superpowers/specs/2026-11-09-risksplit-base-deployment-design.md`

## Global Constraints

- Chain must be Base mainnet, chain ID 8453.
- Never accept, export, print, or persist `PRIVATE_KEY`.
- MSFTc and feed addresses come from `TokenizedAssetConstants.sol` and must match live Base RPC metadata.
- Factory/adapter deployment and first-series creation are separate guarded operations.
- Emit one rich `SeriesCreated` event; indexer retains historical event compatibility.

## Review Focus

- Accidental broadcast on a fork or other chain — chain ID check before simulation/broadcast.
- Plaintext key inherited from shell or profile — reject non-empty `PRIVATE_KEY` before Foundry.
- Wrong or stale MSFTc/Chainlink deployment — verify code, token symbol/decimals, feed decimals and round freshness.
- Malformed series terms or expiry — require explicit prices and timestamp, check constraints and require separate typed confirmation.
- ABI drift between factory and indexer — preserve legacy decoders and decode the new rich event.

### Task 1: Guarded contract deployment

**Files:** `contracts/script/risksplit/DeployRiskSplit.s.sol`, `scripts/deploy-risksplit-base.sh`, `contracts/deployments/base-mainnet-risksplit.json` (generated), `docs/risksplit/base-launch-runbook.md`.

- [ ] Add chain, wallet, RPC, asset/feed, balance, simulation, explicit confirmation, broadcast and result recording.
- [ ] Use `--account`/`--sender`; reject plaintext `PRIVATE_KEY`.
- [ ] Document encrypted keystore setup and deploy command.

### Task 2: Separate series creation

**Files:** `contracts/script/risksplit/CreateMsftcSeries.s.sol`, `scripts/create-risksplit-series-base.sh`, deployment runbook.

- [ ] Replace hard-coded 85%/125% and Unix-week expiry arithmetic with explicit parameters.
- [ ] Validate inputs, simulate, require independent confirmation, broadcast approval and creation.

### Task 3: Canonical series event

**Files:** `contracts/src/risksplit/SeriesFactory.sol`, `contracts/src/risksplit/interfaces/ISeriesFactory.sol`, `packages/shared/src/risksplit/contracts.ts`, `indexer/src/abis.rs`, `indexer/src/risksplit.rs`.

- [ ] Emit a single rich `SeriesCreated` event.
- [ ] Decode the new event and preserve legacy event decoding for already deployed factories.

**Execution note:** Do not broadcast to Base in this implementation task. Do not alter unrelated dirty files.
