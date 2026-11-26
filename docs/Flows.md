# Flows

There are **three live instances**, all funded with public testnet tokens that have no value.
The trade ticket's flip arrow chooses the direction; leaving the seller blank creates an open
order. Full addresses, from-blocks and transaction hashes for every instance are in
[DEPLOYMENT.md](./DEPLOYMENT.md).

| Instance | Payment leg | Asset leg | Matching |
|---|---|---|---|
| Original, named seller | `tUSD` on **Base Sepolia** | `tASSET` on **Unichain Sepolia** | One pre-named seller |
| Open order, forward | `tUSD` on **Base Sepolia** | `tASSET` on **Unichain Sepolia** | Any seller (`seller = address(0)`); first valid lock wins, later sellers are refunded |
| Reverse | `tUSD` on **Unichain Sepolia** | `tASSET` on **Base Sepolia** | Named or open; uses chain-local tokens deployed on the opposite chains |

One decision by the reactive contract on **Reactive Lasna** releases both legs in every
instance. The roles never change — the buyer always pays `tUSD`, the seller always delivers
`tASSET` — only the chains swap.

## Buyer flow

1. Open **New trade**, choose the direction with the flip arrow, enter the seller's address (or
   leave it blank to let anyone match), the `tUSD` amount to pay, the `tASSET` amount to receive
   and a settlement window.
2. Connect a wallet and, if needed, mint the direction's `tUSD` on the faucet (Base Sepolia for
   the forward instances, Unichain Sepolia for the reverse instance).
3. Create the order. This writes to that instance's reactive contract on Lasna; the connected
   wallet is the buyer.
4. On the order detail page, switch to the payment chain and **approve then lock** the `tUSD`
   leg. The terms hash is derived from the on-chain order, not a quote.
5. Wait for a seller to lock the asset leg. Both locks are observed by that instance's reactive
   contract on Lasna.
6. One reactive decision releases the `tUSD` to the matching seller and the `tASSET` to the
   buyer. If the deadline passes before both legs lock, the locked funds can be refunded instead.

## Seller / match flow

1. Find an order on the **Trade** page or via a shared order link; the book aggregates all three
   instances with direction and open filters. Check the `tUSD` amount offered and the `tASSET`
   amount requested.
2. If needed, mint that instance's `tASSET` on the faucet (Unichain Sepolia for the forward
   instances, Base Sepolia for the reverse instance).
3. Open the order detail page, switch to the asset chain and **approve then lock** the `tASSET`
   leg for that order with the canonical terms hash. In a named-seller order only that address
   can lock; in an open order any seller can.
4. For an open order the **first valid lock wins**: later sellers are refunded without touching
   the winner's leg (`AssetEscrow` keys the asset leg by `(orderId, seller)`). The winning lock
   and the buyer's payment lock are both observed by Lasna.
5. The same single reactive decision releases both legs: the buyer receives `tASSET` and the
   matching seller receives `tUSD`. No second settlement transaction is submitted by the seller.

## Track (wallet-free)

`/verify` and `/verify/:orderId` are public, read-only tracking: paste a full 32-byte order id,
follow a shared link, or open an order from an observed hash. The market comes from a hidden link
param or a scan of the three RCs. No wallet is required and nothing is signed — only real
on-chain hashes and decoded events are shown.

## Internal `/dev`

`/dev` is hidden from primary navigation and is internal-only (in production it needs `?dev=1`
or a `VITE_DEV_TOOLS=1` build). It holds debt/reserves/health, warnings, the raw decoded event
log, the latency chart and raw order/proof JSON with literal "Not observed yet" debug states —
diagnostics, not part of the product flows.

## Observability

Every balance, amount, hash and status in the UI comes from a chain read or a decoded on-chain event. Pending steps stay pending; nothing is seeded. The order board and wallet balance chips use plain per-chain reads — wagmi runs with `batch: { multicall: false }` because Lasna has no Multicall3 at viem's canonical address.

All proven loops (payment-first, asset-first, timeout/refund, open order, race and reverse) with
their full transaction hashes are recorded in [DEPLOYMENT.md](./DEPLOYMENT.md); the on-chain
measurement methodology and latency numbers are in [LATENCY.md](./LATENCY.md).
