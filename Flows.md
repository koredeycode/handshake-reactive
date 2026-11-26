# Flows

The live deployment is **one direction only, by role**:

- **Buyer** pays with `Test USD` (`tUSD`, 6 decimals) on **Base Sepolia**.
- **Seller** delivers `Test Asset` (`tASSET`, 18 decimals) on **Unichain Sepolia**.
- One decision by the reactive contract on **Reactive Lasna** releases both legs.

These are public testnet tokens with no value. A reverse market (seller pays `tUSD`, buyer receives `tASSET`) would need a **separate reactive contract / escrow configuration** with the venues swapped; it is not supported by the current deployment or the UI.

## Buyer flow

1. Connect a wallet and, if needed, mint `tUSD` on the faucet (Base Sepolia).
2. Open **New trade**, enter the seller's address, the `tUSD` amount to pay, the `tASSET` amount to receive, and a settlement window.
3. Create the order. This writes to the reactive contract on Lasna; the connected wallet is the buyer.
4. On the order detail page, switch to Base Sepolia and **approve then lock** the `tUSD` payment leg. The terms hash is derived from the on-chain order, not a quote.
5. Wait for the seller to lock the asset leg. Both locks are observed by Lasna.
6. One reactive decision releases the `tUSD` to the seller and the `tASSET` to the buyer. If the deadline passes before both legs lock, the locked funds can be refunded instead.

## Seller flow

1. Find an open order on the **Trade** page or via a shared order link; check the `tUSD` amount offered and the `tASSET` amount requested.
2. If needed, mint `tASSET` on the faucet (Unichain Sepolia).
3. Open the order detail page, switch to Unichain Sepolia and **approve then lock** the `tASSET` asset leg for that order. Only the order's seller can lock it.
4. Wait for the buyer's `tUSD` lock (or confirm it is already locked). Both legs are observed by Lasna.
5. The same single reactive decision releases both legs: the buyer receives `tASSET` and the seller receives `tUSD`. No second settlement transaction is submitted by the seller.

## Observability

Every balance, amount, hash and status in the UI comes from a chain read or a decoded on-chain event. Pending steps stay pending; nothing is seeded. The order board and wallet balance chips use plain per-chain reads — wagmi runs with `batch: { multicall: false }` because Lasna has no Multicall3 at viem's canonical address.
