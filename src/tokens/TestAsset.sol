// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Demo asset token deployed on Unichain Sepolia (chain 1301).
/// @dev Public mint is intentional: these are worthless testnet tokens used only for the demo.
contract TestAsset is ERC20 {
    constructor() ERC20("Test Asset", "tASSET") {}

    function mint(address to_, uint256 amount_) external {
        _mint(to_, amount_);
    }
}
