// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Demo payment token deployed on Base Sepolia (chain 84532).
/// @dev Public mint is intentional: these are worthless testnet tokens used only for the demo.
contract TestUSD is ERC20 {
    constructor() ERC20("Test USD", "tUSD") {}

    function mint(address to_, uint256 amount_) external {
        _mint(to_, amount_);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
