# Othelio Protocol Workspace

Othelio is a personal tokenized-stock basket protocol built on Base. Users manage custom stock portfolios (B20 tokens like `AAPLc`, `NVDAc`, `GOOGLc`) through dedicated Safe Smart Accounts secured by custom modules, guards, and Chainlink price feeds.

---

## 🏗️ Architecture Blueprint

- **`contracts/`**: Foundry framework containing `OthelioAssetRegistry`, `BasketOracle`, `OthelioBasketModule`, `OthelioBasketGuard`, `OthelioSafeFactory`, and `TokenizedAssetConstants`.
- **`indexer/`**: High-performance **Rust Event Indexer** (`othelio-indexer`) built with Tokio, Ethers-rs, and SQLx.
- **`backend/`**: NestJS REST API serving basket holdings, portfolio NAV, and Time-Weighted Return (TWR) performance.
- **`fe/`**: Next.js frontend built with Wagmi, Viem, and dynamic WebGL emblem visuals.
- **`database/`**: PostgreSQL migrations (`001_initial.sql`) for indexer state, events, and snapshot historical series.

---

## 🛠️ Prerequisites

Ensure you have the following installed on your machine:
1. **Node.js**: `>= 22.0.0`
2. **Docker & Docker Desktop**: For containerized database, blockchain, indexer, and backend infrastructure.

---

## ⚡ Local Development

The local chain is started separately from application services. This keeps basket addresses, balances, and indexed activity stable while you restart the frontend, backend, or indexer.

```bash
# 1. Copy environment configuration (first-time setup only)
cp .env.example .env

# 2. Start the local chain, database, contracts, and fixtures once
npm run dev:chain

# 3. Start the indexer, backend, and frontend. Safe to stop and restart.
npm run dev:services
```

`npm run dev` is an alias for `npm run dev:services` after the chain has been started.

Use `npm run dev:reset` only when you want a fresh local chain. It removes the local Postgres volume and all local chain/indexed history before bootstrapping a new environment.

### After a contract change

Any Solidity bytecode change requires a fresh local deployment. Use this sequence:

```bash
# Stops local containers, deletes the local Postgres volume and starts a new Anvil deployment.
npm run dev:reset

# Start the application services after the chain is healthy.
npm run dev:services

# Optional: fund a non-default connected wallet. This does not reset the chain.
./scripts/fund-local-wallet.sh <wallet-address> 100000
```

The reset path deploys the registry, oracle, route registry, adapters, portfolio module, and Safe factory; installs mock USDC/B20 code; and seeds router B20 plus USDC liquidity. `scripts/fund-local-wallet.sh` only funds a wallet. `contracts/script/bootstrap-local-anvil.sh` is a standalone alternative that resets Anvil, so do not run it after `dev:reset`.

Local addresses may change after a reset because the fork state and deployment sequence affect deployer nonces. After every deployment, confirm the broadcast output and update every consumer before starting services:

| Consumer | Values to verify |
| --- | --- |
| `fe/src/lib/contracts.ts` | `31337` factory, module, registry, oracle, adapters, router, USDC |
| `docker-compose.yml` | indexer `FACTORY_ADDRESS` and `MODULE_ADDRESS` |
| `.env` (local, ignored) and `.env.example` | factory, module, registry, oracle |
| `contracts/broadcast/.../run-latest.json` | deployed contract addresses and transaction receipts |
| Postgres / indexer | reset chain-specific indexed data or use `npm run dev:reset`; never retain old events against a fresh Anvil chain |

The local indexer must start at the configured Anvil fork block, not block `0`; otherwise it attempts to replay Base mainnet history through the fork provider. `docker-compose.yml` sets this automatically for the bundled fork.

Do not copy any `31337` address to Base mainnet. Production deployments require their own broadcast review, governance owner, pinned-route verification, and Base fork tests.

---

## 🛠️ Manual & Granular Commands (Optional)

If you prefer to run specific components independently:

| Component | Command |
| :--- | :--- |
| **Chain bootstrap (Anvil, Postgres, contracts, fixtures)** | `npm run dev:chain` |
| **Application services (indexer, backend, frontend)** | `npm run dev:services` |
| **Rebuild only the Rust indexer** | `npm run dev:indexer:rebuild` |
| **Fresh local environment — destructive** | `npm run dev:reset` |
| **NestJS Backend API** | `npm run dev:backend` |
| **Next.js Frontend** | `npm run dev:fe` |
| **Smart Contract Tests** | `cd contracts && forge test` |
| **TypeScript Typecheck** | `npm run typecheck` |
