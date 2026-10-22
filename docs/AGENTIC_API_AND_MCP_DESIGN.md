# Othelio Agentic API & Model Context Protocol (MCP) Design

## Executive Summary

This document specifies the architecture for exposing Othelio's core investment functionality—basket creation, composition management, deposits, withdrawals, rebalancing, and portfolio analytics—to Autonomous AI Agents and Large Language Models (LLMs), including Anthropic Claude, OpenAI ChatGPT, Cursor, and custom agentic frameworks (CrewAI, LangChain, Eliza).

---

## 1. Should We Have an MCP Server?

### Architecture Verdict: **Dual-Layer (Agent REST/OpenAPI + Thin MCP Adapter)**

We should **not choose between REST and MCP—we need an Agent REST API with an OpenAPI 3.0 specification in NestJS documented via Scalar, coupled with a lightweight MCP Server wrapper.**

```
               ┌───────────────────────────────┐
               │    LLM / Agent Consumers      │
               └───────────────┬───────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│     Claude Desktop    │             │  ChatGPT Custom GPTs  │
│  Cursor / Claude Code │             │  LangChain / Eliza    │
│  Local Agent Runtimes │             │  External Webhooks    │
└───────────┬───────────┘             └───────────┬───────────┘
            │ MCP (stdio / SSE)                   │ REST (HTTPS / JSON)
            ▼                                     │
┌───────────────────────┐                         │
│  Othelio MCP Server   │                         │
│  (tools / resources / │                         │
│       prompts)        │                         │
└───────────┬───────────┘                         │
            │                                     │
            └──────────────────┬──────────────────┘
                               │ Internal HTTP / RPC
                               ▼
            ┌─────────────────────────────────────┐
            │       Othelio Agent REST API        │
            │          (/v1/agent/*)              │
            │   - OpenAPI 3.0 + Scalar Reference  │
            │   - Strict Server-Side Guardrails   │
            │   - Quote & Bounded Simulation      │
            └──────────────────┬──────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────┐             ┌───────────────────────┐
│     PostgreSQL DB     │             │  Base Mainnet / viem  │
│  - agent_settings     │             │  - Safe Basket Account│
│  - transaction_quotes │             │  - PortfolioModule V3 │
│  - audit_trail        │             │  - Aerodrome/Chainlink│
└───────────────────────┘             └───────────────────────┘
```

### Why Pure MCP Alone Is Insufficient:
1. **ChatGPT Actions & Web APIs**: ChatGPT Custom GPTs and standard agent workflows communicate strictly via OpenAPI 3.0 HTTP endpoints. They cannot connect directly to local MCP `stdio` servers without an intermediary cloud gateway.
2. **Transaction Life-Cycle & Webhooks**: On-chain operations require simulation, approval flows, polling for receipts, and transaction notifications. Standard HTTP endpoints with clear status lifecycles are the standard for web3 integrations.
3. **Frontend & Mobile Parity**: The web frontend and mobile agents can reuse the same clean agent REST endpoints.

### Why Adding MCP on Top Is High-Leverage:
1. **Instant Claude Integration**: Claude Desktop, Claude Code, Cursor, Windsurf, and Antigravity connect out-of-the-box to MCP servers via `claude_desktop_config.json` or `cursor/mcp.json`.
2. **Resources**: MCP allows streaming real-time basket snapshots and live asset prices directly into the LLM's context window (`othelio://basket/{address}`, `othelio://market/prices`) without wasting tool execution rounds.
3. **Prompts**: Standardized system prompts guide agents on financial guardrails, rebalance drift analysis, and risk checks before proposing actions.
4. **Human Confirmation Prompts**: MCP tools can request human confirmation before triggering on-chain transactions.

---

## 2. Security Threat Model & Human Intent Handoff (Phase 1)

In Phase 1, transactions are executed through **Intent Handoff (Non-Custodial)**: the AI agent computes allocations, quotes swaps, and stages the transaction, but **the human user retains sole signing authority**.

```
   1. User in ChatGPT/Claude: "Deposit $250 USDC into my Tech Basket"
   2. Agent calls: POST /v1/agent/baskets/:address/deposit (with X-Agent-Key)
   3. Backend Server-Side Security Checks:
      ✓ Validates Agent Key against `agent_settings`
      ✓ Checks `amountUsdc <= max_spend_per_tx_usd`
      ✓ Checks `daily_spent + amountUsdc <= daily_spend_limit_usd`
      ✓ Checks `allowed_assets` and NYSE market hours
      ✓ Simulates Aerodrome Slipstream route & bounded execution on Viem
      ✓ Seals Proposal in PostgreSQL (`agent_proposals`) with strict 5-minute TTL
   4. Agent replies with Human-Readable Summary + Secure Deep Link:
      "I've staged your $250 USDC deposit into Tech Basket. 
       Review & sign on Othelio: https://app.othelio.fi/sign/prop_98a72b"
   5. User opens app.othelio.fi, reviews decoded parameters in UI, and signs via MetaMask/Privy.
```

---

### Core Security Principles & Protections

