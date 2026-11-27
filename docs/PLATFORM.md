# Handshake platform runbook (live backend)

Status: **deployed** (contracts untouched; testnets only). This is the operator
runbook for the backend that is now merged and running. Addresses, setup
transactions and settlement proof for the contracts live in
[`DEPLOYMENT.md`](./DEPLOYMENT.md); this document covers the Node service only.

## What is running

- **One Fly app:** `handshake-reactive-api`, public base URL
  <https://handshake-reactive-api.fly.dev>.
- **One machine** (`shared-cpu-1x`, 256 MB, `min_machines_running = 1`,
  `auto_stop_machines = false`) running the Hono API and the indexer in a **single
  Node 24 process**. There is no second app for a keeper (see below).
- Stack: Hono + `@hono/node-server`, Drizzle ORM + `postgres.js` against a
  **Supabase free-tier Postgres** project, viem, Zod, pino, `prom-client`, and the
  Resend SDK for **operator error alerts only**.
- All read endpoints are public with CORS allowlisted to `*.vercel.app`; `?wallet=`
  filters a stream, it is not authentication. No endpoint can move funds, and no
  signing key exists in this app. The UI stays on Vercel (see
  [`VERCEL.md`](./VERCEL.md)).

## Data flow

```text
4 chains over WSS ──one raw eth_subscribe("logs") per chain──▶ indexer
                                                               │ decode + fold + dedupe
                                                               ▼
                                           Supabase (orders, legs, events, outbox,
                                           tokens, wallet cache, keeper tables)
                                                               │ one Drizzle transaction
                                                               ▼
                                       in-process typed EventBus (after commit)
                                                               │
                                    ┌──────────────────────────┴──────────┐
                                    ▼                                     ▼
                            Hono REST reads                        SSE /stream
                       /orders /tokens /wallet/...               + wallet notifications
```

- The indexer watches Reactive Lasna (`5318007`), Base Sepolia (`84532`),
  Unichain Sepolia (`1301`) and Ethereum Sepolia (`11155111`) with **one log
  subscription per chain** (an address set plus an OR of topic0s), not one
  subscription per event type. On reconnect/startup it fills gaps with bounded
  HTTP `eth_getLogs` (Base 200, Unichain 1,000, Sepolia 500, Lasna 30,000 blocks,
  halving on range errors) and a 5-minute reconcile loop.
- Event inserts, order/leg folding and outbox rows commit in **one transaction**;
  the typed in-process bus (`api/src/lib/bus.ts`) publishes only after commit.
  Reorged logs are marked removed and affected orders are rebuilt from surviving
  events, after which clients receive a `resync` frame.

## Local development

Run from the repo root with the `--prefix api` form; the API listens on `:8080`.

```bash
npm install --prefix api
cp api/.env.example api/.env          # fill DATABASE_URL and per-chain RPC/WS URLs
npm run db:generate --prefix api      # regenerate SQL after schema edits
npm run db:migrate --prefix api       # apply api/migrations/*.sql
npm run dev --prefix api              # API + indexer on :8080
npm run typecheck --prefix api
npm run build --prefix api
```

`DATABASE_URL` must be the **Supabase transaction-pooler connection string**
(with `?sslmode=require`), not the direct/session connection: the client uses
`prepare: false` and a small connection pool (`max: 5`) to match the pooler. Keep
the credentials out of git. Startup seeds the chain/venue/token catalogues
idempotently and prunes expired rows (outbox 7 d, events 90 d, keeper actions and
alerts 30 d).

## HTTP API

| Endpoint | Purpose |
|---|---|
| `GET /health` | DB reachability, per-chain WS state, last-event age, outbox depth, keeper freshness, SSE client count |
| `GET /metrics` | Prometheus exposition (see Observability) |
| `GET /orders?status=&chain=&cursor=&limit=` | Keyset-paginated order board (cursor = last `orderId`) |
| `GET /orders/:id` | Order, legs and derived timeline |
| `GET /orders/:id/events` | Raw decoded, surviving (non-reorged) events |
| `GET /tokens?chainId=&verified=` | Curated + discovered token catalog |
| `POST /tokens/validate` | `{chainId,address}` → server-side `symbol()`/`decimals()` lookup, persisted `verified` flag |
| `GET /wallet/:address/balances?chainIds=84532,1301,11155111&force=1` | Multicall3 `balanceOf` + native balance, 15 s read-through cache |
| `GET /wallet/:address/tokens` | Discovered tokens with non-zero balance |
| `GET /stream?wallet=0x…&orderId=0x…` | SSE event stream (below) |

