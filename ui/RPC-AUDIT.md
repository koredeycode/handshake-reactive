# RPC audit — `perf/rpc-load`

Every browser hook/query that can cause an RPC request, its old and new cadence,
and the measured before/after call volume. This file is the PR body appendix.

## Method

- **BEFORE** numbers are the QA measurements on the deployed app: Playwright,
  one tab, 15 s per page, counting JSON-RPC POSTs by host and method.
- **AFTER** numbers are my measurements of `npm run build` served by
  `npm run preview`, headless Chrome + CDP `Network.requestWillBeSent`, again
  one tab and 15 s windows. "Cold" includes the initial page load; "steady"
  starts the counter after a 15 s warm-up.
- The problem report's peak estimate (70–150 req/s) also included four proof
  pollers on My Orders, other open tabs and virtual-time-budget screenshot
  bursts; the per-tab Playwright numbers below are the reproducible baseline.

### Measured worst case

| Scenario | OLD (15 s / calls-per-sec) | NEW (15 s / calls-per-sec) |
| --- | --- | --- |
| Order detail, cold tab | **240 calls** = **16.0/s** (207 `eth_getLogs` + 26 `eth_call` + 4 `getBlock` + 3 `blockNumber`) | **53 calls** = **3.5/s** (35 `eth_getLogs`, 11 `getBlock`, 4 `eth_call`, 3 `blockNumber`) |
| Order detail, settled, steady state | 240/15 s = 16.0/s (proof polled until `refetchInterval` was changed) | **0 calls = 0.0/s** |
| `/`, `/orders`, `/my-orders`, cold | **31 `eth_call` each ≈ 2.1/s** | **13 calls each ≈ 0.87/s** |
| `/orders`, steady state | ~2.1/s | **3 calls / 15 s = 0.20/s** (one still-pending order) |
| Four-row My Orders, proof resolvers | 4 independent 5 s resolvers, ~90 `eth_getLogs` each ≈ **72/s** alone | one cached query per id; settled rows fetch once then **never poll** (~0/s steady) |
| Peak across tabs / screenshot bursts | 70–150 req/s, `-32005` rate limits | no sustained polling; cold burst is bounded to ~3.7/s per tab |

## Every RPC-causing hook

"Chunks" = `eth_getLogs` range requests per event spec. Old proof scanning used
`fromBlock` from `contracts.json` (Unichain 68,824,600 vs latest ~68,847,000)
and 1,000-block chunks — ~23 chunks × 3 payment + 3 asset + 1 Lasna callback
≈ 90 `eth_getLogs` per resolution, plus a `getBlock` per observed event.

