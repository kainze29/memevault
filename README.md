# MemeVault — a memecoin with mechanics on NEAR

**Built at NEAR HACKATHON (Nov 1–14, 2026). Testnet-only project (eligible in all tracks, see HACKATHON.md Q-010).**

- **Live demo:** https://kainze29.github.io/memevault/
- **Contract (NEAR testnet):** [`memevault-v2.testnet`](https://explorer.testnet.near.org/accounts/memevault-v2.testnet)
- **Deploy tx:** [`GCuxAvWrtWgCGRHTPCRhxK1AzQ63FsX8h2AdjoJJMEn9`](https://explorer.testnet.near.org/transactions/GCuxAvWrtWgCGRHTPCRhxK1AzQ63FsX8h2AdjoJJMEn9)
- **Init tx:** [`79SL6jsZUNJaoJGPSDWpdkhRgq4HkfY6z7ukkrCeXHnQ`](https://explorer.testnet.near.org/transactions/79SL6jsZUNJaoJGPSDWpdkhRgq4HkfY6z7ukkrCeXHnQ)
- v2 adds duel burn + Diamond Hands (see below). The v1 contract [`memevault-live.testnet`](https://explorer.testnet.near.org/accounts/memevault-live.testnet) is superseded.

## What it is

Memecoins usually do nothing: you buy, you hope, the chart decides. MemeVault is a memecoin where the meme **does something**. It is a NEP-141 fungible token (MVAULT, 1 billion supply) with five mechanics built into one on-chain contract:

1. **Treasury fee (memecoins track).** Every transfer pays a 1% fee straight into an on-chain treasury. The fee is enforced by the token itself, not by a frontend, so it works for every holder and every wallet.
2. **Meme duels (games track).** Anyone can open a duel between two memes (e.g. DOGE vs PEPE). Holders stake MVAULT on a side; when the window closes, the side with more staked wins and the pot is split among its backers, proportional to stake. A real game loop with real stakes.
3. **Treasury governance (social track).** Holders propose how to spend the treasury (e.g. "pay 500 MVAULT to the artist who made the meme"), vote with token-weighted yes/no votes, and anyone can execute a passed proposal to pay out from the treasury.
4. **Duel burn (v2, memecoins track).** When a duel resolves, 5% of the pot is burned and total supply shrinks. The more the community plays, the scarcer MVAULT gets. Winners split the remaining 95% proportionally. Total burned is tracked on-chain (`total_burned` in stats) and shown on the dashboard.
5. **Diamond Hands (v2, social track).** A holder who has not sold (transferred OUT) in the last 24h (86,400 blocks), or who has never sold at all, is Diamond Hands: their duel winnings are doubled (the bonus is paid from the treasury, never from the pot, and only if the treasury covers it) and their governance votes count 2x per token. Staking into a duel, claiming from the faucet, and receiving tokens do NOT reset the timer; only a transfer out does. The frontend shows a 💎 badge with the remaining time for the connected wallet.
6. **Dashboard (thesis-leaning data).** The frontend shows live treasury balance, total burned, holder leaderboard, duel history, proposal history, plus a live NEAR ecosystem stats panel (NEAR price, total supply, transactions, accounts) from public on-chain data sources.

## The problem

Memecoin communities generate all the value and capture none of it: fees go to exchanges, treasuries are Discord promises, and "community governance" is a poll nobody enforces. MemeVault puts the money rules on-chain where everyone can verify them: the fee, the duel pot, and the treasury vote are all enforced by the contract, not by trust.

## How NEAR fits

- **One contract, three mechanics.** NEAR's cheap storage and fast finality make a fee-collecting token, timed duels, and token-weighted votes practical in a single contract.
- **NEP-141 + NEP-122.** The token follows the NEAR fungible-token standard (transfer, balance, metadata, storage deposits), so any NEAR wallet or tool can hold and move MVAULT.
- **Testnet for everything.** The whole demo runs on NEAR testnet with free test NEAR, so judges can try every feature without spending anything.

## Tracks

- `memecoins` (primary) — memecoin with mechanics: fee-fed treasury (NEP-141).
- `games` — meme duels with staked pots and proportional payouts.
- `social` — token-weighted treasury governance.
- The dashboard's NEAR stats panel leans on `thesis` (on-chain data, live dashboard), but the submission tracks are the three above.

## Try it — do X, see Y (judges)

You need a NEAR **testnet** wallet (free test NEAR at https://near-faucet.io). Open the live demo and:

1. **Connect your testnet wallet, then click "1. Register storage"** — see your wallet connect and the registration succeed (0.002 NEAR storage deposit).
2. **Click "2. Claim 1,000 MVAULT"** — see your balance become 1,000 MVAULT. (One claim per account; the faucet holds 10,000,000 MVAULT.) Claiming does NOT break Diamond Hands.
3. **Send 100 MVAULT to any account** — see your balance drop by 100, the receiver gain 99, and the Treasury stat grow by 1 (the 1% fee). Note: this transfer OUT also (re)starts your 24h Diamond Hands timer, and the 💎 badge will show the countdown.
4. **Create a duel (e.g. DOGE vs PEPE, 3600 seconds), stake on a side** — see the duel appear with your stake counted. Staking does NOT reset your Diamond Hands timer.
5. **After a duel ends, click "Resolve duel"** — see the winner announced, 5% of the pot burned (the "Total burned" stat grows and total supply shrinks), and winners' balances grow by their share of the remaining 95%. If you are Diamond Hands (no sell in 24h), your winnings are doubled, paid from the treasury.
6. **Create a proposal (e.g. pay 1 MVAULT to a friend), vote YES, wait for the window, click "Execute"** — see the proposal pass and the recipient paid from the treasury. Diamond Hands votes count 2x per token.
7. **Check the leaderboard, the burn counter, and the NEAR stats panel** — live on-chain data, no mock values.

Every step above is verified end-to-end by `scripts/e2e-test.js` (run it: `node scripts/e2e-test.js`; it uses fresh test accounts and takes ~15 minutes because it waits out real duel/voting windows).

## How to run it

### Contract (build + deploy)

```sh
npm install
node scripts/build-contract.mjs   # rollup + babel, then qjsc + clang -> build/contract.wasm
node scripts/deploy.js            # deploys to memevault-v2.testnet and inits it
node scripts/e2e-test.js          # full end-to-end test on testnet
```

Build notes: the project uses `near-sdk-js` v2. Its `build` command fails to parse decorators with rollup on this setup, so `scripts/build-contract.mjs` runs the same rollup+babel step directly and then the SDK's `transpileJsAndBuildWasm`. The contract source is `contract/src/index.ts` (TypeScript, near-sdk-js decorators). The init method is named `init`, not `new`, because the bindgen exporter generates `export function <name>` and `new` is a reserved word.

The deployer key lives in `~/.near-credentials/testnet/` (never committed). The contract account is `memevault-v2.testnet`; the token owner (holds the minted supply minus the faucet pool) is `memevault2026.testnet`. Test accounts used by the e2e script (`memevault-tester.testnet`, `memevault-dh.testnet`) share the same keypair and were created via the testnet helper API.

### Frontend

`docs/index.html` is a single-page app (plain HTML/JS + `near-api-js` v2 from CDN, no build step). It is deployed via GitHub Pages from `docs/`. To run locally, serve the folder with any static server, e.g. `npx serve docs`.

## Contract API

Views: `ft_metadata`, `ft_total_supply`, `ft_balance_of`, `storage_balance_of`, `storage_balance_bounds`, `get_treasury_balance`, `get_faucet_pool`, `has_claimed_faucet`, `get_stats` (includes `total_burned`, `burn_bps`), `get_leaderboard`, `get_duels`, `get_duel`, `get_my_stake`, `get_proposals`, `get_proposal`, `get_diamond_hands` (returns `is_diamond`, `last_sell_block`, `blocks_since_sell`, `blocks_remaining`, `diamond_blocks`, `multiplier`).

Calls: `init` (once), `ft_transfer` (1 yoctoNEAR attached, 1% fee to treasury; a transfer OUT (re)starts the caller's Diamond Hands timer), `storage_deposit` (min 0.00125 NEAR), `storage_unregister`, `claim_faucet` (1,000 MVAULT, once per account; does not affect Diamond Hands), `create_duel`, `join_duel` (staking does not affect Diamond Hands), `resolve_duel` (burns 5% of the pot, winners split 95% proportionally, Diamond Hands winners get a 2x bonus from the treasury if it covers it), `create_proposal`, `vote` (Diamond Hands weight 2x per token), `execute_proposal`.

Notes: `ft_transfer_call` is not implemented (only the NEP-141 core + storage). Duel ties go to side A (deterministic, no refunds). Votes are weighted by current MVAULT balance (2x for Diamond Hands), one vote per account per proposal.

## Libraries, templates, and AI code used

- [near-sdk-js](https://github.com/near/near-sdk-js) v2.0.0 — JavaScript smart-contract SDK (contract built with it).
- [near-api-js](https://github.com/near/near-api-js) v5 (scripts) and v2.1.4 UMD via CDN (frontend) — NEAR RPC, accounts, wallet connection.
- [near/quickjs](https://github.com/near/quickjs) v0.1.3, [ailisp/binaryen](https://github.com/ailisp/binaryen) v0.1.16, [WebAssembly/wasi-sdk](https://github.com/WebAssembly/wasi-sdk) 11.0 — toolchain binaries downloaded by the near-sdk-js post-install (re-fetched manually with curl, see repo notes).
- No starter template was used; the contract and frontend were written for this hackathon, with AI assistance (Muse). All AI-generated code is in this repository and listed here per HACKATHON.md Q-005.
- NEAR ecosystem data on the dashboard comes from public APIs: CoinGecko (NEAR price) and NearBlocks (chain stats).

## License

MIT. See `LICENSE`.
