# Othelio Constrained Aerodrome Routing — Implementation Guide

Status: approved architecture handoff

Audience: implementation agent and reviewer

Scope: contracts, deployment, backend planner, frontend execution, indexer, local Anvil fixtures, tests, and operational governance

## 1. Objective

Replace the current assumption that every rebalance has a direct Aerodrome pool with a production-safe routing system that supports:

- a direct approved pool: `tokenIn -> tokenOut`;
- an approved two-pool route: `tokenIn -> USDC -> tokenOut`;
- atomic multi-leg basket funding and rebalancing;
- live off-chain route discovery and ranking;
- independent on-chain enforcement of every security invariant;
- identical route semantics on Base and local Anvil.

The implementation MUST NOT restore arbitrary `target`, `spender`, `bytes calldata`, arbitrary intermediate tokens, or an unrestricted executor.

## 2. Current behavior and known gap

Current contracts expose typed `exactInputSingle` operations. The backend manifest contains only `USDC <-> B20` entries. A rebalance from one B20 asset into another asks the DEX manager for a direct B20/B20 quote and fails when no direct approved pool exists.

The frontend also assumes a backend plan can be executed from its first call. That assumption is unsafe once a rebalance requires multiple ordered trades. The final design must return one atomic module call for one portfolio operation.

## 3. Non-negotiable security invariants

The contracts MUST enforce all of the following without trusting the backend:

1. The router is the pinned Aerodrome Slipstream router held by `OthelioAerodromeSlipstreamAdapter`.
2. The pool factory is an explicitly approved Aerodrome Slipstream factory.
3. A route contains either one pool or exactly two pools.
4. A two-pool route uses canonical USDC as its only intermediate token.
5. Input and output assets are supported by `OthelioAssetRegistry` for `block.chainid`.
6. The input and output assets differ.
7. The recipient is always the basket account; it is never supplied by the caller.
8. The spender is always the pinned router; it is never supplied by the caller.
9. `amountIn > 0`, `minimumAmountOut > 0`, and tick spacings are non-zero.
10. Deadline is not expired and cannot be more than five minutes in the future.
11. Each pool configuration is approved in the on-chain route registry.
12. `minimumAmountOut` satisfies an oracle-derived maximum value-loss limit.
13. Token approvals are exact-amount approvals and are reset to zero after execution.
14. Every portfolio operation is non-reentrant.
15. Maximum route count per atomic operation is bounded, initially `16`.
16. A failed trade reverts the entire funding or rebalance operation.

Do not treat backend simulation, the route manifest, or an owner signature as a substitute for these invariants.

## 4. Contract architecture

Target structure:

```text
OthelioPortfolioModule
  ├─ OthelioAerodromeSlipstreamAdapter
  ├─ OthelioAerodromeRouteRegistry
  ├─ OthelioAaveV3Adapter
  └─ BasketOracle / OthelioAssetRegistry
```

### 4.1 Route types

Add a shared Solidity type file, for example `contracts/src/dex/AerodromeRouteTypes.sol`:

```solidity
enum AerodromeRouteKind {
    DIRECT,
    VIA_USDC
}

struct AerodromeRoute {
    AerodromeRouteKind kind;
    address tokenIn;
    address tokenOut;
    int24 firstTickSpacing;
    int24 secondTickSpacing;
    uint256 amountIn;
    uint256 minimumAmountOut;
}
```

Rules:

- `DIRECT`: `secondTickSpacing == 0`.
- `VIA_USDC`: both tick spacings are non-zero; neither endpoint may be USDC because an endpoint-USDC trade is direct.
- No `bytes path`, target, router, spender, recipient, or intermediate token appears in this user-supplied structure.

### 4.2 Aerodrome route registry

Add `OthelioAerodromeRouteRegistry.sol`.

Required state:

```solidity
struct PoolApproval {
    bool enabled;
    address factory;
}

mapping(bytes32 routeKey => PoolApproval approval) public poolApprovals;
```

