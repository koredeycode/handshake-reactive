// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {HandshakeSupport} from "../script/HandshakeSupport.sol";

/// @dev Covers the reverse-market selectors without any fork or broadcast: only the
///      env-driven helper values and the manifest mapping are asserted here.
contract ScriptOverridesTest is Test {
    function setUp() public {
        _resetEnv();
    }

    /// @dev Pin every env value these helpers read so results are order-independent.
    function _resetEnv() internal {
        vm.setEnv("BASE_RPC", "https://sepolia.base.org");
        vm.setEnv("UNICHAIN_RPC", "https://sepolia.unichain.org");
        vm.setEnv("PAYMENT_RPC", ""); // empty == unset for the leg selectors
        vm.setEnv("ASSET_RPC", "");
        vm.setEnv("SEPOLIA_RPC", "");
        vm.setEnv("REACTIVE_CHAIN_ID_OVERRIDE", "5318007");
        vm.setEnv("PAYMENT_CHAIN_ID_OVERRIDE", "84532");
        vm.setEnv("ASSET_CHAIN_ID_OVERRIDE", "1301");
        vm.setEnv("SEPOLIA_CHAIN_ID_OVERRIDE", "11155111");
        vm.setEnv("PAYMENT_PROXY_OVERRIDE", "0x476F44b11F5C942c58f4c8E3d0300E5710743585");
        vm.setEnv("ASSET_PROXY_OVERRIDE", "0x775c9B990ADe401060B78D0e98684eEf8d2466C1");
        vm.setEnv("SEPOLIA_PROXY_OVERRIDE", "0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4");
        vm.setEnv("SEPOLIA_PAYMENT_TOKEN_ADDRESS", "0x0000000000000000000000000000000000001111");
        vm.setEnv("SEPOLIA_ASSET_TOKEN_ADDRESS", "0x0000000000000000000000000000000000002222");
        vm.setEnv("SEPOLIA_PAYMENT_ESCROW_ADDRESS", "0x0000000000000000000000000000000000003333");
        vm.setEnv("SEPOLIA_ASSET_ESCROW_ADDRESS", "0x0000000000000000000000000000000000004444");
    }

    function testLegRpcHelpersFallBackToLegacyRpcEnvVars() public view {
        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.base.org");
        assertEq(HandshakeSupport.assetRpc(), "https://sepolia.unichain.org");
    }

    function testLegRpcHelpersSelectReverseMarketForks() public {
        vm.setEnv("PAYMENT_RPC", "https://sepolia.unichain.org");
        vm.setEnv("ASSET_RPC", "https://sepolia.base.org");

        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.unichain.org");
        assertEq(HandshakeSupport.assetRpc(), "https://sepolia.base.org");

        vm.setEnv("PAYMENT_RPC", "");
        vm.setEnv("ASSET_RPC", "");
        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.base.org");
        assertEq(HandshakeSupport.assetRpc(), "https://sepolia.unichain.org");
    }

    function testManifestAndChainProxyOverridesMapTheReverseMarket() public {
        vm.setEnv("PAYMENT_CHAIN_ID_OVERRIDE", "1301");
        vm.setEnv("ASSET_CHAIN_ID_OVERRIDE", "84532");
        vm.setEnv("PAYMENT_PROXY_OVERRIDE", "0x775c9B990ADe401060B78D0e98684eEf8d2466C1");
        vm.setEnv("ASSET_PROXY_OVERRIDE", "0x476F44b11F5C942c58f4c8E3d0300E5710743585");

        assertEq(HandshakeSupport.paymentChainId(), 1301);
        assertEq(HandshakeSupport.assetChainId(), 84532);
        assertEq(HandshakeSupport.paymentCallbackProxy(), 0x775c9B990ADe401060B78D0e98684eEf8d2466C1);
        assertEq(HandshakeSupport.assetCallbackProxy(), 0x476F44b11F5C942c58f4c8E3d0300E5710743585);
        assertEq(HandshakeSupport.paymentRpc(), "https://sepolia.base.org"); // independent of chain overrides

        string memory manifest_ = HandshakeSupport.manifest(
            address(0x1111111111111111111111111111111111111111),
            address(0x2222222222222222222222222222222222222222),
            address(0x3333333333333333333333333333333333333333),
            address(0x4444444444444444444444444444444444444444),
            address(0x5555555555555555555555555555555555555555)
        );
        assertTrue(
            _contains(
                manifest_,
                '"chainIds": {"lasna": 5318007, "baseSepolia": 1301, "unichainSepolia": 84532, "ethereumSepolia": 11155111}'
            )
        );
        assertTrue(
            _contains(
                manifest_,
                '"callbackProxies": {"1301": "0x775c9B990ADe401060B78D0e98684eEf8d2466C1", "84532": "0x476F44b11F5C942c58f4c8E3d0300E5710743585", "11155111": "0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4"}'
            )
        );
        assertTrue(_contains(manifest_, '"sepoliaPaymentEscrow": "0x0000000000000000000000000000000000003333"'));

        // Restore canonical defaults so the default-manifest regression is order-independent.
        _resetEnv();
    }

    function _contains(string memory haystack_, string memory needle_) internal pure returns (bool) {
        bytes memory haystack = bytes(haystack_);
        bytes memory needle = bytes(needle_);
        if (needle.length > haystack.length) return false;
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            bool same = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    same = false;
                    break;
                }
            }
            if (same) return true;
        }
        return false;
    }
}
