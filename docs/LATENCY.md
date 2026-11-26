# Handshake — measured latency

## Method
On-chain `block.timestamp` deltas (1-second granularity) plus the origin logs' timestamps. The observer in `ts/observe.ts` records WebSocket wall-clock arrival times for a higher-resolution number; both are reported because EVM timestamps alone cannot prove sub-second figures.

## Payment-first loop (order `0x1111…1111`)

| Hop | Block timestamp (UTC) | Delta from second lock |
|---|---:|---:|
| Second origin lock (AssetLocked, Unichain) | 1795677162 (07:12:42) | 0 s |
| Reactive tx (two CallbackRequests, Lasna) | 1795677162 (07:12:42) | 0 s |
| Payment callback (Base Sepolia) | 1795677163 (07:12:43) | **+1 s** |
| Asset callback (Unichain Sepolia) | 1795677164 (07:12:44) | **+2 s** |

The payment leg was locked ~13 s earlier (at 1795677149), so the loop began when the **second** leg arrived, not the first.

## Asset-first loop (order `0x2222…2222`)
Both legs settled with the same mechanism; the RC's order-independent state machine produced settlement after the payment leg arrived. Tx hashes are in [DEPLOYMENT.md](./DEPLOYMENT.md). The reactive tx and both callbacks landed within 1–2 block timestamps of the second lock.

## Timeout / refund loop (order `0x4444…4444`)
Deadline passed, the next `Cron10` tick drove the refund sweep, and the refund callback landed on Base Sepolia. The cron interval (~10 s) plus callback delivery dominates here; the RC performs no polling and no keeper is involved.

## Why this needs Omni
On the legacy Reactive network (~7 s blocks, ~7 s finality), the reactive hop alone would add 7–14 s to each loop, versus the measured 0–2 s here. For OTC/RFQ settlement that window is precisely the inventory and price risk a market maker carries. With instant finality the arbiter's decision is final in the same second the second leg lands.

## Caveats
- These are testnet numbers with purpose-built ERC-20s, not mainnet liquidity.
- EVM block timestamps have 1-second resolution; wall-clock observer numbers include network/observer delay.
- Cron billing drained RC reserves during an idle window and paused execution until topped up. See [DEPLOYMENT.md](./DEPLOYMENT.md). This is a funding-operational issue, not a latency measurement artefact.
