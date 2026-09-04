# Othelio Smart Contracts Implementation Plan & Architecture Specification

> **Status:** Approved Architecture Plan  
> **Target Framework:** Foundry (Forge, Solc 0.8.24)  
> **Network Target:** Base Mainnet / Base Sepolia  

---

## 1. Executive Architecture Summary

Othelio moves away from simple ERC20/ERC721 tokenized basket wrappers to a **Direct Safe Smart Account Ownership Model**. Each user owns a dedicated Safe Smart Account that holds their Coinbase B20 tokenized stock assets (`AAPLc`, `NVDAc`, `GOOGc`) and benchmark assets (`USDC`).

Execution, safety, and event logging are governed by two custom Safe extensions:
1. **`OthelioBasketGuard`**: Enforces strict withdrawal policies. Generic `ERC20.transfer` calls on tracked assets are blocked, forcing all withdrawals through `OthelioBasketModule`. Accidental or untracked assets can be swept directly by the owner.
2. **`OthelioBasketModule`**: Enables 1-click atomic rebalancing using **Pre/Post-Balance Delta Measuring** to cleanly account for DEX fees, price impact, and slippage, emitting structured events (`BasketFunded`, `BasketRebalanced`, `BasketWithdrawn`) for off-chain indexing.

---

## 2. Smart Contract Components Blueprint

```
contracts/
├── src/
│   ├── interfaces/
│   │   └── IOthelioEvents.sol         # Protocol-wide structured event definitions
│   ├── registry/
│   │   └── OthelioAssetRegistry.sol   # Verified B20 token allowlist & Chainlink price feed mapping
│   ├── safe/
│   │   ├── OthelioBasketModule.sol    # Safe Module: Rebalancing, pre/post swap deltas, withdrawInKind/withdrawToUSDC
│   │   └── OthelioBasketGuard.sol     # Safe Guard: Restricts tracked asset transfers to Module only; allows untracked sweeps
│   ├── factory/
│   │   └── OthelioSafeFactory.sol     # Factory helper to initialize Safe Proxy + attach Guard/Module
│   └── oracle/
│       └── BasketOracle.sol           # NAV calculation engine using Chainlink feeds
└── test/
    ├── OthelioAssetRegistry.t.sol
    ├── OthelioBasketModule.t.sol
    ├── OthelioBasketGuard.t.sol
    └── BasketOracle.t.sol
```

---

## 3. Detailed Component Specifications

### A. `interfaces/IOthelioEvents.sol`
Defines standardized events emitted by `OthelioBasketModule` and `OthelioSafeFactory`:
- `BasketCreated(address indexed safe, address indexed owner, string name, uint256 createdAt)`
- `BasketFunded(address indexed safe, address indexed funder, address inputAsset, uint256 inputAmount, address[] acquiredAssets, uint256[] acquiredAmounts, uint256 totalNAVAfter)`
- `BasketWithdrawn(address indexed safe, address indexed owner, address outputAsset, uint256 navRedeemed, address[] withdrawnAssets, uint256[] withdrawnAmounts, uint256 remainingNAV)`
- `BasketRebalanced(address indexed safe, address indexed controller, address[] soldAssets, uint256[] soldAmounts, address[] boughtAssets, uint256[] boughtAmounts, uint256 totalNAV)`
- `UntrackedAssetSwept(address indexed safe, address indexed owner, address indexed token, uint256 amount)`

### B. `registry/OthelioAssetRegistry.sol`
- Inherits `Ownable2Step`.
- Tracks `AssetConfig { bool supported; address priceFeed; uint8 tokenDecimals; uint8 feedDecimals; }`.
- `configureAsset(uint256 chainId, address token, address priceFeed, bool supported, uint8 tokenDecimals, uint8 feedDecimals)`.
- `isSupported(uint256 chainId, address token)` for validation.

### C. `safe/OthelioBasketModule.sol`
- Interacts with Safe via `execTransactionFromModule`.
- **Rebalance Logic (`rebalance`)**:
  1. Record pre-swap balances of sold & bought tokens in the Safe.
  2. Execute DEX aggregator calldata (e.g. 0x / Aerodrome) via Safe module execution.
  3. Record post-swap balances in the Safe.
  4. Calculate actual `soldAmount` and `boughtAmount` deltas.
  5. Compute updated Basket NAV using `BasketOracle`.
  6. Emit `BasketRebalanced` event.
- **Withdrawal Logic (`withdrawInKind`, `withdrawToUSDC`)**:
  1. Transfer specified amounts of tracked constituents to recipient or swap to USDC.
  2. Emit `BasketWithdrawn`.

### D. `safe/OthelioBasketGuard.sol`
- Implements Safe `ITransactionGuard` interface (`checkTransaction`, `checkAfterExecution`).
- Blocks execution if a transaction attempts to transfer a **tracked constituent** directly out of the Safe unless `msg.sender` is `OthelioBasketModule` or authorized module.
- Allows direct transfers if the token is **untracked / accidental**, enabling 1-click owner recovery sweeps.

### E. `oracle/BasketOracle.sol`
- Evaluates total Basket Net Asset Value (NAV) in USDC ($10^6$ decimals).
- Integrates Chainlink Oracles for Coinbase B20 tokens.
- Handles stock split adjustments (B20 Chainlink feeds natively account for stock split multipliers in feed outputs).

---

## 4. Execution & Testing Strategy

### Step 1: Core Contracts Setup & Fixes
- Fix import & constructor issues in `OthelioAssetRegistry.sol`.
- Implement `IOthelioEvents.sol`, `OthelioAssetRegistry.sol`, `BasketOracle.sol`, `OthelioBasketGuard.sol`, `OthelioBasketModule.sol`, and `OthelioSafeFactory.sol`.

### Step 2: Local Foundry Forge Test Suite
- Run `forge test -vvv` to verify:
  1. Asset registry configuration and price feed resolution.
  2. Safe module initialization & execution.
  3. Pre/post delta accounting during rebalance (mocking DEX swap).
  4. Guard restriction on tracked asset direct transfers.
  5. Owner sweeping of untracked assets.
  6. In-kind and USDC withdrawal flows.

---

## 5. Verification Checklist

- [ ] `OthelioAssetRegistry` correctly registers and checks supported B20 tokens.
- [ ] `OthelioBasketGuard` blocks unauthorized direct transfers of tracked tokens while allowing untracked sweeps.
- [ ] `OthelioBasketModule` accurately computes delta amounts across DEX swaps and emits proper `BasketRebalanced` events.
- [ ] `forge test` passes 100% of test cases locally.
