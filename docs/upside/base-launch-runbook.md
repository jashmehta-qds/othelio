# Base Launch Runbook: Stock Upside Markets

This runbook guides operators through the deployment and launch verification of Stock Upside Markets on Base Mainnet (`chainId: 8453`).

## 1. Prerequisites

- Base Mainnet RPC configured in `.env.base`.
- Encrypted Foundry keystore account with deployer wallet (e.g. `cast wallet import othelio-base-deployer`).
- Deployer wallet holds sufficient ETH for gas on Base.
- Never set or expose plaintext `PRIVATE_KEY` in environment or shell history.

## 2. Pinned Infrastructure & Dependencies

- Pinned `OthelioAssetRegistry`: `0x3DB84b8e172A2b8b1634F8C630C6e2acD07424AC` on Base.
- Underlying MSFTc: `0xB200000000000000000000Ab99cFa739E253872B`.
- Chainlink MSFT Feed: `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c`.
- Native USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- 0x v4 ExchangeProxy: `0xDef1C0ded9bec7F1a1670819833240f027b25EfF`.

## 3. Deployment Procedure

1. Simulate deployment:
   ```bash
   ./scripts/deploy-upside-base.sh
   ```
2. Broadcast deployment with encrypted keystore:
   ```bash
   base-forge script contracts/script/upside/DeployUpside.s.sol:DeployUpside \
     --root contracts \
     --rpc-url "$BASE_RPC_URL" \
     --account othelio-base-deployer \
     --broadcast \
     --verify
   ```
3. Record output addresses and block in `contracts/deployments/base-mainnet-upside.json`.

## 4. Weekly Round Setup & Launch

1. Open the Admin Console (`fe-admin` connected to deployer wallet).
2. Select MSFTc asset from the onchain basket registry.
3. Verify calendar alignment (Friday 16:00 ET US regular market close).
4. Review 4 preset strikes: Starting price, Reach, Strong move, Long shot.
5. Sign round registration and market creation transactions.
6. Verify indexing status and book display in the public UI.