#### 1. Zero Private Key Exposure to the LLM
* The agent never holds or receives private keys, session keys, or wallet seed phrases.
* The agent only has a scoped `X-Agent-Key` with proposal-creation and read permissions.

#### 2. Recipient Address Locking (Anti-Drain Protection)
* For all withdrawal proposals, the recipient address is **immutable and locked to the basket controller’s wallet (`account_address`)**.
* Even if an attacker uses prompt injection to make the LLM propose: *"Withdraw all funds to hacker address 0xDead..."*, the backend forcefully rejects the request or overrides the recipient to the authenticated owner's address.

#### 3. Calldata Tamper-Proofing & Double Validation
* The transaction payload (`to`, `data`, `value`, `calldata_hash`) is generated server-side and stored in PostgreSQL.
* The frontend fetching `GET /v1/proposals/:id` verifies the `calldata_hash` before presenting it to the user.
* The frontend UI decodes the calldata using Viem (`decodeFunctionData`) and renders the real, verified token amounts so the user is never signing a blind hex blob.

#### 4. Anti-MEV, Stale Quote Expiration & On-Chain Bounding
* All DEX routes are bounded on-chain by `OthelioPortfolioModule`:
  - `MAX_SWAP_VALUE_LOSS_BPS = 300` (3%) or user-defined `max_slippage_bps` against Chainlink oracles.
  - Smart contract reverts if `block.timestamp > deadline`.
* Proposals expire in 3–5 minutes. Stale proposals automatically transition to `EXPIRED` status and cannot be submitted.

#### 5. Dual Gatekeeper (In-App Notification)
* To prevent phishing (fake links pasted into LLM chats), whenever an agent stages a proposal, it immediately appears in the user’s authenticated notification drawer on `https://app.othelio.fi`. The user can simply open the official app and review pending agent proposals without clicking any external links.

---

### Phase 1 Database Schema

```sql
-- 1. Agent Guardrails (Managed strictly by authenticated human user)
CREATE TABLE IF NOT EXISTS agent_settings (
  account_address CHAR(42) PRIMARY KEY,
  api_key_hash VARCHAR(64) NOT NULL,
  autonomy_tier TEXT NOT NULL DEFAULT 'staged',
  max_spend_per_tx_usd NUMERIC(12, 2) NOT NULL DEFAULT 500.00,
  daily_spend_limit_usd NUMERIC(12, 2) NOT NULL DEFAULT 2000.00,
  spent_today_usd NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  spent_today_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  max_slippage_bps INTEGER NOT NULL DEFAULT 50,
  allowed_assets TEXT[] NOT NULL DEFAULT ARRAY['USDC', 'AAPLc', 'MSFTc', 'NVDAc', 'GOOGLc', 'AMZNc', 'METAc', 'TSLAc', 'MSTRc', 'SPCXc', 'SNDKc'],
  restrict_to_market_hours BOOLEAN NOT NULL DEFAULT true,
  min_rebalance_drift_bps INTEGER NOT NULL DEFAULT 300,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Staged Proposals (Single-use, tamper-proof, short TTL)
CREATE TABLE IF NOT EXISTS agent_proposals (
  id VARCHAR(64) PRIMARY KEY,
  account_address CHAR(42) NOT NULL,
  basket_address CHAR(42),
  action TEXT NOT NULL, -- 'CREATE_BASKET' | 'DEPOSIT' | 'WITHDRAW' | 'REBALANCE'
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'REJECTED'
  proposal_summary JSONB NOT NULL,
  transaction_call JSONB NOT NULL,
  calldata_hash VARCHAR(66) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  executed_tx_hash VARCHAR(66),
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_account_status ON agent_proposals(account_address, status);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_expires ON agent_proposals(expires_at);
```

### Autonomy Tiers Explained:
1. **`advisory` (Read-Only)**:
   - Agent can inspect portfolios, fetch prices, calculate drift, and draft trade ideas.
   - Any transaction creation or execution endpoints return structured proposals with zero executable calldata.
2. **`staged` (Human-in-the-Loop, Default)**:
   - Agent drafts and simulates transactions (validating bounded routes and slippage).
   - Generates an approval request with a direct deep link: `https://app.othelio.fi/agent/approve/{proposalId}`.
   - The user reviews and signs with their browser/mobile wallet (Metamask, Coinbase Wallet, Privy).
3. **`autonomous` (Bounded Execution)**:
   - User delegates a session key or authorises a backend relayer.
   - Within `max_spend_per_tx_usd` and `daily_spend_limit_usd`, the agent can execute directly on Base mainnet.

---

## 3. Core Functionality & Agent Endpoints

All endpoints live under `/v1/agent/*` and require authentication (API Key or Wallet Signature header).

### 3.1 Basket Lifecycle Endpoints

