# Handshake UI

React + Vite + TypeScript static console for Handshake — trust-minimized cross-chain OTC settlement on Reactive Omni (Lasna ↔ Base Sepolia ↔ Unichain Sepolia). No backend: the browser reads public RPCs directly and links to canonical explorers.

## Run

The package lives in `ui/`, not at the repo root. From the repo root, the correct commands are:

```bash
cd ui
npm install
npm run dev       # http://localhost:5173
npm run build     # static output in ui/dist/
npm run preview
```

Running `npm install && npm run build` directly at the repo root fails with `Missing script: "build"` — there is no root `package.json` by design.

Deploy `dist/` to Vercel (see `vercel.json` rewrite) or GitHub Pages (`404.html` SPA fallback). Set the Vite base path if deploying under a project subpath.

`npm install` may report transitive npm audit advisories (mostly wagmi/WalletConnect dependencies); these are dev-time dependency warnings and did not affect the static build, so no forced major upgrades are applied.

## Configuration

Deployment addresses are intentionally **blank** in `public/contracts.json`. After deploying the contracts, fill in:

- `reactive.reactiveContract` — HandshakeReactive on Lasna
- `base.paymentEscrow`, `base.paymentToken`
- `unichain.assetEscrow`, `unichain.assetToken`

System/proxy addresses, chain IDs and explorer URL builders are already set from PRD §11.1. Optional `scan.*FromBlock` values bound the log scan window; set them to deployment blocks for complete history. Any value can be overridden at build time with `VITE_RC_ADDRESS`, `VITE_PAYMENT_ESCROW`, `VITE_ASSET_ESCROW`, `VITE_PAYMENT_TOKEN`, `VITE_ASSET_TOKEN`, `VITE_BASE_PROXY`, `VITE_UNICHAIN_PROXY`, `VITE_*_FROM_BLOCK`, `VITE_LOOKBACK_BLOCKS`.

This file is fetched at runtime, so addresses can be updated **without rebuilding**. Never put private keys in it.

## Screens / routes

| Route | Screen |
| --- | --- |
| `/orders` | Header + debt banner, health panel, order board, demo guide, event log |
| `/new` | New order form with validation, presets and chain guards |
| `/orders/:orderId` | Order detail: leg cards, lock/approve/retry, hop timeline, proof markdown |
| `/events` | Filterable decoded event feed from all three chains |
| `/latency` | `public/latency.json` chart, table and methodology caveats |
| `/how-it-works` | Three-step explainer and honest limitations |
| `/verify` · `/verify/:orderId` | Public proof lookup — read-only, no wallet, no write buttons |

## Data policy

Every displayed hash, amount, timestamp and status comes from `getOrder`, `orderIds`, `getLeg`, `debt`/`reserves`, ERC-20 reads, or decoded on-chain logs (`PaymentLocked`, `AssetLocked`, terminal events, `CallbackRequest`, `Cron10`). Missing values render as `—` with "not observed yet" (or "not configured"). There is no seeded or sample order data.

The terms hash preflight uses `keccak256(abi.encode(buyer, seller, paymentToken, paymentAmount, assetToken, assetAmount, deadline))` from Lasna's `getOrder(id)`. Confirm the canonical encoding matches the deployed contracts before a demo.

## Stack

React 18 · Vite 5 · TypeScript (strict) · viem · wagmi (injected wallet + chain switching) · TanStack Query (5s board/health, 2s detail, 10s event log, 5s proof) · Tailwind CSS 3.

Polling intervals, explorer links and status derivation live in `src/lib/`. `src/lib/logs.ts` resolves proofs from real logs; `src/lib/proofs.ts` builds the markdown pasted into the DoraHacks submission.
