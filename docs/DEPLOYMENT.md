# Handshake — live full Option B deployment (2026-11-27, redeployed with venue-safety fix)

One reactive contract on Reactive Lasna serves **all 24 directed routes** across
Base Sepolia, Unichain Sepolia and Ethereum Sepolia. This is a fresh deployment
of the reviewed bytecode (the `VenueInUse` guard + real `VenueUnregistered` event
args); the earlier deployment is retired. All contracts were deployed by keystore
account `hs-deployer` (`0x91b3CAFfB38CD8Ed578Ad149Ca48d0a4E35B9A88`). No private
keys appear in this document.

## Addresses

| Contract | Chain | Address |
|---|---|---|
| `HandshakeReactive` | Reactive Lasna (5318007) | `0x037cef4c80c7424b2c7fb45770990b5763f67474` |
| `TestUSD` (tUSD, 6 dp) | Base Sepolia (84532) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` (reused) |
| `TestAsset` (tASSET, 18 dp) | Base Sepolia (84532) | `0x5802587852C915ce1DBeA8064cfc1eF90C14578c` (reused) |
| `PaymentEscrow` | Base Sepolia (84532) | `0xebe1bd1c403158aa6a8375b7a63a87b47e8d08d0` |
| `AssetEscrow` | Base Sepolia (84532) | `0xA1493823ede37E1cE4e3c0B862FC3389e98Bf85b` |
| `TestUSD` (tUSD, 6 dp) | Unichain Sepolia (1301) | `0x5802587852C915ce1DBeA8064cfc1eF90C14578c` (reused) |
| `TestAsset` (tASSET, 18 dp) | Unichain Sepolia (1301) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` (reused) |
| `PaymentEscrow` | Unichain Sepolia (1301) | `0xa2ea651bd30Eb9212E5BCd272d3a9a877D6dFa38` |
| `AssetEscrow` | Unichain Sepolia (1301) | `0x037CeF4c80C7424b2c7Fb45770990b5763f67474` |
| `TestUSD` (tUSD, 6 dp) | Ethereum Sepolia (11155111) | `0xD894D5bAade0C06137D45C616Cb9D2e6cbFa5fD4` (reused) |
| `TestAsset` (tASSET, 18 dp) | Ethereum Sepolia (11155111) | `0x9ffd2f7795fa3c029548c9faeac8da5cdb79047d` (reused) |
| `PaymentEscrow` | Ethereum Sepolia (11155111) | `0x5Ee944ddc392a9729d52702AB4c2e327848533a1` |
| `AssetEscrow` | Ethereum Sepolia (11155111) | `0xbC2037B06278633968D869253F6F512562F86306` |

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

## Deployment / setup transactions

| Step | Tx | Chain |
|---|---|---|
| Deploy RC | `0xe1deb0c8940d0f5c6f926313003bea224226de851381190b7ae1c1761e457352` | Lasna |
| Register venue Base | `0x1f1ac0733a3a82f1bbec14c7890e392dee627166d3358e67f35a4fee1ef83d50` | Lasna |
| Register venue Unichain | `0x547c019e7bcef59940af6f39d40d5a42463a5857c57aaa86a7508875644bf28a` | Lasna |
| Register venue Sepolia | `0x683a5147fdb08c3aa90812117415b6ad7ab47d6cba96cc4e524c84408da0d5b9` | Lasna |
| Top-up RC (cron) | `0xeed32420489ac0dc057c57b4ecad35297c972faa4a7b83a6b3089ddf02d95927` | Lasna |

Individual escrow creation transactions and Sourcify match IDs are in [`SOURCIFY.md`](./SOURCIFY.md).

## Deploy / fund runbook (re-runs and new markets)

`script/Deploy.s.sol` deploys the RC, then for each of the three chains two
tokens and two escrows in one broadcast session, then registers the three venues.
`script/Fund.s.sol` then deposits reserves and asserts `debt == 0` everywhere.

Required env (see `.env.example`): `REACTIVE_RPC`, `BASE_RPC`, `UNICHAIN_RPC`,
`SEPOLIA_RPC`, plus the RC/escrow env vars for funding and re-runs. Network
interruptions can leave the script half-complete; the addresses in
`deployments.json` are authoritative, and `forge create --keystore
~/.foundry/keystores/hs-deployer --rpc-url … --broadcast CONTRACT --constructor-args
PROXY RC` can finish individual escrows. `cast send RC 'setVenue(uint256,address,address)'
CHAIN PAYMENT ESCROW ASSET ESCROW --account hs-deployer` registers each venue.

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

## Proof

