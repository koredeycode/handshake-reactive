# Handshake — symmetric reverse market: deployment plan and market registry design

**Status: PLAN ONLY.** This document proposes work; no contract, script, UI file, address, key or config has been changed, and no transaction has been sent. It is backlog §7 of `personal/FUTURE-DEVELOPMENT.md` in the main worktree.

**Working rule (do not relitigate):** the three proven loops and every hash in [`DEPLOYMENT.md`](./DEPLOYMENT.md) are the submission proof and stay **untouched**. The reverse direction gets a **completely separate market instance** (new RC, new tokens, new escrows, new subscriptions, new proof hashes). When this instance is live, **append a new section** to [DEPLOYMENT.md](./DEPLOYMENT.md); never overwrite or "correct" the original hashes.

- Live market (forward): buyer pays `tUSD` on **Base Sepolia (84532)** → seller delivers `tASSET` on **Unichain Sepolia (1301)**.
- Proposed market (reverse): buyer pays `tUSD` on **Unichain Sepolia (1301)** → seller delivers `tASSET` on **Base Sepolia (84532)**.
- Token **roles do not change** (buyer always pays tUSD, seller always delivers tASSET); only the **chains** swap. `tUSD` and `tASSET` are chain-local ERC-20s, so they must be *deployed again* on the opposite chains — addresses cannot be reused across chains.

Canonical constants (from `script/HandshakeSupport.sol`, `scripts/preflight.sh`, `ts/networks.ts`, `ui/public/contracts.json`):

