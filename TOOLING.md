# Handshake — deployment & proof tooling

Tooling branch (`feat/tooling`) for the Handshake reactive OTC settlement demo.
It implements the PRD runbook (strict deploy order, pre-funded callbacks, observable
proof capture) without deploying anything by default. **No contract addresses, keys,
or secrets are hardcoded.**

## Layout

| File | Purpose |
|---|---|
| `script/HandshakeSupport.sol` | **Single place** for Solidity-side ABIs, network constants, deployment/funding helpers |
| `script/Deploy.s.sol` | Strict-order deployment: RC (Lasna) → tokens → escrows (RC baked in) → `setVenues` → optional funding |
| `script/Fund.s.sol` | `SYSTEM.depositTo(RC)` and proxy `depositTo(escrow)` on Base/Unichain, then asserts `debt == 0` |
| `scripts/preflight.sh` | Debt/reserves, wallet balances and active-subscription gate; prints exact `cast send --account …` fixes |
| `ts/abis.ts` | **Single place** for TypeScript-side ABIs (mirror of the Solidity interfaces) |
| `ts/networks.ts` | Chain IDs, RPC/WebSocket URLs, canonical explorers, proxy/system addresses |
| `ts/deploy.ts` | viem deploy helper (same strict order) with `--account`-style Foundry alternative above |
| `ts/observe.ts` | WebSocket observer recording ms timestamps: second lock → reactive → both callbacks → `latency.json` |
| `ts/collectProofs.ts` | Given an order ID, resolve origin/reactive/callback hashes from logs and print a markdown table |
| `ts/proofBundle.ts` | Emit `proof.md`: hashes, explorer links, decoded payloads, debt/reserves snapshot, verification commands |

## Setup

```bash
forge build                 # contracts branch merged first; libs are submodules
npm install
cp .env.example .env        # fill addresses/wallets, never keys in git
```

Signing:

- Foundry scripts and `preflight.sh` use the **keystore account** (`--account main`).
  Keys stay in Foundry's keystore; this repo never reads a private key for those paths.
- **Do not use `ts/deploy.ts` for signing with a raw `PRIVATE_KEY`.** Prefer the Foundry
  keystore scripts above. `ts/deploy.ts` is a fallback only: it reads `PRIVATE_KEY` from the
  shell/dotenv, refuses to run if unset, and that key must **never** be committed to the repo.

## Deploy (PRD §13)

```bash
export REACTIVE_RPC=https://lasna-rpc.rnk.dev/
export BASE_RPC=https://sepolia.base.org
export UNICHAIN_RPC=https://sepolia.unichain.org

forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

Artifact names default to `src/HandshakeReactive.sol:HandshakeReactive`,
`src/tokens/TestUSD.sol:TestUSD`, `src/tokens/TestAsset.sol:TestAsset`,
`src/PaymentEscrow.sol:PaymentEscrow`, `src/AssetEscrow.sol:AssetEscrow`.
Override with `*_ARTIFACT` env vars if the contracts branch uses different paths.
Previously deployed components can be reused by setting their `*_ADDRESS` env vars.
`setVenues` is one-shot on the contracts branch: `Deploy.s.sol` calls it only when the RC
reports `venuesSet() == false`, and logs `VenuesAlreadySet` when subscriptions already exist.
First-run still follows the strict deploy order.

The script writes `deployments.json` (gitignored). Funding is a separate step by default:

```bash
forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

Amounts: `RC_FUND_AMOUNT_WEI` (default 1 lREACT), `PAYMENT_RESERVE_WEI` and
`ASSET_RESERVE_WEI` (default 0.02 ETH each). Set `AUTO_FUND=1` on Deploy to combine them.

Fallback only: `npm run deploy` (viem; requires `PRIVATE_KEY` from the shell — never commit it).

## Preflight (before every demo / video take)

```bash
npm run preflight
```

Checks on all three chains: `debt == 0`, `reserves > 0` (when exposed), wallet balances
above thresholds, and at least `MIN_ACTIVE_SUBSCRIPTIONS` (default 7: six events + Cron10)
active subscriptions on Lasna. Subscription state is derived from `Subscribe` /
`Unsubscribe` logs from the system contract; set `SUBSCRIPTION_FROM_BLOCK` if the RC was
deployed before the default lookback window. Any failure prints the exact
`cast send … --account $FOUNDRY_ACCOUNT …` command (or faucet URL) to fix it.

## Observability & proofs

```bash
npm run observe                 # Ctrl-C to flush latency.json / latency.csv
npm run proofs -- 0x<orderId>   # markdown table of all resolved tx hashes
npm run proof -- 0x<orderId>    # writes proof.md (also printed to stdout)
```

`observe.ts` derives WebSocket URLs from the HTTP RPCs unless `REACTIVE_WS`, `BASE_WS`,
`UNICHAIN_WS` are set. It records wall-clock `Date.now()` at WebSocket log arrival
(observer delay included) and also stores on-chain block numbers/timestamps; EVM
timestamps have 1-second granularity. `collectProofs.ts` looks back
`PROOF_LOOKBACK_BLOCKS` (default 200k) blocks — raise it for older orders. It never
invents a hash: missing hops render as “not observed”.

Canonical explorers: [BaseScan](https://sepolia.basescan.org/tx/{hash}),
[Reactscan](https://lasna.reactscan.net/tx/{hash}),
[Uniscan](https://sepolia.uniscan.xyz/tx/{hash}).

## Validation

```bash
npm install
npx tsc --noEmit
forge build
```

Merge note: after `feat/contracts` lands, verify `ts/abis.ts` against
`forge inspect <Contract> abi` and adjust only `script/HandshakeSupport.sol` and
`ts/abis.ts`; all scripts and utilities consume those two files.

Honest limitation: Handshake is eventually atomic via two callbacks, not a single
atomic cross-chain transaction.
