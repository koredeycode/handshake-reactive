# Sourcify verification — live Handshake deployment (2026-11-26)

All five deployed contracts from [`DEPLOYMENT.md`](./DEPLOYMENT.md) were submitted to Sourcify and **verified with an exact match**. No contracts were deployed and no transactions were sent during this work.

## Setup / diagnosis

- The preinstalled `forge` (1.3.2-stable) uses Sourcify's **API v1**, which Sourcify removed on 2026-07-07. Both the "already verified" check and the submission endpoint return an HTML 404 page, which forge reports as `error decoding response body; expected value at line 1 column 1` after 5 retries. Verifying that failure is not transient: `GET https://sourcify.dev/server/check-all-by-addresses` returns an `API v1 is removed` response, while `GET /server/health` is healthy.
- Verification was therefore retried with **forge 1.10.0** (Sourcify API v2 support, foundry-rs/foundry#11438), installed temporarily at `/tmp/handshake-forge/forge`. The system forge install was left unchanged.
- Compiler: **solc 0.8.30** (`0.8.30+commit.73712a01`), read from the CBOR metadata of the deployed Lasna bytecode (`a2 ... 64solc 43 00 08 1e`) and passed explicitly with `--compiler-version 0.8.30`. Settings come from `foundry.toml` (`via_ir = true`, optimizer enabled, 200 runs, EVM version `prague`).
- `--skip-is-verified-check` was used because forge's initial `/v2/contract/...` preflight lookup timed out once; the actual submission succeeded. `--creation-transaction-hash` was supplied from `DEPLOYMENT.md` so Sourcify also could attempt a creation-code match.
- No `ETHERSCAN_API_KEY` (or equivalent verifier key) is present in the environment, so the Etherscan fallback was neither needed nor possible.

Constructor arguments for the escrows were built with `cast abi-encode`, e.g.:

```sh
cast abi-encode "constructor(address,address,address)" \
  0x476F44b11F5C942c58f4c8E3d0300E5710743585 \
  0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6 \
  0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6
# PaymentEscrow:
# 0x000000000000000000000000476f44b11f5c942c58f4c8e3d0300e57107435850000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e60000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e6
# AssetEscrow (proxy 0x775c9B99...C1):
# 0x000000000000000000000000775c9b990ade401060b78d0e98684eef8d2466c10000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e60000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e6
```

## Per-contract results

### 1. HandshakeReactive — Reactive Lasna (5318007)

- **Address:** `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6`
- **Contract:** `src/HandshakeReactive.sol:HandshakeReactive` (no constructor args)
- **Command:**

```sh
forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 5318007 --skip-is-verified-check \
  --creation-transaction-hash 0x313eaf094eab7af9626a3d877d600ad3637089c888c01adbcaae10ac1891ca11 \
  0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6 \
  src/HandshakeReactive.sol:HandshakeReactive
```

- **Result:** ✅ `exact_match` (runtime), `creationMatch: null` — Sourcify had no creation-code match entry for this chain/tx. Match ID **`59984681`**, verification job `bd0a38dd-8317-4501-ac76-22c53787e89a`, verified at `2026-11-26T07:57:26Z`. Lookup: https://sourcify.dev/server/v2/contract/5318007/0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6

### 2. TestUSD — Base Sepolia (84532)

- **Address:** `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6`
- **Contract:** `src/tokens/TestUSD.sol:TestUSD` (no constructor args)
- **Command:**

```sh
forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 84532 --skip-is-verified-check \
  --creation-transaction-hash 0x4e7be6c5eb69bbdb8af5f39ba2a7270910d859526bb40bc8c01cbaf837aa8a0e \
  0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6 \
  src/tokens/TestUSD.sol:TestUSD
```

- **Result:** ✅ `exact_match` (creation **and** runtime). Match ID **`59983236`**, verification job `f3287334-2e4c-47e8-9720-907e9fa213e8`, verified at `2026-11-26T07:57:40Z`. Lookup: https://sourcify.dev/server/v2/contract/84532/0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6

### 3. TestAsset — Unichain Sepolia (1301)

- **Address:** `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6`
- **Contract:** `src/tokens/TestAsset.sol:TestAsset` (no constructor args)
- **Command:**

```sh
forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 1301 --skip-is-verified-check \
  --creation-transaction-hash 0xd8a79e6e325d0709dedbad269849fab1afcefc8e90671f3c1a9897f01290ec3f \
  0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6 \
  src/tokens/TestAsset.sol:TestAsset
```

- **Result:** ✅ `exact_match` (creation **and** runtime). Match ID **`59984701`**, verification job `9bb1bd91-0330-44ae-8f97-87909c5649a9`, verified at `2026-11-26T07:57:43Z`. Lookup: https://sourcify.dev/server/v2/contract/1301/0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6

### 4. PaymentEscrow — Base Sepolia (84532)

- **Address:** `0xc5ca1b349d214855aB62291C8990ECC63881bDAe`
- **Contract:** `src/PaymentEscrow.sol:PaymentEscrow`
- **Constructor args:** `(address proxy, address reactive, address token)` = `0x476F44b11F5C942c58f4c8E3d0300E5710743585`, `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6`, `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` (ABI-encoded value shown above).
- **Command:**

```sh
forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 84532 --skip-is-verified-check \
  --creation-transaction-hash 0x90fcba6f19109457a19c829757b57e7b92ffcab66b7a92ed1ee43b413ab904e1 \
  --constructor-args 0x000000000000000000000000476f44b11f5c942c58f4c8e3d0300e57107435850000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e60000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e6 \
  0xc5ca1b349d214855aB62291C8990ECC63881bDAe \
  src/PaymentEscrow.sol:PaymentEscrow
```

- **Result:** ✅ `exact_match` (creation **and** runtime). Match ID **`59984702`**, verification job `04c9b662-decf-4a0e-93a3-4c1d2bc9da9a`, verified at `2026-11-26T07:57:44Z`. Lookup: https://sourcify.dev/server/v2/contract/84532/0xc5ca1b349d214855aB62291C8990ECC63881bDAe

### 5. AssetEscrow — Unichain Sepolia (1301)

- **Address:** `0xc5ca1b349d214855aB62291C8990ECC63881bDAe`
- **Contract:** `src/AssetEscrow.sol:AssetEscrow`
- **Constructor args:** `(address proxy, address reactive, address token)` = `0x775c9B990ADe401060B78D0e98684eEf8d2466C1`, `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6`, `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` (ABI-encoded value shown above).
- **Command:**

```sh
forge verify-contract --verifier sourcify --compiler-version 0.8.30 \
  -c 1301 --skip-is-verified-check \
  --creation-transaction-hash 0x9bd973daaca7cedd31eeb4aaf018733285d6b87552382987bdc237f1506e8c29 \
  --constructor-args 0x000000000000000000000000775c9b990ade401060b78d0e98684eef8d2466c10000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e60000000000000000000000006d1da6e00066f4b3a16fec64010478165bab34e6 \
  0xc5ca1b349d214855aB62291C8990ECC63881bDAe \
  src/AssetEscrow.sol:AssetEscrow
```

- **Result:** ✅ `exact_match` (creation **and** runtime). Match ID **`59984703`**, verification job `7f854236-fcfb-4132-91fc-f9c3121845d4`, verified at `2026-11-26T07:57:46Z`. Lookup: https://sourcify.dev/server/v2/contract/1301/0xc5ca1b349d214855aB62291C8990ECC63881bDAe

## Summary

| Contract          | Chain (ID)               | Address                                      | Match                      | Match ID   | Job ID                                 |
| ----------------- | ------------------------ | -------------------------------------------- | -------------------------- | ---------- | -------------------------------------- |
| HandshakeReactive | Reactive Lasna (5318007) | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` | exact (runtime)            | `59984681` | `bd0a38dd-8317-4501-ac76-22c53787e89a` |
| TestUSD           | Base Sepolia (84532)     | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` | exact (creation + runtime) | `59983236` | `f3287334-2e4c-47e8-9720-907e9fa213e8` |
| TestAsset         | Unichain Sepolia (1301)  | `0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6` | exact (creation + runtime) | `59984701` | `9bb1bd91-0330-44ae-8f97-87909c5649a9` |
| PaymentEscrow     | Base Sepolia (84532)     | `0xc5ca1b349d214855aB62291C8990ECC63881bDAe` | exact (creation + runtime) | `59984702` | `04c9b662-decf-4a0e-93a3-4c1d2bc9da9a` |
| AssetEscrow       | Unichain Sepolia (1301)  | `0xc5ca1b349d214855aB62291C8990ECC63881bDAe` | exact (creation + runtime) | `59984703` | `7f854236-fcfb-4132-91fc-f9c3121845d4` |

**5/5 verified, all `exact_match`.** The retry succeeded after switching from forge 1.3.2 (removed Sourcify v1 API) to forge 1.10.0 (v2 API). Statuses were confirmed with `GET https://sourcify.dev/server/v2/verify/<job-id>` and `GET https://sourcify.dev/server/v2/contract/<chain>/<address>?fields=all`.