| Item | Value |
|---|---|
| Reactive Lasna chain id | `5318007` |
| System / payer contract on Lasna | `0x8888888888888888888888888888888888888888` |
| Legacy system contract (Cron10 subscription source) | `0x0000000000000000000000000000000000fffFfF` |
| Base Sepolia callback proxy | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` |
| Unichain Sepolia callback proxy | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` |
| Live RC / live tUSD / live tASSET address | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` (same on all three chains — same deployer nonce) |
| Live PaymentEscrow / AssetEscrow | `0xc5ca1b349d214855aB62291C8990ECC63881bDAe` |
| Live scan from-blocks | Lasna `9279105`, Base `63775999`, Unichain `68824600`; lookback `50000` |
| Deployer (keystore `main`, labelled `hs-deployer` in [DEPLOYMENT.md](./DEPLOYMENT.md)) | `0x91b3CAFfB38CD8Ed578Ad149Ca48d0a4E35B9A88` |

---

## 0. Live instances (filled 2026-11-26)

Three markets are deployed, funded, preflight-green (debt 0, 7 subscriptions each) and enabled in `ui/public/markets.json`. Original proof hashes remain in [DEPLOYMENT.md](./DEPLOYMENT.md).

**Postscript (PR #18):** the visible market selector was removed after user review. Direction is now chosen by the flip arrow in the trade ticket, blank seller means an open order, the order book aggregates all markets with direction/open filters, and order detail/Track infer their market from a hidden link param or a scan of the three RCs. References to a "selector" in the planning sections below are historical — the registry and role→chain mapping are unchanged.

| Market id | Label | RC (Lasna) | Payment leg | Asset leg | Proof |
|---|---|---|---|---|---|
| `forward-tusd-base-tasset-unichain` | Pay on Base · receive on Unichain | `0x6d1Da6e…34E6` | tUSD / escrow on **Base Sepolia** | tASSET / escrow on **Unichain Sepolia** | [DEPLOYMENT.md](./DEPLOYMENT.md) §Proven loops |
| `open-tusd-base-tasset-unichain` | Open orders · Base → Unichain | `0x679d9B73…3480` | tUSD / escrow `0x6f28EDb5…3480` on **Base** | tASSET / escrow `0x6f28EDb5…3480` on **Unichain** | [DEPLOYMENT.md](./DEPLOYMENT.md) §Proof — open order / race |
| `reverse-tusd-unichain-tasset-base` | Pay on Unichain · receive on Base | `0xC7A4aB5a…514` | tUSD `0x58025878…578c` / escrow `0xFc0C5588…64db` on **Unichain** | tASSET `0x58025878…578c` / escrow `0xFc0C5588…64db` on **Base** | [DEPLOYMENT.md](./DEPLOYMENT.md) §Proof — reverse market |

Full addresses, deploy/setVenues/funding tx hashes and from-blocks are in [DEPLOYMENT.md](./DEPLOYMENT.md). The reverse instance required new chain-local tokens because the original tUSD/tASSET ERC-20s exist only on their original chains.

## 1. Market registry design (`ui/public/markets.json`)

### 1.1 Schema

Implemented as `ui/public/markets.json`, one entry per market. Roles are explicit (`payment` / `asset`) so a direction swap is data, not code. `enabled` gates the selector. All three entries below are now deployed, funded, proven and `enabled: true`; see the live-instance table at the top of §0. The JSON snippets in this section are the original planning shapes — the authoritative values are in `ui/public/markets.json` and [DEPLOYMENT.md](./DEPLOYMENT.md).

```jsonc
{
  "_comment": "Market registry. No keys. systemContract/legacy are chain-wide; per-market addresses are role-based, not chain-slot-based.",
  "version": 1,
  "defaultMarketId": "forward-tusd-base-tasset-unichain",
  "systemContract": "0x8888888888888888888888888888888888888888",
  "legacySystemContract": "0x0000000000000000000000000000000000fffFfF",
  "markets": [
    {
      "id": "forward-tusd-base-tasset-unichain",
      "label": "Pay on Base · receive on Unichain",
      "direction": "forward",
      "enabled": true,
      "reactive": {
        "chainId": 5318007,
        "rc": "0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6",
        "deployBlock": 9279105
      },
      "payment": {
        "chainId": 84532,
        "chainKey": "base",
        "escrow": "0xc5ca1b349d214855aB62291C8990ECC63881bDAe",
        "token": "0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6",
        "tokenSymbol": "tUSD",
        "tokenDecimals": 6,
        "callbackProxy": "0x476F44b11F5C942c58f4c8E3d0300E5710743585",
        "scanFromBlock": 63775999
      },
      "asset": {
        "chainId": 1301,
        "chainKey": "unichain",
        "escrow": "0xc5ca1b349d214855aB62291C8990ECC63881bDAe",
        "token": "0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6",
        "tokenSymbol": "tASSET",
        "tokenDecimals": 18,
        "callbackProxy": "0x775c9B990ADe401060B78D0e98684eEf8d2466C1",
        "scanFromBlock": 68824600
      },
      "scan": { "lasnaFromBlock": 9279105, "lookbackBlocks": 50000 },
      "notes": {
        "latency": "2nd lock → RC 0 s; RC → payment cb +1 s; RC → asset cb +2 s (docs/LATENCY.md)",
        "proofSection": "docs/DEPLOYMENT.md §Proven loops"
      }
    },
    {
      "id": "reverse-tusd-unichain-tasset-base",
      "label": "Pay on Unichain · receive on Base",
      "direction": "reverse",
      "enabled": false,
      "reactive": {
        "chainId": 5318007,
        "rc": "<REVERSE_RC_ADDRESS>",
        "deployBlock": <REVERSE_RC_DEPLOY_BLOCK>
      },
      "payment": {
        "chainId": 1301,
        "chainKey": "unichain",
        "escrow": "<REVERSE_PAYMENT_ESCROW_ADDRESS>",
        "token": "<TUSD_ON_UNICHAIN>",
        "tokenSymbol": "tUSD",
        "tokenDecimals": 6,
        "callbackProxy": "0x775c9B990ADe401060B78D0e98684eEf8d2466C1",
        "scanFromBlock": <TUSD_UNICHAIN_DEPLOY_BLOCK>
      },
      "asset": {
        "chainId": 84532,
        "chainKey": "base",
        "escrow": "<REVERSE_ASSET_ESCROW_ADDRESS>",
        "token": "<TASSET_ON_BASE>",
        "tokenSymbol": "tASSET",
        "tokenDecimals": 18,
        "callbackProxy": "0x476F44b11F5C942c58f4c8E3d0300E5710743585",
        "scanFromBlock": <TASSET_BASE_DEPLOY_BLOCK>
      },
      "scan": { "lasnaFromBlock": <REVERSE_RC_DEPLOY_BLOCK>, "lookbackBlocks": 50000 },
      "notes": { "latency": "<fill after the reverse loop is proven>", "proofSection": "<new docs/DEPLOYMENT.md section>" }
    }
  ]
}
```

Field rules:

- `id` is a stable slug used in URLs (`?market=…`), localStorage and React Query keys.
- `direction` is `forward` | `reverse`; it is **presentational only**. Logic must read `payment.chainId` / `asset.chainId`, never infer a chain from the direction string or token symbol.
- `rc` is per market; `systemContract` and `legacySystemContract` are shared because the RC is on the same Lasna chain.
- `callbackProxy` is chosen by the **leg's chain**, not by its role — this is exactly what flips in the reverse instance.
- `scanFromBlock` per leg and `scan.lasnaFromBlock` keep `eth_getLogs` windows small (see §5).
- `enabled: false` entries are filtered out of the selector and all order queries until the instance is funded and proven.

### 1.2 Keeping the existing single-market UI working

`ui/src/lib/config.ts` currently exposes a single `useConfig(): AppConfig` backed by `ui/public/contracts.json` with `VITE_*` env overrides. ~15 hooks/components call it (`queries.ts`, `proofs.ts`, `balances.ts`, `tokenDisplay.ts`, `OrderDetail.tsx`, `LegCard.tsx`, dev panels, …). Do not break that contract.

Migration shape (for the next UI PR, not this one):

1. **Leave `contracts.json` and `useConfig()` semantics unchanged.** `useConfig()` continues to return the default (live/forward) market with the same `AppConfig` shape and the same `VITE_*` precedence; the default config fallback stays in place if `markets.json` is missing. Existing screens therefore keep working with zero edits.
2. Add `useMarkets(): Market[]` loading `markets.json` (React Query, `staleTime: Infinity`), with a fallback of one synthetic market derived from `useConfig()` when the file cannot be fetched.
3. Add `useMarket(): Market` that reads the selected id from `?market=<id>` (deep links for proof hashes), then localStorage, then `defaultMarketId`. Only `enabled` markets are selectable. Selection persists across reloads.
4. Add `marketToAppConfig(market): AppConfig` as an adapter so migrated hooks can keep consuming the legacy field names. **Caveat:** the legacy shape names chain slots (`base.*`, `unichain.*`) while holding *role* data (`paymentEscrow`, `assetEscrow`). For the forward market these coincide; for the reverse market they do not. Therefore the adapter must be paired with a `chainKeyFor(market, 'payment' | 'asset')` helper (derived from `chainId` via `CHAIN_IDS`) used for `usePublicClient`, `txUrl`, `addressUrl`, balance groups, token registry lookup and faucet links. Until every consumer is migrated, keep the reverse entry `enabled: false`.
5. Include `market.id` in **every** React Query key that touches orders, legs, venues, balances, proofs or latency (`['order', id, rc]`, `['leg', kind, orderId, seller, escrow]`, `['proof', orderId, watch]`, …). Without this, switching markets returns cached forward-market data under the same key.

**No ABI changes are needed.** `HandshakeReactive` is compiled from one source and deployed twice; `getOrder(bytes32)` returns the identical 22-field tuple (buyer, seller, paymentToken, paymentAmount, assetToken, assetAmount, deadline, flags, nonce, timestamps, winner, race fields) in both instances, and `orders`, `orderCount`, `orderIds`, `venues`, `createOrder`, `retry`, `coverDebt` are identical. `ui/src/lib/contracts.ts` and `ts/abis.ts` can be reused verbatim; the selector only swaps the RC address and leg addresses. Sanity-check the selected market on load with `venues()` and `venuesSet()` on the RC — the on-chain venue chain IDs are the authoritative direction.

---

## 2. Exact deploy sequence for the reverse instance

### 2.1 Why the order is strict

1. **RC first.** `callbackSender_` is baked into both escrows at construction (`abi.encode(proxy, rc, token)` in `script/Deploy.s.sol`); it is immutable. A wrong or reused RC address makes every callback unauthenticated forever — only a redeploy fixes it. The RC is also `payable` and is funded at deploy time (`RC_DEPLOY_VALUE_WEI`, default `0.05 ether`).
2. **Tokens second.** Each escrow pins one ERC-20 in its constructor. The reverse tokens must be freshly deployed on the *opposite* chains: `TestUSD` on **Unichain Sepolia (1301)** and `TestAsset` on **Base Sepolia (84532)**. There is no bridge and no shared address.
3. **Escrows third.** `PaymentEscrow` is deployed on **Unichain** bound to the **Unichain proxy** `0x775c9B99…6C1`; `AssetEscrow` is deployed on **Base** bound to the **Base proxy** `0x476F44b1…3585`. Both bind the new RC. `setVenues` cannot be called before both escrow addresses exist.
4. **`setVenues` fourth.** It is one-shot (`venuesSet` guard, reverts `InvalidVenue` on a second call) and installs all seven subscriptions atomically. Verify `venues()` after sending.
5. **Fund last.** `SYSTEM.depositTo(RC)` on Lasna and `proxy.depositTo(escrow)` on each origin chain. Funding before subscriptions wastes reserves and cannot substitute for a wrong venue set.

### 2.2 Preconditions and freshness

```sh
export REACTIVE_RPC=https://lasna-rpc.rnk.dev/
export BASE_RPC=https://sepolia.base.org
export UNICHAIN_RPC=https://sepolia.unichain.org
export DEPLOYER_ADDRESS=0x91b3CAFfB38CD8Ed578Ad149Ca48d0a4E35B9A88
export FOUNDRY_ACCOUNT=main
export DEPLOYMENT_MANIFEST=deployments.reverse.json   # never overwrite deployments.json

