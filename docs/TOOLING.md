# Handshake — deployment & proof tooling

The current system is **one reactive contract on Reactive Lasna** with a venue
registry: `setVenue(chainId, paymentEscrow, assetEscrow)` is called once per
registered chain (84532, 1301, 11155111), producing **19 subscriptions = 6 topics
× 3 chains + Cron10**. Six token-agnostic escrows serve 24 directed routes, and
`termsHash` is bound per order and venue. See [`DEPLOYMENT.md`](./DEPLOYMENT.md)
for the authoritative live addresses and proof. Tooling never hardcodes keys:
**no private keys or keystore passwords belong in this repo**.

## Layout

| File | Purpose |
|---|---|
| `script/HandshakeSupport.sol` | **Single place** for Solidity-side ABIs, network constants, deployment/funding helpers |
| `script/Deploy.s.sol` | Strict-order deployment: RC (Lasna) → per-chain tokens/escrows → one `setVenue()` per chain → optional funding |
| `script/Fund.s.sol` | `SYSTEM.depositTo(RC)` and each proxy's `depositTo(escrow)`, then asserts `debt == 0` |
| `scripts/preflight.sh` | Debt/reserves, wallet balances and active-subscription gate; prints exact `cast send --account …` fixes |
| `ts/abis.ts` | **Single place** for TypeScript-side ABIs (mirror of the Solidity interfaces) |
| `ts/networks.ts` | Chain IDs, RPC/WebSocket URLs, canonical explorers, proxy/system addresses |
| `ts/deploy.ts` | viem deploy helper (fallback; Foundry keystore scripts are preferred) |
| `ts/observe.ts` | WebSocket observer recording ms timestamps: second lock → reactive → both callbacks → `latency.json` |
| `ts/collectProofs.ts` | Given an order ID, resolve origin/reactive/callback hashes from logs and print a markdown table |
| `ts/proofBundle.ts` | Emit `proof.md`: hashes, explorer links, decoded payloads, debt/reserves snapshot, verification commands |

The backend is not part of this tooling path — see [`PLATFORM.md`](./PLATFORM.md)
for the deployed API/indexer and its metrics.

## Setup

```bash
forge build                 # libs are submodules
npm install
cp .env.example .env        # fill addresses/wallets, never keys in git
```

Signing:

- Foundry scripts and `preflight.sh` use the **keystore account**
  (`hs-deployer`; the shell variable is `FOUNDRY_ACCOUNT`, default `main`). Keys
  stay in Foundry's keystore; this repo never reads a private key for those paths.
- **Do not use `ts/deploy.ts` for signing with a raw `PRIVATE_KEY`.** It is a
  fallback that reads the key from the shell/dotenv; never commit that key.

## Deploy (PRD §13)

```bash
export REACTIVE_RPC=https://lasna-rpc.rnk.dev/
export BASE_RPC=https://sepolia.base.org
export UNICHAIN_RPC=https://sepolia.unichain.org
export SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com

forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

Artifact names default to `src/HandshakeReactive.sol:HandshakeReactive`,
`src/tokens/TestUSD.sol:TestUSD`, `src/tokens/TestAsset.sol:TestAsset`,
`src/PaymentEscrow.sol:PaymentEscrow`, `src/AssetEscrow.sol:AssetEscrow`.
Override with `*_ARTIFACT` env vars if needed; previously deployed components can
be reused with their `*_ADDRESS` env vars.

`Deploy.s.sol` registers each venue with
`setVenue(uint256,address,address)` and asserts `subscriptionCount() == 19`.
Venue registration is **not one-shot**: a venue can be replaced with another
`setVenue()` call, but `VenueInUse()` reverts while any non-closed order on that
chain exists (`unsubscribeAll()` has the same guard). Verify with
`venue(chainId)` and `registeredChainIds()`.

The script writes `deployments.json` (gitignored). Funding is a separate step by
default:

```bash
forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

Amounts: `RC_FUND_AMOUNT_WEI` (default 1 lREACT), `PAYMENT_RESERVE_WEI` and
`ASSET_RESERVE_WEI` (default 0.02 ETH each). Set `AUTO_FUND=1` on Deploy to
combine them. Fallback only: `npm run deploy` (viem; requires `PRIVATE_KEY` from
the shell — never commit it).

## Preflight (before every demo / video take)

```bash
npm run preflight
```

Checks all three registered chains: `debt == 0`, `reserves > 0` (when exposed),
wallet balances above thresholds, and at least `MIN_ACTIVE_SUBSCRIPTIONS`
(default **19**: six escrow topics on each of 84532 / 1301 / 11155111 plus
Cron10) active subscriptions on Lasna. Subscription state is derived from
`Subscribe` / `Unsubscribe` logs from the system contract; set
`SUBSCRIPTION_FROM_BLOCK` if the RC was deployed before the default lookback
window. Any failure prints the exact `cast send … --account $FOUNDRY_ACCOUNT …`
command (or faucet URL) to fix it.

## Observability & proofs

Contract-level tooling (below) is separate from the backend metrics in
[`PLATFORM.md`](./PLATFORM.md).

```bash
npm run observe                 # Ctrl-C to flush latency.json / latency.csv
npm run proofs -- 0x<orderId>   # markdown table of all resolved tx hashes
npm run proof -- 0x<orderId>    # writes proof.md (also printed to stdout)
```

`observe.ts` derives WebSocket URLs from the HTTP RPCs unless `REACTIVE_WS`,
`BASE_WS`, `UNICHAIN_WS`, `SEPOLIA_WS` are set. It records wall-clock
`Date.now()` at WebSocket log arrival (observer delay included) and also stores
on-chain block numbers/timestamps; EVM timestamps have 1-second granularity.
`collectProofs.ts` looks back `PROOF_LOOKBACK_BLOCKS` (default 200k) blocks —
raise it for older orders. It never invents a hash: missing hops render as
"not observed".

Canonical explorers: [BaseScan](https://sepolia.basescan.org/tx/{hash}),
[Reactscan](https://lasna.reactscan.net/tx/{hash}),
[Uniscan](https://sepolia.uniscan.xyz/tx/{hash}).

## Validation

```bash
npm install
npx tsc --noEmit
forge build
```

Keep `ts/abis.ts` and `script/HandshakeSupport.sol` in sync with
`forge inspect <Contract> abi` after contract changes; all scripts and utilities
consume those two files.

Honest limitation: Handshake is eventually atomic via two callbacks, not a
single atomic cross-chain transaction.
