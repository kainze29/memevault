// MemeVault: a memecoin with mechanics on NEAR testnet.
// NEP-141 fungible token (MVAULT) with a 1% transfer fee feeding an on-chain
// treasury, plus meme duels (games) and token-weighted treasury governance (social).
import { NearBindgen, near, call, view, initialize, LookupMap, Vector } from "near-sdk-js";

const DECIMALS = 18;
const TOTAL_SUPPLY = (1000000000n * 10n ** BigInt(DECIMALS)).toString(); // 1e9 MVAULT
const FEE_BPS = 100n; // 1% of every transfer goes to the treasury
const STORAGE_MIN = 1250000000000000000000n; // 0.00125 NEAR, NEP-122 minimum
const ONE_YOCTO = 1n;

function toBig(s) {
  return BigInt(s || "0");
}

@NearBindgen({ requireInit: true })
class MemeVault {
  constructor() {
    this.owner_id = "";
    this.total_supply = "0";
    this.balances = new LookupMap("b");
    this.registered = new LookupMap("r");
    this.holders = new Vector("h");
    this.duels = new LookupMap("d");
    this.duel_ids = new Vector("di");
    this.stakes = new Vector("s");
    this.proposals = new LookupMap("p");
    this.proposal_ids = new Vector("pi");
    this.votes = new LookupMap("v");
    this.faucet_pool = "0";
    this.faucet_claimed = new LookupMap("f");
  }

  @initialize({})
  init({ owner_id, faucet_amount }) {
    const faucet = toBig(faucet_amount || "0");
    this.owner_id = owner_id;
    this.total_supply = TOTAL_SUPPLY;
    this.faucet_pool = faucet.toString();
    this.balances.set(owner_id, (toBig(TOTAL_SUPPLY) - faucet).toString());
    this.registered.set(owner_id, "1");
    this.holders.push(owner_id);
    if (faucet > 0n) {
      const t = near.currentAccountId();
      this.balances.set(t, faucet.toString());
      this.registered.set(t, "1");
    }
  }

  // ---------- internal helpers ----------
  _balance(account_id) {
    return this.balances.get(account_id) || "0";
  }

  _setBalance(account_id, amount) {
    const prev = toBig(this._balance(account_id));
    if (prev === 0n && toBig(amount) > 0n && !this._isHolder(account_id)) {
      this.holders.push(account_id);
    }
    this.balances.set(account_id, amount);
  }

  _isHolder(account_id) {
    // cheap check: registered + has ever held; holders vector is the source of truth
    const arr = this.holders.toArray();
    return arr.includes(account_id);
  }

  _requireRegistered(account_id) {
    if (!this.registered.get(account_id)) {
      throw new Error("Account " + account_id + " is not registered. Call storage_deposit first.");
    }
  }

  _treasuryBalance() {
    return this._balance(near.currentAccountId());
  }

  // ---------- NEP-141 core ----------
  @view({})
  ft_metadata() {
    return {
      spec: "ft-1.0.0",
      name: "MemeVault",
      symbol: "MVAULT",
      icon: null,
      reference: null,
      reference_hash: null,
      decimals: DECIMALS,
    };
  }

  @view({})
  ft_total_supply() {
    return this.total_supply;
  }

  @view({})
  ft_balance_of({ account_id }) {
    return this._balance(account_id);
  }

  @call({ payableFunction: true })
  ft_transfer({ receiver_id, amount, memo }) {
    if (near.attachedDeposit() !== ONE_YOCTO) {
      throw new Error("ft_transfer requires exactly 1 yoctoNEAR attached");
    }
    const sender = near.predecessorAccountId();
    const amt = toBig(amount);
    if (amt <= 0n) throw new Error("Amount must be positive");
    this._requireRegistered(receiver_id);
    const senderBal = toBig(this._balance(sender));
    if (senderBal < amt) throw new Error("Insufficient balance");
    const fee = amt / FEE_BPS;
    const net = amt - fee;
    this._setBalance(sender, (senderBal - amt).toString());
    this._setBalance(receiver_id, (toBig(this._balance(receiver_id)) + net).toString());
    if (fee > 0n) {
      const t = near.currentAccountId();
      this._setBalance(t, (toBig(this._balance(t)) + fee).toString());
    }
  }

  // ---------- NEP-122 storage ----------
  @view({})
  storage_balance_bounds() {
    return { min: STORAGE_MIN.toString(), max: STORAGE_MIN.toString() };
  }

  @view({})
  storage_balance_of({ account_id }) {
    if (!this.registered.get(account_id)) return null;
    return { total: STORAGE_MIN.toString(), available: "0" };
  }

