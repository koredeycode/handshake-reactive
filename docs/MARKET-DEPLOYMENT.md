# Market deployment (single-RC venue registry)

Status: **current as of 2026-11-27**. `script/Deploy.s.sol` and
`script/Fund.s.sol` read market parameters from the environment. With no
override, they reproduce the live layout: **one** `HandshakeReactive` on Lasna,
two tokens and two escrows per registered chain, three venues, 19 subscriptions.
Nothing here proposes a second RC — see the superseded note at the end.

## Strict deploy order

1. **RC first** — `HandshakeReactive` on Reactive Lasna (`5318007`). Subscriptions
   require escrow addresses to exist, and each escrow bakes the RC address into
   its `callbackSender` immutable.
2. **Tokens and escrows per chain** — for each of `84532`, `1301`, `11155111`,
   deploy a payment and an asset escrow bound to that chain's callback proxy and
   to the RC. Escrows are token-agnostic; the ERC-20 is supplied per order.
3. **`setVenue()` per chain** — `setVenue(chainId, paymentEscrow, assetEscrow)`
   is called **three times**, once per registered chain. Each call adds six
   topics for that chain; after all three, `subscriptionCount() == 19` (18 escrow
   subscriptions + `Cron10`). Registration is repeatable with a *different*
   escrow pair: `VenueInUse()` reverts while any non-closed order references the
   chain. Verify with `venue(chainId)` and `registeredChainIds()`.
4. **Fund** — `script/Fund.s.sol` (or `AUTO_FUND=1` during deploy), only after
   venues are registered, so every callback has reserve on all six escrows.

Existing address overrides are preserved: `RC_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`,
`ASSET_TOKEN_ADDRESS`, `PAYMENT_ESCROW_ADDRESS`, `ASSET_ESCROW_ADDRESS`, plus the
Sepolia equivalents (`SEPOLIA_PAYMENT_TOKEN_ADDRESS`,
`SEPOLIA_ASSET_TOKEN_ADDRESS`, `SEPOLIA_PAYMENT_ESCROW_ADDRESS`,
`SEPOLIA_ASSET_ESCROW_ADDRESS`). Setting an address override skips that deployment
step and reuses the given contract.

## Chain / proxy overrides

| Variable | Live value | Used for |
|---|---|---|
| `REACTIVE_CHAIN_ID_OVERRIDE` | `5318007` | Lasna chain ID in the manifest / deploy events |
| `PAYMENT_CHAIN_ID_OVERRIDE` | `84532` | default payment leg chain ID |
| `ASSET_CHAIN_ID_OVERRIDE` | `1301` | default asset leg chain ID |
| `PAYMENT_PROXY_OVERRIDE` | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` | Base callback proxy |
| `ASSET_PROXY_OVERRIDE` | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` | Unichain callback proxy |
| `SEPOLIA_PROXY_OVERRIDE` | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` | Ethereum Sepolia callback proxy |
| `PAYMENT_RPC` | value of `BASE_RPC` | fork for the payment token/escrow deploy, funding and debt checks |
| `ASSET_RPC` | value of `UNICHAIN_RPC` | fork for the asset token/escrow deploy, funding and debt checks |
| `SEPOLIA_RPC` | value of `ETHEREUM_SEPOLIA_RPC` | fork for the third chain's escrows and funding |

`PAYMENT_RPC` / `ASSET_RPC` are read through `HandshakeSupport.paymentRpc()` /
`assetRpc()`; every leg deploy, deposit and health check uses those helpers. An
unset value falls back to `BASE_RPC` / `UNICHAIN_RPC`. `Fund.s.sol` has no forks
of its own — it delegates to `fundAll()`.

Other overrides: `REACTIVE_RPC`, `REACTIVE_CHAIN_ID_OVERRIDE`,
`SEPOLIA_CHAIN_ID_OVERRIDE`, `RC_ARTIFACT`, `PAYMENT_TOKEN_ARTIFACT`,
`ASSET_TOKEN_ARTIFACT`, `PAYMENT_ESCROW_ARTIFACT`, `ASSET_ESCROW_ARTIFACT`,
`RC_DEPLOY_VALUE_WEI`, `RC_FUND_AMOUNT_WEI`, `PAYMENT_RESERVE_WEI`,
`SEPOLIA_RESERVE_WEI`, `AUTO_FUND`, `DEPLOYMENT_MANIFEST`.

The RC accepts only testnet chain IDs (`84532`, `1301`, `5318007`, `11155111`)
as venues, so adding another registered chain needs no contract change. A
replacement venue for an existing chain must respect `VenueInUse()`.

## Deploy / fund

```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

After a run, assert:

```
RC.subscriptionCount() == 19
RC.registeredChainIds().length == 3
RC venue(84532/1301/11155111) = (payment escrow, asset escrow, true)
RC owner == deployer
SYSTEM.debt(RC) == 0
each proxy.debt(escrow) == 0 and reserves(escrow) > 0
```

Use `bash scripts/preflight.sh` (which expects `MIN_ACTIVE_SUBSCRIPTIONS=19`)
before any demo, and top up the RC with `SYSTEM.depositTo(RC)` when `debt > 0` —
Reactive stops delivering events while debt is outstanding. Full live addresses,
setup tx hashes and proof are in [`DEPLOYMENT.md`](./DEPLOYMENT.md); tooling
details are in [`TOOLING.md`](./TOOLING.md).

## Superseded: one-RC-per-market plan (2026-11-26)

An earlier version of this runbook described deploying a *fresh RC and two
escrows for each direction* (including a reverse Unichain→Base market), with a
single one-shot venue setup covering only one chain. That design was
**superseded** by the single-RC venue registry above; its plan text is preserved
in git history and `personal/EXPANSION-PLAN.md`. Do not follow it for operations.
The current system covers all directions through the venue registry and the
24 configured routes — no per-direction deployment is required.