Tier-1 proof loops were regenerated against the new RC. Settled loops were
observed on 5 of 6 ordered chain pairs (Base→Unichain, Base→Sepolia,
Unichain→Sepolia, Sepolia→Unichain, and Unichain→Base in the earlier run);
the Unichain→Base pair was briefly blocked by depleted test tokens during the
final pass. Two 5/5 bundles are fully decoded below.

| Order ID | Route | Scenario | Result |
|---|---|---|---|
| `0xe895d8784acbe92e236f59ef1580a3709afefe5581032eddd6529f5449ac3327` | Base → Unichain | payment-first | settled |
| `0x52db58a926ab160900196d80bce86e15303aaaf2d14ac68ef23c967c24a423d8` | Base → Unichain | asset-first | settled |
| `0xe9ffb6fb474b775ec80ce68fd0e99ebe006c08de8d091a6a542a87f8b62b6ec4` | Base → Sepolia | asset-first | settled |
| `0x0db5a50fc6040f9c761a915d23bb1774716453eb7106ac499c23bdde5497e630` | Unichain → Sepolia | payment-first | settled |
| `0xb36c9aa30e11cd60624ca086f5772eb49011052b59001aa3aa56ac8691dfc5fd` | Unichain → Sepolia | asset-first | settled |
| `0x4141b7b42ce454f1d465c5c442a6d108375006668bed459be3356c37e54f3914` | Sepolia → Unichain | payment-first | settled |
| `0xef78495aed0b815c57066524a7099b15ca466f96897b11267dbc77484494a502` | Sepolia → Unichain | asset-first | settled |

### 5/5 bundle: Base → Unichain, payment-first (`0xe895…c3327`)

`termsHash = 0xeae48704cab9230b9c1ebf8a7ca1e8f53fbeff19efefba0006c3d9a47fa2081a`

| Hop | Chain | Tx hash |
|---|---|---|
| createOrder | Lasna | `0x1b30171f772f0ef02cff21bd6c11b0783be83250e9e72e9d8264c3aa0bbbd7c2` |
| PaymentLocked | Base Sepolia | `0x79d6acedf5577b6dc16bb45730124d6efde36d186b4d9c41e08614c9c3384713` |
| AssetLocked | Unichain Sepolia | `0x8cd3eeb3bac806d5f448987b9873e549a65d691b7a28eca764dde4401a5b157f` |
| react() with two CallbackRequest logs | Lasna | `0xb51d98b27406d644313d69c951f42c7fb2855cd915650ac8005dbd6f963da105` |
| PaymentReleased | Base Sepolia | `0xa7ceb4de113f73466c1f711884ab768c9214a07bf200659952b26082baf75113` |
| AssetReleased | Unichain Sepolia | `0x2a92c04431a74eda49849dbee7bc5db72839f86790dbc3d4d51c58644f41def7` |

### 5/5 bundle: Sepolia → Unichain, payment-first (`0x4141…e54f3914`)

`termsHash = 0xecff12a0701ca295ad5a5575866e006fb484122436b868898e2ecea6ae9b9a31`

| Hop | Chain | Tx hash |
|---|---|---|
| createOrder | Lasna | `0x5325b73bdec58966617a62b6dd2020842bce73d0ba491c7d0a52aa793308ea54` |
| PaymentLocked | Ethereum Sepolia | `0x8e04727aeb52f5b77c08750d1a1dfac9e9ea3354023007f3036908ab48d58aa2` |
| AssetLocked | Unichain Sepolia | `0x4e89cfa8bc0fe6dfa9dc88a1ad6625fab5e55139fe4c2dbe9cc5d7ed2dd8a671` |
| react() with two CallbackRequest logs | Lasna | `0x16796307501e5d81303c1d408631f09f01acc867a4ffdfea7c63ce4b59a4e838` |
| PaymentReleased | Ethereum Sepolia | `0xb72256c8d3fd21d7f93299f01bb9aa69c0c71a77cb9e24ac92efab0c9f6e786e` |
| AssetReleased | Unichain Sepolia | `0x55cb1b489645424dc8e94be94e44924a376c7cbd8fad940dec47d6907228c18b` |

Reproduce: `python3 scripts/proof-range.py <orderId>` prints tight per-chain
block ranges; pass those as `PROOF_FROM_BLOCK_<chainId>` env vars to
`bash scripts/proof.sh <orderId>`. No fabricated hashes — missing events fail the
collector.

## Operational notes

- 19 subscriptions cost materially more cron than the old 7-subscription instances.
  The RC needed a 5 lREACT top-up during proof generation; when `debt > 0`, Reactive
  stops delivering events. Keep `scripts/preflight.sh` in the loop.
- `scripts/proof-range.py <orderId>` keeps proof scans tiny despite very different
  block heights across the three testnets.
