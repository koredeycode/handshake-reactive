# Design direction

- **Product.** Cross-chain OTC settlement for traders and market makers — lock on two chains, one reactive arbiter releases both legs.
- **Character.** `sharp, liquid, exact`. An exchange floor, not a bank portal.
- **World.** A DEX trade screen: paired token tiles, chain pills, an amount-dominated trade card, a precise settlement trail.
- **Moments.** The trade card (big tabular amounts, token marks, chain pills) and the settlement timeline are the two rich moments. Figures are set in tabular numerals.
- **Signature.** A two-lines-to-one convergence mark, used in the logo and the decision node of the timeline, and nowhere else.
- **Material.** One tinted neutral ramp (paper / ink), hairline borders, 12–16px radii, a 4px spacing grid, sentence case, one icon set (Lucide), one accent (pink/coral `#e11d62`) used only on the primary action, active state and one key figure. No glows, gradients, emoji, tracked uppercase labels or decorative status color.

Design principles follow the unslop skill by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. No assets were copied.

## Audit

The interface before the product-grade redesign was a developer console wearing a product skin: debt banners with `cast send` commands, native-balance chips, a health panel printing debt/reserves/pool balances, a demo guide, a 250-row event log, a latency chart and a nav leading to Verify / Latency / How it works. A purple-to-blue gradient powered the logo, buttons and active states, with glow shadows, radial washes, animated status dots, staggered slide-ins, uppercase tracked labels and heavy headings.

The product-grade pass removed that chrome but read too much like a settlement desk portal. This pass keeps the restraint and changes the material: the landing screen is now a trade screen with a swap-style ticket and an order book of paired token tiles; token marks are solid-color circles with one or two letters; chain pills label every leg; the settlement timeline reads as a precise trail of observed hops; typography and radii are rounded out toward a DEX while staying on the 4px grid.

## Token presentation

`public/tokens.json` is presentation metadata keyed by chain and live token address, and it mirrors the deployed ERC-20s: the Base Sepolia asset is **Test USD** (`tUSD`, 6 decimals, mark `US`) and the Unichain Sepolia asset is **Test Asset** (`tASSET`, 18 decimals, mark `AS`). The copy always says testnet. Token marks are inline SVG circles with letters taken from the real symbols; chain marks (Base, Unichain, Lasna) are small monochrome inline SVGs that inherit the pill's ink or active accent. No external images, no image CDN, no invented branding.

The quiet `/faucet` destination lets a connected wallet call the existing public `mint(address,uint256)` on each live demo token, watch balances refresh, and find native ETH faucets (Alchemy, ZalalenA, Superchain) for gas. It reuses the same write/switch-chain/receipt pattern as approve and lock.

## Diagnostics

Everything removed from the product is preserved on the hidden internal route `/dev`, reachable by direct URL (in production add `?dev=1` or build with `VITE_DEV_TOOLS=1`). It is deliberately absent from primary navigation and clearly labelled internal. It contains the debt/reserves/health panel, debt and eventual-atomicity warnings, the raw decoded event log, the latency chart with methodology caveats, and raw order/proof/venues JSON with literal "Not observed yet" debug states. All values come from live chain reads or the static observer file; none are seeded.

## Multicall

Lasna has no Multicall3 at viem's canonical address. `createConfig` sets `batch: { multicall: false }`, and the order board reads IDs and orders with plain `readContract` calls in parallel instead of `multicall`. No read path depends on a multicall3 deployment.
