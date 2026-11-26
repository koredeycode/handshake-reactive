// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Vm.sol";

// All Solidity-side ABIs, network constants and shared script actions live here.
// Keep this file as the single place to adjust after the contract branch is merged.
// The TypeScript mirror is `ts/abis.ts` + `ts/networks.ts`.

uint256 constant REACTIVE_CHAIN_ID = 5318007;
uint256 constant PAYMENT_CHAIN_ID = 84532;
uint256 constant ASSET_CHAIN_ID = 1301;

address constant SYSTEM_CONTRACT = 0x8888888888888888888888888888888888888888;
address constant BASE_CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
address constant UNICHAIN_CALLBACK_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;

/// @notice Minimal RC surface needed by deployment scripts.
interface IHandshakeReactive {
    function setVenues(uint256 paymentChainId_, address paymentEscrow_, uint256 assetChainId_, address assetEscrow_) external;

    function createOrder(
        bytes32 orderId_,
        address seller_,
        address paymentToken_,
        uint256 paymentAmount_,
        address assetToken_,
        uint256 assetAmount_,
        uint256 durationSeconds_
    ) external;

    function retry(bytes32 orderId_) external;
    function coverDebt() external;
    function orderCount() external view returns (uint256);
}

/// @notice The payer interface exposed by both the SYSTEM contract and callback proxies.
/// @dev `depositTo` and `reserves` are not in reactive-lib-omni's IPayable, so they are
///      declared here with their canonical signatures instead of hardcoding calldata everywhere.
interface IFundingContract {
    function debt(address contract_) external view returns (uint256);
    function depositTo(address contract_) external payable;
    function reserves(address contract_) external view returns (uint256);
}

library HandshakeSupport {
    Vm internal constant VM = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    /// @notice Reads a required RPC URL from the environment.
    function rpc(string memory envName_) internal view returns (string memory) {
        return VM.envString(envName_);
    }

    /// @notice Creates and selects a fork for the given RPC URL.
    function selectFork(string memory url_) internal returns (uint256 forkId) {
        forkId = VM.createFork(url_);
        VM.selectFork(forkId);
    }

    /// @notice Deploys a compiled artifact with constructor args appended to its creation bytecode.
    /// @dev Uses vm.getCode so the scripts compile before the contract sources are merged.
    function deploy(string memory artifact_, bytes memory constructorArgs_, uint256 value_) internal returns (address deployed) {
        bytes memory creationCode = abi.encodePacked(VM.getCode(artifact_), constructorArgs_);
        uint256 length = creationCode.length;
        VM.broadcast();
        assembly {
            deployed := create(value_, add(creationCode, 0x20), length)
        }
        VM.stopBroadcast();
        require(deployed != address(0), string.concat("HandshakeSupport: deployment failed for ", artifact_));
    }

    /// @notice Returns an env-provided address, or `default_` when the variable is unset.
    function envAddressOr(string memory envName_, address default_) internal view returns (address) {
        return VM.envOr(envName_, default_);
    }

    /// @notice Reads a uint from a contract with a graceful fallback for optional view methods.
    function readUint(address target_, bytes memory callData_) internal view returns (uint256 value, bool ok) {
        (bool success, bytes memory result) = target_.staticcall(callData_);
        if (success && result.length >= 32) {
            return (abi.decode(result, (uint256)), true);
        }
        return (0, false);
    }

    /// @notice Funds the RC on Lasna and both escrows at their callback proxies, then asserts debt == 0.
    /// @dev Strictly follows PRD §11.5: SYSTEM.depositTo(RC), then proxy depositTo(escrow) on each chain.
    function fundAll(address rc_, address paymentEscrow_, address assetEscrow_) internal {
        require(rc_ != address(0) && paymentEscrow_ != address(0) && assetEscrow_ != address(0), "HandshakeSupport: addresses required");

        uint256 rcAmount = VM.envOr("RC_FUND_AMOUNT_WEI", uint256(1 ether));
        uint256 paymentAmount = VM.envOr("PAYMENT_RESERVE_WEI", uint256(0.02 ether));
        uint256 assetAmount = VM.envOr("ASSET_RESERVE_WEI", uint256(0.02 ether));

        selectFork(rpc("REACTIVE_RPC"));
        VM.broadcast();
        IFundingContract(SYSTEM_CONTRACT).depositTo{value: rcAmount}(rc_);
        VM.stopBroadcast();

        selectFork(rpc("BASE_RPC"));
        VM.broadcast();
        IFundingContract(BASE_CALLBACK_PROXY).depositTo{value: paymentAmount}(paymentEscrow_);
        VM.stopBroadcast();

        selectFork(rpc("UNICHAIN_RPC"));
        VM.broadcast();
        IFundingContract(UNICHAIN_CALLBACK_PROXY).depositTo{value: assetAmount}(assetEscrow_);
        VM.stopBroadcast();

        // Verify health on each chain before returning.
        selectFork(rpc("REACTIVE_RPC"));
        require(IFundingContract(SYSTEM_CONTRACT).debt(rc_) == 0, "HandshakeSupport: RC still in debt");
        selectFork(rpc("BASE_RPC"));
        require(IFundingContract(BASE_CALLBACK_PROXY).debt(paymentEscrow_) == 0, "HandshakeSupport: payment escrow still in debt");
        selectFork(rpc("UNICHAIN_RPC"));
        require(IFundingContract(UNICHAIN_CALLBACK_PROXY).debt(assetEscrow_) == 0, "HandshakeSupport: asset escrow still in debt");
    }

    /// @notice Builds the JSON manifest consumed by the TypeScript tooling.
    function manifest(address rc_, address paymentToken_, address assetToken_, address paymentEscrow_, address assetEscrow_)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            "{\n",
            '  "chainIds": {"lasna": 5318007, "baseSepolia": 84532, "unichainSepolia": 1301},\n',
            '  "systemContract": "', VM.toString(SYSTEM_CONTRACT), '",\n',
            '  "callbackProxies": {"84532": "', VM.toString(BASE_CALLBACK_PROXY), '", "1301": "', VM.toString(UNICHAIN_CALLBACK_PROXY), '"},\n',
            '  "reactive": "', VM.toString(rc_), '",\n',
            '  "paymentToken": "', VM.toString(paymentToken_), '",\n',
            '  "assetToken": "', VM.toString(assetToken_), '",\n',
            '  "paymentEscrow": "', VM.toString(paymentEscrow_), '",\n',
            '  "assetEscrow": "', VM.toString(assetEscrow_), '"\n',
            "}\n"
        );
    }
}