  @call({ payableFunction: true })
  storage_deposit({ account_id }) {
    const account = account_id || near.predecessorAccountId();
    if (near.attachedDeposit() < STORAGE_MIN) {
      throw new Error("Attach at least 0.00125 NEAR for storage");
    }
    if (!this.registered.get(account)) {
      this.registered.set(account, "1");
    }
    return { total: STORAGE_MIN.toString(), available: "0" };
  }

  @call({})
  storage_unregister({ force }) {
    const account = near.predecessorAccountId();
    if (toBig(this._balance(account)) > 0n && !force) {
      throw new Error("Account still holds tokens. Use force=true to unregister anyway.");
    }
    this.registered.remove(account);
    return true;
  }

  // ---------- treasury / stats views ----------
  @view({})
  get_treasury_balance() {
    // fees collected only; the faucet pool held by the contract is excluded
    return (toBig(this._balance(near.currentAccountId())) - toBig(this.faucet_pool)).toString();
  }

  @view({})
  get_faucet_pool() {
    return this.faucet_pool;
  }

  @view({})
  has_claimed_faucet({ account_id }) {
    return !!this.faucet_claimed.get(account_id);
  }

  // Anyone registered can claim 1,000 MVAULT once, so judges can try the demo
  // without asking the team for tokens. Funded from the faucet pool set at init.
  @call({})
  claim_faucet({}) {
    const caller = near.predecessorAccountId();
    this._requireRegistered(caller);
    if (this.faucet_claimed.get(caller)) throw new Error("Faucet already claimed");
    const amount = 1000n * 10n ** BigInt(DECIMALS);
    if (toBig(this.faucet_pool) < amount) throw new Error("Faucet pool is empty");
    this.faucet_claimed.set(caller, "1");
    this.faucet_pool = (toBig(this.faucet_pool) - amount).toString();
    const t = near.currentAccountId();
    this._setBalance(t, (toBig(this._balance(t)) - amount).toString());
    this._setBalance(caller, (toBig(this._balance(caller)) + amount).toString());
    return this._balance(caller);
  }

  @view({})
  get_stats() {
    let totalStaked = 0n;
    const duelArr = this.duel_ids.toArray();
    for (const id of duelArr) {
      const d = this.duels.get(id.toString());
      if (d) totalStaked += toBig(d.stakes_a) + toBig(d.stakes_b);
    }
    return {
      total_supply: this.total_supply,
      treasury_balance: this.get_treasury_balance(),
      faucet_pool: this.faucet_pool,
      holders: this.holders.length,
      duels: this.duel_ids.length,
      proposals: this.proposal_ids.length,
      total_staked: totalStaked.toString(),
      fee_bps: Number(FEE_BPS),
      decimals: DECIMALS,
    };
  }

  @view({})
  get_leaderboard({ limit }) {
    const n = limit || 10;
    const arr = this.holders.toArray();
    const rows = arr
      .map((account_id) => ({ account_id, balance: this._balance(account_id) }))
      .filter((r) => toBig(r.balance) > 0n)
      .sort((a, b) => (toBig(b.balance) > toBig(a.balance) ? 1 : -1))
      .slice(0, n);
    return rows;
  }

  // ---------- duels (games track) ----------
  @call({})
  create_duel({ option_a, option_b, duration_sec }) {
    const id = this.duel_ids.length;
    const end = near.blockTimestamp() + BigInt(duration_sec || 3600) * 1000000000n;
    const duel = {
      id,
      option_a,
      option_b,
      end_time: end.toString(),
      stakes_a: "0",
      stakes_b: "0",
      resolved: false,
      winner: null,
      creator: near.predecessorAccountId(),
    };
    this.duels.set(id.toString(), duel);
    this.duel_ids.push(id);
    return duel;
  }

  @call({})
  join_duel({ duel_id, side, amount }) {
    const d = this.duels.get(duel_id.toString());
    if (!d) throw new Error("Duel not found");
    if (d.resolved) throw new Error("Duel already resolved");
    if (near.blockTimestamp() >= toBig(d.end_time)) throw new Error("Duel entry closed");
    if (side !== "a" && side !== "b") throw new Error("side must be 'a' or 'b'");
    const amt = toBig(amount);
    if (amt <= 0n) throw new Error("Amount must be positive");
    const caller = near.predecessorAccountId();
    const bal = toBig(this._balance(caller));
    if (bal < amt) throw new Error("Insufficient MVAULT balance");
    this._setBalance(caller, (bal - amt).toString());
    if (side === "a") d.stakes_a = (toBig(d.stakes_a) + amt).toString();
    else d.stakes_b = (toBig(d.stakes_b) + amt).toString();
    this.duels.set(duel_id.toString(), d);
    this.stakes.push({ duel_id, account_id: caller, side, amount: amt.toString() });
    return d;
  }

