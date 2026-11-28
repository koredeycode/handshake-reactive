# Audit remediation record — FUTURE, prepared locally

**Status: prepared locally on 2026-11-28, NOT merged, NOT deployed, NOT broadcast.**
No commit, push, PR, deploy, workflow run, or transaction was made. No credential
files were read. Scope is **testnet only**; there is no mainnet path in any prepared
artifact. This record is review material, not release evidence.

Sources (read-only): `/tmp/opencode/quillshield-audit.md` (QuillShield contract and
release-gate audit), `/tmp/opencode/buyer-ux-audit.md` (all-persona UX audit), and
`personal/CRON100-RUNBOOK.md` (gitignored personal notes — never attach to a PR).

Everything below is part of the **same future single PR** as the Cron100/rescue/`expire`
patch. The live system still runs Cron10 on the old addresses.

---

## 1. Verification performed locally

| Check | Result |
|---|---|
| `forge build` (solc 0.8.30) | pass — only pre-existing `asm-keccak256` lint note at `src/HandshakeReactive.sol:429` |
| `forge test -vv` | **119 passed, 0 failed** (was 99 at baseline; 76 in the RC suite) |
| `npm run typecheck --prefix api` / `npm run build --prefix api` | pass |
| `npm run typecheck --prefix ui` / `npm run build --prefix ui` | pass (pre-existing >500 kB chunk warning) |
| `git diff --check` | clean |
| YAML parse of both workflows | pass |

Green builds/tests prove the modelled paths only. They are **not** release evidence:
fork rehearsal, Sourcify exact-match, address/topic mirror verification and the `/health`
hard gate are still unchecked in the runbook.

---

## 2. Contract & release findings

| ID | Finding | Fix prepared | Files |
|---|---|---|---|
| **F-01** (Med, 78%) | `retry()`/`_sweep()` overwrite per-leg request nonces; a delayed terminal event at the old nonce is rejected forever, the leg never closes, and cron pays for no-op callbacks. | Per-leg nonces are now **floors** (`_setLegRequestFloor`, written only when zero); `_handleTerminal` accepts any nonce from that floor through the current global nonce. Simultaneously fixes the delayed-delivery case, not just an attacker. Regression test: settle@1 → retry@2 → terminal@1 closes the leg; older/future nonces still rejected. | `src/HandshakeReactive.sol`, `test/HandshakeReactive.t.sol` |
| **F-02** (Med, 68%) | Unbounded `_orderIds` makes `_requireVenueIdle` gas-DoS-able and starves `_sweep`. | `MAX_ORDERS = 10_000` + `TooManyOrders()` on `createOrder`; permissionless `pruneClosedOrders(limit)` swaps closed ids out and keeps `sweepCursor` valid. Tests for cap, pruning, and sweeping after prune. Consumers must treat `orderIds()` as an unordered mutable index (`OrdersPruned` event). | `src/HandshakeReactive.sol`, `test/HandshakeReactive.t.sol` |
| **F-03** (Med, cond. High, 60%) | `uint8 assetLockCount` overflow on the 256th asset log reverted `react()` for that order. | Widened to `uint256`; `MAX_ASSET_LOCKS = 32`; cap branch **refunds** the over-cap depositor via `_refundRaceLoser` (with a `depositor != winner` guard so a redelivered winner log cannot refund the winner). `react()` can no longer revert from the counter, and no depositor is stranded. | `src/HandshakeReactive.sol`, `test/HandshakeReactive.t.sol`, `script/HandshakeSupport.sol` |
| **F-04** (Low, 75%) | `cancelOrder()` set refund intent but requested no callback for an already-seen payment leg. | Now calls `_requestRefundForLegs()` (bumps nonce, requests callbacks, emits `REFUND_REQUESTED`) before the `CANCELLED` event; buyer-only/pre-deadline and settlement-terminal invariants preserved. | `src/HandshakeReactive.sol`, `test/HandshakeReactive.t.sol` |
| **F-05** (Low, 50%) | Outbound fee-on-transfer tokens desynced `lockedByToken` from what recipients received. | Both escrows verify recipient balance delta on `release`/`refund`; mismatch reverts `InsufficientReceived`, so the leg stays `LOCKED` and accounting cannot drift. NatSpec declares inbound and outbound fee-on-transfer tokens unsupported for legs. Mock + tests added. | `src/PaymentEscrow.sol`, `src/AssetEscrow.sol`, `test/Escrow.t.sol`, `test/Mocks.sol` |
| Q-1 | No `chainId` check against the escrow's registered chain in `react()`. | Defensive `log_.chainId == meta.chainId` guards added in `_handleLocked` and `_handleTerminal`, with a test. Underlying system-contract trust question remains a cutover verification item. | `src/HandshakeReactive.sol`, `test/HandshakeReactive.t.sol` |
| Defender | Third-party GitHub Actions pinned to floating tags. | All 7 `uses:` lines in both workflows pinned to immutable SHAs (checkout v4.4.0, setup-node v4.4.0, foundry-toolchain v1.9.2, setup-flyctl master HEAD). Triggers and deploy behavior unchanged. Node 20 in the UI job left as-is (documented residual). | `.github/workflows/ci.yml`, `.github/workflows/deploy-api.yml` |

