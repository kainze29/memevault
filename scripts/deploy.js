// Deploy MemeVault contract to testnet and initialize it.
// Usage: node scripts/deploy.js
const { connect, keyStores, utils } = require("near-api-js");
const fs = require("fs");
const path = require("path");

const CONTRACT_ID = "memevault-app.testnet";
const OWNER_ID = "memevault2026.testnet"; // holds the minted supply (not the contract)
const FAUCET_AMOUNT = "10000000000000000000000000"; // 10,000,000 MVAULT for judge claims
const CRED_PATH = path.join(process.env.HOME, ".near-credentials/testnet/memevault-app.testnet.json");

async function main() {
  const cred = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("testnet", CONTRACT_ID, utils.KeyPair.fromString(cred.private_key));
  const near = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: "https://rpc.testnet.near.org",
    walletUrl: "https://wallet.testnet.near.org",
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: "https://explorer.testnet.near.org",
  });
  const account = await near.account(CONTRACT_ID);
  const code = fs.readFileSync(path.join(__dirname, "..", "build", "contract.wasm"));
  console.log("Deploying", code.length, "bytes to", CONTRACT_ID);
  const deployRes = await account.deployContract(code);
  console.log("DEPLOY TX:", deployRes.transaction.hash);
  console.log("Deploy status:", JSON.stringify(deployRes.status).slice(0, 200));
  console.log("Calling init...");
  const initRes = await account.functionCall({
    contractId: CONTRACT_ID,
    methodName: "init",
    args: { owner_id: OWNER_ID, faucet_amount: FAUCET_AMOUNT },
    gas: 100000000000000n,
  });
  console.log("INIT TX:", initRes.transaction.hash);
  console.log("DONE");
}

main().catch((e) => {
  console.error("DEPLOY FAILED:", e.message);
  process.exit(1);
});
