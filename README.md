# Othelio Protocol Workspace

Othelio is a personal tokenized-stock basket protocol built on Base. Users manage custom stock portfolios (B20 tokens like `AAPLc`, `NVDAc`, `GOOGLc`) through dedicated Safe Smart Accounts secured by custom modules, guards, and Chainlink price feeds.

---

## 🏗️ Architecture Blueprint

- **`contracts/`**: Foundry framework containing `OthelioAssetRegistry`, `BasketOracle`, `OthelioBasketModule`, `OthelioBasketGuard`, `OthelioSafeFactory`, and `TokenizedAssetConstants`.
- **`indexer/`**: High-performance **Rust Event Indexer** (`othelio-indexer`) built with Tokio, Ethers-rs, and SQLx.
- **`backend/`**: Fastify REST & GraphQL API serving basket holdings, portfolio NAV, and Time-Weighted Return (TWR) performance.
- **`fe/`**: Next.js frontend built with Wagmi, Viem, and dynamic WebGL emblem visuals.
- **`database/`**: PostgreSQL migrations (`001_initial.sql`) for indexer state, events, and snapshot historical series.

---

## 🛠️ Prerequisites

Ensure you have the following installed on your machine:
1. **Node.js**: `>= 22.0.0`
2. **Foundry** (`forge`, `anvil`): Install via `curl -L https://foundry.paradigm.xyz | bash && foundryup`
3. **Docker & Docker Compose** (or local **PostgreSQL 17**): For running the database and indexer container.

---

## ⚡ 1-Command Local Development (Recommended)

Start the entire Othelio stack (Anvil local chain, Postgres DB, Contract deployment, Rust indexer, Backend API, and Next.js frontend) with a single command:

```bash
# 1. Setup environment file (if not done yet)
cp .env.example .env

# 2. Start the entire local stack in 1 command
npm run dev
```

This single command automatically boots:
- 🛢️ **PostgreSQL 17** (with auto-migrated tables)
- ⛓️ **Anvil EVM Chain** (`http://localhost:8545`)
- 📜 **Auto-Contract Deployment** (`DeployOthelio.s.sol`)
- 🦀 **Rust Event Indexer** (`othelio-indexer`)
- ⚡ **Fastify Backend API** (`http://localhost:3001`)
- 🎨 **Next.js Frontend App** (`http://localhost:3000`)

---

### 2. Start PostgreSQL Database
Using Docker Compose (Recommended):
```bash
docker compose up -d postgres
```
*Note: This automatically initializes the schema from `database/migrations/001_initial.sql`.*

If running local PostgreSQL manually on macOS:
```bash
# Create database and user
psql -U postgres -c "CREATE DATABASE othelio;"
psql -U postgres -c "CREATE USER othelio WITH PASSWORD 'othelio';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE othelio TO othelio;"

# Apply initial schema migration
psql -U postgres -d othelio -f database/migrations/001_initial.sql
```

---

### 3. Run Local Blockchain & Deploy Contracts

**Terminal 1: Start Anvil local EVM node**
```bash
anvil
```
*(Runs local EVM chain on `http://127.0.0.1:8545` with Chain ID `31337`)*

**Terminal 2: Deploy Protocol Smart Contracts**
```bash
cd contracts
COINBASE_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000 \
forge script script/DeployOthelio.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

Deploys contract suite and prints deployed addresses:
- **`OthelioAssetRegistry`**: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- **`BasketOracle`**: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- **`OthelioBasketModule`**: `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`
- **`OthelioBasketGuard`**: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`
- **`OthelioSafeFactory`**: `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`

---

### 4. Run Rust Indexer Service
```bash
docker compose up --build indexer
```
*(Monitors on-chain `BasketCreated`, `BasketRebalanced`, and `BasketWithdrawn` events and writes snapshots to Postgres).*

---

### 5. Run Backend & Frontend

**Backend API**:
```bash
npm run dev:backend
```

**Frontend Web App**:
```bash
cd fe
yarn dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🧪 Testing

### Smart Contract Test Suite (Forge)
```bash
cd contracts
forge test
```
*Executes all 10 unit test suites covering Guard transfer/approve intercepts, Oracle staleness validation, and Module pre/post swap balance deltas.*

### Frontend Typecheck
```bash
cd fe
npx tsc --noEmit
```
