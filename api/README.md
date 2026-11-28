# Handshake backend (Phases A–C)

Hono REST + SSE API and a four-chain log indexer running in **one Node 24 process**.
Drizzle/Postgres projection of on-chain events; no signing keys, no custody, no
contract changes. The Vite UI integration is a **separate follow-up PR (Phase D)**;
the dedicated keeper Fly app is Phase E and is not part of this package.

## Stack

Node 24 · TypeScript (strict) · Hono + `@hono/node-server` · Drizzle ORM +
`drizzle-kit` + `postgres.js` · viem · Zod · pino · prom-client · Resend SDK
(operator alerts only).

## Local run

```bash
cd handshake
npm install --prefix api
cp api/.env.example api/.env          # fill DATABASE_URL / RPC URLs
npm run db:generate --prefix api      # regenerate SQL after schema edits
npm run db:migrate --prefix api       # apply migrations to your own Postgres
npm run dev --prefix api              # API + indexer on :8080
npm run typecheck --prefix api
npm run build --prefix api
```

`db:migrate` applies `api/migrations/*.sql` using drizzle-kit's migrator. The
Supabase CLI can apply the same SQL to a local or hosted project; this repo does
not link/deploy a Supabase project. At startup the app seeds the chain/venue/
curated-token catalogues (idempotent) and prunes expired rows (outbox 7 d, events
14 d, keeper actions / alerts 30 d).

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | DB reachability, per-chain WS state, last-event age, outbox depth, keeper freshness, SSE client count |
| `GET /metrics` | Prometheus exposition (indexer lag/events/reconnects, outbox depth, SSE clients/replays, wallet cache ratio, API duration, alerts) |
| `GET /orders?status=&chain=&cursor=&limit=` | Keyset-paginated order board (cursor = last `orderId`) |
| `GET /orders/:id` | Order + legs + derived timeline |
| `GET /orders/:id/events` | Raw decoded, surviving (non-reorged) events |
| `GET /tokens?chainId=&verified=` | Curated + discovered token catalog |
| `POST /tokens/validate` | `{chainId,address}` → server-side `symbol()`/`decimals()` `eth_call`, persisted `verified` flag |
| `GET /wallet/:address/balances?chainIds=84532,1301,11155111&force=1` | Multicall3 `balanceOf` + `eth_getBalance`, 15 s read-through cache |
| `GET /wallet/:address/tokens` | Discovered tokens with non-zero balance |
| `GET /stream?wallet=0x…&orderId=0x…` | SSE: `text/event-stream`, `id:` = global outbox cursor, named events, `retry: 3000`, `: ping` every 15 s, `Last-Event-ID` replay |

### SSE notes

- Event names: `hello`, `order.created`, `order.state`, `lock.payment`,
  `lock.asset`, `callback.requested`, `terminal.release`, `terminal.refund`,
  `order.settled`, `order.refunded`, `wallet.balance`, `notification`,
  `keeper.status`, `resync`, `heartbeat`. Zod schemas live in
  `src/lib/events.ts` and are intended to be shared with the UI client.
- Replay reads at most 500 rows per burst (20 bursts per connection); an
  expired/unknown cursor or a 256-frame buffer overflow sends `resync` and
  closes the connection so the client can invalidate REST queries.
- `?wallet=` is a filter, not authentication. Public order events go to all
  streams; `notification` and `wallet.balance` only to a matching wallet.
- Notifications are wallet-scoped, whitelisted to `counterparty_locked`,
  `settled`, `refunded`, `deadline_soon`, `retry_failed`, deduped by
  `(wallet, orderId, kind)` with a 5-minute cooldown. **No user email is ever
  stored or sent.** Resend is used only for operator error alerts, and only
  when `RESEND_API_KEY` + `OPERATOR_ALERT_EMAIL` are set (otherwise log-only).

## Indexer architecture