  @call({})
  resolve_duel({ duel_id }) {
    const d = this.duels.get(duel_id.toString());
    if (!d) throw new Error("Duel not found");
    if (d.resolved) throw new Error("Duel already resolved");
    if (near.blockTimestamp() < toBig(d.end_time)) throw new Error("Duel has not ended yet");
    const pot = toBig(d.stakes_a) + toBig(d.stakes_b);
    const winner = toBig(d.stakes_a) >= toBig(d.stakes_b) ? "a" : "b";
    const winTotal = winner === "a" ? toBig(d.stakes_a) : toBig(d.stakes_b);
    const payouts = [];
    if (pot > 0n && winTotal > 0n) {
      const records = this.stakes.toArray();
      for (const r of records) {
        if (r.duel_id === duel_id && r.side === winner) {
          const share = (toBig(r.amount) * pot) / winTotal;
          this._setBalance(r.account_id, (toBig(this._balance(r.account_id)) + share).toString());
          payouts.push({ account_id: r.account_id, amount: share.toString() });
        }
      }
    }
    d.resolved = true;
    d.winner = winner;
    this.duels.set(duel_id.toString(), d);
    return { duel: d, payouts };
  }

  @view({})
  get_duel({ duel_id }) {
    return this.duels.get(duel_id.toString());
  }

  @view({})
  get_duels() {
    return this.duel_ids.toArray().map((id) => this.duels.get(id.toString()));
  }

  @view({})
  get_my_stake({ duel_id, account_id }) {
    let total = 0n;
    for (const r of this.stakes.toArray()) {
      if (r.duel_id === duel_id && r.account_id === account_id) total += toBig(r.amount);
    }
    return total.toString();
  }

  // ---------- proposals (social track) ----------
  @call({})
  create_proposal({ title, description, amount, recipient, duration_sec }) {
    const id = this.proposal_ids.length;
    const end = near.blockTimestamp() + BigInt(duration_sec || 86400) * 1000000000n;
    const p = {
      id,
      title,
      description,
      amount: toBig(amount).toString(),
      recipient,
      end_time: end.toString(),
      yes: "0",
      no: "0",
      executed: false,
      passed: null,
      creator: near.predecessorAccountId(),
    };
    this.proposals.set(id.toString(), p);
    this.proposal_ids.push(id);
    return p;
  }

  @call({})
  vote({ proposal_id, vote }) {
    const p = this.proposals.get(proposal_id.toString());
    if (!p) throw new Error("Proposal not found");
    if (p.executed) throw new Error("Proposal already executed");
    if (near.blockTimestamp() >= toBig(p.end_time)) throw new Error("Voting has ended");
    if (vote !== "yes" && vote !== "no") throw new Error("vote must be 'yes' or 'no'");
    const caller = near.predecessorAccountId();
    const key = proposal_id.toString() + ":" + caller;
    if (this.votes.get(key)) throw new Error("Already voted on this proposal");
    const weight = toBig(this._balance(caller));
    if (weight <= 0n) throw new Error("Need MVAULT balance to vote");
    if (vote === "yes") p.yes = (toBig(p.yes) + weight).toString();
    else p.no = (toBig(p.no) + weight).toString();
    this.votes.set(key, vote);
    this.proposals.set(proposal_id.toString(), p);
    return p;
  }

  @call({})
  execute_proposal({ proposal_id }) {
    const p = this.proposals.get(proposal_id.toString());
    if (!p) throw new Error("Proposal not found");
    if (p.executed) throw new Error("Proposal already executed");
    if (near.blockTimestamp() < toBig(p.end_time)) throw new Error("Voting has not ended yet");
    const passed = toBig(p.yes) > toBig(p.no) && toBig(p.yes) > 0n;
    p.executed = true;
    p.passed = passed;
    if (passed) {
      const treasury = toBig(this.get_treasury_balance());
      const amt = toBig(p.amount);
      if (treasury < amt) throw new Error("Treasury cannot cover this proposal");
      const t = near.currentAccountId();
      // deduct from the contract's FULL balance (treasury + faucet pool),
      // not from the treasury figure alone, or the faucet pool accounting breaks
      this._setBalance(t, (toBig(this._balance(t)) - amt).toString());
      if (!this.registered.get(p.recipient)) this.registered.set(p.recipient, "1");
      this._setBalance(p.recipient, (toBig(this._balance(p.recipient)) + amt).toString());
    }
    this.proposals.set(proposal_id.toString(), p);
    return p;
  }

  @view({})
  get_proposal({ proposal_id }) {
    return this.proposals.get(proposal_id.toString());
  }

  @view({})
  get_proposals() {
    return this.proposal_ids.toArray().map((id) => this.proposals.get(id.toString()));
  }
}