#### 1. `POST /v1/agent/baskets/create`
*Creates a new basket Safe account with initial target composition.*
- **Request**:
  ```json
  {
    "name": "Magnificent Tech Basket",
    "symbol": "MGT",
    "targets": [
      { "symbol": "NVDAc", "weight": 40 },
      { "symbol": "AAPLc", "weight": 30 },
      { "symbol": "MSFTc", "weight": 20 },
      { "symbol": "USDC", "weight": 10 }
    ],
    "initialDepositUsdc": "500" // Optional initial funding
  }
  ```
- **Response**:
  - In `staged` mode: Returns Factory `createBasket` calldata + initial deposit swap plan + human sign URL.
  - In `autonomous` mode: Executes contract creation, registers basket in DB, and returns `basketAddress` and `txHash`.

#### 2. `POST /v1/agent/baskets/:address/deposit`
*Adds funds in USDC to an existing basket and automatically routes through Aerodrome Slipstream into the target weights.*
- **Request**:
  ```json
  {
    "amountUsdc": "250.00",
    "maxSlippageBps": 50
  }
  ```
- **Validation**:
  - Checks if `amountUsdc <= max_spend_per_tx_usd`.
  - Checks if `spent_today_usd + amountUsdc <= daily_spend_limit_usd`.
  - Checks market hours if B20 equities are targets.
- **Response**:
  - Generates verified V3 bounded execution calldata for `fundAerodromePortfolio` on `OthelioPortfolioModule`.
  - Returns expected acquired amounts, price warnings, minimum received, and execution payload.

#### 3. `POST /v1/agent/baskets/:address/withdraw`
*Withdraws capital from the basket either in-kind (all underlying tokens) or liquidated into USDC.*
- **Request**:
  ```json
  {
    "amountUsd": "100.00",
    "kind": "in-kind", // or "usdc"
    "recipientAddress": "0xUserWallet..."
  }
  ```
- **Response**:
  - Verified withdrawal plan, simulated token transfers, and execution calldata.

#### 4. `POST /v1/agent/baskets/:address/rebalance`
*Rebalances a basket either back to its original target weights or according to an updated composition.*
- **Request**:
  ```json
  {
    "updatedTargets": [
      { "symbol": "NVDAc", "weight": 50 },
      { "symbol": "AAPLc", "weight": 50 }
    ],
    "force": false // If false, rejected if drift < min_rebalance_drift_bps
  }
  ```
- **Response**:
  - Multi-hop swap plan with Aerodrome Slipstream routes, verified against Chainlink oracle NAV bounds.

### 3.2 Read & Discovery Endpoints

#### 5. `GET /v1/agent/baskets`
*Lists all baskets managed by or associated with the user/agent with NAV, performance, and drift metrics.*

#### 6. `GET /v1/agent/baskets/:address`
*Returns granular holdings, cost basis, accounting summary, target vs current weights, and drift breakdown.*

#### 7. `GET /v1/agent/assets`
*Returns list of all tradeable B20 assets on Base, current Chainlink feed prices, oracle freshness, and whether the market is open.*

#### 8. `GET /v1/agent/settings`
*Read-only inspection for the agent to check its active guardrails, remaining daily budget, allowed assets, and autonomy mode.*
*(Note: Updating guardrails requires the authenticated human user via `PUT /v1/settings/:address/agent`)*.

---

## 4. MCP Tools & Resources Specification

The `@othelio/mcp` server exposes these capabilities as native Model Context Protocol primitives:

### MCP Tools:
- `othelio_list_baskets`: List all baskets and overall portfolio health.
- `othelio_get_basket_detail`: Inspect a basket's current composition, drift, and performance.
- `othelio_create_basket`: Create a new investment basket with target weights.
- `othelio_deposit_funds`: Add USDC to a basket with automatic allocation.
- `othelio_withdraw_funds`: Withdraw funds in-kind or in USDC.
- `othelio_rebalance_basket`: Execute a rebalance back to targets or new weights.
- `othelio_get_supported_assets`: Get prices and tradeable status of all tokenized equities.
- `othelio_get_agent_settings`: View current spend limits and guardrails.

### MCP Resources:
- `othelio://market/prices`: Real-time Chainlink prices of all supported assets.
- `othelio://baskets/{address}`: Live snapshot of basket holdings and valuation.
- `othelio://settings`: Current agent limits and permissions.

---

## 5. Phased Implementation Roadmap (in `.worktrees/agentic-api`)

- **Phase 1: Database Migration & Agent Settings Module**
  - Add `agent_settings` table and migration `018_agent_settings.sql`.
  - Create `backend/src/agent/agent-settings.service.ts` with guardrail validation logic.
- **Phase 2: Agent REST API (`/v1/agent/*`) & Interactive Docs**
  - Implement `AgentController` and `AgentService` wrapping basket creation, quote simulation, deposit, withdraw, and rebalance.
  - Integrate **Scalar API Reference** (`@scalar/nestjs-api-reference`) serving an interactive API reference and OpenAPI spec at `/docs` or `/reference`.
- **Phase 3: Model Context Protocol (MCP) Server**
  - Build `@othelio/mcp` package using `@modelcontextprotocol/sdk`.
  - Provide ready-to-use configuration for Claude Desktop, Cursor, and ChatGPT Actions.
