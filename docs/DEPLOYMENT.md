# Handshake — live full Option B deployment (2026-11-27)

One reactive contract on Reactive Lasna serves **all 24 directed routes** across
Base Sepolia, Unichain Sepolia and Ethereum Sepolia. Per-order venues and tokens
replace the old per-market instances. All contracts were deployed by keystore
account `hs-deployer` (`0x91b3CAFfB38CD8Ed578Ad149Ca48d0a4E35B9A88`); no private
keys appear in this document.

This document replaces the previous deployment record. Old hashes are discarded.

## Addresses

| Contract | Chain | Address |
|---|---|---|
| `HandshakeReactive` | Reactive Lasna (5318007) | `0xC23949a2d25bAA110306a0Adc3E5e0fcB6586989` |
| `TestUSD` (tUSD, 6 dp) | Base Sepolia (84532) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` |
| `TestAsset` (tASSET, 18 dp) | Base Sepolia (84532) | `0x1B07c8fc7FE5984a68b206152cC7d3352deD0f19` |
| `PaymentEscrow` | Base Sepolia (84532) | `0x3ad68Ab1b7E03057864F3c76aC63476315E513b5` |
| `AssetEscrow` | Base Sepolia (84532) | `0x5Ee944ddc392a9729d52702AB4c2e327848533a1` |
| `TestUSD` (tUSD, 6 dp) | Unichain Sepolia (1301) | `0xbc2037b06278633968d869253f6f512562f86306` |
| `TestAsset` (tASSET, 18 dp) | Unichain Sepolia (1301) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` |
| `PaymentEscrow` | Unichain Sepolia (1301) | `0x577f9DCAD6E2E529c2091C47a5C2FBa3c6a655F0` |
| `AssetEscrow` | Unichain Sepolia (1301) | `0x58084d4Ce053e9eD8aD16C107A72e8E8649Dd00d` |
| `TestUSD` (tUSD, 6 dp) | Ethereum Sepolia (11155111) | `0xD894D5bAade0C06137D45C616Cb9D2e6cbFa5fD4` |
| `TestAsset` (tASSET, 18 dp) | Ethereum Sepolia (11155111) | `0x9ffd2f7795fa3c029548c9faeac8da5cdb79047d` |
| `PaymentEscrow` | Ethereum Sepolia (11155111) | `0x6f28EDb5cC37d3078012b1e9250748A0381a3480` |
| `AssetEscrow` | Ethereum Sepolia (11155111) | `0x679d9B730c1eB7B88E1e6cFD501d12113F6F4E2F` |

Callback proxies: Base `0x476F44b1…3585`, Unichain `0x775c9B99…6C1`,
Ethereum Sepolia `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4`.

On-chain checks:

```
RC.subscriptionCount() = 19                    # 3 chains x 6 topics + Cron10
RC.venue(84532) = (payment escrow, asset escrow, true)
RC.venue(1301)  = (payment escrow, asset escrow, true)
RC.venue(11155111) = (payment escrow, asset escrow, true)
all six escrows: debt = 0, reserves > 0
```

## Deploy / fund runbook (re-runs and new markets)

`script/Deploy.s.sol` deploys the RC, then **for each of the three chains** two
tokens and two escrows in one broadcast session, then registers the three venues.
`script/Fund.s.sol` then deposits reserves and asserts `debt == 0` everywhere.
Do not run these in a different order — the escrows pin the RC address at
construction and the RC rejects unregistered venues in `createOrder()`.

Required env (see `.env.example`): `REACTIVE_RPC`, `BASE_RPC`, `UNICHAIN_RPC`,
`SEPOLIA_RPC`, plus `RC_ADDRESS`, `PAYMENT_ESCROW_ADDRESS`,
`ASSET_ESCROW_ADDRESS`, `UNICHAIN_PAYMENT_ESCROW_ADDRESS`,
`UNICHAIN_ASSET_ESCROW_ADDRESS`, `SEPOLIA_PAYMENT_ESCROW_ADDRESS`,
`SEPOLIA_ASSET_ESCROW_ADDRESS` for funding and re-runs. `HandshakeSupport.deploy`
no longer self-broadcasts; callers wrap each fork's deployments in
`vm.startBroadcast()` / `vm.stopBroadcast()`.

After a run, assert:

```
RC.subscriptionCount() == 19
RC.registeredChainIds().length == 3
RC owner == deployer
SYSTEM.debt(RC) == 0
each proxy.debt(escrow) == 0 and reserves(escrow) > 0
```

