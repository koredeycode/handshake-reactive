// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {HandshakeSupport} from "../script/HandshakeSupport.sol";

contract ManifestTest is Test {
    function setUp() public {
        _resetEnv();
    }

    /// @dev vm.setEnv is process-global; pin every value manifest() reads so this exact
    ///      string assertion cannot be perturbed by another suite's overrides.
    function _resetEnv() internal {
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

    function testDefaultManifestUnchanged() public view {
        address rc = address(0x1111111111111111111111111111111111111111);
        address pt = address(0x2222222222222222222222222222222222222222);
        address at = address(0x3333333333333333333333333333333333333333);
        address pe = address(0x4444444444444444444444444444444444444444);
        address ae = address(0x5555555555555555555555555555555555555555);
        string memory expected = string.concat(
            "{\n",
            '  "chainIds": {"lasna": 5318007, "baseSepolia": 84532, "unichainSepolia": 1301, "ethereumSepolia": 11155111},\n',
            '  "systemContract": "0x8888888888888888888888888888888888888888",\n',
            '  "callbackProxies": {"84532": "0x476F44b11F5C942c58f4c8E3d0300E5710743585", "1301": "0x775c9B990ADe401060B78D0e98684eEf8d2466C1", "11155111": "0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4"},\n',
            '  "reactive": "0x1111111111111111111111111111111111111111",\n',
            '  "paymentToken": "0x2222222222222222222222222222222222222222",\n',
            '  "assetToken": "0x3333333333333333333333333333333333333333",\n',
            '  "paymentEscrow": "0x4444444444444444444444444444444444444444",\n',
            '  "assetEscrow": "0x5555555555555555555555555555555555555555",\n',
            '  "sepoliaPaymentToken": "0x0000000000000000000000000000000000001111",\n',
            '  "sepoliaAssetToken": "0x0000000000000000000000000000000000002222",\n',
            '  "sepoliaPaymentEscrow": "0x0000000000000000000000000000000000003333",\n',
            '  "sepoliaAssetEscrow": "0x0000000000000000000000000000000000004444"\n',
            "}\n"
        );
        assertEq(HandshakeSupport.manifest(rc, pt, at, pe, ae), expected);
    }
}