### SSE `/stream`

- `text/event-stream`; `id:` is the global outbox cursor; frames are **named
  events**; `retry: 3000` is sent once and a `: ping` comment every 15 s.
- `Last-Event-ID` replays at most 500 rows per burst (20 bursts per connection).
  An expired/unknown cursor, or a 256-frame buffer overflow, sends a `resync`
  event and closes the connection so the client invalidates its REST queries.
- Event catalogue (`api/src/lib/events.ts`): `hello`, `order.created`,
  `order.state`, `lock.payment`, `lock.asset`, `callback.requested`,
  `terminal.release`, `terminal.refund`, `order.settled`, `order.refunded`,
  `wallet.balance`, `notification`, `keeper.status`, `resync`, `heartbeat`.
  `keeper.status` frames are read-only telemetry derived from `keeper_state`
  rows; with no keeper process deployed, no such rows are written.
- Public order events go to all streams. `notification` and `wallet.balance` are
  wallet-scoped and only reach a stream whose `?wallet=` filter matches.
  Notifications are whitelisted to `counterparty_locked`, `settled`, `refunded`,
  `deadline_soon` and `retry_failed`, deduped by `(wallet, orderId, kind)` with a
  5-minute cooldown. **No user email is ever collected or sent.**

## Resend = operator alerts only

Resend delivers error alerts to a **single operator recipient**: uncaught 5xx,
indexer disconnect / stale last event, DB failure / outbox backlog, and (when a
keeper exists) debt/top-up failures. Delivery is deduped with a storm window and
backed by an alert-delivery row with retry. Without `RESEND_API_KEY` and
`OPERATOR_ALERT_EMAIL`, alerts are **log-only**. There is no user email path and
no notification opt-in table.

## Deploy / Fly secrets

### CI/CD (normal path)

`.github/workflows/deploy-api.yml` deploys `handshake-reactive-api` on every push
to `main` that touches `api/**`, the workflow itself, `fly.toml` or `Dockerfile`,
plus manual `workflow_dispatch`. **PRs never deploy.** Superseded runs are
cancelled via `concurrency`. The job runs `npm ci --prefix api`,
`npm run build --prefix api`, then `flyctl deploy --config fly.toml` from `api/`,
authenticated with the app-scoped `FLY_API_TOKEN` GitHub secret. The build step
is mandatory: `api/Dockerfile` copies prebuilt `dist/` and does not compile in
the container. Check `fly logs -a handshake-reactive-api` and `/health` after
merge; no manual Fly action is needed for a normal backend change.

### Manual deploy / secrets (escape hatch)

Deploy from `api/` so `api/fly.toml` applies, and rebuild `dist/` first:

```bash
npm run build --prefix api       # Dockerfile copies dist/; never deploy stale output
cd api
fly secrets set \
  DATABASE_URL='postgresql://...@<supabase-pooler-host>:6543/postgres?sslmode=require' \
  RESEND_API_KEY=... \
  ALERT_FROM_EMAIL='Handshake Alerts <alerts@resend.dev>' \
  OPERATOR_ALERT_EMAIL=you@example.com
# plus the per-chain RPC/WS URLs listed in api/.env.example
fly deploy
```

`ALERT_FROM_EMAIL` is the **authoritative and only** `From` header used by the
API. `RESEND_FROM` is unused by the backend and must not be relied on (a Fly
secret with that name is harmless); use a **verified Resend sender** and a
verified operator recipient. Secrets must never be committed or echoed into
docs.

Frontend deploys are separate: Vercel handles `ui/**`, and re-pointing the
canonical alias is still **manual (option 3)** after each production deploy — see
[`VERCEL.md`](./VERCEL.md). Backend CI/CD does not touch Vercel.

### Shutdown / backfill note

`stopIndexer()` now sets a stopping flag, unsubscribes, and awaits all tracked
gap-fill tasks **before** `closeDb()`. A failed log inside a gap fill is logged
with `txHash` and the block cursor stops at the last successfully processed log,
so the 5-minute reconcile replays it instead of silently skipping it. Resend
API `{ error }` responses are treated as failures (retry + `status: 'failed'`),
so `alert_email_total{status="sent"}` only counts accepted sends.

