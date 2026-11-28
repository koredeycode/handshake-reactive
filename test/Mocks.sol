// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

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

/// @dev ERC-20 that delivers 1% less than the requested amount. Used to prove the
///      escrows check the actual balance delta instead of trusting the lock arguments.
contract FeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1%

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to_, uint256 amount_) external {
        _mint(to_, amount_);
    }

    function transferFrom(address from_, address to_, uint256 amount_) public override returns (bool) {
        uint256 fee = amount_ / 10_000 * FEE_BPS;
        uint256 net = amount_ - fee;
        _spendAllowance(from_, _msgSender(), amount_);
        _transfer(from_, to_, net);
        if (fee != 0) _burn(from_, fee);
        return true;
    }
}

/// @dev ERC-20 with NO inbound fee (transferFrom is inherited unchanged) but a 1% fee
///      on outgoing `transfer`. Used to prove the escrows also verify the recipient's
///      balance delta on release/refund: a token that only fees on exit cannot consume
///      a leg and leave `lockedByToken` desynced.
contract OutboundFeeToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1%
    address public constant FEE_RECEIVER = address(0xFEE1);

    constructor() ERC20("Outbound Fee Token", "OFT") {}

    function mint(address to_, uint256 amount_) external {
        _mint(to_, amount_);
    }

    function transfer(address to_, uint256 amount_) public override returns (bool) {
        uint256 fee = amount_ / 10_000 * FEE_BPS;
        uint256 net = amount_ - fee;
        _transfer(_msgSender(), to_, net);
        if (fee != 0) _transfer(_msgSender(), FEE_RECEIVER, fee);
        return true;
    }
}

/// @dev ERC-20 that re-enters an escrow's `lock` from inside `transferFrom`. The
///      armed call is arbitrary calldata so the same mock can attack either escrow.
contract ReentrantToken is ERC20 {
    address private _escrow;
    bytes private _reenterCalldata;
    bool private _armed;

    constructor() ERC20("Reentrant Token", "RNT") {}

    function mint(address to_, uint256 amount_) external {
        _mint(to_, amount_);
    }

    function arm(address escrow_, bytes calldata reenterCalldata_) external {
        _escrow = escrow_;
        _reenterCalldata = reenterCalldata_;
        _armed = true;
    }

    function transferFrom(address from_, address to_, uint256 amount_) public override returns (bool) {
        if (_armed) {
            _armed = false;
            (bool ok, bytes memory reason) = _escrow.call(_reenterCalldata);
            if (!ok) {
                assembly {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
        }
        return super.transferFrom(from_, to_, amount_);
    }
}