- One viem `webSocket(...)` client per chain (Lasna 5318007, Base Sepolia 84532,
  Unichain Sepolia 1301, Ethereum Sepolia 11155111), each with **one** raw
  `eth_subscribe("logs", …)` covering all relevant addresses and an OR of
  topic0s (not one subscription per event type).
- Decodes `PaymentLocked`, `AssetLocked`, `PaymentReleased`, `PaymentRefunded`,
  `AssetReleased`, `AssetRefunded`, RC `OrderStateChanged`, system-contract
  `CallbackRequest` (config tuple → payload → orderId, which is **not**
  indexed), `Cron100` heartbeat, venue registry events, and curated-token
  `Transfer` (wallet balance hint). The `Cron100` topic0 is the fixed legacy
  system-contract constant; `Cron10` logs are ignored, and only `Cron100`
  drives the liveness heartbeat.
- Idempotent upsert on `(chain_id, tx_hash, log_index)`. On reconnect/startup,
  bounded HTTP `eth_getLogs` gap fill uses the proven caps: Base 200,
  Unichain 1000, Sepolia 500, Lasna 30 000 blocks, with 429 backoff and halving
  on range errors. A 5-minute reconcile loop covers silent gaps.
- `fold.ts` is a pure state machine mirroring the RC: nonce guards stale
  replays, `settleRequested` dominates refund, race-mode asset legs are keyed
  by seller with one winner, terminal `settled`/`refunded` states are derived
  from closed legs. Reorgs mark logs `removed` and rebuild affected orders from
  surviving events, then ask clients to resync.
- Event insert + order/leg fold + outbox rows commit in **one Drizzle
  transaction**; the typed in-process `EventBus` is published only after
  commit (`src/lib/bus.ts`) and can be swapped for a `PgNotifyBus` later.

**Cron100 cutover (future, plan only):** update every address/topic source
(`api/src/contracts.ts` included), redeploy this backend and confirm `/health`
shows the new escrows **before** sending any test transaction on the new RC.
Otherwise those events fall outside the initial backfill window and appear as
empty terms / empty timelines. Details in `personal/CRON100-RUNBOOK.md`.

### Buyer-UX indexer remediations (future, plan only)

These are code changes only; nothing is applied to a live database or service.

- `orders.refund_reason` (`refundReason` in API JSON) persists the cause carried
  by `OrderStateChanged` / `LATE_REFUND` / `RACE_LOSER_REFUND` / `INVALID` /
  `CANCELLED` / `EXPIRED`. `migrations/0001_refund_reason.sql` adds the nullable
  text column; the Drizzle `meta/` snapshot and journal were regenerated offline
  with `npm run db:generate` (no DB connection). The reason is forwarded on the
  `order.state` SSE frame, is already the `reason` of `order.refunded`, and is
  returned by both `GET /orders` and `GET /orders/:id`. The
  `settle_requested` terminal rule (including the DB CHECK constraint) is
  unchanged. Historical rows that predate the column have a blank reason until
  their events are replayed (or a new stage arrives); there is no SQL backfill
  from `order_events`, because deriving a cause from old rows would be fragile.
  The fold uses `expired` only as a last-resort fallback when no persisted
  reason exists and never overwrites a true reason with it.
- Refund status is derived from the order-level `refundRequested` decision flag
  plus the two closure flags, matching the UI. `REFUND_REQUESTED`, `EXPIRED`,
  `CANCELLED`, `LATE_REFUND` and `INVALID` set that decision; `RACE_LOSER_REFUND`
  is leg-level and records a `race_loser` reason without marking the whole order
  refunded, so a winner may still settle. `WINNER` no longer implies a race
  loser, and a stale reason is cleared on `SETTLE_REQUESTED`.
- Terminal/settled derivation now uses the origin-chain closure flags
  (`paymentClosed && assetClosed`) alone, matching the client. A missing leg row
  can no longer leave a genuinely closed order stuck in `settling`.
