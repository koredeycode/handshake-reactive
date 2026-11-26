# Handshake UI

React + Vite + TypeScript static console for Handshake — trust-minimized cross-chain OTC settlement on Reactive Omni (Reactive Lasna ↔ Base Sepolia ↔ Unichain Sepolia). No backend: the browser reads public RPCs directly and links to canonical explorers.

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

Live addresses are read at runtime from `public/contracts.json`. `public/tokens.json` holds display metadata (name, symbol, decimals, letter mark, color) keyed by chain and token address; its name/symbol/decimals mirror the deployed ERC-20s (`Test USD` / `tUSD` on Base Sepolia, `Test Asset` / `tASSET` on Unichain Sepolia). Optional build-time overrides: `VITE_RC_ADDRESS`, `VITE_PAYMENT_ESCROW`, `VITE_ASSET_ESCROW`, `VITE_PAYMENT_TOKEN`, `VITE_ASSET_TOKEN`, `VITE_BASE_PROXY`, `VITE_UNICHAIN_PROXY`, `VITE_*_FROM_BLOCK`, `VITE_LOOKBACK_BLOCKS`. `VITE_DEV_TOOLS=1` enables the hidden `/dev` route in a production build (it can also be opened with `?dev=1`). Never put private keys in any of these files.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Home: product headline, Base Sepolia → Reactive Lasna → Unichain Sepolia route, primary trade action and a live order book preview |
| `/orders` | Trade screen: swap-style trade ticket and the live order book |
| `/my-orders` | Personal order history: real orders where the connected wallet is buyer or seller, with observed tx hashes |
| `/new` | Trade ticket + order details: validation, quick presets, custom settlement window (30 seconds – 30 days) and chain guards |
| `/orders/:orderId` | Order detail: trade card, lock/approve/retry, settlement trail and paired leg cards |
| `/verify` · `/verify/:orderId` | Public tracking — read-only, no wallet, only real hashes |
| `/faucet` | Quiet testnet destination: mint the two demo tokens, refresh balances, find native ETH faucets |
| `/dev` | Hidden internal diagnostics (not linked from navigation): debt/reserves/health, warnings, raw event log, latency chart, raw JSON state |

## Data policy

Every displayed hash, amount, timestamp and status comes from `getOrder`, `orderIds`, `getLeg`, `debt`/`reserves`, ERC-20 reads, or decoded on-chain logs (`PaymentLocked`, `AssetLocked`, terminal events, `CallbackRequest`, `Cron10`). There is no seeded or sample order data. Primary screens show pending steps as "Awaiting this leg" / "Settlement in progress"; literal "Not observed yet" debug states live on `/dev`.

The terms-hash preflight uses `keccak256(abi.encode(buyer, seller, paymentToken, paymentAmount, assetToken, assetAmount, deadline))` from Reactive Lasna's `getOrder(id)`. Confirm the canonical encoding matches the deployed contracts before a demo.

## Multicall

Reactive Lasna has no Multicall3 at viem's canonical address. wagmi is configured with `batch: { multicall: false }` and the order board issues plain `readContract` calls in parallel, so no read path requires Multicall3.

## Chain logo assets

Official colored chain marks are bundled in `public/chains/` and served locally — there is no runtime CDN dependency:

- `base.svg` — the official Base Square in Base Blue, from Web3 Icons (MIT), network "branded" SVG: https://github.com/0xa3k5/web3icons (https://web3icons.io). Base and Web3 Icons own their respective marks.
- `unichain.svg` — the Unichain brand mark in brand pink, also from Web3 Icons (MIT): https://github.com/0xa3k5/web3icons (https://web3icons.io).
- `lasna.svg` — the official Reactive Network header mark from https://reactive.network (gradient ring `#62D0FF → #3C2EFF → #CBB5FF`, white bolt), rebuilt as a clean local SVG in a `0 0 64 64` viewBox. The ring's centre is filled with a near-black disc (`#0b0b10`) behind the bolt so the mark reads correctly on our light surfaces; Reactscan / Reactive Network own the mark; see their brand guidelines for usage.

These are third-party brand assets used purely to identify the chains; no logo is generated at runtime.

## Handshake mark and favicon

Handshake's mark is the two legs converging into one decision — drawn in code, not a third-party asset. The sidebar logo (`ConvergenceMark` in `src/components/ui.tsx`) and `public/favicon.svg` draw that signature in the pink/coral product accent (`accent`, `#e11d62`) on a dark square; the favicon picks out the convergence point in white for contrast. The same signature appears quietly (ink, not accent) in the settlement diagram and decision node of the settlement trail, so the accent stays reserved for the brand mark, primary actions and active states.

## Stack

React 18 · Vite 5 · TypeScript (strict) · viem · wagmi (injected wallet + chain switching) · TanStack Query · Tailwind CSS 3.

Polling intervals, explorer links and status derivation live in `src/lib/`. `src/lib/logs.ts` resolves proofs from real logs; `src/lib/proofs.ts` builds the settlement trail.
