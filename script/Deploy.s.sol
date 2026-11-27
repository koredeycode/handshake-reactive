// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {HandshakeSupport, IHandshakeReactive, VenueConfig} from "script/HandshakeSupport.sol";

/// @notice Deploys the full Option B system: one RC on Lasna, two test tokens and two
///         token-agnostic escrows on each of three testnets, then registers all venues.
///   1. HandshakeReactive on Lasna (payable, lightly funded)
///   2. Test tokens per chain (defaults: TestUSD + TestAsset; env overrides accepted)
///   3. PaymentEscrow / AssetEscrow per chain, with the RC as callback sender
///   4. RC.setVenue(chainId, paymentEscrow, assetEscrow) x3 — 19 subscriptions total
///   5. Optional funding via AUTO_FUND=1 (normally run script/Fund.s.sol next)
///
/// Run with Foundry's keystore account; no private key is read by this script:
///   forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
///     --account main --slow
/// Broadcast is per fork: forks must be switched outside an active broadcast.
contract DeployScript is Script {
    struct ChainDeploy {
        VenueConfig venue;
        address paymentToken;
        address assetToken;
    }

    function run() external {
        string memory lazyRpc = HandshakeSupport.rpc("REACTIVE_RPC");
        uint256 lazyFork = HandshakeSupport.selectFork(lazyRpc);

        // 1. RC first — no subscriptions can be installed until the escrows exist.
        address rc = HandshakeSupport.envAddressOr("RC_ADDRESS", address(0));
        if (rc == address(0)) {
            uint256 value = HandshakeSupport.VM.envOr("RC_DEPLOY_VALUE_WEI", uint256(0.05 ether));
            HandshakeSupport.VM.startBroadcast();
            rc = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("RC_ARTIFACT", string("src/HandshakeReactive.sol:HandshakeReactive")),
                "",
                value
            );
            HandshakeSupport.VM.stopBroadcast();
        }
        require(rc != address(0), "DeployScript: RC is zero");

        // 2-3. Tokens + escrows per chain. All four contracts on a chain are deployed
        //      inside one broadcast session so CREATE nonces cannot collide.
        ChainDeploy memory base = _deployVenue(
            rc,
            HandshakeSupport.paymentChainId(),
            HandshakeSupport.paymentCallbackProxy(),
            HandshakeSupport.paymentRpc(),
            "PAYMENT_TOKEN_ADDRESS",
            "PAYMENT_TOKEN_ARTIFACT",
            "src/tokens/TestUSD.sol:TestUSD",
            "PAYMENT_ASSET_TOKEN_ADDRESS",
            "src/tokens/TestAsset.sol:TestAsset",
            "PAYMENT_ESCROW_ADDRESS",
            "PAYMENT_ASSET_ESCROW_ADDRESS"
        );
        ChainDeploy memory unichain = _deployVenue(
            rc,
            HandshakeSupport.assetChainId(),
            HandshakeSupport.assetCallbackProxy(),
            HandshakeSupport.assetRpc(),
            "ASSET_TOKEN_ADDRESS",
            "ASSET_TOKEN_ARTIFACT",
            "src/tokens/TestAsset.sol:TestAsset",
            "UNICHAIN_ASSET_TOKEN_ADDRESS",
            "src/tokens/TestUSD.sol:TestUSD",
            "UNICHAIN_PAYMENT_ESCROW_ADDRESS",
            "UNICHAIN_ASSET_ESCROW_ADDRESS"
        );
        ChainDeploy memory sepolia = _deployVenue(
            rc,
            HandshakeSupport.sepoliaChainId(),
            HandshakeSupport.sepoliaCallbackProxy(),
            HandshakeSupport.sepoliaRpc(),
            "SEPOLIA_PAYMENT_TOKEN_ADDRESS",
            "SEPOLIA_PAYMENT_TOKEN_ARTIFACT",
            "src/tokens/TestUSD.sol:TestUSD",
            "SEPOLIA_ASSET_TOKEN_ADDRESS",
            "src/tokens/TestAsset.sol:TestAsset",
            "SEPOLIA_PAYMENT_ESCROW_ADDRESS",
            "SEPOLIA_ASSET_ESCROW_ADDRESS"
        );

        VenueConfig[] memory venues = new VenueConfig[](3);
        venues[0] = base.venue;
        venues[1] = unichain.venue;
        venues[2] = sepolia.venue;

        // 4. Subscriptions — one set of six topics per chain plus a single Cron10.
        HandshakeSupport.VM.selectFork(lazyFork);
        for (uint256 i = 0; i < venues.length; ++i) {
            VenueConfig memory v = venues[i];
            (,, bool registered) = IHandshakeReactive(rc).venue(v.chainId);
            if (!registered) {
                HandshakeSupport.VM.startBroadcast();
                IHandshakeReactive(rc).setVenue(v.chainId, v.paymentEscrow, v.assetEscrow);
                HandshakeSupport.VM.stopBroadcast();
                emit VenueRegistered(v.chainId, v.paymentEscrow, v.assetEscrow);
            } else {
                console2.log("DeployScript: venue already registered for chain", v.chainId);
            }
        }
        require(IHandshakeReactive(rc).subscriptionCount() == 19, "DeployScript: expected 19 subscriptions");

        // Persist addresses so Fund / TS utilities can pick them up.
        HandshakeSupport.VM.setEnv(
            "SEPOLIA_PAYMENT_TOKEN_ADDRESS", HandshakeSupport.VM.toString(sepolia.paymentToken)
        );
        HandshakeSupport.VM.setEnv("SEPOLIA_ASSET_TOKEN_ADDRESS", HandshakeSupport.VM.toString(sepolia.assetToken));
        HandshakeSupport.VM.setEnv(
            "SEPOLIA_PAYMENT_ESCROW_ADDRESS", HandshakeSupport.VM.toString(sepolia.venue.paymentEscrow)
        );
        HandshakeSupport.VM.setEnv(
            "SEPOLIA_ASSET_ESCROW_ADDRESS", HandshakeSupport.VM.toString(sepolia.venue.assetEscrow)
        );
        console2.log("MANIFEST:", HandshakeSupport.manifest(rc, base.paymentToken, unichain.assetToken, base.venue.paymentEscrow, unichain.venue.assetEscrow));

        emit Deployed(HandshakeSupport.reactiveChainId(), rc);
        for (uint256 i = 0; i < venues.length; ++i) {
            emit Deployed(venues[i].chainId, venues[i].paymentEscrow);
            emit Deployed(venues[i].chainId, venues[i].assetEscrow);
        }

        // 5. Optional funding. Default off: prefer the explicit Fund.s.sol step.
        if (keccak256(bytes(HandshakeSupport.VM.envOr("AUTO_FUND", string("0")))) == keccak256("1")) {
            HandshakeSupport.fundAll(rc, venues);
        }
    }

    /// @notice Deploys both tokens and both escrows on one chain in a single broadcast.
    function _deployVenue(
        address rc_,
        uint256 chainId_,
        address proxy_,
        string memory rpc_,
        string memory paymentTokenEnv_,
        string memory paymentArtifactEnv_,
        string memory paymentArtifactDefault_,
        string memory assetTokenEnv_,
        string memory assetArtifact_,
        string memory paymentEscrowEnv_,
        string memory assetEscrowEnv_
    ) internal returns (ChainDeploy memory result_) {
        HandshakeSupport.selectFork(rpc_);
        HandshakeSupport.VM.startBroadcast();

        address paymentToken = HandshakeSupport.envAddressOr(paymentTokenEnv_, address(0));
        if (paymentToken == address(0)) {
            paymentToken = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr(paymentArtifactEnv_, paymentArtifactDefault_), "", 0
            );
        }
        address assetToken = HandshakeSupport.envAddressOr(assetTokenEnv_, address(0));
        if (assetToken == address(0)) {
            assetToken = HandshakeSupport.deploy(assetArtifact_, "", 0);
        }
        address paymentEscrow = HandshakeSupport.envAddressOr(paymentEscrowEnv_, address(0));
        if (paymentEscrow == address(0)) {
            paymentEscrow = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("PAYMENT_ESCROW_ARTIFACT", string("src/PaymentEscrow.sol:PaymentEscrow")),
                abi.encode(proxy_, rc_),
                0
            );
        }
        address assetEscrow = HandshakeSupport.envAddressOr(assetEscrowEnv_, address(0));
        if (assetEscrow == address(0)) {
            assetEscrow = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("ASSET_ESCROW_ARTIFACT", string("src/AssetEscrow.sol:AssetEscrow")),
                abi.encode(proxy_, rc_),
                0
            );
        }
        HandshakeSupport.VM.stopBroadcast();

        require(
            paymentToken != address(0) && assetToken != address(0) && paymentEscrow != address(0)
                && assetEscrow != address(0) && paymentEscrow != assetEscrow,
            "DeployScript: venue is zero or duplicated"
        );
        result_.venue = VenueConfig({
            chainId: chainId_,
            proxy: proxy_,
            paymentEscrow: paymentEscrow,
            assetEscrow: assetEscrow,
            rpc: rpc_
        });
        result_.paymentToken = paymentToken;
        result_.assetToken = assetToken;
        emit Deployed(chainId_, paymentToken);
        emit Deployed(chainId_, assetToken);
    }

    event Deployed(uint256 chainId, address contractAddress);
    event VenueRegistered(uint256 chainId, address paymentEscrow, address assetEscrow);
}