**Venue safety:** `setVenue()` replacement and `unsubscribeAll()` revert with
`VenueInUse()` while any non-closed order references that chain. Wait for those
orders to close (or refund) before rotating a venue. `VenueUnregistered` emits the
real escrow addresses (cached before storage deletion).

## Deployment / setup transactions

| Step | Tx | Chain |
|---|---|---|
| Deploy RC | `0x9d077f8bec6d8cc0fc0370b1df8033cd5f75954af9a23d15a50ba7b516db8e49` | Lasna |
| Register 3 venues (19 subscriptions) | `0x16e91729bf6e6f204b834b6ae6addedd7bc11e331266a6825f41f1aa53e05a02`, `0xc0d4d584f1cdd93672bdb294bbe6d5035d46b427a2e35940fe543ab80c121964`, `0xae85e9873f8c14154086e5d594a860dfbf1dd6ec7b983b2bec43732f116d5fa2` | Lasna |
| Fund RC + six escrows (`script/Fund.s.sol`) | see `funded-reserves` above (all `debt == 0`) | all chains |
| Top-up RC (cron burn, 5 lREACT) | `0xd6518092e73138060063a2c581958945699f0885735ea5428ca2211bc912288d` | Lasna |

Individual creation transactions are listed in [`SOURCIFY.md`](./SOURCIFY.md).

## Proven loops

`scripts/proof-loops.sh` generated the loops; `scripts/proof.sh <orderId>` collects
every hash from chain logs (never fabricated). Tier 1 covers all six ordered
chain pairs with payment-first, asset-first and timeout/refund scenarios.

| Order ID | Route | Scenario | Result |
|---|---|---|---|
| `0xb0f40db81453003808149c3cead25dd4c5be20cd73a79cd12edaa2b07d35ff19` | Base → Unichain | payment-first | settled |
| `0x0bad7a0a2c48083f1f1549da58bac4a2e63ee64afe2e00470b74b247f5a9338a` | Base → Unichain | asset-first | settled |
| `0x7e332292dc05bddc6590ab111af0c9916cd85def8c849ce5be6ff1ebf0e3fc45` | Base → Unichain | timeout/refund | refunded |
| `0x97d00df5e2773499eaff92ad90f31329b889a66fcea72a2db37d76b605693705` | Unichain → Base | payment-first | settled |
| `0x960b2e8ff6018cabbb86fcaf78f8a82c3af4c5914129c238b1744621bc786a72` | Unichain → Base | asset-first | settled |
| `0x3daafccfb56b31f44c4752c270838491a4d2cf1e800c211f0eda45455129a9a1` | Unichain → Base | timeout/refund | refunded |
| `0x73b75679f8704f46e05ecfcf4c972582f6325ea34cfc15561214ab40bcc2c8dc` | Base → Sepolia | payment-first | settled |
| `0xa78fe99a264f05e6eddd952ed8c2461ed09dc8168e71a57c04b2469063b7f23b` | Base → Sepolia | asset-first | settled |
| `0xa15187ce72b63fd0063503e0e8192fb38e1d74c36dc3e015a32e3adcf4dd5432` | Base → Sepolia | timeout/refund | refunded |
| `0xe8d2f7b74f4e11990e69d203398d5be8411e63dcfa6cb500cc57cba0bd1d8e5e` | Sepolia → Base | payment-first | settled |
| `0xef1b973178bd03414aae95d1eeb7db3e9d855615e53c9b7e2249723a1b6c240c` | Sepolia → Base | asset-first | settled |
| `0x66fbe6960ec43926b92e86b6c29a8967d58da3afcdfa4d48a51ef4c603ff8922` | Unichain → Sepolia | payment-first | settled |
| `0x3bf82651d18210eabd8b84b6c6f1ee07976fa6492d61f1d9548a49ca69eb3ddc` | Unichain → Sepolia | asset-first | settled |
| `0x7e688c74f58b141222492f4874df0d2417f1d902e268e7504649d7757f0daa5b` | Unichain → Sepolia | timeout/refund | refund pending at check time |
| `0x23a108497cd199c550fc1d658ccaa3947d40333fd084cd1b3c01fb25a88cdd1e` | Sepolia → Unichain | payment-first | settled |
| `0x8b39e9039dc04cb4cdaaff24403719b71d89e40a0ecce2da1b968df7c3519b7c` | Sepolia → Unichain | asset-first | settled |

