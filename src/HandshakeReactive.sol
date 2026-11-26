// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";

/// @title HandshakeReactive
/// @notice Neutral arbiter for cross-chain OTC settlement. Lives on Reactive Lasna.
///         It watches both escrows, releases both legs only after both valid locks are
///         observed before the deadline, and refunds locked legs after expiry.
contract HandshakeReactive is AbstractReactive, Ownable {
    // ------------------------------------------------------------------ constants

    uint256 private constant BASE_SEPOLIA = 84532;
    uint256 private constant UNICHAIN_SEPOLIA = 1301;
    uint256 private constant REACTIVE_LASNA = 5318007;
    uint256 private constant ETHEREUM_SEPOLIA = 11155111;

    uint256 private constant MIN_DURATION = 30;
    uint256 private constant MAX_DURATION = 30 days;
    uint256 private constant RETRY_COOLDOWN = 30;
    uint8 private constant SWEEP_LIMIT = 8;
    uint64 private constant CALLBACK_GAS_LIMIT = 500_000;

    address private constant LEGACY_SYSTEM_ADDR = 0x0000000000000000000000000000000000fffFfF;

    // Topic0 values are computed from the exact event signatures so signature typos
    // cannot silently produce subscriptions that never match.
    uint256 private constant PAYMENT_LOCKED_TOPIC_0 =
        uint256(keccak256("PaymentLocked(bytes32,address,address,address,uint256,bytes32,uint256)"));
    uint256 private constant ASSET_LOCKED_TOPIC_0 =
        uint256(keccak256("AssetLocked(bytes32,address,address,address,uint256,bytes32,uint256)"));
    uint256 private constant PAYMENT_RELEASED_TOPIC_0 =
        uint256(keccak256("PaymentReleased(bytes32,address,uint256,uint64)"));
    uint256 private constant ASSET_RELEASED_TOPIC_0 =
        uint256(keccak256("AssetReleased(bytes32,address,uint256,uint64)"));
    uint256 private constant PAYMENT_REFUNDED_TOPIC_0 =
        uint256(keccak256("PaymentRefunded(bytes32,address,uint256,uint64)"));
    uint256 private constant ASSET_REFUNDED_TOPIC_0 =
        uint256(keccak256("AssetRefunded(bytes32,address,uint256,uint64)"));
    // Legacy system contract Cron10(uint256) — topic0 0x04463f7c…3307b687.
    uint256 private constant CRON10_TOPIC_0 = uint256(keccak256("Cron10(uint256)"));

    // -------------------------------------------------------------------- structs

    struct Order {
        address buyer;
        address seller;
        address paymentToken;
        uint256 paymentAmount;
        address assetToken;
        uint256 assetAmount;
        uint256 deadline; // unix seconds
        bool paymentSeen;
        bool assetSeen;
        bool settleRequested;
        bool refundRequested;
        bool paymentClosed; // per-leg terminal event observed
        bool assetClosed; // per-leg terminal event observed
        bool paymentRefundRequested;
        bool assetRefundRequested;
        bool invalid;
        uint64 nonce; // monotonic across ALL callback requests for this order
        uint256 lastActionTimestamp; // uint256: compare directly against block.timestamp
        address winner; // race mode only; address(0) until first asset lock
        // Race mode bookkeeping and the nonce of the last callback requested per leg.
        // Per-leg nonces let a race-loser refund bump `nonce` without invalidating
        // confirmation of the winner's in-flight settlement callbacks.
        uint8 assetLockCount;
        uint64 paymentRequestNonce;
        uint64 assetRequestNonce;
    }

    // --------------------------------------------------------------------- events

    event OrderStateChanged(bytes32 indexed orderId, string stage, uint64 nonce);
    event VenuesSet(uint256 paymentChainId, address paymentEscrow, uint256 assetChainId, address assetEscrow);

    // --------------------------------------------------------------------- errors

    error DuplicateOrder();
    error InvalidSeller();
    error InvalidToken();
    error ZeroAmount();
    error InvalidDuration();
    error UnknownOrder();
    error InvalidVenue();
    error CooldownActive();

    // --------------------------------------------------------------------- state

    mapping(bytes32 => Order) public orders;
    bytes32[] private _orderIds;
    uint256 public sweepCursor;

    uint256 public paymentChainId;
    address public paymentEscrow;
    uint256 public assetChainId;
    address public assetEscrow;
    bool public venuesSet;

    constructor() payable Ownable(msg.sender) {}

    // --------------------------------------------------------------- order lifecycle

    function createOrder(
        bytes32 orderId_,
        address seller_,
        address paymentToken_,
        uint256 paymentAmount_,
        address assetToken_,
        uint256 assetAmount_,
        uint256 durationSeconds_
    ) external {
        if (orders[orderId_].buyer != address(0)) revert DuplicateOrder();
        if (seller_ == address(0) || seller_ == msg.sender) revert InvalidSeller();
        if (paymentToken_ == address(0) || assetToken_ == address(0)) revert InvalidToken();
        if (paymentAmount_ == 0 || assetAmount_ == 0) revert ZeroAmount();
        if (durationSeconds_ < MIN_DURATION || durationSeconds_ > MAX_DURATION) revert InvalidDuration();

        Order storage o = orders[orderId_];
        o.buyer = msg.sender;
        o.seller = seller_;
        o.paymentToken = paymentToken_;
        o.paymentAmount = paymentAmount_;
        o.assetToken = assetToken_;
        o.assetAmount = assetAmount_;
        o.deadline = block.timestamp + durationSeconds_;
        _orderIds.push(orderId_);

        emit OrderStateChanged(orderId_, "CREATED", 0);
    }

    /// @notice Canonical terms hash both escrow legs must carry. The UI computes this
    ///         from getOrder(orderId) before enabling the lock buttons.
    function termsHash(bytes32 orderId_) public view returns (bytes32) {
        Order storage o = orders[orderId_];
        return keccak256(
            abi.encode(o.buyer, o.seller, o.paymentToken, o.paymentAmount, o.assetToken, o.assetAmount, o.deadline)
        );
    }

    /// @notice Installs all subscriptions. Escrow addresses are unknown at deploy time.
    function setVenues(uint256 paymentChainId_, address paymentEscrow_, uint256 assetChainId_, address assetEscrow_)
        external
        onlyOwner
    {
        if (!_isTestnet(paymentChainId_) || !_isTestnet(assetChainId_)) revert InvalidVenue();
        if (paymentEscrow_ == address(0) || assetEscrow_ == address(0)) revert InvalidVenue();

        paymentChainId = paymentChainId_;
        paymentEscrow = paymentEscrow_;
        assetChainId = assetChainId_;
        assetEscrow = assetEscrow_;
        venuesSet = true;

        _subscribe(paymentChainId_, paymentEscrow_, PAYMENT_LOCKED_TOPIC_0);
        _subscribe(assetChainId_, assetEscrow_, ASSET_LOCKED_TOPIC_0);
        _subscribe(paymentChainId_, paymentEscrow_, PAYMENT_RELEASED_TOPIC_0);
        _subscribe(paymentChainId_, paymentEscrow_, PAYMENT_REFUNDED_TOPIC_0);
        _subscribe(assetChainId_, assetEscrow_, ASSET_RELEASED_TOPIC_0);
        _subscribe(assetChainId_, assetEscrow_, ASSET_REFUNDED_TOPIC_0);
        _subscribe(block.chainid, LEGACY_SYSTEM_ADDR, CRON10_TOPIC_0);

        emit VenuesSet(paymentChainId_, paymentEscrow_, assetChainId_, assetEscrow_);
    }

    /// @notice Removes every subscription (e.g. after the demo, to stop cron billing).
    function unsubscribeAll() external onlyOwner {
        SYSTEM.unsubscribe(
            paymentChainId, paymentEscrow, PAYMENT_LOCKED_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.unsubscribe(
            assetChainId, assetEscrow, ASSET_LOCKED_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.unsubscribe(
            paymentChainId, paymentEscrow, PAYMENT_RELEASED_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.unsubscribe(
            paymentChainId, paymentEscrow, PAYMENT_REFUNDED_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.unsubscribe(
            assetChainId, assetEscrow, ASSET_RELEASED_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.unsubscribe(
            assetChainId, assetEscrow, ASSET_REFUNDED_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        SYSTEM.unsubscribe(
            block.chainid, LEGACY_SYSTEM_ADDR, CRON10_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
        venuesSet = false;
    }

    function coverDebt() external {
        _coverDebt();
    }

    // -------------------------------------------------------------------- react()

    /// @inheritdoc IReactive
    /// @dev Calldata is required by the pinned IReactive interface. Filter branch never
    ///      reverts on an unrecognized log; only the trusted system contract can call.
    function react(IReactive.LogRecord calldata log_) external onlySystem {
        uint256 topic = log_.topic0;

        if (topic == PAYMENT_LOCKED_TOPIC_0) {
            _handleLocked(log_, true);
        } else if (topic == ASSET_LOCKED_TOPIC_0) {
            _handleLocked(log_, false);
        } else if (topic == PAYMENT_RELEASED_TOPIC_0 || topic == PAYMENT_REFUNDED_TOPIC_0) {
            _handleTerminal(log_, true, topic == PAYMENT_RELEASED_TOPIC_0);
        } else if (topic == ASSET_RELEASED_TOPIC_0 || topic == ASSET_REFUNDED_TOPIC_0) {
            _handleTerminal(log_, false, topic == ASSET_RELEASED_TOPIC_0);
        } else if (topic == CRON10_TOPIC_0 && log_.contractAddress == LEGACY_SYSTEM_ADDR) {
            _sweep();
        }
        // Unrecognized topic0 / source: deliberate no-op.
    }

    function _handleLocked(IReactive.LogRecord calldata log_, bool isPayment_) internal {
        if (log_.opCode != 4) return;
        address expectedEscrow = isPayment_ ? paymentEscrow : assetEscrow;
        if (expectedEscrow == address(0) || log_.contractAddress != expectedEscrow) return;
        if (log_.data.length < 128) return;

        bytes32 id = bytes32(log_.topic1);
        address depositor = address(uint160(log_.topic2));
        address counterparty = address(uint160(log_.topic3));
        (address token, uint256 amount, bytes32 receivedTermsHash, uint256 deadline) =
            abi.decode(log_.data, (address, uint256, bytes32, uint256));

        Order storage o = orders[id];
        if (o.buyer == address(0)) return; // no order: ignore logs from lookalike contracts
        if (!isPayment_) o.assetLockCount += 1; // every observed asset lock, winner or loser

        // A lock that arrives after a refund decision or after both legs closed cannot
        // settle: refund that leg right away so its depositor is never stranded.
        if (o.refundRequested || (o.paymentClosed && o.assetClosed)) {
            if (isPayment_) {
                _refundLateLeg(id, o, true, depositor);
            } else {
                _refundRaceLoser(id, o, depositor);
            }
            return;
        }

        // Race mode: the first valid asset lock wins; later sellers are refunded.
        if (!isPayment_ && o.winner != address(0)) {
            if (o.winner == depositor) return; // duplicate log for the winner
            _refundRaceLoser(id, o, depositor);
            return;
        }

        bool termsOk = isPayment_
            ? depositor == o.buyer && counterparty == o.seller && token == o.paymentToken && amount == o.paymentAmount
                && deadline == o.deadline && receivedTermsHash == termsHash(id)
            : depositor == o.seller && counterparty == o.buyer && token == o.assetToken && amount == o.assetAmount
                && deadline == o.deadline && receivedTermsHash == termsHash(id);

        if (!termsOk || block.timestamp >= o.deadline) {
            // The incoming leg is provably locked on its escrow, so mark it seen
            // before requesting refunds — otherwise that depositor would be stranded.
            if (isPayment_) {
                o.paymentSeen = true;
            } else if (o.winner == address(0)) {
                o.assetSeen = true;
                o.winner = depositor;
            }
            string memory stage = "EXPIRED";
            if (!termsOk) {
                o.invalid = true;
                stage = "INVALID";
            }
            _requestRefundForLegs(id, o, true, true);
            emit OrderStateChanged(id, stage, o.nonce);
            return;
        }

        if (isPayment_) {
            if (o.paymentSeen) return; // duplicate log
            o.paymentSeen = true;
            emit OrderStateChanged(id, "PAYMENT_SEEN", o.nonce);
        } else {
            if (o.assetSeen) return;
            o.assetSeen = true;
            o.winner = depositor;
            emit OrderStateChanged(id, "ASSET_SEEN", o.nonce);
            emit OrderStateChanged(id, "WINNER", o.nonce);
        }

        if (o.paymentSeen && o.assetSeen) {
            // Both callbacks are requested in this single react() transaction.
            _requestSettle(id, o, true, true);
        }
    }

    function _handleTerminal(IReactive.LogRecord calldata log_, bool isPayment_, bool isRelease_) internal {
        if (log_.opCode != 3) return;
        address expectedEscrow = isPayment_ ? paymentEscrow : assetEscrow;
        if (expectedEscrow == address(0) || log_.contractAddress != expectedEscrow) return;
        if (log_.data.length < 64) return;

        bytes32 id = bytes32(log_.topic1);
        address recipient = address(uint160(log_.topic2));
        (, uint64 nonce) = abi.decode(log_.data, (uint256, uint64));

        Order storage o = orders[id];
        if (o.buyer == address(0)) return;

        // Accept the global nonce or the last nonce requested for this specific leg;
        // older nonces are stale and never close a leg.
        uint64 legNonce = isPayment_ ? o.paymentRequestNonce : o.assetRequestNonce;
        if (nonce != o.nonce && nonce != legNonce) return;

        if (isPayment_) {
            if (!o.paymentClosed) {
                o.paymentClosed = true;
                emit OrderStateChanged(id, "PAYMENT_CLOSED", nonce);
            }
            return;
        }

        // A refund event from a race loser must not close the winner's asset leg.
        bool winnerLeg = isRelease_ ? recipient == o.buyer : (o.winner == address(0) || recipient == o.winner);
        if (winnerLeg && !o.assetClosed) {
            o.assetClosed = true;
            emit OrderStateChanged(id, "ASSET_CLOSED", nonce);
        }
    }

    // --------------------------------------------------------- callback request helpers

    function _requestSettle(bytes32 id_, Order storage o_, bool payment_, bool asset_) internal {
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        o_.settleRequested = true;
        uint64 nonce = o_.nonce;

        if (payment_ && !o_.paymentClosed) {
            o_.paymentRequestNonce = nonce;
            SYSTEM.requestCallbackV_1_0(
                ISystemContract.CallbackConfiguration_V_1_0({
                    chainId: paymentChainId,
                    recipient: paymentEscrow,
                    gasLimit: CALLBACK_GAS_LIMIT,
                    payload: abi.encodeWithSignature(
                        "release(address,bytes32,address,uint256,uint64)",
                        address(0),
                        id_,
                        o_.seller,
                        o_.paymentAmount,
                        nonce
                    )
                })
            );
        }
        if (asset_ && !o_.assetClosed) {
            o_.assetRequestNonce = nonce;
            address seller = o_.winner == address(0) ? o_.seller : o_.winner;
            SYSTEM.requestCallbackV_1_0(
                ISystemContract.CallbackConfiguration_V_1_0({
                    chainId: assetChainId,
                    recipient: assetEscrow,
                    gasLimit: CALLBACK_GAS_LIMIT,
                    payload: abi.encodeWithSignature(
                        "release(address,bytes32,address,address,uint256,uint64)",
                        address(0),
                        id_,
                        seller,
                        o_.buyer,
                        o_.assetAmount,
                        nonce
                    )
                })
            );
        }
        emit OrderStateChanged(id_, "SETTLE_REQUESTED", nonce);
    }

    function _requestRefundForLegs(bytes32 id_, Order storage o_, bool payment_, bool asset_) internal {
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        o_.refundRequested = true;
        uint64 nonce = o_.nonce;

        if (payment_ && o_.paymentSeen && !o_.paymentClosed) {
            o_.paymentRequestNonce = nonce;
            o_.paymentRefundRequested = true;
            _requestPaymentRefund(id_, nonce);
        }
        if (asset_ && o_.assetSeen && !o_.assetClosed) {
            o_.assetRequestNonce = nonce;
            o_.assetRefundRequested = true;
            _requestAssetRefund(id_, o_.winner, nonce);
        }
        emit OrderStateChanged(id_, "REFUND_REQUESTED", nonce);
    }

    /// @notice Refund a leg whose Locked log arrived after the order entered refund mode.
    function _refundLateLeg(bytes32 id_, Order storage o_, bool isPayment_, address depositor_) internal {
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        o_.refundRequested = true;
        uint64 nonce = o_.nonce;

        if (isPayment_) {
            o_.paymentSeen = true;
            o_.paymentRequestNonce = nonce;
            o_.paymentRefundRequested = true;
            _requestPaymentRefund(id_, nonce);
        } else {
            o_.assetRequestNonce = nonce;
            o_.assetRefundRequested = true;
            _requestAssetRefund(id_, depositor_, nonce);
        }
        emit OrderStateChanged(id_, "LATE_REFUND", nonce);
    }

    /// @notice Refund a later seller in race mode; does not alter winner settlement state.
    function _refundRaceLoser(bytes32 id_, Order storage o_, address seller_) internal {
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        uint64 nonce = o_.nonce;
        _requestAssetRefund(id_, seller_, nonce);
        emit OrderStateChanged(id_, "RACE_LOSER_REFUND", nonce);
    }

    function _requestPaymentRefund(bytes32 id_, uint64 nonce_) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: paymentChainId,
                recipient: paymentEscrow,
                gasLimit: CALLBACK_GAS_LIMIT,
                payload: abi.encodeWithSignature("refund(address,bytes32,uint64)", address(0), id_, nonce_)
            })
        );
    }

    function _requestAssetRefund(bytes32 id_, address seller_, uint64 nonce_) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: assetChainId,
                recipient: assetEscrow,
                gasLimit: CALLBACK_GAS_LIMIT,
                payload: abi.encodeWithSignature("refund(address,bytes32,address,uint64)", address(0), id_, seller_, nonce_)
            })
        );
    }

    // ------------------------------------------------------------------ retry/sweep

    /// @notice Permissionless retry. Chooses release vs refund from order state and
    ///         respects the same 30s cooldown as the cron sweep.
    function retry(bytes32 orderId_) external {
        Order storage o = orders[orderId_];
        if (o.buyer == address(0)) revert UnknownOrder();
        if (o.paymentClosed && o.assetClosed) return;
        if (o.lastActionTimestamp != 0 && block.timestamp < o.lastActionTimestamp + RETRY_COOLDOWN) {
            revert CooldownActive();
        }

        if (o.refundRequested) {
            if ((o.paymentSeen && !o.paymentClosed) || (o.assetSeen && !o.assetClosed)) {
                _requestRefundForLegs(orderId_, o, true, true);
            }
            return;
        }
        if (o.settleRequested) {
            _requestSettle(orderId_, o, o.paymentSeen && !o.paymentClosed, o.assetSeen && !o.assetClosed);
            // neither requested yet: deliberate no-op
        }
    }

    /// @notice Cursor-bounded cron work: at most 8 orders per Cron10 tick.
    function _sweep() internal {
        uint256 len = _orderIds.length;
        if (len == 0) return;

        for (uint8 processed = 0; processed < SWEEP_LIMIT;) {
            if (sweepCursor >= len) sweepCursor = 0;
            bytes32 id = _orderIds[sweepCursor];
            sweepCursor = (sweepCursor + 1) % len;
            processed += 1;

            Order storage o = orders[id];
            if (o.buyer == address(0) || (o.paymentClosed && o.assetClosed)) continue;

            if (block.timestamp >= o.deadline) {
                if (o.lastActionTimestamp != 0 && block.timestamp < o.lastActionTimestamp + RETRY_COOLDOWN) continue;
                if ((o.paymentSeen && !o.paymentClosed) || (o.assetSeen && !o.assetClosed)) {
                    _requestRefundForLegs(id, o, true, true);
                }
            } else if (o.paymentSeen && o.assetSeen && !o.settleRequested && !o.invalid && !o.refundRequested) {
                _requestSettle(id, o, true, true);
            }
        }
    }

    // ---------------------------------------------------------------------- views

    function orderCount() external view returns (uint256) {
        return _orderIds.length;
    }

    function orderIds(uint256 index_) external view returns (bytes32) {
        return _orderIds[index_];
    }

    function getOrder(bytes32 orderId_) external view returns (Order memory) {
        return orders[orderId_];
    }

    function venues()
        external
        view
        returns (uint256 paymentChainId_, address paymentEscrow_, uint256 assetChainId_, address assetEscrow_)
    {
        return (paymentChainId, paymentEscrow, assetChainId, assetEscrow);
    }

    function isClosed(bytes32 orderId_) external view returns (bool) {
        Order storage o = orders[orderId_];
        return o.paymentClosed && o.assetClosed;
    }

    // ------------------------------------------------------------------- internals

    function _subscribe(uint256 chainId_, address contract_, uint256 topic0_) internal {
        SYSTEM.subscribe(chainId_, contract_, topic0_, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _isTestnet(uint256 chainId_) internal pure returns (bool) {
        return chainId_ == BASE_SEPOLIA || chainId_ == UNICHAIN_SEPOLIA || chainId_ == REACTIVE_LASNA
            || chainId_ == ETHEREUM_SEPOLIA;
    }
}
