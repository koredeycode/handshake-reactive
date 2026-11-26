# Handshake UI

React + Vite + TypeScript static console for Handshake — trust-minimized cross-chain OTC settlement on Reactive Omni (Lasna ↔ Base Sepolia ↔ Unichain Sepolia). No backend: the browser reads public RPCs directly and links to canonical explorers.

## Run

The package lives in `ui/`, not at the repo root. From the repo root, the correct commands are:

```bash
cd ui
npm install
npm run dev       # http://localhost:5173
npm run typecheck
npm run build     # static output in ui/dist/
npm run preview
```

Running `npm install && npm run build` directly at the repo root fails with `Missing script: "build"` — there is no root `package.json` by design.

Deploy `dist/` to Vercel (see `vercel.json` rewrite) or GitHub Pages (`404.html` SPA fallback). Set the Vite base path if deploying under a project subpath.

`npm install` may report transitive npm audit advisories (mostly wagmi/WalletConnect dependencies); these are dev-time dependency warnings and did not affect the static build, so no forced major upgrades are applied.

## Configuration

Live addresses are read at runtime from `public/contracts.json`. `public/tokens.json` holds presentation metadata only (display name, symbol, decimals, mark, color) keyed by chain and token address — the ERC-20 contracts keep their own on-chain names. Optional build-time overrides: `VITE_RC_ADDRESS`, `VITE_PAYMENT_ESCROW`, `VITE_ASSET_ESCROW`, `VITE_PAYMENT_TOKEN`, `VITE_ASSET_TOKEN`, `VITE_BASE_PROXY`, `VITE_UNICHAIN_PROXY`, `VITE_*_FROM_BLOCK`, `VITE_LOOKBACK_BLOCKS`. `VITE_DEV_TOOLS=1` enables the hidden `/dev` route in a production build (it can also be opened with `?dev=1`). Never put private keys in any of these files.

## Routes

| Route | Screen |
| --- | --- |
| `/orders` | Trade screen: swap-style trade ticket and the live order book |
| `/new` | Trade ticket + order details: validation, presets and chain guards |
| `/orders/:orderId` | Order detail: trade card, lock/approve/retry, settlement trail and paired leg cards |
| `/verify` · `/verify/:orderId` | Public tracking — read-only, no wallet, only real hashes |
| `/faucet` | Quiet testnet destination: mint the two demo tokens, refresh balances, find native ETH faucets |
| `/dev` | Hidden internal diagnostics (not linked from navigation): debt/reserves/health, warnings, raw event log, latency chart, raw JSON state |

## Data policy

Every displayed hash, amount, timestamp and status comes from `getOrder`, `orderIds`, `getLeg`, `debt`/`reserves`, ERC-20 reads, or decoded on-chain logs (`PaymentLocked`, `AssetLocked`, terminal events, `CallbackRequest`, `Cron10`). There is no seeded or sample order data. Primary screens show pending steps as "Awaiting this leg" / "Settlement in progress"; literal "Not observed yet" debug states live on `/dev`.

The terms-hash preflight uses `keccak256(abi.encode(buyer, seller, paymentToken, paymentAmount, assetToken, assetAmount, deadline))` from Lasna's `getOrder(id)`. Confirm the canonical encoding matches the deployed contracts before a demo.

## Multicall

Lasna has no Multicall3 at viem's canonical address. wagmi is configured with `batch: { multicall: false }` and the order board issues plain `readContract` calls in parallel, so no read path requires Multicall3.

## Stack

React 18 · Vite 5 · TypeScript (strict) · viem · wagmi (injected wallet + chain switching) · TanStack Query · Tailwind CSS 3.

Polling intervals, explorer links and status derivation live in `src/lib/`. `src/lib/logs.ts` resolves proofs from real logs; `src/lib/proofs.ts` builds the settlement trail.