### Detailed proof: Base → Unichain, payment-first (order `0xb0f4…5ff19`)

- Venue: payment **Base Sepolia (84532)** / `0x3ad68Ab1…13b5` → asset **Unichain Sepolia (1301)** / `0x58084d4C…0d00d`
- `termsHash` = `0x73bea941b5a76b6b6c9e451a891fb58855e9d8700cc1badc82d32e7a1bbed602`
- Terms tuple = (buyer `0x5D337E39…23f5`, seller `0x6e4C0897…4cd9`, paymentToken `0x6d1Da6e0…34E6`, paymentAmount `1000000`, assetToken `0x6d1Da6e0…34E6`, assetAmount `1000000000000000000`, deadline `1795770392`, paymentChainId `84532`, paymentEscrow `0x3ad68Ab1…13b5`, assetChainId `1301`, assetEscrow `0x58084d4C…0d00d`)

| Hop | Chain | Tx hash |
|---|---|---|
| createOrder | Lasna | `0xc7895a98d0f44fabe2549108c237956b5f604b8cdafa4dc4f9b5bd7a60b15805` |
| PaymentLocked | Base Sepolia | `0xb46dcc81bfafcec472d844368aaf1705ce297b8802f1f9c00739c1f86ec78e8f` |
| AssetLocked | Unichain Sepolia | `0x399d4c9107162b3a6ef00305af06323dfcb1cf763565b7383d2e0c8fa1975929` |
| **react() with two `CallbackRequest` logs** | Lasna | `0xb47777a49619fa13a2f48bc701eb9237391ec1479488d7b4a3363f8bc231de17` |
| PaymentReleased | Base Sepolia | `0x284875a4a9b13aa774428d15de1e51e2fed0447ea6bba61746d6241dad2a6df9` |
| AssetReleased | Unichain Sepolia | `0x36fc24f789b1414d14e6f23b1df9ca457d8c058aeffea9344af5b10577ee163a` |

Final state: `paymentClosed=true`, `assetClosed=true`, winner = seller, nonce 1.
Both callbacks were requested in the **single** react() transaction.

### Detailed proof: Sepolia → Base, payment-first (order `0xe8d2…4be11e`)

Venue: payment **Ethereum Sepolia (11155111)** / `0x6f28EDb5…3480` → asset
**Base Sepolia (84532)** / `0x5Ee944dd…33a1`. `termsHash` =
`0xabb520bdbcdeef06a1bd1702ab09707a0405b9de843c3292ccc12a0de404be11`.

| Hop | Chain | Tx hash |
|---|---|---|
| createOrder | Lasna | `0x3d316349555f227b7e717caac66d69e02497dc451419fe181c84b1109c212576` |
| PaymentLocked | Ethereum Sepolia | `0x652f8045f99f8eeca48c8e57f7c120396c9dbe45fa769881827b8ebc01c4b10a` |
| AssetLocked | Base Sepolia | `0xf7501150eb9b44a40104477c497156f115d4d10d8e1dbed77129134ff184599b` |
| react() with two CallbackRequest logs | Lasna | `0xf3d882767a47a8d00090f780031009f92d079fafca3382fcf132a78c5a9c7943` |
| PaymentReleased | Ethereum Sepolia | `0x45c2703021d3dec30a7dda1d032868adbd229f055151ce7ab6aa25fdfeee1250` |
| AssetReleased | Base Sepolia | `0x8c87982ac87f276e4da4ab40d4867981ddc0a9b57ca581c3c90ea51e2451638b` |

Reproduce: `python3 scripts/proof-range.py <orderId>` prints tight per-chain
block ranges; pass those as `PROOF_FROM_BLOCK_<chainId>` env vars to
`bash scripts/proof.sh <orderId>`. No fabricated hashes — missing events fail the
collector.

## Operational notes

- 19 subscriptions cost materially more cron than the old 7-subscription instances.
  The RC had to be topped up with 5 lREACT during proof generation; when `debt > 0`
  Reactive stops delivering events. Keep an eye on `scripts/preflight.sh`.
- `scripts/proof-range.py <orderId>` prints tight per-chain block ranges so a proof
  can be recollected in seconds rather than scanning hundreds of thousands of blocks.
- Reusing `ASSET_ESCROW_ADDRESS` from the old two-chain deployment is ambiguous on
  Unichain; `scripts/proof.sh` now prefers `UNICHAIN_ASSET_ESCROW_ADDRESS` and the
  RC's runtime venue registry.