Canonical key:

```solidity
keccak256(abi.encode(block.chainid, min(tokenA, tokenB), max(tokenA, tokenB), tickSpacing))
```

Required functions:

```solidity
function setPoolApproval(
    uint256 chainId,
    address tokenA,
    address tokenB,
    int24 tickSpacing,
    address factory,
    bool enabled
) external onlyOwner;

function requireApprovedPool(
    uint256 chainId,
    address tokenA,
    address tokenB,
    int24 tickSpacing
) external view returns (address factory, address pool);
```

`requireApprovedPool` MUST:

- reject zero/same token addresses and zero tick spacing;
- require the approval to be enabled;
- call the approved factory's canonical `getPool(tokenA, tokenB, tickSpacing)`;
- require a non-zero pool address and pool bytecode;
- optionally verify the pool reports the expected tokens and tick spacing if the deployed ABI supports those reads.

Emit `AerodromePoolApprovalUpdated` for every governance change.

Production ownership must be transferred to the governance timelock/multisig before launch. Local chain ownership remains with the local deployer.

### 4.3 Adapter API

Extend `IAerodromeSlipstreamSwapRouter` with the router's typed `exactInput` struct/function after confirming the deployed Base ABI. The adapter, not the backend, constructs the packed path.

Replace the single-only builder with:

```solidity
function exactInputCall(
    AerodromeRoute calldata route,
    address basket,
    uint256 deadline
) external view returns (address target, bytes memory data);
```

The adapter MUST:

- validate the route kind;
- validate the required pool approval(s) through the route registry;
- build `tokenIn + tickSpacing + tokenOut` internally for direct routes;
- build `tokenIn + firstTickSpacing + USDC + secondTickSpacing + tokenOut` internally for USDC routes;
- hard-code `recipient = basket`;
- return only the pinned router as `target`;
- encode Aerodrome `exactInput`, never `multicall` or arbitrary router calldata.

Do not accept packed path bytes from the backend.

### 4.4 Oracle value-loss guard

Before execution, the portfolio module must calculate the oracle value of `amountIn` and the oracle value represented by `minimumAmountOut`, accounting for registry token decimals and feed decimals.

Initial policy:

```solidity
uint256 public constant MAX_SWAP_VALUE_LOSS_BPS = 300; // 3%
```

Require:

```text
minimum output USD value >= input USD value * 9700 / 10000
```

If B20 multiplier/corporate-action accounting affects share-equivalent value, use the canonical oracle value function that already accounts for it. Do not implement a duplicate simplified price calculation in the DEX module.

The governance-adjustable version may be added later, but any setter must be timelocked and capped. For the first launch, an immutable or constant bound is preferable.

### 4.5 Portfolio module APIs

Replace the old single-route public entry points; no compatibility aliases are required before deployment.

```solidity
function fundAerodromePortfolio(
    address basket,
    address fundingToken,
    uint256 totalFundingAmount,
    AerodromeRoute[] calldata routes,
    uint256 deadline
) external nonReentrant onlySafeOwner(basket);

function rebalanceAerodromePortfolio(
    address basket,
    AerodromeRoute[] calldata routes,
    uint256 deadline
) external nonReentrant onlySafeOwner(basket);
```

Funding requirements:

- `fundingToken` must be canonical USDC for the first release.
- Pull `totalFundingAmount` once from the owner into the basket.
- Every route must start with USDC and therefore be `DIRECT` for current B20 purchases.
- Sum of route input amounts must equal `totalFundingAmount`.
- Execute all routes in order and revert atomically on any failure.

Rebalance requirements:

- Validate route count is between 1 and 16.
- Validate every route independently.
- Backend should order sell routes before buy routes.
- The module must verify the basket holds each route's input amount at the moment of execution.
- Do not dynamically spend the basket's entire token balance.
- Leave any unused USDC as tracked basket cash; never sweep dust to the owner or backend.

