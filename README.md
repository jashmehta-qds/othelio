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

## ⚡ 1-Command Local Development (Recommended)

Start the entire Othelio stack (Anvil local chain, Postgres DB, Contract auto-deployment, Rust indexer, NestJS backend API, and Next.js frontend) in **1 command**:

```bash
# 1. Copy environment configuration (first-time setup only)
cp .env.example .env

# 2. Run the entire stack
npm run dev
```

That's it! `npm run dev` automatically handles everything in parallel:
- 🛢️ **PostgreSQL 17**: Boots database with auto-migrated schema.
- ⛓️ **Anvil EVM Chain**: Local blockchain listening on `http://localhost:8545`.
- 📜 **Contract Deployment**: Automatically executes `DeployOthelio.s.sol`.
- 🦀 **Rust Event Indexer**: Processes on-chain logs into Postgres.
- 🦁 **NestJS Backend API**: Available at `http://localhost:3001`.
- 🎨 **Next.js Frontend App**: Available at `http://localhost:3000`.

---

## 🛠️ Manual & Granular Commands (Optional)

If you prefer to run specific components independently:

| Component | Command |
| :--- | :--- |
| **All Infrastructure (Docker)** | `npm run dev:infra` or `docker compose up --build` |
| **NestJS Backend API** | `npm run dev:backend` |
| **Next.js Frontend** | `npm run dev:fe` |
| **Smart Contract Tests** | `cd contracts && forge test` |
| **TypeScript Typecheck** | `npm run typecheck` |
