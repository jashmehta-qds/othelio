const fs = require("fs");
const path = require("path");

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

async function seedAnvilPools() {
  const rpcUrl = "http://127.0.0.1:8545";

  // 1. Etch MockAavePool contract bytecode
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

  // 2. Etch DeployMockERC20 bytecode onto all 13 Coinbase B20 token addresses
  const erc20ArtifactPath = path.join(__dirname, "../contracts/out/DeployOthelio.s.sol/DeployMockERC20.json");
  if (fs.existsSync(erc20ArtifactPath)) {
    const erc20Json = JSON.parse(fs.readFileSync(erc20ArtifactPath, "utf8"));
    const erc20Bytecode = erc20Json.deployedBytecode.object;

    for (const addr of TOKEN_ADDRESSES) {
      try {
        await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "anvil_setCode",
            params: [addr, erc20Bytecode],
            id: 2,
          }),
        });
      } catch (err) {
        console.warn(`[seed-anvil-pools] Failed to etch ERC20 bytecode on ${addr}:`, err.message);
      }
    }
    console.log(`[seed-anvil-pools] Etched DeployMockERC20 bytecode onto all ${TOKEN_ADDRESSES.length} Coinbase stock token contracts on local Anvil RPC.`);
  }
}

seedAnvilPools();
