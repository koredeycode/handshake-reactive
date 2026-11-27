// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {HandshakeSupport, VenueConfig} from "script/HandshakeSupport.sol";

/// @notice Funds the single RC and all six escrows after venue registration.
///   - Lasna: SYSTEM.depositTo(RC)                         (default 1 lREACT)
///   - Each testnet: proxy.depositTo(payment escrow)       (default 0.02 ETH)
///                   proxy.depositTo(asset escrow)         (default 0.02 ETH)
///   PAYMENT_RPC / ASSET_RPC / SEPOLIA_RPC select the forks; FundScript has no forks
///   of its own, it delegates to HandshakeSupport.fundAll(), which uses the same helpers.
///
/// All addresses and amounts come from the environment; signing uses Foundry's
/// keystore account selected by `--account`. No private key appears in source.
///
///   forge script script/Fund.s.sol:FundScript --rpc-url $REACTIVE_RPC \
///     --account main --broadcast --slow
contract FundScript is Script {
    function run() external {
        address rc = HandshakeSupport.VM.envAddress("RC_ADDRESS");

        VenueConfig[] memory venues = new VenueConfig[](3);
        venues[0] = VenueConfig({
            chainId: HandshakeSupport.paymentChainId(),
            proxy: HandshakeSupport.paymentCallbackProxy(),
            paymentEscrow: HandshakeSupport.VM.envAddress("PAYMENT_ESCROW_ADDRESS"),
            assetEscrow: HandshakeSupport.VM.envAddress("ASSET_ESCROW_ADDRESS"),
            rpc: HandshakeSupport.paymentRpc()
        });
        venues[1] = VenueConfig({
            chainId: HandshakeSupport.assetChainId(),
            proxy: HandshakeSupport.assetCallbackProxy(),
            paymentEscrow: HandshakeSupport.VM.envAddress("UNICHAIN_PAYMENT_ESCROW_ADDRESS"),
            assetEscrow: HandshakeSupport.VM.envAddress("UNICHAIN_ASSET_ESCROW_ADDRESS"),
            rpc: HandshakeSupport.assetRpc()
        });
        venues[2] = VenueConfig({
            chainId: HandshakeSupport.sepoliaChainId(),
            proxy: HandshakeSupport.sepoliaCallbackProxy(),
            paymentEscrow: HandshakeSupport.VM.envAddress("SEPOLIA_PAYMENT_ESCROW_ADDRESS"),
            assetEscrow: HandshakeSupport.VM.envAddress("SEPOLIA_ASSET_ESCROW_ADDRESS"),
            rpc: HandshakeSupport.sepoliaRpc()
        });

        HandshakeSupport.fundAll(rc, venues);
    }
}