For every route:

1. Approve exactly `amountIn` from the basket to the router.
2. Ask the adapter to construct the exact route call.
3. Execute the pinned router call through the basket module interface.
4. Decode and require a valid returned output amount.
5. Require output `>= minimumAmountOut`.
6. Reset approval to zero.
7. Emit a typed execution event.

Required event:

```solidity
event AerodromeRouteExecuted(
    address indexed basket,
    address indexed tokenIn,
    address indexed tokenOut,
    AerodromeRouteKind kind,
    uint256 amountIn,
    uint256 amountOut,
    int24 firstTickSpacing,
    int24 secondTickSpacing
);
```

Also emit one operation-level event containing an operation ID/hash and route count.

## 5. Backend route discovery and planning

### 5.1 Manifest schema

Replace the current pair-only assumption with a chain-scoped pool manifest:

```ts
interface ApprovedAerodromePool {
  chainId: 31337 | 8453;
  token0: Address;
  token1: Address;
  tickSpacing: number;
  factory: Address;
  router: Address;
  enabled: boolean;
  minimumLiquidityUsdE8: bigint;
}
```

The backend manifest must mirror on-chain approvals. At startup, fail readiness if an enabled backend record disagrees with the on-chain route registry, router, factory, pool address, or tick spacing.

### 5.2 Candidate generation

For every requested `tokenIn -> tokenOut` trade, generate at most:

1. `DIRECT(tokenIn, tokenOut)` for each approved direct pool configuration.
2. `VIA_USDC(tokenIn, USDC, tokenOut)` for each approved pair of pool configurations.

Do not generate routes through WETH, AERO, arbitrary B20 assets, or backend-provided intermediates in v1.

If either endpoint is USDC, generate direct candidates only.

### 5.3 Quote validation

For every candidate:

- query the official Aerodrome quoter at the same block;
- reject zero output;
- reject expired/stale quote data;
- reject pools below the manifest liquidity floor;
- reject oracle deviation above `MAX_SWAP_VALUE_LOSS_BPS`;
- estimate route gas;
- calculate final output value minus gas;
- preserve exact token addresses, tick spacings, input amount and basket recipient.

Select the highest net-value valid candidate. Direct routing is not inherently preferred. A direct candidate wins only when it produces the best safe net result.

### 5.4 Rebalance planning

The planner must not request arbitrary B20/B20 direct quotes and fail immediately. It must route each net trade through the candidate generator above.

Planning sequence:

1. Read one canonical position snapshot at block `N`.
2. Calculate target USD values.
3. Calculate overweight sells and underweight buys.
4. Create B20-to-USDC sell routes first where needed.
5. Calculate a conservative buyable USDC budget using sell `minimumAmountOut` values plus existing free USDC.
6. Create USDC-to-B20 buy routes whose total input does not exceed that conservative budget.
7. Leave rounding/dust as USDC.
8. Encode exactly one `rebalanceAerodromePortfolio` call.
9. Simulate that full call from the real owner against the latest block.
10. Reject if the snapshot block is stale, any route changed, or simulation fails.

The response must contain one executable call for a rebalance. Do not return a list that the frontend executes partially.

### 5.5 Funding planning

For funding:

1. Split the exact supplied USDC amount by target weights.
2. Create one direct USDC-to-B20 route per target asset.
3. Ensure route inputs sum exactly to total funding amount; apply integer remainder to one route deterministically.
4. Encode one `fundAerodromePortfolio` call.
5. Return one allowance requirement: owner approves the portfolio module for exactly the total USDC amount.
6. Simulate the allowance plus module call assumptions and return a short expiry.

### 5.6 API errors

Return structured errors rather than only prose:

```json
{
  "code": "NO_APPROVED_ROUTE",
  "chainId": 8453,
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "directCandidates": 0,
  "viaUsdcCandidates": 0
}
```

Required codes:

