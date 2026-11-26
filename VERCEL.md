# Vercel deployment — Handshake operator console

## Production URL

https://handshake-reactive.vercel.app

Old auto-generated URL still resolves: https://ui-nine-gold.vercel.app
- Latest production deployment: `handshake-reactive-8tpdugluh-koredeycodes-projects.vercel.app` (Git-triggered, serves the direction-driven UI: flip arrow, blank-seller open orders, aggregated book with filters, redesigned faucet, mobile fixes; bundle `index-p5zp7_4v.js`). The RPC-optimised query layer is documented in `ui/RPC-AUDIT.md`.
- The short alias `handshake-reactive.vercel.app` was re-pointed to that deployment after the Git deploy; Vercel's project-level domain association is inconsistent after the project rename, so re-check the alias after future deploys.
- Inspector: https://vercel.com/koredeycodes-projects/ui/9SyYFbGRD9MEwh8R9JzSNF5tuRiF
- Status: `READY`, target `production`

## Deploy details

- **Project name:** `handshake-reactive` (renamed from `ui` on 2026-11-26; Vercel team/scope `koredeycodes-projects`, project ID `prj_EYOzeYPQuCvQuw5kuDoFl9tqZ7Hb`). The CLI originally created it as `ui`.
- **Canonical deploy path: Git integration.** Push to `main` (or open a PR). The GitHub repo `koredeycode/handshake-reactive` was connected during the original deploy; every push triggers a Vercel build.
- The root-level `vercel.json` pins the build to the UI workspace, because the project Root Directory is `.` (repo root) while the Vite app lives in `ui/`:
  - install: `npm ci --prefix ui`
  - build: `npm run build --prefix ui` (`tsc -b && vite build`)
  - output: `ui/dist`
  - SPA rewrite to `/index.html` (same rule that used to live only in `ui/vercel.json`)
- Without that config, Git-triggered builds ran `vite build` at the repo root, where `vite` is not a dependency, and failed with `BUILD_UTILS_SPAWN_127` / `vite: command not found`. See `CI-REPORT.md` for the failing deployment logs.
- CLI deploys are now an **escape hatch only**, not the normal path. If you must use one, run it from the repo root (so the root `vercel.json` applies) or from `ui/`; do not run both the Git path and a `--prod` CLI deploy for the same change, or the production alias will point to whichever finished last.
- The canonical subdomain was added as a project domain (`vercel domains add handshake-reactive.vercel.app ui`) and follows future production deployments.

## Build output summary

Local verification before deploy: `cd ui && npm install && npm run build` (`tsc -b && vite build`) succeeded.

```
vite v5.4.21 building for production...
✓ 1620 modules transformed.
dist/index.html                   0.67 kB │ gzip:   0.41 kB
dist/assets/index-CXQEDHho.css   26.16 kB │ gzip:   5.70 kB
dist/assets/ccip-BffoLoyS.js      4.70 kB │ gzip:   2.08 kB
dist/assets/index-BWUfBYdF.js   649.75 kB │ gzip: 200.87 kB
✓ built in 9.32s
```

Only a chunk-size advisory was emitted (main JS bundle > 500 kB); no build errors. `public/contracts.json` is copied into `dist/contracts.json` in the output.

## Contract configuration is runtime-editable

`ui/public/contracts.json` holds the live addresses (Reactive Contract `0x6d1Da6e…`, escrows `0xc5ca1b…`). The app fetches `/contracts.json` at runtime with `cache: 'no-cache'` (`ui/src/lib/config.ts`), so address or scan-window changes can be picked up by updating that single static JSON asset — **no JS rebuild is required** for address changes. `VITE_*` env overrides take precedence over the JSON and do require a new build. No private keys are present in the repo or in this deployment.

## Public access

Vercel SSO deployment protection was disabled on 2026-11-26 so judges can open the console without a Vercel account: `vercel project protection disable ui --sso`. The production URL is public.
