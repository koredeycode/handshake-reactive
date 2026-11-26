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
