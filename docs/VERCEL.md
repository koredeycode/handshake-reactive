# Vercel deployment — Handshake operator console

## Production URL

https://handshake-reactive.vercel.app

**Canonical alias is re-pointed manually after every production deploy (option 3).**
Git integration builds each push, but Vercel's project-level domain association is
unreliable after the project rename, so do not assume the short domain follows the
new deployment. After a production build is `READY`, re-point it explicitly:

```bash
vercel alias set <new-prod-url> handshake-reactive.vercel.app
```

Then verify both URLs return the same JS bundle and HTTP 200. Do not re-point the
alias before the production deploy finishes, and never run a `--prod` CLI deploy
for the same change as a Git deploy (whichever finishes last wins the alias).

Old auto-generated URL still resolves: https://ui-nine-gold.vercel.app
- Latest production deployment: `handshake-reactive-ppy4nlpsg-koredeycodes-projects.vercel.app` (Git-triggered, serves the final UI: asset pickers, 10-row home preview with source/destination chain marks, chain→asset→mint faucet, and the WalletConnect connector; bundle `index-BL5Uj_Cq.js`). `VITE_WALLETCONNECT_PROJECT_ID` is set for Production and Preview. The RPC-optimised query layer is documented in `ui/RPC-AUDIT.md`.
- The short alias `handshake-reactive.vercel.app` was re-pointed to that deployment after the Git deploy (see the manual `vercel alias set` step above). Vercel's project-level domain association is inconsistent after the project rename, so re-point and re-check the alias after every future production deploy.
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
- Without that config, Git-triggered builds ran `vite build` at the repo root, where `vite` is not a dependency, and failed with `BUILD_UTILS_SPAWN_127` / `vite: command not found`. See [CI-REPORT.md](./CI-REPORT.md) for the failing deployment logs.
- CLI deploys are now an **escape hatch only**, not the normal path. If you must use one, run it from the repo root (so the root `vercel.json` applies) or from `ui/`; do not run both the Git path and a `--prod` CLI deploy for the same change, or the production alias will point to whichever finished last.
- The canonical subdomain was added as a project domain (`vercel domains add handshake-reactive.vercel.app ui`), but following production deployments is **not** guaranteed: use the explicit `vercel alias set` command above after each deploy.

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

`ui/public/contracts.json` holds the live Reactive Contract address
(`0x037cef4c…67474`); per-chain escrow addresses are read from its on-chain venue
registry, and the chain/proxy catalog lives in `ui/public/markets.json`. The app
fetches `/contracts.json` at runtime with `cache: 'no-cache'`
(`ui/src/lib/config.ts`), so an RC address change can be picked up by updating
that static JSON asset — **no JS rebuild is required** for address changes.
`VITE_*` env overrides take precedence over the JSON and do require a new build.
After any address change, still re-point the alias with the command above. No
private keys are present in the repo or in this deployment.

## Public access

Vercel SSO deployment protection was disabled on 2026-11-26 so judges can open the console without a Vercel account: `vercel project protection disable ui --sso`. The production URL is public.
