// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {HandshakeSupport} from "../script/HandshakeSupport.sol";

contract ManifestTest is Test {
    function testDefaultManifestUnchanged() public view {
        address rc = address(0x1111111111111111111111111111111111111111);
        address pt = address(0x2222222222222222222222222222222222222222);
        address at = address(0x3333333333333333333333333333333333333333);
        address pe = address(0x4444444444444444444444444444444444444444);
        address ae = address(0x5555555555555555555555555555555555555555);
        string memory expected = string.concat(
            "{\n",
            '  "chainIds": {"lasna": 5318007, "baseSepolia": 84532, "unichainSepolia": 1301},\n',
            '  "systemContract": "0x8888888888888888888888888888888888888888",\n',
            '  "callbackProxies": {"84532": "0x476F44b11F5C942c58f4c8E3d0300E5710743585", "1301": "0x775c9B990ADe401060B78D0e98684eEf8d2466C1"},\n',
            '  "reactive": "0x1111111111111111111111111111111111111111",\n',
            '  "paymentToken": "0x2222222222222222222222222222222222222222",\n',
            '  "assetToken": "0x3333333333333333333333333333333333333333",\n',
            '  "paymentEscrow": "0x4444444444444444444444444444444444444444",\n',
            '  "assetEscrow": "0x5555555555555555555555555555555555555555"\n',
            "}\n"
        );
        assertEq(HandshakeSupport.manifest(rc, pt, at, pe, ae), expected);
    }
}
