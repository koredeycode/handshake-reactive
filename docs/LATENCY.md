# Handshake — measured latency (full Option B, 2026-11-27)

## Method

On-chain `block.timestamp` deltas (1-second granularity) from the transaction
receipts of each proof hop. The observer in `ts/observe.ts` can record WebSocket
arrival times for a higher-resolution figure; both are reported because EVM
timestamps alone cannot prove sub-second differences. All hashes come from
`scripts/proof.sh` and are listed in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

The measurement starts at the **second** origin lock: the loop cannot settle
before both legs exist, so the first leg's age is irrelevant to the arbiter's
critical path.

## Base → Unichain, payment-first (order `0xb0f4…5ff19`)

| Hop | Chain | UTC | Delta from second lock |
|---|---|---|---:|
| PaymentLocked (first leg) | Base Sepolia | 08:56:43 | −6 s |
| AssetLocked (second leg) | Unichain Sepolia | 08:56:49 | 0 s |
| react() with two CallbackRequest logs | Lasna | 08:56:49 | **0 s** |
| PaymentReleased | Base Sepolia | 08:56:50 | **+1 s** |
| AssetReleased | Unichain Sepolia | 08:56:51 | **+2 s** |

Both callbacks are requested in the same Lasna transaction; there is no
commit/release round trip and no keeper in the settlement path.

## Other pairs

The same mechanism was proven on all six ordered chain pairs (see the proof matrix
in [`DEPLOYMENT.md`](./DEPLOYMENT.md)). The arbiter hop is the same single `react()`
transaction everywhere; callback delivery is one or two block timestamps after it
on Base Sepolia, Unichain Sepolia and Ethereum Sepolia.

## Refund path

Refunds are driven by `Cron10` plus the permissionless `retry()`. In the Tier-1
timeout loops the deadline was 30 s; the refund callback landed on the payment
chain within the next cron interval after expiry. Cron billing is paid from the
RC's lREACT reserve, so the refund path is not instantaneous and requires funding
maintenance (see operational notes in [`DEPLOYMENT.md`](./DEPLOYMENT.md)).

## Why this needs Omni / Reactive

On the legacy Reactive network (~7 s blocks, ~7 s finality), the arbiter hop alone
would add 7–14 s to each loop, versus the measured 0 s here. For OTC/RFQ settlement
that window is exactly the inventory and price risk a market maker carries.

## Caveats

- Testnet numbers with purpose-built ERC-20s, not mainnet liquidity.
- EVM block timestamps have 1-second resolution; wall-clock observer numbers
  include network and observer delay.
- The single RC has 19 subscriptions, so cron burn is materially higher than in
  the old 7-subscription instances. Keep the RC funded; when `debt > 0`, Reactive
  stops delivering events until a top-up.
