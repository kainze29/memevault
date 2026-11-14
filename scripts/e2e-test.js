// End-to-end test of the MemeVault v2 contract on testnet.
// Usage: node scripts/e2e-test.js
// Verifies every "do X, see Y" step from the README, including the v2 features:
//   - Duel burn: 5% of the pot is burned on resolve, supply shrinks.
//   - Diamond Hands: no sell in 24h (or never sold) = 2x duel winnings paid from
//     the treasury + 2x vote weight. Staking/faucet/receiving do NOT reset it;
//     a sell DOES reset it.
// Balance checks are delta-based where possible. Takes ~15 min (real duel +
// voting windows of 120s each).
const { connect, keyStores, utils } = require("near-api-js");
const fs = require("fs");
const path = require("path");

const CONTRACT = "memevault-v2.testnet";
const OWNER = "memevault2026.testnet";
const USER = "memevault-tester.testnet"; // faucet account
const DH = "memevault-dh.testnet"; // fresh account, never sells until the sell test
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
    fs.readFileSync(path.join(process.env.HOME, ".near-credentials/testnet/memevault-v2.testnet.json"), "utf8")
  );
  const keyStore = new keyStores.InMemoryKeyStore();
  for (const id of [CONTRACT, OWNER, USER, DH]) {
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
  const owner = await near.account(OWNER);
  const dh = await near.account(DH);
  const view = (m, a) => contract.viewFunction({ contractId: CONTRACT, methodName: m, args: a || {} });
  const call = (account, m, a, deposit) =>
    account.functionCall({ contractId: CONTRACT, methodName: m, args: a || {}, gas: GAS, attachedDeposit: deposit || 0n });

  // 1. Metadata + supply + burn config
  const meta = await view("ft_metadata");
  check("ft_metadata symbol MVAULT", meta.symbol === "MVAULT", meta.symbol);
  check("ft_metadata decimals 18", meta.decimals === 18);
  const supply = await view("ft_total_supply");
  check("total supply 1e9 MVAULT", supply === (1000000000n * MVAULT).toString());
  const stats0 = await view("get_stats");
  check("burn_bps is 500 (5%)", stats0.burn_bps === 500, "burn_bps=" + stats0.burn_bps);
  check("total_burned starts at 0", stats0.total_burned === "0");
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

  // 3. Transfer 100 MVAULT -> 1% fee to treasury, 99 received, and it is a SELL
  const ownerBefore = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  const treasuryBefore = 0n;
  await call(user, "ft_transfer", { receiver_id: OWNER, amount: (100n * MVAULT).toString() }, 1n);
  const bal2 = await view("ft_balance_of", { account_id: USER });
  check("sender balance 900 after sending 100", bal2 === (900n * MVAULT).toString(), bal2);
  const ownerAfter = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  check("owner received 99 (100 minus 1 fee)", ownerAfter - ownerBefore === 99n * MVAULT);
  const treasury1 = BigInt(await view("get_treasury_balance"));
  check("treasury grew by 1 MVAULT fee", treasury1 - treasuryBefore === 1n * MVAULT, treasury1.toString());
  const dhUser = await view("get_diamond_hands", { account_id: USER });
  check("transfer OUT marks seller as NOT Diamond Hands", dhUser.is_diamond === false, JSON.stringify(dhUser));

  // 4. Duel #0: create, stake both sides, wait, resolve. Pot 40, burn 2, winner gets 38.
  await call(user, "create_duel", { option_a: "DOGE", option_b: "PEPE", duration_sec: 120 });
  const duels0 = await view("get_duels", {});
  const duelId0 = duels0[duels0.length - 1].id;
  await call(user, "join_duel", { duel_id: duelId0, side: "a", amount: (10n * MVAULT).toString() });
  await call(user, "join_duel", { duel_id: duelId0, side: "b", amount: (30n * MVAULT).toString() });
  const d0 = await view("get_duel", { duel_id: duelId0 });
  check("duel stakes a=10 b=30", d0.stakes_a === (10n * MVAULT).toString() && d0.stakes_b === (30n * MVAULT).toString());
  console.log("... waiting 130s for duel #0 to end ...");
  await sleep(130000);
  await call(user, "resolve_duel", { duel_id: duelId0 });
  const d0r = await view("get_duel", { duel_id: duelId0 });
  check("duel #0 resolved, winner is b", d0r.resolved === true && d0r.winner === "b", "winner=" + d0r.winner);
  check("duel #0 burned 2 MVAULT (5% of 40)", d0r.burned === (2n * MVAULT).toString(), "burned=" + d0r.burned);
  const bal3 = await view("ft_balance_of", { account_id: USER });
  // 900 - 40 staked + 38 distributable (40 pot minus 2 burned, sole winner, no bonus: user sold) = 898
  check("winner got 38 not 40, balance 898", bal3 === (898n * MVAULT).toString(), bal3);
  const stats1 = await view("get_stats");
  check("total_burned is 2 MVAULT", stats1.total_burned === (2n * MVAULT).toString(), stats1.total_burned);
  check("total supply shrank by 2 MVAULT", stats1.total_supply === ((1000000000n - 2n) * MVAULT).toString(), stats1.total_supply);

  // 5. Fund the treasury: owner transfers 10,000 to user, fee 100 -> treasury 101
  await call(owner, "ft_transfer", { receiver_id: USER, amount: (10000n * MVAULT).toString() }, 1n);
  const treasury2 = BigInt(await view("get_treasury_balance"));
  check("treasury is 101 after owner transfer fee", treasury2 === 101n * MVAULT, treasury2.toString());

  // 6. Diamond Hands account: register + claim faucet (claim does NOT reset the timer)
  await call(dh, "storage_deposit", {}, utils.format.parseNearAmount("0.002"));
  await call(dh, "claim_faucet", {});
  const dhBal0 = await view("ft_balance_of", { account_id: DH });
  check("DH faucet gives 1,000 MVAULT", dhBal0 === (1000n * MVAULT).toString(), dhBal0);
  const dh0 = await view("get_diamond_hands", { account_id: DH });
  check("never-sold account IS Diamond Hands", dh0.is_diamond === true, JSON.stringify(dh0));

  // 7. Duel #1: DH stakes 10 on A, user stakes 5 on B. Winner A. Pot 15, burn 0.75,
  //    distributable 14.25, DH share 14.25 + 14.25 bonus from treasury (101 covers it).
  await call(dh, "create_duel", { option_a: "DOGE", option_b: "PEPE", duration_sec: 120 });
  const duels1 = await view("get_duels", {});
  const duelId1 = duels1[duels1.length - 1].id;
  await call(dh, "join_duel", { duel_id: duelId1, side: "a", amount: (10n * MVAULT).toString() });
  await call(user, "join_duel", { duel_id: duelId1, side: "b", amount: (5n * MVAULT).toString() });
  console.log("... waiting 130s for duel #1 to end ...");
  await sleep(130000);
  await call(dh, "resolve_duel", { duel_id: duelId1 });
  const d1r = await view("get_duel", { duel_id: duelId1 });
  check("duel #1 resolved, winner is a", d1r.resolved === true && d1r.winner === "a", "winner=" + d1r.winner);
  check("duel #1 burned 0.75 MVAULT (5% of 15)", d1r.burned === (750000000000000000n).toString(), "burned=" + d1r.burned);
  const dhBal1 = await view("ft_balance_of", { account_id: DH });
  // 1000 - 10 staked + 14.25 share + 14.25 diamond bonus = 1018.5
  check("DH got 2x (1018.5), bonus paid from treasury", dhBal1 === (1018500000000000000000n).toString(), dhBal1);
  const treasury3 = BigInt(await view("get_treasury_balance"));
  check("treasury paid the 14.25 bonus (101 -> 86.75)", treasury3 === 8675n * 10n ** 16n, treasury3.toString());
  const dh1 = await view("get_diamond_hands", { account_id: DH });
  check("staking did NOT reset Diamond Hands", dh1.is_diamond === true, JSON.stringify(dh1));
  const stats2 = await view("get_stats");
  check("total_burned is 2.75 MVAULT", stats2.total_burned === (2750000000000000000n).toString(), stats2.total_burned);

  // 8. Proposal: create, DH votes yes with 2x weight (1018.5 x 2 = 2037), wait, execute
  const ownerBefore2 = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  await call(dh, "create_proposal", {
    title: "Test payout",
    description: "Pay 1 MVAULT from treasury to owner",
    amount: (1n * MVAULT).toString(),
    recipient: OWNER,
    duration_sec: 120,
  });
  const props = await view("get_proposals", {});
  const propId = props[props.length - 1].id;
  await call(dh, "vote", { proposal_id: propId, vote: "yes" });
  const p1 = await view("get_proposal", { proposal_id: propId });
  check("vote counted with 2x Diamond weight (yes 2037)", p1.yes === (2037n * MVAULT).toString(), "yes=" + p1.yes);
  try {
    await call(dh, "vote", { proposal_id: propId, vote: "yes" });
    check("double vote rejected", false);
  } catch (e) {
    check("double vote rejected", /Already voted/i.test(e.message));
  }
  console.log("... waiting 130s for voting to end ...");
  await sleep(130000);
  await call(dh, "execute_proposal", { proposal_id: propId });
  const p2 = await view("get_proposal", { proposal_id: propId });
  check("proposal executed and passed", p2.executed === true && p2.passed === true);
  const treasury4 = BigInt(await view("get_treasury_balance"));
  check("treasury spent 1 MVAULT (86.75 -> 85.75)", treasury4 === 8575n * 10n ** 16n, treasury4.toString());
  const ownerAfter2 = BigInt(await view("ft_balance_of", { account_id: OWNER }));
  check("recipient got 1 MVAULT payout", ownerAfter2 - ownerBefore2 === 1n * MVAULT);

  // 9. Sell resets Diamond Hands: DH transfers 10 to user
  await call(dh, "ft_transfer", { receiver_id: USER, amount: (10n * MVAULT).toString() }, 1n);
  const dh2 = await view("get_diamond_hands", { account_id: DH });
  check("a sell resets Diamond Hands", dh2.is_diamond === false, JSON.stringify(dh2));

  // 10. Stats + leaderboard
  const stats = await view("get_stats");
  check("stats show duels and proposals", stats.duels >= 2 && stats.proposals >= 1, JSON.stringify(stats));
  const lb = await view("get_leaderboard", { limit: 3 });
  check("leaderboard top is owner", lb[0].account_id === OWNER, lb[0].account_id);

  console.log("\n==== RESULT: " + pass + " passed, " + fail + " failed ====");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E ERROR:", e.message);
  process.exit(1);
});