# Confirm the keystore alias signs for the expected deployer; no raw key is read.
cast wallet address --account main
# Confirm nonces before deploying; addresses are CREATE(deployer, nonce).
cast nonce --rpc-url $REACTIVE_RPC $DEPLOYER_ADDRESS
cast nonce --rpc-url $BASE_RPC     $DEPLOYER_ADDRESS
cast nonce --rpc-url $UNICHAIN_RPC $DEPLOYER_ADDRESS
```

The live RC is `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` because the live deployment reused one nonce on three chains. The reverse RC **must be a fresh deployment with a fresh Lasna nonce** (and must not equal the live address). Since the live nonce is already consumed on Lasna, an ordinary new deployment satisfies this; assert `RC_ADDRESS != 0x6d1Da6e…34E6`, and if a collision is ever observed, switch to a different keystore alias (never a raw key). On Base and Unichain, also confirm the new token/escrow addresses differ from `0x6d1Da6e…34E6` / `0xc5ca1b34…bDAe`.

### 2.3 Path A — deploy today with the scripts as they exist (no source edits)

`script/Deploy.s.sol` currently hardcodes chain roles: tokens on Base/Unichain, escrows on Base/Unichain with BASE/UNICHAIN proxies, and `setVenues(84532, …, 1301, …)`. Setting only the five *address* overrides cannot reverse the chain roles: a fresh RC would get the **live** direction installed. So for a reverse deployment without waiting on the contracts workstream, use direct `forge create` / `cast send` with the same keystore account, then use `Fund.s.sol`'s values manually. (Nothing under `src/`, `script/`, `test/`, `ui/` or `scripts/` is modified by these commands.)

```sh
# 1. RC — fresh Lasna nonce, payable, lightly funded at creation (0.05 lREACT).
forge create --rpc-url $REACTIVE_RPC --account main --broadcast --value 0.05ether \
  src/HandshakeReactive.sol:HandshakeReactive
export RC_ADDRESS=<RC_FROM_OUTPUT>; export RC_DEPLOY_TX=<TX>; export RC_DEPLOY_BLOCK=<BLOCK>

# 2. Chain-local tokens: tUSD on Unichain, tASSET on Base.
forge create --rpc-url $UNICHAIN_RPC --account main --broadcast \
  src/tokens/TestUSD.sol:TestUSD
export TUSD_UNICHAIN=<ADDRESS>; export TUSD_UNICHAIN_TX=<TX>; export TUSD_UNICHAIN_BLOCK=<BLOCK>

forge create --rpc-url $BASE_RPC --account main --broadcast \
  src/tokens/TestAsset.sol:TestAsset
export TASSET_BASE=<ADDRESS>; export TASSET_BASE_TX=<TX>; export TASSET_BASE_BLOCK=<BLOCK>

