// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {
    HandshakeSupport,
    IHandshakeReactive,
    BASE_CALLBACK_PROXY,
    UNICHAIN_CALLBACK_PROXY,
    REACTIVE_CHAIN_ID,
    PAYMENT_CHAIN_ID,
    ASSET_CHAIN_ID
} from "script/HandshakeSupport.sol";

/// @notice Deploys in the strict PRD §13 order:
///   1. HandshakeReactive on Lasna (payable, lightly funded)
///   2. TestUSD on Base Sepolia and TestAsset on Unichain Sepolia
///   3. PaymentEscrow / AssetEscrow with the RC address baked in
///   4. RC.setVenues(...) installing all subscriptions
///   5. Optional funding via AUTO_FUND=1 (normally run script/Fund.s.sol next)
///
/// Run with Foundry's keystore account; no private key is read by this script:
///   forge script script/Deploy.s.sol:DeployScript --rpc-url $REACTIVE_RPC \
///     --account handshake --broadcast --slow
contract DeployScript is Script {
    function run() external {
        string memory lazyRpc = HandshakeSupport.rpc("REACTIVE_RPC");
        string memory baseRpc = HandshakeSupport.rpc("BASE_RPC");
        string memory unichainRpc = HandshakeSupport.rpc("UNICHAIN_RPC");

        // 1. RC first — no subscriptions can be installed until the escrows exist.
        address rc = HandshakeSupport.envAddressOr("RC_ADDRESS", address(0));
        if (rc == address(0)) {
            HandshakeSupport.selectFork(lazyRpc);
            uint256 value = HandshakeSupport.VM.envOr("RC_DEPLOY_VALUE_WEI", uint256(0.05 ether));
            rc = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("RC_ARTIFACT", string("src/HandshakeReactive.sol:HandshakeReactive")),
                "",
                value
            );
        }

        // 2. Test tokens.
        address paymentToken = HandshakeSupport.envAddressOr("PAYMENT_TOKEN_ADDRESS", address(0));
        if (paymentToken == address(0)) {
            HandshakeSupport.selectFork(baseRpc);
            paymentToken = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("PAYMENT_TOKEN_ARTIFACT", string("src/tokens/TestUSD.sol:TestUSD")),
                "",
                0
            );
        }

        address assetToken = HandshakeSupport.envAddressOr("ASSET_TOKEN_ADDRESS", address(0));
        if (assetToken == address(0)) {
            HandshakeSupport.selectFork(unichainRpc);
            assetToken = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("ASSET_TOKEN_ARTIFACT", string("src/tokens/TestAsset.sol:TestAsset")),
                "",
                0
            );
        }

        require(rc != address(0), "DeployScript: RC is zero");
        require(paymentToken != address(0) && assetToken != address(0), "DeployScript: token is zero");

        // 3. Escrows — callbackSender_ is immutable, so the RC address must be exact.
        address paymentEscrow = HandshakeSupport.envAddressOr("PAYMENT_ESCROW_ADDRESS", address(0));
        if (paymentEscrow == address(0)) {
            HandshakeSupport.selectFork(baseRpc);
            paymentEscrow = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("PAYMENT_ESCROW_ARTIFACT", string("src/PaymentEscrow.sol:PaymentEscrow")),
                abi.encode(BASE_CALLBACK_PROXY, rc, paymentToken),
                0
            );
        }

        address assetEscrow = HandshakeSupport.envAddressOr("ASSET_ESCROW_ADDRESS", address(0));
        if (assetEscrow == address(0)) {
            HandshakeSupport.selectFork(unichainRpc);
            assetEscrow = HandshakeSupport.deploy(
                HandshakeSupport.VM.envOr("ASSET_ESCROW_ARTIFACT", string("src/AssetEscrow.sol:AssetEscrow")),
                abi.encode(UNICHAIN_CALLBACK_PROXY, rc, assetToken),
                0
            );
        }

        require(paymentEscrow != address(0) && assetEscrow != address(0), "DeployScript: escrow is zero");

        // 4. Subscriptions — only now are both escrow addresses known.
        HandshakeSupport.selectFork(lazyRpc);
        HandshakeSupport.VM.broadcast();
        IHandshakeReactive(rc).setVenues(PAYMENT_CHAIN_ID, paymentEscrow, ASSET_CHAIN_ID, assetEscrow);
        HandshakeSupport.VM.stopBroadcast();

        // Persist addresses so Fund / TS utilities can pick them up.
        HandshakeSupport.VM.writeFile(
            HandshakeSupport.VM.envOr("DEPLOYMENT_MANIFEST", string("deployments.json")),
            HandshakeSupport.manifest(rc, paymentToken, assetToken, paymentEscrow, assetEscrow)
        );

        // HandshakeSupport.VM.log cannot format addresses conveniently; console2 can.
        emit Deployed(REACTIVE_CHAIN_ID, rc);
        emit Deployed(PAYMENT_CHAIN_ID, paymentToken);
        emit Deployed(ASSET_CHAIN_ID, assetToken);
        emit Deployed(PAYMENT_CHAIN_ID, paymentEscrow);
        emit Deployed(ASSET_CHAIN_ID, assetEscrow);

        // 5. Optional funding. Default off: prefer the explicit Fund.s.sol step.
        if (keccak256(bytes(HandshakeSupport.VM.envOr("AUTO_FUND", string("0")))) == keccak256("1")) {
            HandshakeSupport.fundAll(rc, paymentEscrow, assetEscrow);
        }
    }

    event Deployed(uint256 chainId, address contractAddress);
}