| Hook / query | File | OLD interval | NEW interval | Calls it makes | Chains | Chunks (old → new) |
| --- | --- | --- | --- | --- | --- | --- |
| `useProof` | `src/lib/proofs.ts` | 5,000 ms, once **per order row** | 8,000 ms while non-terminal; **false + `staleTime: Infinity` once terminal** | `eth_getLogs` (locks, terminal events, CallbackRequest), `eth_blockNumber`, `eth_getBlockByNumber` for event timestamps | Base, Unichain, Lasna (3) | ~90 → ~35 on cold resolution; ~0 steady; cursor window is 200 blocks on later polls |
| `useOrders` → `order-ids` query (new) | `src/lib/queries.ts` | part of the 5 s `useOrders` query | 30,000 ms + `staleTime: 60_000` | `eth_call` `orderCount`, `eth_call` `orderIds(i)` ×N | Lasna (1) | n/a |
| `useOrders` → per-order queries (new) | `src/lib/queries.ts` | 5,000 ms, 1 + 2N `eth_call` per page | 5,000 ms **only for non-terminal orders**; `false` for settled/refunded | `eth_call` `getOrder(id)` | Lasna (1) | n/a; shared `['order', id]` key with detail/verify |
| `useOrder` | `src/lib/queries.ts` | 2,000 ms | 5,000 ms pending, `false` terminal, `staleTime: 5_000` | `eth_call` `getOrder(id)` + `isZeroAddress` local check | Lasna (1) | n/a |
| `useLeg` | `src/lib/queries.ts` | 2,000 ms | 8,000 ms while `state < 2`, then `false`; `staleTime: 5_000` | `eth_call` `getLeg` (asset tries the 6-arg raced getter first, then the single-leg getter) | Base, Unichain (2) | n/a |
| `useTokenMeta` | `src/lib/queries.ts` | one-off (`staleTime: Infinity`) | unchanged | `eth_call` `decimals`, `symbol` ×2 | Base, Unichain (2) | n/a |
| `useTokenBalance` | `src/lib/queries.ts` | 10,000 ms | 15,000 ms + `staleTime: 10_000` | `eth_call` `balanceOf` | Base/Unichain (1 per kind) | n/a |
| `useAllowance` | `src/lib/queries.ts` | 4,000 ms | 15,000 ms + `staleTime: 10_000` | `eth_call` `allowance` | Base/Unichain (1 per kind) | n/a |
| `useVenues` | `src/lib/queries.ts` | one-off (`staleTime: 30_000`) | unchanged | `eth_call` `venues` | Lasna (1) | n/a |
| `useHealth` | `src/lib/queries.ts` | 5,000 ms | 15,000 ms, `staleTime: 10_000` (dev-only `/dev`) | per chain: `eth_call` `debt`, `reserves`, `balanceOf` + `eth_getBalance` = 4 calls ×3 | Lasna, Base, Unichain (3) | n/a |
| `useNativeBalances` | `src/lib/queries.ts` | wagmi default (~4,000 ms) | 15,000 ms + `staleTime: 10_000` | `eth_getBalance` ×3 | Lasna, Base, Unichain (3) | n/a |
| `useWalletBalances` | `src/lib/balances.ts` | wagmi default (~4,000 ms) | 15,000 ms + `staleTime: 10_000` | `eth_getBalance` ×3 + `eth_call` `balanceOf` ×2 | Lasna, Base, Unichain (3) | n/a |
| `usePublicClient` / `useProofClients` | `src/lib/proofs.ts`, dev panels | n/a | n/a | no call itself; supplies clients with the fallbacks below | 3 | n/a |
| `event-feed` query (`EventLog`) | `src/components/dev/EventLog.tsx` | 10,000 ms | 30,000 ms + `staleTime: 20_000` (dev-only) | `eth_getLogs` for 7 specs + `eth_blockNumber` + `eth_getBlockByNumber` | 3 | ~2 → up to 10 per spec with adaptive 200-block chunks |
| `cron-status` query (`HealthPanel`) | `src/components/dev/HealthPanel.tsx` | 10,000 ms | 30,000 ms + `staleTime: 20_000` (dev-only) | `eth_blockNumber`, 1 `eth_getLogs` (60 blocks), `eth_getBlockByNumber` | Lasna (1) | 1 |
| `useConfig`, `useTokenRegistry`, `useLatency` | `src/lib/config.ts`, `tokenDisplay.ts`, `latency.ts` | one-off | unchanged | **static JSON fetches** (`contracts.json`, `tokens.json`, `latency.json`) — no RPC | none | n/a |

## What changed

1. **No per-row proof polling.** My Orders passes the already-fetched `order`
   into `useProof`, so there is no second `getOrder` poller per row. Proof
   queries are keyed `['proof', id, watch]` and shared with order detail,
   verify and raw state. Terminal orders use `staleTime: Infinity` and
   `refetchInterval: false`: their hashes stay cached, but no log scan repeats.
2. **Poll only while pending.** `isOrderTerminal()` in `src/lib/status.ts`
   derives finality from `paymentClosed`, `assetClosed`, `refundRequested`,
   `settleRequested`, `invalid` (with `paymentSeen`/`assetSeen` so a half-locked
   refund is not called terminal early). Proofs poll at 8 s while pending;
   order reads poll at 5 s; legs stop at `RELEASED`/`REFUNDED`.