# 3. Escrows — (proxy, RC, token) constructor, immutable callback sender.
forge create --rpc-url $UNICHAIN_RPC --account main --broadcast \
  src/PaymentEscrow.sol:PaymentEscrow \
  --constructor-args 0x775c9B990ADe401060B78D0e98684eEf8d2466C1 "$RC_ADDRESS" "$TUSD_UNICHAIN"
export PAYMENT_ESCROW=<ADDRESS>; export PAYMENT_ESCROW_TX=<TX>; export PAYMENT_ESCROW_BLOCK=<BLOCK>

forge create --rpc-url $BASE_RPC --account main --broadcast \
  src/AssetEscrow.sol:AssetEscrow \
  --constructor-args 0x476F44b11F5C942c58f4c8E3d0300E5710743585 "$RC_ADDRESS" "$TASSET_BASE"
export ASSET_ESCROW=<ADDRESS>; export ASSET_ESCROW_TX=<TX>; export ASSET_ESCROW_BLOCK=<BLOCK>

# 4. Subscriptions — note swapped chain ids and swapped escrows.
cast send --rpc-url $REACTIVE_RPC --account main "$RC_ADDRESS" \
  'setVenues(uint256,address,uint256,address)' 1301 "$PAYMENT_ESCROW" 84532 "$ASSET_ESCROW"
cast call --rpc-url $REACTIVE_RPC "$RC_ADDRESS" 'venuesSet()(bool)'
cast call --rpc-url $REACTIVE_RPC "$RC_ADDRESS" 'venues()(uint256,address,uint256,address)'
# Expect: true / 1301, PAYMENT_ESCROW, 84532, ASSET_ESCROW.

# 5. Funding — same amounts as Fund.s.sol defaults, but payer must match the leg's chain.
cast send --rpc-url $REACTIVE_RPC  --account main 0x8888888888888888888888888888888888888888 \
  'depositTo(address)' "$RC_ADDRESS"      --value 1ether
cast send --rpc-url $UNICHAIN_RPC  --account main 0x775c9B990ADe401060B78D0e98684eEf8d2466C1 \
  'depositTo(address)' "$PAYMENT_ESCROW"  --value 0.02ether
cast send --rpc-url $BASE_RPC      --account main 0x476F44b11F5C942c58f4c8E3d0300E5710743585 \
  'depositTo(address)' "$ASSET_ESCROW"    --value 0.02ether

# Health assertions mirroring HandshakeSupport.fundAll.
cast call --rpc-url $REACTIVE_RPC 0x8888888888888888888888888888888888888888 'debt(address)(uint256)' "$RC_ADDRESS"
cast call --rpc-url $UNICHAIN_RPC 0x775c9B990ADe401060B78D0e98684eEf8d2466C1 'debt(address)(uint256)' "$PAYMENT_ESCROW"
cast call --rpc-url $BASE_RPC     0x476F44b11F5C942c58f4c8E3d0300E5710743585 'debt(address)(uint256)' "$ASSET_ESCROW"
```

**Do not run `Fund.s.sol` against the reverse instance as-is:** `HandshakeSupport.fundAll` hardcodes *Base proxy → payment escrow* and *Unichain proxy → asset escrow*, which is the forward role/chain mapping. Likewise `scripts/preflight.sh` hardcodes `BASE_PROXY` for the payment escrow and `UNICHAIN_PROXY` for the asset escrow (§3).

### 2.4 Path B — single-command path after the contract/tooling workstream lands overrides

Required additions from that workstream (names below are the proposed contract; map to the actual names if they differ): `PAYMENT_CHAIN_ID` / `ASSET_CHAIN_ID` overriding `PAYMENT_CHAIN_ID`/`ASSET_CHAIN_ID` constants and driving RPC/proxy selection by chain; `PAYMENT_CALLBACK_PROXY` / `ASSET_CALLBACK_PROXY` (or equivalent) overriding the proxy constants in escrow construction and in `fundAll`. The same overrides must be honoured by `Deploy.s.sol`, `Fund.s.sol` and `preflight.sh`. With those in place:

```sh
# Make sure stale address overrides from .env are cleared — otherwise the script reuses
# live contracts and (worse) skips setVenues on a reused RC.
env -u RC_ADDRESS -u PAYMENT_TOKEN_ADDRESS -u ASSET_TOKEN_ADDRESS \
    -u PAYMENT_ESCROW_ADDRESS -u ASSET_ESCROW_ADDRESS \
  PAYMENT_CHAIN_ID=1301 ASSET_CHAIN_ID=84532 \
  PAYMENT_CALLBACK_PROXY=0x775c9B990ADe401060B78D0e98684eEf8d2466C1 \
  ASSET_CALLBACK_PROXY=0x476F44b11F5C942c58f4c8E3d0300E5710743585 \
  RC_DEPLOY_VALUE_WEI=50000000000000000 \
  DEPLOYMENT_MANIFEST=deployments.reverse.json \
  forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
    --account main --broadcast --slow

# Read the five fresh addresses from deployments.reverse.json, then:
RC_ADDRESS=<...> PAYMENT_ESCROW_ADDRESS=<...> ASSET_ESCROW_ADDRESS=<...> \
  PAYMENT_CHAIN_ID=1301 ASSET_CHAIN_ID=84532 \
  PAYMENT_CALLBACK_PROXY=0x775c9B990ADe401060B78D0e98684eEf8d2466C1 \
  ASSET_CALLBACK_PROXY=0x476F44b11F5C942c58f4c8E3d0300E5710743585 \
  forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
    --account main --broadcast --slow
