const fs = require("fs");
const path = require("path");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const LOCAL_ROUTER = "0xBD606f1dAE0285D55113eFC11501677B2221A4dd";
const LOCAL_DEPLOYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const LOCAL_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER_LIQUIDITY = 1_000_000n * 10n ** 18n;
const ROUTER_USDC_LIQUIDITY = 1_000_000n * 10n ** 6n;
const DEFAULT_WALLET_USDC = 100_000n * 10n ** 6n;

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

const TOKEN_ADDRESSES = [
  "0xb200000000000000000000C2e324d24d7eEcd1fb", // AAPLc
  "0xb200000000000000000000d9192b6B456483C2E8", // AMZNc
  "0xb200000000000000000000c85a31389D71F3ecfb", // COINc
  "0xB20000000000000000000019f6E7C675b73C2e4D", // CRCLc
  "0xb2000000000000000000002D0BA3164cc74f58B7", // GOOGLc
  "0xB2000000000000000000004AFF16039bA04bdFBc", // INTCc
  "0xb2000000000000000000008bC8786B856E61707C", // METAc
  "0xB200000000000000000000Ab99cFa739E253872B", // MSFTc
  "0xb2000000000000000000004884b426556b92883d", // MSTRc
  "0xb20000000000000000000078ee7ce2fE4908108C", // NVDAc
  "0xb200000000000000000000397293Cb8cda9a10c5", // SNDKc
  "0xb2000000000000000000007b9fcbd005511aCBd5", // SPCXc
  "0xb2000000000000000000001e800a7f5189430cD0", // TSLAc
];

async function installTokenCode() {
  const usdcArtifactPath = path.join(__dirname, "../contracts/out/MockUSDC.sol/MockUSDC.json");
  const erc20ArtifactPath = path.join(__dirname, "../contracts/out/DeployLocalOthelio.s.sol/DeployMockERC20.json");
  if (!fs.existsSync(usdcArtifactPath) || !fs.existsSync(erc20ArtifactPath)) {
    throw new Error("Mock token artifacts are missing; run forge build first.");
  }
  const usdcJson = JSON.parse(fs.readFileSync(usdcArtifactPath, "utf8"));
  const erc20Json = JSON.parse(fs.readFileSync(erc20ArtifactPath, "utf8"));
  // The fork can expose canonical Base code/precompile stubs at these addresses.
  // Local tests need deterministic mock ERC-20 semantics, so replace them only
  // on Anvil through its non-production `anvil_setCode` RPC.
  await rpc("anvil_setCode", [LOCAL_USDC, usdcJson.deployedBytecode.object]);
  for (const addr of TOKEN_ADDRESSES) {
    await rpc("anvil_setCode", [addr, erc20Json.deployedBytecode.object]);
  }
}

async function seedAnvilPools() {
  await installTokenCode();
  if (process.argv.includes("--tokens-only")) {
    console.log(`[seed-anvil-pools] Installed mock token code for USDC and ${TOKEN_ADDRESSES.length} B20 assets.`);
    return;
  }
  const rpcUrl = RPC_URL;
  // 1. Install MockAavePool code only when the fork did not already provide it.
  const aaveArtifactPath = path.join(__dirname, "../contracts/out/MockAavePool.sol/MockAavePool.json");
  if (fs.existsSync(aaveArtifactPath)) {
    const aaveJson = JSON.parse(fs.readFileSync(aaveArtifactPath, "utf8"));
    const aaveBytecode = aaveJson.deployedBytecode.object;
    const aaveTargetAddress = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "anvil_setCode",
          params: [aaveTargetAddress, aaveBytecode],
          id: 1,
        }),
      });
      const data = await res.json();
      console.log(`[seed-anvil-pools] Etched MockAavePool bytecode onto ${aaveTargetAddress}:`, data);
    } catch (err) {
      console.warn("[seed-anvil-pools] Local Anvil node not reachable for MockAavePool:", err.message);
    }
  }

  // 2. Install the router and seed token liquidity.
  const routerArtifactPath = path.join(__dirname, "../contracts/out/MockDEXRouter.sol/MockDEXRouter.json");
  if (!fs.existsSync(routerArtifactPath)) {
    throw new Error("Mock router artifact is missing; run forge build first.");
  }
  const routerJson = JSON.parse(fs.readFileSync(routerArtifactPath, "utf8"));
  await rpc("anvil_setCode", [LOCAL_ROUTER, routerJson.deployedBytecode.object]);
  const routerRecipient = LOCAL_ROUTER.slice(2).toLowerCase().padStart(64, "0");
  const usdcAmount = ROUTER_USDC_LIQUIDITY.toString(16).padStart(64, "0");
  await rpc("eth_sendTransaction", [{
    from: LOCAL_DEPLOYER,
    to: LOCAL_USDC,
    data: `0x40c10f19${routerRecipient}${usdcAmount}`,
  }]);
  const walletRecipient = LOCAL_DEPLOYER.slice(2).toLowerCase().padStart(64, "0");
  const walletUsdcAmount = DEFAULT_WALLET_USDC.toString(16).padStart(64, "0");
  await rpc("eth_sendTransaction", [{
    from: LOCAL_DEPLOYER,
    to: LOCAL_USDC,
    data: `0x40c10f19${walletRecipient}${walletUsdcAmount}`,
  }]);

  for (const addr of TOKEN_ADDRESSES) {
    const amount = ROUTER_LIQUIDITY.toString(16).padStart(64, "0");
    await rpc("eth_sendTransaction", [{
      from: LOCAL_DEPLOYER,
      to: addr,
      data: `0x40c10f19${routerRecipient}${amount}`,
    }]);
  }
  console.log(`[seed-anvil-pools] Seeded ${TOKEN_ADDRESSES.length} B20 assets, router liquidity, and ${DEFAULT_WALLET_USDC / 10n ** 6n} USDC for the default Anvil wallet.`);
}

seedAnvilPools().catch((error) => {
  console.error("[seed-anvil-pools] Failed:", error);
  process.exitCode = 1;
});