- `NO_APPROVED_ROUTE`
- `POOL_APPROVAL_MISMATCH`
- `INSUFFICIENT_ROUTE_LIQUIDITY`
- `ORACLE_DEVIATION_TOO_HIGH`
- `ROUTE_SIMULATION_FAILED`
- `STALE_POSITION_SNAPSHOT`
- `INSUFFICIENT_CONSERVATIVE_USDC_BUDGET`

## 6. Frontend changes

The frontend must:

- treat a funding or rebalance plan as one module call;
- never execute only `plan.calls[0]` when multiple calls are returned;
- require the wallet's chain to equal `plan.chainId`;
- show `Direct` or `Via USDC` per planned trade;
- display expected output, minimum output, price impact and quote expiry;
- request one exact USDC allowance for funding;
- show one wallet confirmation for the atomic module operation after allowance;
- disable confirmation when the plan expires or the position snapshot changes;
- map structured backend route errors to actionable UI messages.

Aave remains hidden behind `AAVE_UI_ENABLED = false`; this routing work must not enable it.

## 7. Indexer changes

Index and persist:

- `AerodromeRouteExecuted` per route;
- operation-level funding/rebalance event;
- route kind;
- input/output token;
- actual input/output amounts;
- tick spacings;
- transaction hash, block number and log index.

Use `(chain_id, tx_hash, log_index)` as the idempotency key. A reset/reorg must not produce duplicate route records. Basket state should be derived from actual execution events/balances, not backend quote expectations.

## 8. Anvil parity

The local environment must exercise the same code path as production.

Update `contracts/script/bootstrap-local-anvil.sh` so one command:

- resets Anvil only when explicitly invoked as a reset bootstrap;
- deploys registry, oracle, route registry, adapters, module and factory;
- installs six-decimal mock USDC at the configured local USDC address;
- installs mock B20 bytecode at all configured B20 addresses;
- installs a mock router compatible with both `exactInputSingle` and typed `exactInput`;
- registers USDC with a $1 mock feed;
- registers all B20 feeds;
- approves all `USDC <-> B20` pools at tick spacing 100 in the on-chain route registry;
- creates/installs a mock pool identity for every approved pair if factory lookup is enforced;
- funds the requested test wallet with 100,000 USDC and 100 ETH;
- seeds the router/pools with B20 and USDC liquidity;
- verifies factory code, module version, router pin, route approvals and wallet balance before returning success.

Do not approve direct B20/B20 local pools by default. This ensures local rebalance tests exercise `VIA_USDC`. Add a test-only helper that enables one direct pool to verify route preference.

The mock quote must use oracle-consistent prices and token decimals. Do not use `1 USDC = 1 stock token` when the local stock feed reports another price.

## 9. Governance and deployment

Production route approval process:

1. Backend discovers a candidate pool.
2. Operations records pool address, factory, token pair, tick spacing, liquidity, recent volume and oracle deviation behavior.
3. Security review approves or rejects it.
4. Governance queues `setPoolApproval` through the timelock.
5. After execution, the backend manifest is updated to the identical record.
6. Backend readiness verifies manifest/on-chain equality before serving quotes.

Emergency response may disable a route through the timelock's emergency policy if governance supports it. It must not permit instantly adding a new route with the same emergency authority.

Deployment order:

1. Asset registry and oracle.
2. Aerodrome route registry.
3. Aerodrome adapter pinned to router, USDC and route registry.
4. Aave adapter.
5. Portfolio module.
6. Basket factory.
7. Configure supported assets.
8. Configure approved Aerodrome pools.
9. Transfer production registry ownership to governance.
10. Update frontend, backend and indexer constants from broadcast output.
11. Verify bytecode and configuration on-chain.
12. Enable backend readiness only after all checks pass.

## 10. Required tests

### Contract unit tests