```

Keep `AUTO_FUND` unset (`0`) so deploy and funding remain separate, verifiable steps. Use `--slow` for multi-fork scripts to avoid nonce races.

The five existing address hooks also support a **hybrid** path: if the RC/tokens/escrows were deployed manually per Path A, set `RC_ADDRESS`, `PAYMENT_TOKEN_ADDRESS`, `ASSET_TOKEN_ADDRESS`, `PAYMENT_ESCROW_ADDRESS` and `ASSET_ESCROW_ADDRESS` to those fresh addresses. Every deploy branch is skipped, and `Deploy.s.sol` then installs `setVenues` (because `venuesSet() == false`) and writes `DEPLOYMENT_MANIFEST` — a single canonical venue call plus a manifest for the reverse market. This is safe **only after** the chain/proxy overrides land; with today's constants it would install the forward venues on the new RC. Never point those overrides at the live addresses.

---

## 3. Funding & subscriptions

### 3.1 Exact amounts used live (defaults from `.env.example` / `HandshakeSupport.sol`)

| Purpose | Call | Payer / chain | Amount |
|---|---|---|---|
| RC creation | `create{value: ...}` | Lasna deploy tx | `0.05` lREACT (`RC_DEPLOY_VALUE_WEI=50000000000000000`) |
| RC reserve | `SYSTEM.depositTo(RC)` | `0x8888…8888` on Lasna | `1` lREACT (`RC_FUND_AMOUNT_WEI=1000000000000000000`) |
| Payment escrow reserve | `proxy.depositTo(paymentEscrow)` | Base proxy live / **Unichain proxy reverse** | `0.02` ETH (`PAYMENT_RESERVE_WEI=20000000000000000`) |
| Asset escrow reserve | `proxy.depositTo(assetEscrow)` | Unichain proxy live / **Base proxy reverse** | `0.02` ETH (`ASSET_RESERVE_WEI=20000000000000000`) |

Post-condition asserted by `fundAll`: `debt(rc) == debt(paymentEscrow) == debt(assetEscrow) == 0`. `debt > 0` means Reactive pauses delivery (documented in [DEPLOYMENT.md](./DEPLOYMENT.md)); top up with `SYSTEM.depositTo(RC)` on Lasna **before** every demo. These are the tooling defaults; confirm the actual live `reserves()` values with `cast call` rather than assuming, and use the same numbers for the reverse instance so the two markets are comparable.

### 3.2 The seven subscriptions installed by `setVenues`

Computed from the exact event signatures in `src/HandshakeReactive.sol` (`cast keccak "<signature>"`). For the **reverse** instance, subscriptions 1–6 point at the **new** escrows on the **swapped** chains; subscription 7 is identical for every RC.

| # | Event signature | topic0 | Origin chain | Contract |
|---|---|---|---|---|
| 1 | `PaymentLocked(bytes32,address,address,address,uint256,bytes32,uint256)` | `0xeb5b40d9e18193862e588be5f3887ec6b361ac7d7ad78e42e11adbd4cd697664` | `1301` | reverse PaymentEscrow |
| 2 | `AssetLocked(bytes32,address,address,address,uint256,bytes32,uint256)` | `0xe158058005a726fed86812e55f6199567efd4d6208f3367a8f61078ce1c3489a` | `84532` | reverse AssetEscrow |
| 3 | `PaymentReleased(bytes32,address,uint256,uint64)` | `0x903a04873fc04f468e31890f89b42c3d9aee337eea5a0e4c35446103b17bbf65` | `1301` | reverse PaymentEscrow |
| 4 | `PaymentRefunded(bytes32,address,uint256,uint64)` | `0x7ed45eda872966fe5f5f62451acdda28671441ee7b9cce8dc0483b10d95ac77c` | `1301` | reverse PaymentEscrow |
| 5 | `AssetReleased(bytes32,address,uint256,uint64)` | `0x8e7c2eb1a26bfcaca6a1abcf5add7d581276e708f9f446876015ed75c55397ee` | `84532` | reverse AssetEscrow |
| 6 | `AssetRefunded(bytes32,address,uint256,uint64)` | `0x512b6121585cd55600c64960420f18d49179f8611ab38147fe12deb03931f61f` | `84532` | reverse AssetEscrow |
| 7 | `Cron10(uint256)` | `0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687` | `5318007` (`block.chainid`) | `0x0000000000000000000000000000000000fffFfF` |

`setVenues` accepts only testnet chain ids (`84532`, `1301`, `5318007`, `11155111`), so both swapped ids pass. Expect exactly **7** active subscriptions for the new RC — `MIN_ACTIVE_SUBSCRIPTIONS=7` in preflight.

### 3.3 Parameterising `scripts/preflight.sh` for the second RC/proxies

Today the script is single-market: `PAYMENT_CHAIN_ID=84532`, `ASSET_CHAIN_ID=1301`, `BASE_PROXY`/`UNICHAIN_PROXY` constants, and `check_health` maps payment → Base proxy, asset → Unichain proxy. For a second instance it must become market-parameterised (no new file is created by this plan — this is a work item for the tooling PR):

- `PAYMENT_CHAIN_ID` / `ASSET_CHAIN_ID` become env-driven (`1301` / `84532` for reverse) and select the RPC used for each leg (`UNICHAIN_RPC` / `BASE_RPC`) instead of hardcoded slots.
- `PAYMENT_PROXY_ADDRESS` / `ASSET_PROXY_ADDRESS` become env-driven (`0x775c9B99…6C1` / `0x476F44b1…3585` for reverse); keep `SYSTEM=0x8888…8888` for Lasna. The `check_health` FIX commands and the subscription FIX command must use these same variables.
- `RC_ADDRESS`, `PAYMENT_ESCROW_ADDRESS`, `ASSET_ESCROW_ADDRESS` are already env-driven — point them at the reverse instance. `DEPLOYER_ADDRESS` / `BUYER_ADDRESS` / `SELLER_ADDRESS` remain the same wallets, but the buyer now needs ETH on Unichain and the seller on Base (flip the balance checks).
- Set `SUBSCRIPTION_FROM_BLOCK=<RC_DEPLOY_BLOCK>` (the script already supports it) so the log walk starts at the new RC's deployment, and keep `SUBSCRIPTION_LOOKBACK_BLOCKS=300000` as a bound. The `eth_getLogs` loop uses `chunk=30000` (Lasna's cap) and filters `topics: [SUBSCRIBE/UNSUBSCRIBE_TOPIC, rc_topic]`, so the two RCs cannot contaminate each other's count — but the RC env var must be correct.
- `MIN_ACTIVE_SUBSCRIPTIONS` stays `7`. Run preflight once per market from a dedicated env file (`set -a; source .env.reverse; set +a; bash scripts/preflight.sh`); never mix forward and reverse addresses in one invocation.

### 3.4 Verifying active subscriptions from Lasna logs

`check_subscriptions()` already implements the canonical method; reproduce it manually if needed:

1. Query `Subscribe`/`Unsubscribe` logs emitted by the system contract `0x8888…8888` with `topics: [<event topic0>, <32-byte left-padded RC address>]`, stepping `eth_getLogs` in **30,000-block chunks** (Lasna cap) from `SUBSCRIPTION_FROM_BLOCK` to `eth_blockNumber`.
   - Subscribe topic: `0xe9b38458922e1af481b2244c7c2bb32e465e90c352946042d2a09472fad6c246`
   - Unsubscribe topic: `0x15fca4b8348be4e206988055f4ba52d98f0ba260e633cf0968042fcfb004a944`
2. Replay in `(blockNumber, logIndex)` order: `Subscribe` (`topics[2]` = chain id, `topics[3]` = contract, `data` = topic0) inserts key `(chain, contract, topic0)`; `Unsubscribe` removes it.
3. Assert the final active set has 7 entries and matches §3.2 exactly. A count of 0 with `venuesSet() == true` means the from-block is wrong; a count < 7 means a partial install and requires investigation before any demo.
4. Cross-check with `cast call $REACTIVE_RPC $RC 'venues()(uint256,address,uint256,address)'` — the on-chain venues must be `1301 / reverse PaymentEscrow / 84532 / reverse AssetEscrow`.

---

## 4. Verification & proof

### 4.1 Sourcify

Use the same recipe that produced 5/5 `exact_match` in [`SOURCIFY.md`](./SOURCIFY.md): forge **1.10.0** (v2 API) at `/tmp/handshake-forge/forge` if system forge is still 1.3.2; `--verifier sourcify --compiler-version 0.8.30 --skip-is-verified-check --creation-transaction-hash <tx>`; settings from `foundry.toml` (`via_ir = true`, optimizer, 200 runs) — do not edit `foundry.toml`. No Etherscan key is available, so no Etherscan fallback is expected.

Constructor args (build with `cast abi-encode`; the escrow tuple is always `(address proxy, address reactive, address token)`):

```sh
cast abi-encode 'constructor(address,address,address)' \
  0x775c9B990ADe401060B78D0e98684eEf8d2466C1 "$RC_ADDRESS" "$TUSD_UNICHAIN"