- Origin locks are folded even when their event precedes `CREATED` on Lasna:
  a `PaymentLocked`/`AssetLocked` from a subscribed escrow introduces an order
  only when RC hydration supplies the full terms; with failed hydration the
  event is kept as an audit row and the leg is repaired once the order exists.
  Re-delivered events repair only a missing leg (keyed by role + seller), so no
  lock is double-counted and no duplicate SSE frame or notification is
  published.
- `keeper.status` frames are now published from the read-only on-chain RC
  telemetry poll (`readRcTelemetry`) so the UI's delayed-chain signal works
  without a signing keeper. These frames carry Lasna `chainId`, RC `target`,
  `debtWei` and `reservesWei`, and reuse the last successful reading if a poll
  goes stale. They write no `keeper_state` rows and send no email; existing
  operator alerts are unchanged.

**Cutover caveat (future):** `0001_refund_reason.sql` must reach the target DB
before this build serves traffic. `api/fly.toml` declares
`[deploy] release_command = "node dist/db/migrate.js"`: Fly runs it with the
app's `DATABASE_URL` secret on a temporary machine **before** the new app
machines start, so no GitHub secret and no manual DB step are needed. The
migrator is idempotent (safe on every deploy), `api/Dockerfile` copies
`migrations/` next to `dist/`, and the compiled migrator imports only production
dependencies. Orders already stuck with both closure flags set need a
reindex/replay (or a new event) to be re-derived with the new status logic — the
migration does not backfill state or historical reasons.

### Deliberate deviations from the plan

- The plan mentions a Postgres `apply_order_event` function. State folding is
  implemented in the pure TypeScript reducer inside the same Drizzle
  transaction instead. The SQL invariants (UNIQUE event key and the
  `NOT (settle_requested AND status='refunded')` CHECK) are enforced by the DB.
- `wallet.balance.newBalance` is a `'0'` refetch hint: the event tells the
  client to call `/wallet/:address/balances`, which is authoritative.
- Reorg rebuild uses an order's full surviving history (a superset of the
  plan's `min(block)-10`) to avoid partial folds.
- No keeper process is included here: `keeper_state` / `keeper_actions` tables
  and `keeper.status` telemetry/alerting are ready for the Phase E keeper app.

## Deploy

Main pushes that touch `api/**` (or the deploy workflow / Fly config) **auto-deploy
the backend** via `.github/workflows/deploy-api.yml`; PRs do not. The job runs
`npm ci`, `npm run build`, then `flyctl deploy --config fly.toml` from `api/`
using the `FLY_API_TOKEN` GitHub secret. For a manual deploy, rebuild `dist/`
first — `api/Dockerfile` copies prebuilt output and does not compile in the
container:

```bash
npm run build --prefix api     # mandatory before a manual fly deploy
cd api
fly launch --no-deploy        # one-time, if the app does not exist yet
fly secrets set DATABASE_URL=... RESEND_API_KEY=... ALERT_FROM_EMAIL=... \
  OPERATOR_ALERT_EMAIL=... \
  BASE_WS=... BASE_RPC=... UNICHAIN_WS=... UNICHAIN_RPC=... \
  SEPOLIA_WS=... SEPOLIA_RPC=... REACTIVE_WS=... REACTIVE_RPC=...
fly deploy                    # api/fly.toml: 1 × shared-cpu-1x, 256 MB
```

`ALERT_FROM_EMAIL` must be a verified Resend sender; `RESEND_FROM` is unused by
the API. `fly.toml` keeps `auto_stop_machines = false` / `min_machines_running = 1`
so the WSS subscriptions and Supabase project stay alive. The keeper key must
live only in the separate Phase E Fly app, never in `handshake-api`. Vercel UI
deploys and canonical alias re-pointing remain manual (option 3, see
`docs/VERCEL.md`); backend CI/CD never touches Vercel.

Shutdown drains in-flight gap fills before the DB pool closes, and a failed log
during gap fill leaves the block cursor at the last successful log for the
5-minute reconcile to retry (see `docs/PLATFORM.md`).
