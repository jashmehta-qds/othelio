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
