# Sourcify verification — full Option B deployment (2026-11-27)

All 11 newly deployed contracts were submitted to Sourcify and verified with an
**exact match (creation and runtime)**. The two reused chain-local test tokens
from the earlier deployment are already verified at their existing addresses.

This document replaces the previous verification record; old proof hashes and
match IDs are discarded per the cutover decision in `personal/EXPANSION-PLAN.md`.

## Setup

- `forge` **1.10.0** (temporarily installed at `/tmp/handshake-forge/forge`) is
  required: the preinstalled 1.3.2 uses Sourcify's retired API v1.
- Compiler **solc 0.8.30**, settings from `foundry.toml` (`via_ir = true`,
  optimizer enabled, 200 runs, EVM version `prague`).
- Submitted with `--verifier sourcify --skip-is-verified-check
  --creation-transaction-hash <tx> --constructor-args <args>`.
- Escrow constructor args are now **two** addresses:
  `(callbackProxy, reactiveSender)`. ABI-encode with:
  ```sh
  cast abi-encode "constructor(address,address)" <PROXY> <RC>
  ```

## Verified contracts

| Contract | Chain (ID) | Address | Match ID | Result |
|---|---|---|---|---|
| HandshakeReactive | Reactive Lasna (5318007) | `0xC23949a2d25bAA110306a0Adc3E5e0fcB6586989` | `60061096` | exact (creation + runtime) |
| TestAsset | Base Sepolia (84532) | `0x1B07c8fc7FE5984a68b206152cC7d3352deD0f19` | `60059456` | exact (creation + runtime) |
| PaymentEscrow | Base Sepolia (84532) | `0x3ad68Ab1b7E03057864F3c76aC63476315E513b5` | `60061097` | exact (creation + runtime) |
| AssetEscrow | Base Sepolia (84532) | `0x5Ee944ddc392a9729d52702AB4c2e327848533a1` | `60061098` | exact (creation + runtime) |
| TestUSD | Unichain Sepolia (1301) | `0xbc2037b06278633968d869253f6f512562f86306` | `60061099` | exact (creation + runtime) |
| PaymentEscrow | Unichain Sepolia (1301) | `0x577f9DCAD6E2E529c2091C47a5C2FBa3c6a655F0` | `60061100` | exact (creation + runtime) |
| AssetEscrow | Unichain Sepolia (1301) | `0x58084d4Ce053e9eD8aD16C107A72e8E8649Dd00d` | `60061101` | exact (creation + runtime) |
| TestUSD | Ethereum Sepolia (11155111) | `0xD894D5bAade0C06137D45C616Cb9D2e6cbFa5fD4` | `60059557` | exact (creation + runtime) |
| TestAsset | Ethereum Sepolia (11155111) | `0x9ffd2f7795fa3c029548c9faeac8da5cdb79047d` | `60059596` | exact (creation + runtime) |
| PaymentEscrow | Ethereum Sepolia (11155111) | `0x6f28EDb5cC37d3078012b1e9250748A0381a3480` | `60061105` | exact (creation + runtime) |
| AssetEscrow | Ethereum Sepolia (11155111) | `0x679d9B730c1eB7B88E1e6cFD501d12113F6F4E2F` | `60061106` | exact (creation + runtime) |

Lookup form: `https://sourcify.dev/server/v2/contract/<chainId>/<address>`

## Creation transactions

| Contract | Chain | Creation tx |
|---|---|---|
| HandshakeReactive | Lasna | `0x9d077f8bec6d8cc0fc0370b1df8033cd5f75954af9a23d15a50ba7b516db8e49` |
| TestAsset | Base Sepolia | `0x1b001602940d5bf6842dc8cda4aa250b7b5398e8356b148fff11db78a4502bf2` |
| PaymentEscrow | Base Sepolia | `0x78c2bf660aa3c5989d0c869d0dd2a8efdb702b3dd1afb8eb1cfc25249dd08ef8` |
| AssetEscrow | Base Sepolia | `0xa66616a894638ec407b95bc70d5fe7dd1aa2b31c835fefb0effad05cf0e392a9` |
| TestUSD | Unichain Sepolia | `0x2e9c6d4b17554feee28697d3e32474e62dad4921b2b1c7e1d29894fff1846d58` |
| PaymentEscrow | Unichain Sepolia | `0xe9252f36981a1eec01173d0448451fa9a487c3a531b3f5155f763cff5a8a7f86` |
| AssetEscrow | Unichain Sepolia | `0x8e906fec2b8a924064225742e588262d1f72de8778c42358bc527fb05ced308d` |
| TestUSD | Ethereum Sepolia | `0xdfab74164ba26524af5ab70dcf00eb87f8b591b879b86bef47e42cbd7f0756b5` |
| TestAsset | Ethereum Sepolia | `0xdce340fa32242b8cdddb60ace3d24b8b53d8797c9f0531cdfde592761bce9e76` |
| PaymentEscrow | Ethereum Sepolia | `0xeedb8a54fc4bdb7cc7ac5e2fc7908789de21ae24385cbbcad9e95789eba59ce1` |
| AssetEscrow | Ethereum Sepolia | `0xa120f430e124dc1960583aad44e8299198e938dcb34d6e4f669fd2543056d739` |

## Constructor arguments (escrows)

- Base Sepolia proxy `0x476F44b11F5C942c58f4c8E3d0300E5710743585`
- Unichain Sepolia proxy `0x775c9B990ADe401060B78D0e98684eEf8d2466C1`
- Ethereum Sepolia proxy `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4`
- Reactive sender for all six: `0xC23949a2d25bAA110306a0Adc3E5e0fcB6586989`