cast abi-encode 'constructor(address,address,address)' \
  0x476F44b11F5C942c58f4c8E3d0300E5710743585 "$RC_ADDRESS" "$TASSET_BASE"
```

Five commands to run after deployment (replace `<…>` with recorded outputs). For the live RC, [SOURCIFY.md](./SOURCIFY.md) had to pass the `setVenues` tx as `--creation-transaction-hash` because no creation-code match entry existed; for a fresh `forge create` deployment use its real creation tx, falling back to the `setVenues` tx only if Sourcify cannot locate the creation code.

```sh
# 1. HandshakeReactive — Lasna 5318007, no constructor args
/tmp/handshake-forge/forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 5318007 --skip-is-verified-check --creation-transaction-hash <RC_DEPLOY_TX> \
  <RC_ADDRESS> src/HandshakeReactive.sol:HandshakeReactive

# 2. TestUSD — Unichain Sepolia 1301, no constructor args
/tmp/handshake-forge/forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 1301 --skip-is-verified-check --creation-transaction-hash <TUSD_UNICHAIN_TX> \
  <TUSD_UNICHAIN> src/tokens/TestUSD.sol:TestUSD

# 3. TestAsset — Base Sepolia 84532, no constructor args
/tmp/handshake-forge/forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 84532 --skip-is-verified-check --creation-transaction-hash <TASSET_BASE_TX> \
  <TASSET_BASE> src/tokens/TestAsset.sol:TestAsset

# 4. PaymentEscrow — Unichain Sepolia 1301
/tmp/handshake-forge/forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 1301 --skip-is-verified-check --creation-transaction-hash <PAYMENT_ESCROW_TX> \
  --constructor-args <ABI_ENCODED_UNICHAIN_PROXY_RC_TUSD> \
  <PAYMENT_ESCROW> src/PaymentEscrow.sol:PaymentEscrow

# 5. AssetEscrow — Base Sepolia 84532
/tmp/handshake-forge/forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 84532 --skip-is-verified-check --creation-transaction-hash <ASSET_ESCROW_TX> \
  --constructor-args <ABI_ENCODED_BASE_PROXY_RC_TASSET> \
  <ASSET_ESCROW> src/AssetEscrow.sol:AssetEscrow
