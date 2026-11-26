// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";

/// @dev Minimal stand-in for the Lasna system contract, etched at 0x8888…8888.
///      Records subscription and callback requests so tests can assert them.
contract MockSystemContract {
    struct CallbackCall {
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    struct Subscription {
        uint256 chainId;
        address contractAddress;
        uint256 topic0;
        uint256 topic1;
        uint256 topic2;
        uint256 topic3;
    }

    CallbackCall[] public callbacks;
    Subscription[] public subscriptions;
    Subscription[] public unsubscriptions;
    mapping(address => uint256) public debts;
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }

    function debt(address contract_) external view returns (uint256) {
        return debts[contract_];
    }

    function setDebt(address contract_, uint256 amount_) external {
        debts[contract_] = amount_;
    }

    // forge-lint: disable-next-line(mixed-case-function) — name mirrors the real system contract interface
    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        callbacks.push(CallbackCall(config_.chainId, config_.recipient, config_.gasLimit, config_.payload));
    }

    function requestCallback(ISystemContract.CallbackVersion, bytes memory) external {}

    function subscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external {
        subscriptions.push(Subscription(chainId_, contract_, topic0_, topic1_, topic2_, topic3_));
    }

    function unsubscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external {
        unsubscriptions.push(Subscription(chainId_, contract_, topic0_, topic1_, topic2_, topic3_));
    }

    function callbackCount() external view returns (uint256) {
        return callbacks.length;
    }

    function subscriptionCount() external view returns (uint256) {
        return subscriptions.length;
    }

    function unsubscriptionCount() external view returns (uint256) {
        return unsubscriptions.length;
    }

    function resetCallbacks() external {
        delete callbacks;
    }
}

/// @dev Minimal callback proxy etched at the canonical proxy addresses. Calls are
///      forwarded so msg.sender at the escrow is the proxy (as in production).
contract MockCallbackProxy {
    error ForwardFailed(bytes reason_);

    function forward(address target_, bytes calldata data_) external {
        (bool ok, bytes memory reason) = target_.call(data_);
        if (!ok) revert ForwardFailed(reason);
    }
}
