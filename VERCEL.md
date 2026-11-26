# Vercel deployment — Handshake operator console

## Production URL

https://ui-six-livid.vercel.app

- Deployment ID: `dpl_AXzubFftMfA4uMW7b1YBHXRs7DiR`
- Inspector: https://vercel.com/koredeycodes-projects/ui/AXzubFftMfA4uMW7b1YBHXRs7DiR
- Status: `READY`, target `production`

## Deploy details

- **Project name:** `ui` (Vercel team/scope `koredeycodes-projects`, project ID `prj_EYOzeYPQuCvQuw5kuDoFl9tqZ7Hb`). The CLI created this project automatically; it did not require `--name`.
- **Deploy command used (run from `ui/`):**

  ```bash
  cd ui
  vercel deploy --prod --yes
  ```

- Vercel detected Vite automatically (build command `vite build`, output directory `dist`). The GitHub repo `koredeycode/handshake-reactive` was connected during deploy.
- Deployment Protection (Vercel Authentication) is enabled on the project by default; external viewers may need to be added to the Vercel project to view the site.

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
