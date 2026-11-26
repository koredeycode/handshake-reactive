# Design direction

- **Product.** Cross-chain OTC settlement for traders and market makers — lock on two chains, one reactive arbiter releases both legs.
- **Character.** exact, calm, financial. A settlement desk, not a dashboard.
- **World.** A dealing-room ledger: warm paper-white surfaces, ink type, quiet hairlines, one ledger-blue accent for the active thing.
- **Moments.** The settlement timeline is the single rich moment: two legs converge into one decision, then two releases. Figures are set in tabular numerals.
- **Signature.** A two-lines-to-one convergence mark, used in the logo and the decision node of the timeline, and nowhere else.

Design principles follow the unslop skill by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. No assets were copied.

## Audit

The old interface was a developer console wearing a product skin. Its landing screen was an "Operator console" headed by a five-second polling banner, a debt banner with `cast send` commands and a "copy commands" button, native-balance chips for all three chains, and a system-health panel printing debt, reserves, pool balances and a "subscriptions live in the Reactive node" note. Below that sat an order table, a three-run "Demo guide", and a collapsible 250-row decoded event log. The primary navigation led to Verify, Latency, How it works and an event log; the landing copy explained RPC scan windows and "no invented hashes". Order detail exposed expected `termsHash` hex, a proof-markdown block for a submission form, an "event log" teaser, RC flags and nonce, and a timeline whose missing rows literally read "not observed yet" beside a latency table with "no latency sample keyed to this order". The public verify page was titled "Public verification", asked visitors not to trust the dashboard, and printed a paste-ready proof table. A purple-to-blue gradient powered the logo, buttons and active states, with glow shadows, radial washes, animated status dots, staggered slide-ins, uppercase tracked labels and 700–900 weight headings.

## What was removed

Developer-facing chrome is gone from user screens: the debt banner and `cast send` commands, native-balance chips, system health/debt/reserves/subscription panel, demo guide, giant event log, latency chart and methodology caveats, "honest limitations" page, proof-markdown blocks, raw `termsHash` display, RC flags/nonce, "not observed yet" debug text, and every gradient, glow, colored shadow and looping animation. Primary navigation is now Orders, New trade and Track an order. The event feed, health and latency tooling are deleted rather than hidden; chain reads and writes, explorer URL patterns, runtime `contracts.json` config, the `termsHash` precondition computed from `getOrder`, approve/lock actions, retry, and read-only `/verify` tracking all remain unchanged.
