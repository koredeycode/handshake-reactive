// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Vm.sol";

// All Solidity-side ABIs, network constants and shared script actions live here.
// Keep this file as the single place to adjust after the contract branch is merged.
// The TypeScript mirror is `ts/abis.ts` + `ts/networks.ts`.

uint256 constant REACTIVE_CHAIN_ID = 5318007;
uint256 constant PAYMENT_CHAIN_ID = 84532;
uint256 constant ASSET_CHAIN_ID = 1301;
uint256 constant SEPOLIA_CHAIN_ID = 11155111;

address constant SYSTEM_CONTRACT = 0x8888888888888888888888888888888888888888;
address constant BASE_CALLBACK_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
address constant UNICHAIN_CALLBACK_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
address constant SEPOLIA_CALLBACK_PROXY = 0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4;

/// @notice Minimal RC surface needed by deployment scripts.
interface IHandshakeReactive {
    function setVenue(uint256 chainId_, address paymentEscrow_, address assetEscrow_) external;

    function createOrder(
        bytes32 orderId_,
        address seller_,
        address paymentToken_,
        uint256 paymentAmount_,
        uint256 paymentChainId_,
        address paymentEscrow_,
        address assetToken_,
        uint256 assetAmount_,
        uint256 assetChainId_,
        address assetEscrow_,
        uint256 durationSeconds_
    ) external;

    function venue(uint256 chainId_) external view returns (address paymentEscrow, address assetEscrow, bool registered);

    function retry(bytes32 orderId_) external;
    function coverDebt() external;
    function orderCount() external view returns (uint256);
    function registeredChainIds() external view returns (uint256[] memory);
    function subscriptionCount() external view returns (uint256);
}

/// @notice The payer interface exposed by both the SYSTEM contract and callback proxies.
/// @dev `depositTo` and `reserves` are not in reactive-lib-omni's IPayable, so they are
///      declared here with their canonical signatures instead of hardcoding calldata everywhere.
interface IFundingContract {
    function debt(address contract_) external view returns (uint256);
    function depositTo(address contract_) external payable;
    function reserves(address contract_) external view returns (uint256);
}