- Direct route succeeds for approved pool.
- USDC route succeeds for two approved pools.
- Arbitrary intermediate cannot be supplied.
- More than two pools cannot be encoded.
- Unapproved first or second pool reverts.
- Wrong router/factory reverts.
- Zero/same/unsupported tokens revert.
- Recipient cannot differ from basket.
- Expired and excessively long deadlines revert.
- Zero amounts and minimum outputs revert.
- Oracle-deviant minimum output reverts.
- Exact approval is cleared after success.
- Approval is not left behind after reverted operation.
- Reentrancy attempt fails.
- Route count above 16 fails.
- Failure on route N reverts routes `0..N-1` atomically.
- Funding route sum must equal pulled USDC amount.
- Only owner of the specific basket can execute.
- Malicious approved-router mock cannot redirect recipient or retain allowance.

### Backend tests

- Direct candidate selected when it has better safe net output.
- USDC candidate selected when direct pool is absent.
- USDC candidate selected when direct output is worse.
- Endpoint-USDC trade does not create a redundant two-hop route.
- Missing second USDC pool returns `NO_APPROVED_ROUTE`.
- Manifest/on-chain mismatch fails readiness and quote generation.
- Thin/manipulated pool fails liquidity or oracle checks.
- Conservative buy budget never exceeds sell minimums plus existing USDC.
- Rebalance produces one atomic module call.
- Funding produces one call and one exact allowance requirement.
- Simulation uses the real basket, caller, module and current chain.
- Local quote uses oracle-consistent decimal conversion.

### Fork tests

- Query current Base factory registry and approved Slipstream factories.
- Discover real `USDC <-> B20` pools before enabling them.
- Simulate a direct route only if a reviewed direct pool exists.
- Simulate a B20-to-B20 route through USDC.
- Assert actual output satisfies oracle and quote bounds.
- Pin the test block to make audit results reproducible.

### Frontend tests

- Expired plan disables execution.
- Wrong chain disables execution.
- Direct/via-USDC route is displayed correctly.
- One atomic call is submitted after funding allowance.
- Structured errors display useful remediation.
- Aave UI remains disabled.

### Indexer tests

- Multi-route transaction creates one operation and N route records.
- Event replay is idempotent.
- Reset/reorg replacement removes orphaned records.
- Actual output, not quote output, updates activity/state.

## 11. Acceptance criteria

Implementation is complete only when all of the following are true:

- A B20-to-B20 rebalance succeeds through USDC on Anvil.
- The same rebalance is submitted as one atomic module transaction.
- No arbitrary target, calldata, spender, recipient or intermediate token enters any public execution API.
- A direct route is chosen only when its pool is approved, live, liquid, oracle-safe and economically better.
- Backend and on-chain route approval states are verified to match.
- Production deployment ownership is a multisig/timelock, not an EOA.
- Contract, backend, frontend and indexer tests pass.
- Base fork tests pass at a pinned block.
- The old exact-input-single public entry points and obsolete ABI definitions are removed everywhere.
- Deployment outputs and constants are updated across contracts, backend, frontend, indexer and documentation.

## 12. Explicit non-goals

Do not implement in this pass:

- arbitrary-hop aggregation;
- arbitrary router calldata;
- WETH/AERO intermediates;
- cross-DEX splitting;
- CoW/solver settlement;
- user-supplied adapters;
- enabling Aave in the UI;
- backward compatibility for undeployed legacy module APIs.

## 13. Recommended implementation sequence

1. Add route types and route registry with tests.
2. Extend the Aerodrome interface and adapter to construct direct/via-USDC paths internally.
3. Replace module entry points with atomic funding and rebalance APIs plus oracle checks.
4. Update deployment and the Anvil bootstrap; prove a local via-USDC rebalance.
5. Replace backend quote selection and encode one atomic call.
6. Update shared schemas and ABIs.
7. Update frontend execution and route review UI.
8. Update indexer event ingestion and database migration.
9. Run unit, integration, Anvil and pinned Base fork tests.
10. Conduct an independent security review before deployment.