3. **Narrow scan window.** `orderRange()` estimates the deadline block from two
   real block timestamps (configured anchor + tip) and scans only
   `deadline − 2,000 … deadline + 2,000` blocks on each chain; it falls back to
   the old configured window when the estimate is impossible. Observed
   events sit 118–553 s before the deadline, inside that window. Additional
   reductions: a 200-block cursor overlap on later polls, skipping the
   impossible terminal branch (release vs refund) for final orders, and
   `fetchLogs.shouldStop` once all required event kinds for the order are seen.
   **Tradeoff:** a leg locked more than 2,000 blocks before its deadline on
   Base Sepolia (~7 min at current 0.2 s block time) falls outside the tight
   window; the fallback global scan covers that case when the estimate fails,
   but a deliberately very early lock with a valid estimate would need a wider
   `DEADLINE_LOOKBACK` in `src/lib/logs.ts`.
4. **Adaptive `eth_getLogs` chunks — providers disagree.** `https://sepolia.base.org`
   rejects ranges over 200 with `code -32614` ("eth_getLogs is limited to a
   200 range"); `https://sepolia.unichain.org` rejects over 1,000 with
   `-32602` ("block range greater than 1000 max"); publicnode accepts 1,000.
   `fetchLogs` now starts at **200 blocks**, remembers a per-client ceiling in
   a `WeakMap`, grows slowly (after 3 successes) toward 1,000, and on a range
   error **halves the chunk and retries the same window** — it never silently
   drops a range. One concise `console.warn` is emitted per adjusted client.
   Rate-limit errors (`-32005`, HTTP 429) back off and retry the same window.
   The proof path also caps `maxChunks` to the width of the now-small window.
5. **Fallback transport defaults were a hidden multiplier.** viem's
   `fallback()` defaults to `retryCount: 3`: a rate-limited or range-limited
   request re-walks the whole transport list four times (up to 8 attempts with
   two endpoints), and it explicitly retries on `-32005` / HTTP 429. That is
   why the deployed app showed Base calls both on `sepolia.base.org` and
   `base-sepolia-rpc.publicnode.com`. We now set `retryCount: 0` on the
   fallback **and** every inner `http()` transport, `rank: false` explicitly
   (enabling ranking would ping every endpoint with `net_listening` every ~4 s),
   and `shouldThrow` returns `false` for per-endpoint errors (`-32614`,
   `-32602` range errors, `-32005`, 429) so failover is immediate while
   wallet-rejected / reverted calls keep viem's normal throw behaviour.
6. **Multicall is per-chain.** Multicall3 is deployed at
   `0xcA11bde05977b3631167028862bE2a173976CA11` on Base Sepolia and Unichain
   Sepolia (verified with `eth_getCode`), so `createConfig.batch` enables it
   for those chains and disables it only for Reactive Lasna. The custom
   Unichain chain now declares the multicall3 contract so viem will batch.
   Lasna has no Multicall3: its `getOrder` reads remain plain `eth_call`s,
   which is why the board now caches IDs and polls only pending orders instead
   of relying on batching there.

## Correctness check — real hashes only

Headless Chrome screenshots of the production build (one tab, 15 s):

- `ui/screenshots/order-detail-rpc-audit.png` — order `0x1111…1111`, "5 of 5
  observed": payment locked `0xdb96e811…`, asset locked `0xeb3a68a2…`,
  reactive `0xadce615f…`, payment released `0x8a2dafb4…`, asset released
  `0x42196856…`.
- `ui/screenshots/order-detail-2222-rpc-audit.png` — order `0x2222…2222`,
  "5 of 5 observed": asset released `0x7937029b…`.

**Note for the reviewer:** the hash `0x7937029b…` in the task description
belongs to order `0x2222…2222`, not `0x1111…1111`. `DEPLOYMENT.md` and the
live chain both record `0x4219685614356fc4be8d15d90f4129145fc082e62309560b1175e2ac4e7e3c37`
as the asset-release tx for `0x1111…1111`. We show the real hash; nothing is
fabricated. The tuple-decode (`decodeAbiParameters` with `callbackConfigTuple`)
and the 5/6-argument callback `nonce` handling from PR #12 are unchanged.
