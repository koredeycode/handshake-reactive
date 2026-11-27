# Handshake docs

Index of the operator and proof notes kept alongside the contracts. The repo-root
[`README.md`](../README.md) is the project entry point.

| Doc | What it covers |
|---|---|
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Current live deployment — one RC, three registered chains, addresses, setup tx hashes and proven settlement loops |
| [`PLATFORM.md`](./PLATFORM.md) | Operator runbook for the deployed backend (Fly API, Supabase, REST/SSE, Resend alerts, metrics and alert rules) |
| [`LATENCY.md`](./LATENCY.md) | Latency methodology and measured end-to-end timings |
| [`RPC-AUDIT.md`](../ui/RPC-AUDIT.md) | RPC audit pointer — public-endpoint limits, query inventory and measured call rates (lives in `ui/`) |
| [`SOURCIFY.md`](./SOURCIFY.md) | Sourcify verification record for the live contracts |
| [`CI-REPORT.md`](./CI-REPORT.md) | CI / Vercel deployment-failure investigation and fix |
| [`VERCEL.md`](./VERCEL.md) | Vercel deployment notes, canonical deploy path and production URL |
| [`MARKETS.md`](./MARKETS.md) | Current venue-registry model (one RC, three chains, 24 routes); earlier multi-RC market plan marked superseded |
| [`MARKET-DEPLOYMENT.md`](./MARKET-DEPLOYMENT.md) | Current deploy/fund recipe: venue registration via `setVenue()` and environment overrides |
| [`Flows.md`](./Flows.md) | Buyer, seller, match and tracking flows across the live system |
| [`TOOLING.md`](./TOOLING.md) | Deployment, funding, preflight, latency observation and proof tooling |