/// @notice One chain's deployed venue, used by fundAll and the deploy script.
struct VenueConfig {
    uint256 chainId;
    address proxy;
    address paymentEscrow;
    address assetEscrow;
    string rpc;
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
        assembly {
            deployed := create(value_, add(creationCode, 0x20), length)
        }
        require(deployed != address(0), string.concat("HandshakeSupport: deployment failed for ", artifact_));
    }

    /// @notice Returns an env-provided address, or `default_` when the variable is unset.
    function envAddressOr(string memory envName_, address default_) internal view returns (address) {
        return VM.envOr(envName_, default_);
    }

    /// @notice Market parameters. Env overrides let a new market reuse these scripts
    ///         without editing constants; defaults are the current live testnet values.
    function reactiveChainId() internal view returns (uint256) {
        return VM.envOr("REACTIVE_CHAIN_ID_OVERRIDE", REACTIVE_CHAIN_ID);
    }

    function paymentChainId() internal view returns (uint256) {
        return VM.envOr("PAYMENT_CHAIN_ID_OVERRIDE", PAYMENT_CHAIN_ID);
    }

    function assetChainId() internal view returns (uint256) {
        return VM.envOr("ASSET_CHAIN_ID_OVERRIDE", ASSET_CHAIN_ID);
    }

    function sepoliaChainId() internal view returns (uint256) {
        return VM.envOr("SEPOLIA_CHAIN_ID_OVERRIDE", SEPOLIA_CHAIN_ID);
    }

    function paymentCallbackProxy() internal view returns (address) {
        return VM.envOr("PAYMENT_PROXY_OVERRIDE", BASE_CALLBACK_PROXY);
    }

    function assetCallbackProxy() internal view returns (address) {
        return VM.envOr("ASSET_PROXY_OVERRIDE", UNICHAIN_CALLBACK_PROXY);
    }

    function sepoliaCallbackProxy() internal view returns (address) {
        return VM.envOr("SEPOLIA_PROXY_OVERRIDE", SEPOLIA_CALLBACK_PROXY);
    }

    /// @notice RPC endpoint for each leg. PAYMENT_RPC / ASSET_RPC / SEPOLIA_RPC let a
    ///         market point at the correct chains without repurposing legacy variable names.
    function paymentRpc() internal view returns (string memory) {
        if (VM.envExists("PAYMENT_RPC")) {
            string memory override_ = VM.envString("PAYMENT_RPC");
            if (bytes(override_).length != 0) return override_;
        }
        return rpc("BASE_RPC");
    }

    function assetRpc() internal view returns (string memory) {
        if (VM.envExists("ASSET_RPC")) {
            string memory override_ = VM.envString("ASSET_RPC");
            if (bytes(override_).length != 0) return override_;
        }
        return rpc("UNICHAIN_RPC");
    }

    function sepoliaRpc() internal view returns (string memory) {
        if (VM.envExists("SEPOLIA_RPC")) {
            string memory override_ = VM.envString("SEPOLIA_RPC");
            if (bytes(override_).length != 0) return override_;
        }
        return rpc("ETHEREUM_SEPOLIA_RPC");
    }

    /// @notice Reads a uint from a contract with a graceful fallback for optional view methods.
    function readUint(address target_, bytes memory callData_) internal view returns (uint256 value, bool ok) {
        (bool success, bytes memory result) = target_.staticcall(callData_);
        if (success && result.length >= 32) {
            return (abi.decode(result, (uint256)), true);
        }
        return (0, false);
    }

    /// @notice Funds the RC on Lasna and every escrow at its chain's callback proxy,
    ///         then asserts debt == 0 everywhere.
    function fundAll(address rc_, VenueConfig[] memory venues_) internal {
        require(rc_ != address(0), "HandshakeSupport: RC required");
        require(venues_.length != 0, "HandshakeSupport: venues required");

        uint256 rcAmount = VM.envOr("RC_FUND_AMOUNT_WEI", uint256(1 ether));
        uint256 baseReserve = VM.envOr("PAYMENT_RESERVE_WEI", uint256(0.02 ether));
        uint256 sepoliaReserve = VM.envOr("SEPOLIA_RESERVE_WEI", uint256(0.02 ether));

        uint256 reactiveFork = selectFork(rpc("REACTIVE_RPC"));
        VM.startBroadcast();
        IFundingContract(SYSTEM_CONTRACT).depositTo{value: rcAmount}(rc_);
        VM.stopBroadcast();

        for (uint256 i = 0; i < venues_.length; ++i) {
            VenueConfig memory v = venues_[i];
            require(v.paymentEscrow != address(0) && v.assetEscrow != address(0), "HandshakeSupport: escrow required");
            uint256 amount = v.chainId == SEPOLIA_CHAIN_ID ? sepoliaReserve : baseReserve;
            amount = VM.envOr(string.concat("RESERVE_WEI_", VM.toString(v.chainId)), amount);

            selectFork(v.rpc);
            VM.startBroadcast();
            IFundingContract(v.proxy).depositTo{value: amount}(v.paymentEscrow);
            IFundingContract(v.proxy).depositTo{value: amount}(v.assetEscrow);
            VM.stopBroadcast();

            require(IFundingContract(v.proxy).debt(v.paymentEscrow) == 0, "HandshakeSupport: payment escrow still in debt");
            require(IFundingContract(v.proxy).debt(v.assetEscrow) == 0, "HandshakeSupport: asset escrow still in debt");
        }

        VM.selectFork(reactiveFork);
        require(IFundingContract(SYSTEM_CONTRACT).debt(rc_) == 0, "HandshakeSupport: RC still in debt");
    }

    /// @notice Builds the JSON manifest consumed by the TypeScript tooling.
    /// @dev Sepolia addresses come from env (or zero when not deployed yet).
    function manifest(address rc_, address paymentToken_, address assetToken_, address paymentEscrow_, address assetEscrow_)
        internal
        view
        returns (string memory)
    {
        address sepoliaToken = VM.envOr("SEPOLIA_PAYMENT_TOKEN_ADDRESS", address(0));
        address sepoliaAsset = VM.envOr("SEPOLIA_ASSET_TOKEN_ADDRESS", address(0));
        address sepoliaPaymentEscrow = VM.envOr("SEPOLIA_PAYMENT_ESCROW_ADDRESS", address(0));
        address sepoliaAssetEscrow = VM.envOr("SEPOLIA_ASSET_ESCROW_ADDRESS", address(0));

        return string.concat(
            _manifestNetworks(),
            '  "reactive": "', VM.toString(rc_), '",\n',
            '  "paymentToken": "', VM.toString(paymentToken_), '",\n',
            '  "assetToken": "', VM.toString(assetToken_), '",\n',
            '  "paymentEscrow": "', VM.toString(paymentEscrow_), '",\n',
            '  "assetEscrow": "', VM.toString(assetEscrow_), '",\n',
            _manifestSepolia(sepoliaToken, sepoliaAsset, sepoliaPaymentEscrow, sepoliaAssetEscrow),
            "}\n"
        );
    }

    function _manifestNetworks() internal view returns (string memory) {
        return string.concat(
            "{\n",
            '  "chainIds": {"lasna": ', VM.toString(reactiveChainId()), ', "baseSepolia": ', VM.toString(paymentChainId()), ', "unichainSepolia": ', VM.toString(assetChainId()), ', "ethereumSepolia": ', VM.toString(sepoliaChainId()), '},\n',
            '  "systemContract": "', VM.toString(SYSTEM_CONTRACT), '",\n',
            '  "callbackProxies": {"', VM.toString(paymentChainId()), '": "', VM.toString(paymentCallbackProxy()), '", "', VM.toString(assetChainId()), '": "', VM.toString(assetCallbackProxy()), '", "', VM.toString(sepoliaChainId()), '": "', VM.toString(sepoliaCallbackProxy()), '"},\n'
        );
    }

    function _manifestSepolia(address token_, address asset_, address paymentEscrow_, address assetEscrow_)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '  "sepoliaPaymentToken": "', VM.toString(token_), '",\n',
            '  "sepoliaAssetToken": "', VM.toString(asset_), '",\n',
            '  "sepoliaPaymentEscrow": "', VM.toString(paymentEscrow_), '",\n',
            '  "sepoliaAssetEscrow": "', VM.toString(assetEscrow_), '"\n'
        );
    }
}
