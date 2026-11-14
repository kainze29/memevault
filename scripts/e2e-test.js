// End-to-end test of the MemeVault contract on testnet.
// Usage: node scripts/e2e-test.js
// Verifies every "do X, see Y" step from the README.
// Balance checks are delta-based so the script is re-runnable.
const { connect, keyStores, utils } = require("near-api-js");
const fs = require("fs");
const path = require("path");

const CONTRACT = "memevault-live.testnet";
const OWNER = "memevault2026.testnet";
const USER = "memevault-tester.testnet"; // fresh test user (faucet account)
const MVAULT = 10n ** 18n;
const GAS = 100000000000000n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("PASS:", name, extra !== undefined ? "(" + extra + ")" : "");
  } else {
    fail++;
    console.log("FAIL:", name, extra !== undefined ? "(" + extra + ")" : "");
  }
}

async function main() {
  const cred = JSON.parse(
    fs.readFileSync(path.join(process.env.HOME, ".near-credentials/testnet/memevault-live.testnet.json"), "utf8")
  );
  const keyStore = new keyStores.InMemoryKeyStore();
  for (const id of [CONTRACT, OWNER, USER]) {
    await keyStore.setKey("testnet", id, utils.KeyPair.fromString(cred.private_key));
  }
  const near = await connect({
    networkId: "testnet",
    keyStore,
    nodeUrl: "https://rpc.testnet.near.org",
    walletUrl: "https://wallet.testnet.near.org",
    helperUrl: "https://helper.testnet.near.org",
    explorerUrl: "https://explorer.testnet.near.org",
  });
  const contract = await near.account(CONTRACT);
  const user = await near.account(USER);
  const view = (m, a) => contract.viewFunction({ contractId: CONTRACT, methodName: m, args: a || {} });
  const call = (account, m, a, deposit) =>
    account.functionCall({ contractId: CONTRACT, methodName: m, args: a || {}, gas: GAS, attachedDeposit: deposit || 0n });

  // 1. Metadata + supply
  const meta = await view("ft_metadata");
  check("ft_metadata symbol MVAULT", meta.symbol === "MVAULT", meta.symbol);
  check("ft_metadata decimals 18", meta.decimals === 18);
  const supply = await view("ft_total_supply");
  check("total supply 1e9 MVAULT", supply === (1000000000n * MVAULT).toString());
  const treasury0 = await view("get_treasury_balance");
  const pool0 = await view("get_faucet_pool");
  check("faucet pool non-empty", BigInt(pool0) > 0n, pool0);

  // 2. Register user + claim faucet
  await call(user, "storage_deposit", {}, utils.format.parseNearAmount("0.002"));
  const sb = await view("storage_balance_of", { account_id: USER });
  check("user registered", sb !== null);
  await call(user, "claim_faucet", {});
  const bal1 = await view("ft_balance_of", { account_id: USER });
  check("faucet gives 1,000 MVAULT", bal1 === (1000n * MVAULT).toString(), bal1);
  try {
    await call(user, "claim_faucet", {});
    check("second faucet claim rejected", false);
  } catch (e) {
    check("second faucet claim rejected", /already claimed/i.test(e.message));
  }

  // 3. Transfer 100 MVAULT -> 1% fee to treasury, 99 received
  const ownerBefore = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  const treasuryBefore = BigInt(treasury0);
  await call(user, "ft_transfer", { receiver_id: OWNER, amount: (100n * MVAULT).toString() }, 1n);
  const bal2 = await view("ft_balance_of", { account_id: USER });
  check("sender balance 900 after sending 100", bal2 === (900n * MVAULT).toString(), bal2);
  const ownerAfter = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  check("owner received 99 (100 minus 1 fee)", ownerAfter - ownerBefore === 99n * MVAULT);
  const treasury1 = BigInt(await view("get_treasury_balance"));
  check("treasury grew by 1 MVAULT fee", treasury1 - treasuryBefore === 1n * MVAULT, treasury1.toString());

  // 4. Duel: create, stake both sides, wait, resolve (120s window; testnet calls are slow)
  await call(user, "create_duel", { option_a: "DOGE", option_b: "PEPE", duration_sec: 120 });
  const duels = await view("get_duels", {});
  const duelId = duels[duels.length - 1].id;
  await call(user, "join_duel", { duel_id: duelId, side: "a", amount: (10n * MVAULT).toString() });
  await call(user, "join_duel", { duel_id: duelId, side: "b", amount: (30n * MVAULT).toString() });
  const d1 = await view("get_duel", { duel_id: duelId });
  check("duel stakes a=10 b=30", d1.stakes_a === (10n * MVAULT).toString() && d1.stakes_b === (30n * MVAULT).toString());
  console.log("... waiting 130s for duel to end ...");
  await sleep(130000);
  await call(user, "resolve_duel", { duel_id: duelId });
  const d2 = await view("get_duel", { duel_id: duelId });
  check("duel resolved, winner is b", d2.resolved === true && d2.winner === "b", "winner=" + d2.winner);
  const bal3 = await view("ft_balance_of", { account_id: USER });
  // 900 - 40 staked + 40 pot back (sole winner on b side) = 900
  check("winner got pot back, balance 900", bal3 === (900n * MVAULT).toString(), bal3);

  // 5. Proposal: create, vote, wait, execute (pays 1 MVAULT from treasury to OWNER)
  const ownerBefore2 = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  await call(user, "create_proposal", {
    title: "Test payout",
    description: "Pay 1 MVAULT from treasury to owner",
    amount: (1n * MVAULT).toString(),
    recipient: OWNER,
    duration_sec: 120,
  });
  const props = await view("get_proposals", {});
  const propId = props[props.length - 1].id;
  await call(user, "vote", { proposal_id: propId, vote: "yes" });
  const p1 = await view("get_proposal", { proposal_id: propId });
  check("vote counted (yes weight 900)", p1.yes === (900n * MVAULT).toString(), "yes=" + p1.yes);
  try {
    await call(user, "vote", { proposal_id: propId, vote: "yes" });
    check("double vote rejected", false);
  } catch (e) {
    check("double vote rejected", /Already voted/i.test(e.message));
  }
  console.log("... waiting 130s for voting to end ...");
  await sleep(130000);
  await call(user, "execute_proposal", { proposal_id: propId });
  const p2 = await view("get_proposal", { proposal_id: propId });
  check("proposal executed and passed", p2.executed === true && p2.passed === true);
  const treasury2 = BigInt(await view("get_treasury_balance"));
  check("treasury spent 1 MVAULT", treasury2 === treasury1 - 1n * MVAULT, treasury2.toString());
  const ownerAfter2 = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  check("recipient got 1 MVAULT payout", ownerAfter2 - ownerBefore2 === 1n * MVAULT);

  // 6. Stats + leaderboard
  const stats = await view("get_stats");
  check("stats show duels and proposals", stats.duels >= 1 && stats.proposals >= 1, JSON.stringify(stats));
  const lb = await view("get_leaderboard", { limit: 3 });
  check("leaderboard top is owner", lb[0].account_id === OWNER, lb[0].account_id);

  console.log("\n==== RESULT: " + pass + " passed, " + fail + " failed ====");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E ERROR:", e.message);
  process.exit(1);
});