## Keeper: DEFERRED (not implemented)

The signing keeper is **not built or deployed**. The current RC is kept alive by
manual top-ups, so there is no key in Fly, Supabase or the UI. The `keeper_state`
/ `keeper_actions` tables and `keeper.status` SSE event are read-only and idle
until a keeper writes state; `topups_total` has no increment site in the deployed
API today. The full future Cron100/keeper cutover procedure is in
`personal/CRON100-RUNBOOK.md` (gitignored) and `personal/PLATFORM-PLAN.md` §9 —
**do not implement it as part of this runbook**.

## Observability

`GET /metrics` exposes Prometheus text. These are the **exact metric names**
registered in `api/src/lib/metrics.ts` (labels in braces):

| Metric | Type | Meaning |
|---|---|---|
| `indexer_block_lag_seconds{chain}` | gauge | Age of most recently indexed event per chain |
| `indexer_events_total{chain,event}` | counter | Accepted (deduplicated) on-chain events |
| `indexer_reconnects_total{chain}` | counter | WSS reconnects per chain |
| `indexer_last_event_age_seconds{chain}` | gauge | Seconds since last accepted event on a chain |
| `rpc_requests_total{chain,method}` | counter | RPC requests issued by the backend |
| `db_failures_total` | counter | Database operation failures |
| `outbox_depth` | gauge | Undelivered outbox rows (refreshed at scrape time) |
| `sse_clients` | gauge | Active SSE connections |
| `sse_replays_total` | counter | `Last-Event-ID` replays |
| `sse_buffer_overflow_total` | counter | Clients disconnected due to backpressure |
| `notification_events_total{kind}` | counter | Wallet-scoped outbox rows created |
| `wallet_cache_reads_total{result}` | counter | Wallet balance reads by `hit`/`miss` |
| `api_request_duration_seconds{method,route,status}` | histogram | HTTP request duration |
| `alert_email_total{status}` | counter | Operator alert delivery attempts |
| `rc_debt_wei` | gauge | Reactive contract debt |
| `rc_reserves_wei` | gauge | Reactive contract reserves |
| `escrow_debt_wei{chain}` | gauge | Escrow callback-proxy debt |
| `topups_total{chain}` | counter | Keeper top-up actions observed (idle until a keeper exists) |

The helper `walletCacheHitRatio()` derives a hit ratio from
`wallet_cache_reads_total`; there is no separately exported
`wallet_balance_cache_hit_ratio` metric despite the older proposal.
`rc_debt_wei`, `rc_reserves_wei`, `escrow_debt_wei` and `topups_total` are
populated from `keeper_state` rows by the 60-second alert monitor. With the
keeper deferred those rows are not written, so these series read zero/empty
today — check debt and reserves directly with `cast call` until a keeper exists.

Suggested alert rules (thresholds are starting points, tune after a week of data;
the debt/reserve rules become effective once a keeper writes `keeper_state`):

| Alert | Condition | Action |
|---|---|---|
| RC debt | `rc_debt_wei > 0` for > 5 min | Reactive pauses delivery — top up the RC via the system contract `depositTo(RC)` |
| Escrow reserve low | `escrow_debt_wei{chain} > 0`; there is no escrow-reserve gauge, so check reserves via `cast call` / `/health` | Fund the chain's callback proxy `depositTo(escrow)` |
| Indexer stale | `indexer_last_event_age_seconds{chain} > 300` or rising `indexer_block_lag_seconds` | Check WSS state in `/health`, reconnect count and HTTP gap-fill |
| Outbox backlog | `outbox_depth > 1000` (matches `OUTBOX_BACKLOG_ALERT`) sustained | Investigate DB/bus/SSE consumers before rows age out (7 d) |
| 5xx rate | `rate(api_request_duration_seconds_count{status=~"5.."}[5m])` above baseline | Check pino error logs; Resend operator alerts also fire |
| SSE replays | spike in `sse_replays_total` or any `sse_buffer_overflow_total` | Clients are falling behind; check connection count and replay window |

**No hosted dashboard is configured yet.** `/metrics` is scrape-ready for a
future Prometheus/Grafana (or Fly log drain) setup — do not assume one exists.
For now use `fly logs -a handshake-reactive-api` for pino JSON logs (fields
`orderId`, `txHash`, `chainId`, `eventName`, `blockNumber`, `lagMs`) and scrape
`/metrics` directly when debugging.