```

Record each match ID / job ID / lookup URL in the **new** [DEPLOYMENT.md](./DEPLOYMENT.md) section, and mirror the [SOURCIFY.md](./SOURCIFY.md) summary table shape. **Do NOT overwrite the original hashes or match IDs in [DEPLOYMENT.md](./DEPLOYMENT.md) or [SOURCIFY.md](./SOURCIFY.md); add a new section to each** (e.g. `## Symmetric reverse market (2026-11-…)`).

### 4.2 Proof table template — fill after deployment

Run the reverse loops with the standard amounts (100 tUSD ↔ 1 tASSET), full 32-byte order IDs, and `PROOF_LOOKBACK_BLOCKS=200000` / per-leg `scanFromBlock` from `markets.json`. Paste the **full** 0x + 64-hex order id into `/verify`; abbreviations are rejected.

**Reverse payment-first** — order `0x…` (buyer pays tUSD on Unichain; seller delivers tASSET on Base):

| Stage | Tx hash | Chain | Explorer | Block / UTC | Notes |
|---|---|---|---|---|---|
| `createOrder` | `<TX>` | Lasna | [Reactscan](https://lasna.reactscan.net/tx/<TX>) | `<block>` | `paymentToken = tUSD@1301`, `assetToken = tASSET@84532` |
| `PaymentLocked` | `<TX>` | Unichain Sepolia | [Uniscan](https://sepolia.uniscan.xyz/tx/<TX>) | `<block>` | buyer locks tUSD |
| `AssetLocked` | `<TX>` | Base Sepolia | [BaseScan](https://sepolia.basescan.org/tx/<TX>) | `<block>` | second lock — starting gun |
| Reactive decision | `<TX>` | Lasna | [Reactscan](https://lasna.reactscan.net/tx/<TX>) | `<block>` | **two `CallbackRequest` logs in the same receipt** |
| `PaymentReleased` | `<TX>` | Unichain Sepolia | [Uniscan](https://sepolia.uniscan.xyz/tx/<TX>) | `<block>` | seller receives tUSD |
| `AssetReleased` | `<TX>` | Base Sepolia | [BaseScan](https://sepolia.basescan.org/tx/<TX>) | `<block>` | buyer receives tASSET |

**Reverse asset-first** — order `0x…` (same table, swap `PaymentLocked` / `AssetLocked` order; settlement hashes are new).

**Reverse timeout / refund** — order `0x…`:

| Stage | Tx hash | Chain | Notes |
|---|---|---|---|
| `createOrder` | `<TX>` | Lasna | duration ≥ 30 s |
| `PaymentLocked` (seller never locks) | `<TX>` | Unichain Sepolia | — |
| Reactive refund tx (Cron10 sweep) | `<TX>` | Lasna | assert `Cron10` from legacy system |
| `PaymentRefunded` callback | `<TX>` | Unichain Sepolia | buyer refunded |
| Final leg state | — | Unichain Sepolia | `REFUNDED` (3), nonce 1 — verify with `getLeg` |

**Latency notes:** copy the [LATENCY.md](./LATENCY.md) method (block timestamps, 1 s resolution) and record the reverse deltas separately: second lock → RC, RC → Unichain callback, RC → Base callback, plus the ~7 s legacy comparison. Do not reuse forward-market numbers or hashes.

---

## 5. Costs & risks

### 5.1 Approximate testnet ETH / lREACT from the deployer wallet

| Chain | Spend | Recommended balance |
|---|---|---|
| Lasna (5318007) | `0.05` RC deploy + `1` lREACT `depositTo` + gas for `setVenues` (7 subscriptions), orders, top-ups | ~`1.2–2` lREACT; faucet `request(address)` with 2 ETH on ETH Sepolia → `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434` |
| Base Sepolia (84532) | one ERC-20 deploy + one AssetEscrow deploy + `0.02` ETH reserve + lock/release gas | ~`0.1–0.2` ETH; Coinbase faucet |
| Unichain Sepolia (1301) | one ERC-20 deploy + one PaymentEscrow deploy + `0.02` ETH reserve + lock/release gas | ~`0.1–0.2` ETH; `https://faucet.zalalena.com/unichain` |

Additional ERC-20 test balances: mint tUSD to the buyer on Unichain and tASSET to the seller on Base (the reverse of the live market). Preflight thresholds remain `MIN_LASNA=0.1`, `MIN_BASE=0.01`, `MIN_UNICHAIN=0.005` (wei values in `scripts/preflight.sh`), but fund above them because two markets now share the wallet.

### 5.2 Risks and gotchas

- **One-shot `setVenues`.** `venuesSet` is permanent until `unsubscribeAll`. A second call reverts `InvalidVenue`; `Deploy.s.sol` silently skips it when an RC is reused. Therefore: fresh RC, verify `venues()` and `venuesSet()` immediately, and never run the deploy script with a stale `RC_ADDRESS` left in the environment. A wrong venue set cannot be repaired on that RC — redeploy.
- **Two RCs billed per cron tick.** `Cron10` bills each RC every tick even when idle. A ~10-minute idle window on one RC accrued ~`0.0216` lREACT of debt and paused event delivery until top-up. A second RC roughly doubles idle burn, so budget top-ups for **both** RCs and check `debt()` in preflight before each demo. Debt > 0 means no events are delivered — this is operational, not a contract bug.
- **RPC range limits.** Base Sepolia's official endpoint rejects `eth_getLogs` ranges above **200** blocks (`-32614`), Unichain above **~1000** (`-32602`; publicnode accepts 1000), Lasna caps at **30,000** (used by `preflight.sh`). Use the adaptive chunking already in `ui/src/lib/logs.ts` (`SAFE_CHUNK=200`, grow to `MAX_CHUNK=1000`, halve on error) for proof queries; keep per-leg `scanFromBlock` near the deployment block and `SUBSCRIPTION_FROM_BLOCK` near the RC deploy block so windows stay small. Do not raise `PROOF_LOOKBACK_BLOCKS` to compensate — chunk and narrow instead.
- **Role/chain confusion.** The current tooling binds payment→Base and asset→Unichain in `Deploy.s.sol`, `Fund.s.sol`, `preflight.sh`, `buildHops()` (`ui/src/lib/proofs.ts`), `useTokenDisplay()` and `useLeg()`. Any of these left unchanged will read or fund the wrong chain for the reverse instance. This is the main correctness risk; gate the reverse market behind `enabled: false` until all are migrated.
- **Token metadata.** `ui/public/tokens.json` is keyed by chain + address, and tUSD (6 decimals) / tASSET (18 decimals) keep their decimals on the new chains. Add the new chain/address entries; never infer decimals from the symbol alone.
- **Fresh-nonce collisions.** CREATE addresses depend on deployer + nonce. Verify all five reverse addresses differ from the live ones and record the deploy nonces.

### 5.3 Rollback / cleanup if the reverse instance is unused

1. Stop creating orders; wait for any open orders to reach terminal state (or expire).
2. Call on the **reverse RC only**: `cast send --rpc-url $REACTIVE_RPC --account main $RC_ADDRESS 'unsubscribeAll()'` (onlyOwner). This removes all seven subscriptions, including the Cron10 one, and sets `venuesSet = false`, stopping cron billing for that RC. **Never call this on the live RC** `0x6d1Da6e…34E6`.
3. If needed, `coverDebt()` on the reverse RC and leave any remaining lREACT reserve; optionally top up the **live** RC separately so the proven loops keep working.
4. Set the reverse market entry `enabled: false` in `markets.json` and remove/ignore `deployments.reverse.json`; keep the recorded addresses and proof hashes for the audit trail. Do not delete or edit the original [DEPLOYMENT.md](./DEPLOYMENT.md) section.

---

## 6. UI handoff checklist (next UI PR)

Scope: role-derived chain mapping. No ABI or contract changes. **Delivered by PR #17 and revised by PR #18**; the checkbox list below is the original plan, and the visible selector item was replaced by the direction flip in the trade ticket.

- [x] Add `ui/public/markets.json` (§1.1) and `ui/src/lib/markets.ts` with `useMarkets()` / `useMarket()`; keep `useConfig()` and `contracts.json` as the default-market fallback so existing screens work unchanged.
- [x] ~~Add a **market selector** control in the shell header~~ — **replaced by PR #18**: direction flip in the trade ticket + board filters, no visible selector.
- [ ] Make the **route strip, token tiles, leg cards and flow explainer** follow the selected market: payment leg = tUSD on `market.payment.chainId`, asset leg = tASSET on `market.asset.chainId`, with amounts formatted using each token's own decimals.
- [ ] Derive **chain marks and chain labels** from `chainKeyFor(market, role)` instead of hardcoded `'base'`/`'unichain'`; update `usePublicClient`, `txUrl`/`addressUrl`, `BALANCE_GROUPS` in `Shell.tsx`, `useTokenRegistry()` lookup, `buildHops()` in `proofs.ts`, `resolveProof()` and the faucet links. Reverse: buyer needs Unichain, seller needs Base.
- [ ] Add `market.id` to all React Query keys (`order`, `leg`, `venues`, `proof`, balances, token meta, latency); on market switch, clear/invalidate stale per-market caches so no forward hash is shown under the reverse market.
- [ ] Keep **per-market proof hashes and latency notes** from `markets.json` / the new [DEPLOYMENT.md](./DEPLOYMENT.md) section; `/verify` and `/orders/:id` must use the selected market's RC and escrows. Full 64-hex order IDs only. Never surface another market's hashes.
- [ ] Add the new token addresses to `ui/public/tokens.json` under their **new chain keys** with real symbol/decimals/mark/color.
- [ ] Keep **`/dev` hidden** from primary navigation (it remains a route only for diagnostics: debt/reserves, event log, latency chart, raw state, warnings). No demo notes, debt panels, "not observed yet" copy or wallet prompts on primary screens; `/verify` stays wallet-free.
- [ ] QA both directions in one session: switch markets, create/lock/settle a small order on each (during a dedicated test window, not during a recording), confirm the two `CallbackRequest` logs and both callbacks resolve to the correct market, and confirm preflight debt == 0 for both RCs.

---

## Sources

[`DEPLOYMENT.md`](./DEPLOYMENT.md), [`SOURCIFY.md`](./SOURCIFY.md), [`LATENCY.md`](./LATENCY.md), `script/Deploy.s.sol`, `script/Fund.s.sol`, `script/HandshakeSupport.sol`, `scripts/preflight.sh`, `src/HandshakeReactive.sol`, `ui/public/contracts.json`, `ui/public/tokens.json`, `ui/src/lib/config.ts`, `ui/src/lib/chains.ts`, `ui/src/lib/{contracts,queries,proofs,balances,tokenDisplay,logs}.ts`, `ts/networks.ts`, `.env.example`, `personal/FUTURE-DEVELOPMENT.md`, `personal/VIDEO-SCRIPT.md` (the last two read from the sibling main worktree; untouched here). Topic0 values computed locally with `cast keccak` from the contract's event signatures — read-only, no network calls or transactions.
