---
name: coinbase-b20-asset-onboarding
description: Use when adding or enabling Coinbase B20 tokenized stocks in Othelio's Base contracts, Chainlink registry, Aerodrome Slipstream routes, backend asset catalog, or tradeable status. Covers verification, code changes, and a human-run governance transaction handoff.
---

# Coinbase B20 asset onboarding

Use this skill for a requested set of Coinbase tokenized stock addresses on Base (chain ID 8453). The result is reviewed code, evidence for each asset, and exact transactions for the human to execute. Do not broadcast an onchain transaction or ask for a private key in chat.

## Sources of truth

- The Coinbase tokenized-stocks API supplies identity and display metadata. Match by `contract_address`, not ticker. Its `nav_price` is optional and is not Othelio's trading oracle. A previously reviewed address such as COINc may be absent from the current API; preserve that distinction and return nullable Coinbase-only fields.
- Base's B20 factory must return `isB20` and `isB20Initialized` for each token. Verify token decimals and positive supply onchain.
- A reviewed Chainlink **Coinbase B20 total-return** proxy, or a separately designed and approved oracle adapter, supplies the onchain price. A stock-only feed cannot be substituted without applying the B20 multiplier and handling Coinbase's pause state. Check proxy identity, `decimals`, positive `latestRoundData` answer, round completeness, and `updatedAt` at a pinned block. A missing feed address is *unverified*, not evidence that no feed exists.
- The deployed `OthelioAssetRegistry` and `OthelioAerodromeRouteRegistry` are the authorities for enabled assets and routes. Their owner may differ; read both `owner()` values before preparing transactions. Prefer configuring these existing contracts to redeploying them because baskets reference the deployed registry.

## Asset decision

Produce a per-address manifest with token, symbol, feed, supply, selected Aerodrome pool/tick, quote results, and decision. Treat these as separate states:

| State | Required evidence | Contract/API action |
| --- | --- | --- |
| Tradeable candidate | Initialized B20, positive supply, verified compatible oracle, executable pool eligible for route approval, and simulated trade passing Othelio's value-loss guard | Enable in registry and route registry; return `tradeable: true` only after onchain configuration is confirmed |
| Visible, not tradeable | Valid identity but any required trade condition missing | Include in the API catalog with `tradeable: false`; do not approve a nonexistent or unusable pool |
| Unverified identity | B20 factory verification fails, or an API-absent address lacks prior explicit review | Do not enable; report evidence and request an explicit product decision |

Do not reject a pool merely because a $1,000 round trip returns less than $990. The user's accepted policy is to rely on current quote slippage checks and the onchain oracle value-loss guard. Still test actual buy and sell quotes at representative sizes and simulate the guard; a pool address or token balance alone does not prove execution. Route approvals for inactive pools should wait until executable liquidity exists.

## Follow the complete code path

Inspect current code and project specs before editing. Start code discovery with the repository's codebase-memory graph tools; use `rg` for config files, literal values, or gaps in the graph. Current touchpoints (confirm before changing):

- `contracts/src/constants/TokenizedAssetConstants.sol`: reviewed token and feed addresses.
- `contracts/script/OthelioDeploymentAssets.sol` and `contracts/script/DeployBaseOthelio.s.sol`: future-deployment manifest and pool ticks. Keep local/fork deployment scripts and tests aligned.
- `contracts/src/registry/OthelioAssetRegistry.sol` and `contracts/src/dex/OthelioAerodromeRouteRegistry.sol`: existing owner-only `configure`/`configureBatch` and `setPoolApproval` paths. Add a narrowly scoped governance script for the **deployed** addresses when needed.
- `backend/src/dex/aerodrome-slipstream-routes.ts` and shared launch manifests: backend routing must agree with onchain approvals.
- `backend/src/baskets/baskets.service.ts`, `packages/shared/src/portfolio.ts`, and frontend asset selection: the existing `/v1/assets` response must list requested staged assets with `tradeable: false`; selection must reject them. Keep indexed Chainlink `priceUsdE8` separate from nullable Coinbase NAV and metadata. An in-process Coinbase metadata cache is preferred until deployment topology justifies Redis.
- `indexer/src/oracle.rs`: price indexing discovers supported registry feeds; verify new supported assets produce price observations. A staged unsupported asset needs a catalog row independent of price observations.

Recheck all addresses, ABI shapes, and deployment state rather than copying historical audit results. Update tests that assert fixed asset counts, and run Base-aware fork release checks where B20 precompile behavior matters. Test the new asset's oracle valuation, both swap directions, tradeable gating, and backend/API consistency. Do not call an asset tradeable solely because it appears on Coinbase, Aerodrome, or a swap aggregator.

## Human-run transaction handoff

Read [transaction-handoff.md](references/transaction-handoff.md) when preparing an onchain change. Deliver the exact script or calldata, chain ID, target contracts, parameters, expected post-state, simulation output, and verification commands. Stop before broadcast. The human executes and returns transaction hashes; only then verify receipts and resulting state. Never place a private key in a command line, source file, `.env` file, tool argument, log, or assistant message. If an EOA key is required, generate an interactive prompt runner; if a Safe owns a contract, prepare a Safe transaction bundle instead.