---

## 3. Open questions

- **Q-2 resolved:** `deployments.json` lists the Unichain asset escrow at the same
  address as the Lasna RC; both addresses have code with different bytecode on their
  chains — a legitimate cross-chain CREATE collision, not a stale copy. Still verify
  at cutover when the new addresses are generated.
- **Q-3 unresolved:** whether the live Reactive system contract retries/replays a
  reverted `react()` or halts delivery. F-03 no longer reverts from the counter, but
  other reverts remain possible; confirm against the system contract before assigning
  residual severity.
- **Q-4 resolved:** ~200 lREACT top-up (2 Sepolia ETH) is prepaid system `reserves` with no
  withdrawal function in the pinned ABI. Accept as non-refundable (runbook decision #5);
  do not invent `withdrawReserves`.

---

## 4. UX gaps — prepared fixes

### P0

| Gap | Fix prepared |
|---|---|
| Stranded/partially-folded orders had no recovery and self-contradicted. | New `STALLED` / `WAITING_FOR_EXPIRY` states; "Needs attention" panel and board filter with copy-case-details; Retry gated on a real decision plus an unclosed seen leg; indexer upserts/repairs late-arriving origin locks so a real lock always has a leg row. Historical missed locks still need a one-off replay. |
| "Refunding" asserted a decision based only on the wall clock. | `REFUNDING` removed; now `REFUND_PENDING`, `REFUND_STALLED` (>180 s without a terminal log), `EXPIRED`, and waiting/stalled states derived from on-chain flags first. |
| Refund reason never reached the user. | `refund_reason` column + migration; persisted from `OrderStateChanged`, forwarded on SSE and in `GET /orders`, rendered in pills/tooltips/trail/notice with Expired · Invalid · Cancelled · Late lock · Lost race. |
| Debt-paused orders never showed "Delayed · network". | Read-only `keeper.status`-shaped SSE frame published from the existing RC telemetry poll (no keeper, no email, no `keeper_state` rows); banner in Shell and `DELAYED` pills. |
| API status and UI pill disagreed (`settling` vs `Settled`). | Both now treat `paymentClosed && assetClosed` as terminal even when only one leg row is persisted. Existing stuck rows need a reindex/replay to recompute. |

### P1

- Seller-scoped race-loser / late-lock explanations with winner and refund tx links.
- Retry gated on a decision + unclosed leg, with tooltip explaining it costs gas and
  cannot start a refund (a "disable after 3 attempts" counter was **not** added).
- In-product `TraderGuide`: pending → decision → released/refunded, expected timing
  (live ~10 s vs **after Cron100 cutover** ~2 min), seller-never-locks, race loser,
  stalled steps, and "the operator cannot rescue locked funds".
- Deep-link 404s now show "order may not be indexed yet" with Refresh + explorer link;
  an "indexed N seconds ago" timestamp was **not** added.
- Classified tx errors (rejection / chain / allowance / balance / RPC) with failing hash
  and chain; custom-token provenance and immutable-once-locked warning in confirmation.
- Stale-data banner with `isStale`/`staleReason` and transient "Resynced"; `aria-live`
  on status surfaces, notification focus trap/Escape/focus restore, global reduced-motion.
- Mobile wallet-browser/WalletConnect hint; new `MobileWalletHint` component.

### P2

- `buildProofMarkdown()` wired to "Copy proof bundle" on order detail and timeline.
- Collapsed raw-events panel using the existing `/orders/:id/events` hook.
- Expandable advanced section: nonce, per-leg request nonces, termsHash, last action,
  last event age.
- "Needs attention" board filter added. Multi-select/CSV export **not** added.
- Dev-panel Cron100 labels qualified as "after cutover"; live is still Cron10.

**Expire action (prepared):** `ui/src/components/ExpireAction.tsx` plus the
`expire(bytes32)` ABI and `canExpireOrder`/`expireCooldownRemaining` helpers. Gated to
stranded orders, network-switches to Lasna, uses an explicit confirmation modal
("not a guaranteed refund", "never after settlement", gas and 30 s cooldown), and
waits for the indexer to fold `REFUND_REQUESTED`/`EXPIRED`. Still a future-only
selector; the runbook's `CANCELLED` vs `EXPIRED` label decision (#6) remains open and
the future UI PR needs screenshots.

**Operator alert cleanup (prepared):** the false `outbox_backlog` email was removed —
`outbox_depth` is an append-only SSE cursor count, not a delivery backlog, and
`delivered_at` is never written. Telemetry status rows are marked delivered so they
do not feed the metric, `alert_email_total` now has a `kind` label, suppression logs
are at `info`, and cooldowns hydrate from `alert_deliveries` at boot. `outboxDepth`
remains observable in `/metrics` and `/health`; real alerts (API 5xx, WS/gap-fill
failures, stale indexer, keeper issues, DB failures) are unchanged.

---

## 4b. Final E2E review fixes and Pact comparison

A fresh adversarial review of the complete patch found and fixed these before the PR:

- **Contracts P1:** `MAX_ORDERS` could permanently brick `createOrder` with unprunable
  empty orders. `pruneClosedOrders` now also removes expired fund-free orders
  (`refundRequested || invalid`, no legs seen). 10,000-cap regression test added.
- **Contracts P2:** `expire()` no-ops now precede deadline/cooldown guards (repeat calls
  are silent); dead `TooManyAssetLocks` error and unreachable `_refundLateLeg` asset
  branch removed; cap NatSpec corrected.
- **API P0:** merging the PR would auto-deploy code needing `refund_reason` before any
  migration. `api/fly.toml` now has `[deploy] release_command = "node dist/db/migrate.js"`
  (runs with Fly's own `DATABASE_URL` before new machines start) and the Dockerfile copies
  `migrations/` into the image. No GitHub secret added.
- **API P1:** `WINNER` no longer sets `race_loser` (healthy matched orders were showing
  "Lost race"); `order.state` SSE frames now carry the reason established by that stage;
  pre-`CREATED` locks no longer create partial order rows when hydration fails; API and
  UI refund-status derivation now agree (decision flags + closure, not reason alone).
- **UI P0:** `ExpireAction` could call the live RC. Gated by `VITE_EXPIRE_ENABLED=1` AND
  a check that the configured RC is not the known live address; re-checked at submit.
- **UI P0:** refund reasons now require real refund evidence before display, so healthy
  settled orders never show "Lost race"; historical bad rows are also suppressed.
- **UI P1/P2:** cancellations render as a neutral "Cancelled" instead of red "Invalid";
  verify tracker passes the reason to the trail; cooldown is labelled advisory; stale
  "Refunding" guide copy fixed; needs-attention includes delayed chains; mobile wallet
  hint can actually render; proof bundles no longer export live `Cron10` as `cron100`.
- **Status styling (decision #13):** all 15 statuses have distinct label, surface,
  border, weight and dot shape/colour; green = settled, neutral = refunded/cancelled,
  amber = waiting/attention, red = failure/invalid, accent = in-progress.

**Pact comparison** (https://github.com/PhiBao/pact): two liveness patterns adopted
before the single deploy — (1) escrows re-emit their truthful terminal event on repeated
`release`/`refund` callbacks, so a lost terminal event cannot leave an RC leg open
forever; (2) permissionless event-only `reannounce()` on each escrow restates a still-
LOCKED `Locked` log so a leg whose lock event was lost can be seen and refunded.
Pact's two-phase commit/unwind, bond+witness, chain-local refund deadline and unbounded
sweep inspection were NOT adopted — they would weaken our terminal-settlement invariant.

## 5. Required contents of the future single PR / release gate

- [ ] This patch set plus the Cron100/rescue/`expire` patch in ONE PR; no partial ship.
- [ ] `forge test -vv`, API/UI typecheck and builds, `git diff --check` green.
- [ ] UI screenshots attached (visible labels and new guide changed).
- [ ] Migration `api/migrations/0001_refund_reason.sql` applied via Fly's
      `[deploy] release_command` **before** new machines start (verify in deploy logs).
- [ ] Fork rehearsal of `Deploy.s.sol` / `Fund.s.sol` (runbook checklist still unchecked).
- [ ] Ownership: deployer EOA resolved (testnet; transferable later without redeploy).
- [ ] Sourcify exact-match for all 7 new contracts; new hashes recorded, old hashes removed.
- [ ] Address/topic mirrors verified (`deployments.json`, API config, UI config,
      `ts/abis.ts`, preflight script); 19 = 18 event + Cron100, no Cron10 subscription.
- [ ] Backfill/replay for historical missed locks and closed rows needing status recompute.
- [ ] RC topped up with 2 Sepolia ETH → ~200 lREACT; `debt == 0`, `reserves >= 200e18`.
- [ ] `VITE_EXPIRE_ENABLED=1` set in the UI build **only after** the new RC address is
      configured; the known live RC must not show the "Request refund" button.
- [ ] **Hard gate:** no test transaction or proof loop until the backend/indexer is
      redeployed on the new addresses and `/health` verifies the new RC/escrows/Cron100.

## 6. Residual risks / accepted items

- Q-3 system-contract replay behavior (external verification required).
- Testnet-only scope; no mainnet path.
- `api/**` pushes to `main` auto-deploy to Fly without an approval gate (deliberately
  unchanged here).
- Node 20 deprecation warning in the UI CI job (left unchanged; separate future change).
- Unpinned solc in `foundry.toml`/CI (reproducibility relies on the local toolchain).
- Cron100 labels in prepared UI source while live is Cron10; qualified in copy, but
  operators must not read dev panels as current behavior until cutover.
- F-01/F-02/F-03 fixed but not fork-rehearsed or scale-tested at production load.
