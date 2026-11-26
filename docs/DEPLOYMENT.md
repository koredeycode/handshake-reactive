# Handshake — live testnet deployment (2026-11-26)

All contracts deployed by keystore account `hs-deployer` (`0x91b3CAFfB38CD8Ed578Ad149Ca48d0a4E35B9A88`) from the generated wallet file in `personal/wallets.json`. No private keys appear here.

## Addresses

| Contract | Chain | Address |
|---|---|---|
| `HandshakeReactive` | Reactive Lasna (5318007) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` |
| `TestUSD` | Base Sepolia (84532) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` |
| `TestAsset` | Unichain Sepolia (1301) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` |
| `PaymentEscrow` | Base Sepolia (84532) | `0xc5ca1b349d214855aB62291C8990ECC63881bDAe` |
| `AssetEscrow` | Unichain Sepolia (1301) | `0xc5ca1b349d214855aB62291C8990ECC63881bDAe` |

The same address appears on multiple chains because the deployer used the same nonce on each chain; this is expected and harmless.

## Setup transactions

| Step | Tx | Chain |
|---|---|---|
| Deploy TestUSD | `0x4e7be6c5eb69bbdb8af5f39ba2a7270910d859526bb40bc8c01cbaf837aa8a0e` | Base Sepolia |
| Deploy TestAsset | `0xd8a79e6e325d0709dedbad269849fab1afcefc8e90671f3c1a9897f01290ec3f` | Unichain Sepolia |
| Deploy PaymentEscrow | `0x90fcba6f19109457a19c829757b57e7b92ffcab66b7a92ed1ee43b413ab904e1` | Base Sepolia |
| Deploy AssetEscrow | `0x9bd973daaca7cedd31eeb4aaf018733285d6b87552382987bdc237f1506e8c29` | Unichain Sepolia |
| `setVenues` (7 subscriptions) | `0x313eaf094eab7af9626a3d877d600ad3637089c888c01adbcaae10ac1891ca11` | Lasna |
| Top-up RC after debt pause | `0xb4b61bbf88e31882a9004f3be006e58146cafcfbf77292182e8a87c0a3fc9769` | Lasna |

## Proven loops

### Payment-first — order `0x1111…1111`
| Stage | Tx | Chain |
|---|---|---|
| createOrder | `0x02311b746c590f929fe3e9f18fb039ba212e4772cf850f46865a0cee789ea3b0` | Lasna |
| PaymentLocked | `0xdb96e811f371e79ba72949de0edd45371add9540976a9d94a761154114b47c75` | Base Sepolia |
| AssetLocked | `0xeb3a68a22685b8fb8397c19d1b1db3bd67961aef7c74b73ddcab27401f6a674f` | Unichain Sepolia |
| Reactive tx with **two** `CallbackRequest` logs | `0xadce615f8d88432de9e7f8b1680708eebbf7123be0d50a5ffa64135d70767dc9` | Lasna |
| PaymentReleased | `0x8a2dafb49dfc944f7328a4f030e69bc7c5cbf73b759787cd60b15808942fa0c8` | Base Sepolia |
| AssetReleased | `0x4219685614356fc4be8d15d90f4129145fc082e62309560b1175e2ac4e7e3c37` | Unichain Sepolia |

### Asset-first — order `0x2222…2222`
| Stage | Tx | Chain |
|---|---|---|
| createOrder | `0x2c303df96e42fa6a37ccd5d59a38058d4e470e8e99c0b3a6d207d9f8cf8c5b6e` | Lasna |
| AssetLocked | `0xe9d41f573deae3d31ccdd9647e7d49f87ef411e2e206f66aab86142394c96303` | Unichain Sepolia |
| PaymentLocked | `0x21ffc13c7fb58464802466eef26bf83cb31d0d1ffadb885768df488540fd27a5` | Base Sepolia |
| Reactive tx with **two** `CallbackRequest` logs | `0x89a54515de3bcecf953b3f2d67b66a4a148cbff808bad50cc08c89b956569225` | Lasna |
| PaymentReleased | `0x28e233942ff16446ea9bf3286a81a82a2b763739571b27b0b60599d695824ae6` | Base Sepolia |
| AssetReleased | `0x7937029b953978a39c4f71bb2fcd446b7d165c675fc4c487c05a738e27b0a016` | Unichain Sepolia |

### Timeout / refund — order `0x4444…4444`
| Stage | Tx | Chain |
|---|---|---|
| PaymentLocked (seller never locked) | `0x01a526e4a05814a828d3c88d5d55b26fa1a0d5d74a6afc3dfb85065699c1bd67` | Base Sepolia |
| Reactive refund tx (Cron10 sweep) | `0x6e373ced02f971e4ca522761a5538eed37765a77f8aeb75888e5126eb2077dca` | Lasna |
| PaymentRefunded callback | `0x68d6a8abb1419addd8c6ef59bda98eeb7c174c7c14ab674b68811a1d9e90033c` | Base Sepolia |

Final escrow leg state: `REFUNDED` (3), nonce 1. Buyer got the payment back automatically.

## Operational notes
- `Cron10` bills the RC on every tick even when there is no work. During a ~10-minute idle window the RC accrued ~0.0216 lREACT of debt, and **Reactive stops delivering events while debt > 0**. Top up with `SYSTEM.depositTo(RC)` before demos; `scripts/preflight.sh` checks this.
- One order (`0x3333…3333`) was stranded while the RC was in debt; after the top-up, new events were processed normally. This is documented behaviour, not a contract bug.
- Sourcify verification failed on the first attempt with an upstream decode error; it should be retried before submission.

## Additional market instances (2026-11-26, appended — do not overwrite the loops above)

The three proven loops above stay untouched as submission proof. Two new instances were deployed from the open-orders contract build (`forge` 1.3.2, `via_ir`) after PR #16. Both pass `scripts/preflight.sh` with debt 0 and 7 active subscriptions each.

### Open-orders / race market (forward direction, fresh RC + escrows)

| Contract | Chain | Address | Deploy tx | From block |
|---|---|---|---|---|
| `HandshakeReactive` | Lasna | `0x679d9B730c1eB7B88E1e6cFD501d12113F6F4E2F` | `0x5c8807235fd91804dcd3d65e26cb765b3957152e1aef9c68044f099eb83f6a70` | 9311378 |
| `PaymentEscrow` (tUSD) | Base Sepolia | `0x6f28EDb5cC37d3078012b1e9250748A0381a3480` | `0x1a5bfbfa5838fba2f501d7b174759c143ea7cb9fa72d64acacb716dbe5dba173` | 63951455 |
| `AssetEscrow` (tASSET) | Unichain Sepolia | `0x6f28EDb5cC37d3078012b1e9250748A0381a3480` | `0xd9cee47aa97096087923a2e06828c20927847f08c0ee7c0c1ca32dae5b8a9087` | 68859739 |

- Tokens are reused from the original market (`tUSD` Base `0x6d1Da6e…34E6`, `tASSET` Unichain `0x6d1Da6e…34E6`).
- `setVenues(84532, escrow, 1301, escrow)` → `0xe737cad813fc2a2a7fd0fcda7736b2d01bb1a4533a9f630f425e5d5e7aea1065` (7 subscriptions).
- Funding: Lasna `0xc45c5ab3…`, Base `0x53bca468…`, Unichain `0x84fa20da…` (0.003 ETH reserve; testnet gas is far below the 500k callback gas limit).

### Reverse market (pay tUSD on Unichain, receive tASSET on Base)

| Contract | Chain | Address | Deploy tx | From block |
|---|---|---|---|---|
| `HandshakeReactive` | Lasna | `0xC7A4aB5adA127D683D9D867245e02f279DC59514` | `0xc4251f8d1eb3c2211f01f6d263c589c224c0e2ad1a2eb4d3e5672b13c56eb703` | 9311484 |
| `TestUSD` (tUSD) | Unichain Sepolia | `0x5802587852C915ce1DBeA8064cfc1eF90C14578c` | `0x4236b21e6aed0ba0fa943144df3b2e2b40157c7b559448e9f85afbd2d4572012` | 68859811 |
| `TestAsset` (tASSET) | Base Sepolia | `0x5802587852C915ce1DBeA8064cfc1eF90C14578c` | `0xf5a2c13dac433213e2d09e6b222b41a7d63e2e203290a4994b467ef6e2efbcf2` | 63951862 |
| `PaymentEscrow` (tUSD) | Unichain Sepolia | `0xFc0C5588c302d1cB07086BC413B94A35133264db` | `0xd3f0b798e1f03ac28cb10b91f987e46fc8a74373495adec03eb8694a2755ceb2` | 68859822 |
| `AssetEscrow` (tASSET) | Base Sepolia | `0xFc0C5588c302d1cB07086BC413B94A35133264db` | `0x041385b8ddfaac4dee5a49882b718d97f60b6cfd25c69b9ff7b0d86d3b23d120` | 63951922 |

- `setVenues(1301, escrow, 84532, escrow)` → `0x972cfde0eb2ae025ea6d08068a69f26aa8669ab13e3abbb466fbeb8539b40348` (7 subscriptions).
- Funding: Lasna `0x9ae63c5b…`, Unichain `0xbb0fe491…`, Base `0x3d820889…` (0.003 ETH on Unichain, 0.02 ETH on Base).
- No settlement loops have been proven on the two new instances yet — proof hashes will be appended here after a dedicated test window, never inserted into the original sections above.

### Original RC top-up

The original RC accrued ~0.0198 lREACT of debt and Reactive paused delivery. Top-up `SYSTEM.depositTo` → `0xf9da2394c79ecf11fdc97dffe27ca0f610bb1b172a4605e7a699dd933a2642bd`; debt is back to 0 and reserves ~1.03e16 wei.

### Proof — open order `0xaaaa…aaaa` (race market, seller = address(0))
| Stage | Tx | Chain |
|---|---|---|
| createOrder (open) | `0x9d8f8c078699bc47bfc60e930eea988f683026153655821c9353dbe280e52e98` | Lasna |
| PaymentLocked (counterparty 0) | `0x14f8f22d51a08a287948ebee97b602a8ea5cd19561533024bd710894d333cf96` | Base Sepolia |
| AssetLocked (winner) | `0x07a7bc7a66828fc82570f9c670d9acfa2e7f874589afb566abb2d1cdb4fb83fc` | Unichain Sepolia |
| Reactive tx with **two** `CallbackRequest` logs | `0xdb6117bd972950c37e4d412b47e24783fc6432643e7eb2089cd3038234e30e01` | Lasna |
| PaymentReleased (to winner) | `0xc9153ef7658ddcd442b05fec6e415e9ae429d1cedd88cec599e06e0e6f4760c8` | Base Sepolia |
| AssetReleased (to buyer) | `0x82f17033b2b9d5ef67b9d806c058a8219483a648391416ece2a7dcb2bc78d721` | Unichain Sepolia |

### Proof — race with two sellers `0xbbbb…bbbb` (race market)
First valid asset lock wins; the later seller is refunded without closing the winner's leg. Final state: winner = first seller, `assetLockCount = 2`, payment RELEASED, winner asset RELEASED, loser asset REFUNDED, both legs closed.

| Stage | Tx | Chain |
|---|---|---|
| createOrder (open) | `0x7aace04ccad67772de21029e1e7d2a930a80ea288e3e7d397ff2178fe735d200` | Lasna |
| PaymentLocked | `0x6bf11a7818a228de4f1e77224a330731f872e29e91c0310d528598990a4f19ba` | Base Sepolia |
| AssetLocked — winning seller | `0xa95d819994fc77a8f053259ea73c43fd3d7c417fffe98b3ac8aa03da91be2017` | Unichain Sepolia |
| AssetLocked — later seller | `0xdd960395a7b72d15cb4c77923b1d4a513d1cdb5dd16d30bfc0bf4faba6555425` | Unichain Sepolia |
| Reactive tx with **two** `CallbackRequest` logs | `0x824eecdea48e9fb9e2fc61f5cdb44a742c55e04023bc9228c69028f476cd6063` | Lasna |
| Reactive loser-refund tx | `0x7bceca193b1103f02474e6a9d49e952f4ae1575b364f7b29dc80c5f40211097d` | Lasna |
| PaymentReleased (to winner) | `0x9e508e5eee5b06a03f2a6aa07959b419285f9b467c2a36573333b39888630aaa` | Base Sepolia |
| AssetReleased (winner → buyer) | `0x901a4615ec788af64046cc18d55765547971610e235b939cc2caf2cb2e3c8f8d` | Unichain Sepolia |
| AssetRefunded (loser) | `0xcc4c5f8261760198a2d1d94c34019ca9156569167b77f85b3e663f4992d1f46c` | Unichain Sepolia |

### Proof — reverse market `0xcccc…cccc` (asset-first)
| Stage | Tx | Chain |
|---|---|---|
| createOrder | `0x61cc0e591e85b1c93f0632bf034f2336ccacfc2305b82df23b8f9a14a79e8076` | Lasna |
| AssetLocked (tASSET on Base) | `0xc491f031b6d882f16c406e0a8f48683d627699a5d3c7edab6f5780f35f7593a0` | Base Sepolia |
| PaymentLocked (tUSD on Unichain) | `0x58ad65b3189d8ab940ded4786cad85d887da3745d1830e88c688857c5967c811` | Unichain Sepolia |
| Reactive tx with **two** `CallbackRequest` logs | `0x1e3d80263ae3d2f87376182ec199b530ab6f979e19c8607436a1d34a91259041` | Lasna |
| PaymentReleased (to seller) | `0x4d0037ae1016061e64dfc0e64b8f5259035bd89b5d5d8ce2bb440ae3f53e4ca0` | Unichain Sepolia |
| AssetReleased (to buyer) | `0x248083746d1bcd0a61150b1213630d0bfecf30fbe4f19d2a7fd695e8a69138d9` | Base Sepolia |
