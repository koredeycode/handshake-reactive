# Handshake — markets and venues

Status: **current as of 2026-11-27**. The live system is **one reactive contract**
on Reactive Lasna with **one on-chain venue registry**, not one contract per
market. [`DEPLOYMENT.md`](./DEPLOYMENT.md) is authoritative for addresses,
transaction hashes and proof; this document explains how markets are represented.

## Current model

- RC: `0x037cef4c80c7424b2c7fb45770990b5763f67474` (Reactive Lasna, `5318007`).
- `setVenue(uint256 chainId, address paymentEscrow, address assetEscrow)` is
  called **once per registered chain**, not once for the whole system. Verify with
  `venue(chainId)` and `registeredChainIds()`.
- Registered chains: `84532` (Base Sepolia), `1301` (Unichain Sepolia),
  `11155111` (Ethereum Sepolia). All three are active.
- **19 subscriptions** = the six escrow topics below on **each** of the three
  chains (18) + one `Cron10` heartbeat on Lasna. `subscriptionCount()` and
  preflight's `MIN_ACTIVE_SUBSCRIPTIONS` use 19.
- **6 token-agnostic escrows** (a payment and an asset escrow per chain) support
  **24 directed routes**. A route is selected by direction and token pair in the
  trade ticket; there is no market selector and no separate RC per route.
- `termsHash(orderId)` on the RC is the canonical hash of the order terms; it is
  bound **per order and venue** and must be passed into both `lock()` calls. A
  mismatch marks the order invalid and refunds the locked legs.

| Chain | Payment escrow | Asset escrow | Callback proxy |
|---|---|---|---|
| Base Sepolia `84532` | `0xebe1bd1c403158aa6a8375b7a63a87b47e8d08d0` | `0xA1493823ede37E1cE4e3c0B862FC3389e98Bf85b` | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` |
| Unichain Sepolia `1301` | `0xa2ea651bd30Eb9212E5BCd272d3a9a877D6dFa38` | `0x037CeF4c80C7424b2c7Fb45770990b5763f67474` | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` |
| Ethereum Sepolia `11155111` | `0x5Ee944ddc392a9729d52702AB4c2e327848533a1` | `0xbC2037B06278633968D869253F6F512562F86306` | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` |

### The 18 event subscriptions + cron

Each of these six escrow events is subscribed **per registered chain** (slots
1–18). `Cron10(uint256)` is the nineteenth subscription, from the legacy system contract
`0x0000000000000000000000000000000000fffFfF` on Lasna and drives the bounded
refund sweep (8 orders/tick, 30 s cooldown).

| # | Event |
|---|---|
| 1 | `PaymentLocked(bytes32,address,address,address,uint256,bytes32,uint256)` |
| 2 | `AssetLocked(bytes32,address,address,address,uint256,bytes32,uint256)` |
| 3 | `PaymentReleased(bytes32,address,uint256,uint64)` |
| 4 | `PaymentRefunded(bytes32,address,uint256,uint64)` |
| 5 | `AssetReleased(bytes32,address,uint256,uint64)` |
| 6 | `AssetRefunded(bytes32,address,uint256,uint64)` |

`VenueInUse()` protects replacement: a venue cannot be rotated (nor subscriptions
removed) while any non-closed order references that chain. `VenueUnregistered`
emits the real escrow addresses before storage deletion.

The UI reads the chain/proxy catalog from `ui/public/markets.json` (version 2)
and reads escrow addresses from the RC's venue registry at runtime; they are not
hardcoded per market. Direction comes from the trade-ticket arrow, a blank seller
creates an open order, and the order book aggregates routes with direction/open
filters. Order detail and Track infer the venue from a hidden link parameter or
from the order itself.

## Superseded planning record (2026-11-26) — historical only

Earlier revisions of this file described a *different* design that was **never
the deployed system**: one RC per market (forward, open, reverse), a
`ui/public/markets.json` **market registry** with three market entries, a
one-shot venue setup whose subscriptions covered only one chain, plus a new
deployment for each direction. That plan is retained here only as background; the full text is
in git history and in `personal/EXPANSION-PLAN.md`. Do not use its addresses,
counts or setup calls as operational instructions. The current replacement is the
single-RC venue registry described above (see also
[`MARKET-DEPLOYMENT.md`](./MARKET-DEPLOYMENT.md) and
[`DEPLOYMENT.md`](./DEPLOYMENT.md)).

The 2026-11-26 PR #18 note remains historically accurate: the visible market
selector was removed after review; direction, blank-seller open orders and the
aggregated order book replaced it. That behavior survives in the current system.
