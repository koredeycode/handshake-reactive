# Market deployment (parameterised)

`script/Deploy.s.sol` and `script/Fund.s.sol` read all market parameters from the
environment. With no override set, behaviour is byte-for-byte the existing Base
Sepolia (payment) / Unichain Sepolia (asset) market. Nothing in this document was
deployed as part of the open-orders change — it is the runbook for a **new** market.

## Strict deploy order

1. **RC first** — `HandshakeReactive` on Reactive Lasna. No subscriptions can be
   installed before the escrow addresses exist, and the escrows bake the RC address
   into their `callbackSender` immutable.
2. **Tokens** — payment token on the payment chain, asset token on the asset chain.
3. **Escrows** — `PaymentEscrow` (payment chain) and `AssetEscrow` (asset chain),
   constructed with the callback proxy for that chain and the RC from step 1.
4. **`setVenues`** — installs all seven subscriptions on the RC. **One-shot**:
   `setVenues` reverts with `InvalidVenue()` if `venuesSet` is already true, and the
   deploy script deliberately skips it when reusing an RC. A new market needs a new
   RC (or an explicit `unsubscribeAll()` followed by a fresh `setVenues`).
5. **Fund** — `script/Fund.s.sol` (or `AUTO_FUND=1` during deploy), only after
   `setVenues`, so every callback has reserve.

Existing address overrides are preserved: `RC_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`,
`ASSET_TOKEN_ADDRESS`, `PAYMENT_ESCROW_ADDRESS`, `ASSET_ESCROW_ADDRESS`. Setting an
address override skips that deployment step and reuses the given contract.

## New chain / proxy overrides

| Variable | Default (current market) | Used for |
|---|---|---|
| `REACTIVE_CHAIN_ID_OVERRIDE` | `5318007` | Lasna chain ID in the manifest / deploy events |
| `PAYMENT_CHAIN_ID_OVERRIDE` | `84532` | payment chain ID in `setVenues`, manifest, deploy events |
| `ASSET_CHAIN_ID_OVERRIDE` | `1301` | asset chain ID in `setVenues`, manifest, deploy events |
| `PAYMENT_PROXY_OVERRIDE` | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` | payment escrow's callback proxy, and the proxy funded by `fundAll` |
| `ASSET_PROXY_OVERRIDE` | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` | asset escrow's callback proxy, and the proxy funded by `fundAll` |
| `PAYMENT_RPC` | value of `BASE_RPC` | fork used for the payment token/escrow deploys and for payment-leg funding + debt checks |
| `ASSET_RPC` | value of `UNICHAIN_RPC` | fork used for the asset token/escrow deploys and for asset-leg funding + debt checks |

`PAYMENT_RPC` / `ASSET_RPC` are read through `HandshakeSupport.paymentRpc()` /
`assetRpc()`, and every leg deploy, deposit, and health check in `Deploy.s.sol` and
`fundAll()` uses those helpers. An empty or unset value falls back to the legacy
`BASE_RPC` / `UNICHAIN_RPC` variables, so the default market is unchanged.
`Fund.s.sol` has no forks of its own — it delegates entirely to `fundAll()`.

The RC's venue whitelist accepts `5318007`, `84532`, `1301`, `11155111`, so a reverse
market using the two existing testnets needs no contract change.

Other existing overrides: `REACTIVE_RPC` (Lasna endpoint; unchanged by the leg
selectors), `BASE_RPC` / `UNICHAIN_RPC` (the legacy defaults for the two legs),
`RC_ARTIFACT`, `PAYMENT_TOKEN_ARTIFACT`, `ASSET_TOKEN_ARTIFACT`,
`PAYMENT_ESCROW_ARTIFACT`, `ASSET_ESCROW_ARTIFACT`, `RC_DEPLOY_VALUE_WEI`,
`RC_FUND_AMOUNT_WEI`, `PAYMENT_RESERVE_WEI`, `ASSET_RESERVE_WEI`, `AUTO_FUND`,
`DEPLOYMENT_MANIFEST`.

## Example: same market (no overrides)

```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

## Example: reverse market (tUSD on Unichain, tASSET on Base)

Set the **new** leg-specific RPC variables to the correct endpoints, then swap the
chain IDs and callback proxies. Leave `BASE_RPC` / `UNICHAIN_RPC` at their canonical
values; they are only fallbacks and must not be repurposed. Deploy fresh tokens on
the corresponding chains (the artifact overrides are explicit so the runbook is
unambiguous).

```bash
export REACTIVE_RPC=https://lasna-rpc.rnk.dev/
export BASE_RPC=https://sepolia.base.org              # unchanged legacy default
export UNICHAIN_RPC=https://sepolia.unichain.org      # unchanged legacy default

# These select the forks for every leg deploy / fund / health check:
export PAYMENT_RPC=https://sepolia.unichain.org       # payment leg -> Unichain
export ASSET_RPC=https://sepolia.base.org             # asset leg -> Base

export PAYMENT_CHAIN_ID_OVERRIDE=1301
export ASSET_CHAIN_ID_OVERRIDE=84532
export PAYMENT_PROXY_OVERRIDE=0x775c9B990ADe401060B78D0e98684eEf8d2466C1
export ASSET_PROXY_OVERRIDE=0x476F44b11F5C942c58f4c8E3d0300E5710743585

export PAYMENT_TOKEN_ARTIFACT=src/tokens/TestUSD.sol:TestUSD       # tUSD on Unichain
export ASSET_TOKEN_ARTIFACT=src/tokens/TestAsset.sol:TestAsset     # tASSET on Base

export DEPLOYMENT_MANIFEST=deployments-reverse.json

# 1–4: fresh RC -> tokens -> escrows -> setVenues (one-shot)
forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow

# 5: fund RC and both escrows through the overridden proxies
export RC_ADDRESS=0x...   # addresses from deployments-reverse.json
export PAYMENT_ESCROW_ADDRESS=0x...
export ASSET_ESCROW_ADDRESS=0x...
forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
  --account main --broadcast --slow
```

The generated manifest maps each **chain ID to its callback proxy** using the same
overrides: `{"1301": "0x775c…", "84532": "0x476F…"}` for the reverse market above,
with `chainIds` and the `Deployed` events likewise reflecting the swapped IDs. The
manifest contains no RPC URLs, so its byte-for-byte default output is unchanged.

Existing deployment hashes in [DEPLOYMENT.md](./DEPLOYMENT.md) are historical records and are
intentionally left untouched.
