// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {HandshakeSupport} from "script/HandshakeSupport.sol";

/// @notice Funds all three contracts after setVenues (PRD §11.5 / §13 step 7).
///   - Lasna: SYSTEM.depositTo(RC)              (default 1 lREACT)
///   - Base Sepolia: proxy.depositTo(payment escrow)  (default 0.02 ETH)
///   - Unichain Sepolia: proxy.depositTo(asset escrow) (default 0.02 ETH)
///
/// All addresses and amounts come from the environment; signing uses Foundry's
/// keystore account selected by `--account`. No private key appears in source.
///
///   forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
///     --account main --broadcast --slow
contract FundScript is Script {
    function run() external {
        address rc = HandshakeSupport.VM.envAddress("RC_ADDRESS");
        address paymentEscrow = HandshakeSupport.VM.envAddress("PAYMENT_ESCROW_ADDRESS");
        address assetEscrow = HandshakeSupport.VM.envAddress("ASSET_ESCROW_ADDRESS");

        HandshakeSupport.fundAll(rc, paymentEscrow, assetEscrow);
    }
}
