// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {HandshakeSupport} from "../script/HandshakeSupport.sol";

/// @dev Covers the leg RPC selectors without any fork or broadcast. All env
///      mutations live in one test so results cannot depend on test order
///      (vm.setEnv with an empty value is a no-op in some Foundry versions).
///      Chain/proxy overrides are intentionally NOT mutated here: Foundry's env
///      cache is process-global and would perturb ManifestTest's exact assertion.
contract ScriptOverridesTest is Test {
    function setUp() public {
        vm.setEnv("BASE_RPC", "https://sepolia.base.org");
        vm.setEnv("UNICHAIN_RPC", "https://sepolia.unichain.org");
        vm.setEnv("SEPOLIA_RPC", "https://sepolia.gateway.tenderly.co");
    }

    function testRpcSelectorsAndOverrides() public {
        // No PAYMENT_RPC / ASSET_RPC override: fall back to BASE_RPC / UNICHAIN_RPC.
        vm.setEnv("PAYMENT_RPC", "__unset__");
        vm.setEnv("ASSET_RPC", "__unset__");
        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.base.org");
        assertEq(HandshakeSupport.assetRpc(), "https://sepolia.unichain.org");

        // Explicit leg overrides win.
        vm.setEnv("PAYMENT_RPC", "https://sepolia.unichain.org");
        vm.setEnv("ASSET_RPC", "https://sepolia.base.org");
        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.unichain.org");
        assertEq(HandshakeSupport.assetRpc(), "https://sepolia.base.org");

        // Reset with the sentinel so a later test sees the fallback again.
        vm.setEnv("PAYMENT_RPC", "__unset__");
        vm.setEnv("ASSET_RPC", "__unset__");
        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.base.org");
        assertEq(HandshakeSupport.assetRpc(), "https://sepolia.unichain.org");
    }
}
