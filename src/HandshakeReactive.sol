// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";

/// @title HandshakeReactive
/// @notice Neutral arbiter for cross-chain OTC settlement. Lives on Reactive Lasna.
///         One instance serves every registered chain pair and every ERC-20 pair: the
///         venue and token choice are stored per order and validated against the actual
///         log source. Both legs are released from a single react() transaction, and
///         once settlement has been requested the refund path is permanently closed.
contract HandshakeReactive is AbstractReactive, Ownable, ReentrancyGuard {
    using Address for address payable;

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

    /// @notice Bounds the permissionless order registry so `_requireVenueIdle()` and
    ///         `_sweep()` stay bounded; closed ids can be removed with pruneClosedOrders().
    uint256 public constant MAX_ORDERS = 10_000;
    /// @notice Bounds the asset `Locked` logs counted for one order so the counter can
    ///         never overflow and halt react(). Over-cap logs are NOT silently ignored:
    ///         their depositor is REFUNDED via `_refundRaceLoser`, so no seller is stranded.
    uint256 public constant MAX_ASSET_LOCKS = 32;

    address private constant LEGACY_SYSTEM_ADDR = 0x0000000000000000000000000000000000fffFfF;

    uint8 private constant ROLE_PAYMENT = 1;
    uint8 private constant ROLE_ASSET = 2;

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
    // Legacy system contract Cron100(uint256) — topic0
    // 0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70.
    uint256 private constant CRON100_TOPIC_0 =
        0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;

    // 18-decimal lREACT: rescue must leave a fee floor so subscriptions keep running.
    uint256 private constant NATIVE_RESCUE_FLOOR = 1 ether;

    // -------------------------------------------------------------------- structs

    /// @notice The two chains and escrows that settle one order. Stored per order so a
    ///         venue change by the owner cannot move an in-flight order.
    struct Venue {
        uint256 paymentChainId;
        address paymentEscrow;
        uint256 assetChainId;
        address assetEscrow;
    }

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
        // Race mode bookkeeping and the FIRST (floor) callback nonce requested per leg.
        // Retries may bump `nonce`, but the floor is never overwritten, so a delayed
        // terminal event from the original callback still closes its leg. A race-loser
        // refund bumps `nonce` without invalidating the winner's callbacks either.
        uint256 assetLockCount;
        uint64 paymentRequestNonce;
        uint64 assetRequestNonce;
        Venue venue;
    }

    struct VenueRegistration {
        address paymentEscrow;
        address assetEscrow;
        bool registered;
    }

    struct EscrowMeta {
        uint256 chainId;
        uint8 role; // ROLE_PAYMENT or ROLE_ASSET
        bool registered;
    }

    // --------------------------------------------------------------------- events

    event OrderStateChanged(bytes32 indexed orderId, string stage, uint64 nonce);
    event VenueRegistered(uint256 indexed chainId, address paymentEscrow, address assetEscrow);
    event VenueUnregistered(uint256 indexed chainId, address paymentEscrow, address assetEscrow);
    /// @notice Emitted by rescueNative(); FUTURE-ONLY, post-Cron100-redeploy only.
    event NativeRescued(address indexed to, uint256 amount, uint256 debtAtCall);
    /// @notice Emitted when closed ids are removed from the sweep/prune index by pruneClosedOrders().
    event OrdersPruned(uint256 count, uint256 remaining);

    // --------------------------------------------------------------------- errors

    error DuplicateOrder();
    error InvalidSeller();
    error InvalidToken();
    error ZeroAmount();
    error InvalidDuration();
    error UnknownOrder();
    error InvalidVenue();
    error VenueNotFound();
    error CooldownActive();
    error NotBuyer();
    error NotOpenOrder();
    error OrderMatched();
    error DeadlineReached();
    error NoWinner();
    error VenueInUse();
    error ZeroAddress();
    error OutstandingDebt(uint256 debt);
    error RescueWouldStarveSubscriptions(uint256 remaining, uint256 floor);
    error TooManyOrders();

    // --------------------------------------------------------------------- state

    mapping(bytes32 => Order) public orders;
    bytes32[] private _orderIds;
    uint256 public sweepCursor;

    /// @notice chainId => the single payment/asset escrow pair registered for that chain.
    mapping(uint256 => VenueRegistration) private _venueRegistry;
    uint256[] private _registeredChainIds;

    /// @notice escrow address => (chainId, role). Used in react() to derive the venue
    ///         from the *actual* log source instead of trusting the order's claim.
    mapping(address => EscrowMeta) public escrows;

    bool public cronSubscribed;

    constructor() payable Ownable(msg.sender) {}

    // -------------------------------------------------------------- venue registry

    /// @notice Register (or replace) the payment + asset escrows for one testnet chain.
    ///         Installing the first venue also installs the single Cron100 subscription.
    function setVenue(uint256 chainId_, address paymentEscrow_, address assetEscrow_) external onlyOwner {
        if (!_isTestnet(chainId_)) revert InvalidVenue();
        if (paymentEscrow_ == address(0) || assetEscrow_ == address(0)) revert InvalidVenue();
        if (paymentEscrow_ == assetEscrow_) revert InvalidVenue();

        VenueRegistration storage v = _venueRegistry[chainId_];
        if (v.registered) {
            // A new escrow may not already be in use by a different chain/role.
            if (paymentEscrow_ != v.paymentEscrow && escrows[paymentEscrow_].registered) revert InvalidVenue();
            if (assetEscrow_ != v.assetEscrow && escrows[assetEscrow_].registered) revert InvalidVenue();
            // Replacing a venue with in-flight orders would make those orders
            // unprocessable: react() validates logs against the live escrow map.
            _requireVenueIdle(chainId_);
            _unsubscribeEscrow(chainId_, v.paymentEscrow, ROLE_PAYMENT);
            _unsubscribeEscrow(chainId_, v.assetEscrow, ROLE_ASSET);
            delete escrows[v.paymentEscrow];
            delete escrows[v.assetEscrow];
        } else {
            if (escrows[paymentEscrow_].registered || escrows[assetEscrow_].registered) revert InvalidVenue();
            _registeredChainIds.push(chainId_);
        }

        v.paymentEscrow = paymentEscrow_;
        v.assetEscrow = assetEscrow_;
        v.registered = true;

        escrows[paymentEscrow_] = EscrowMeta({chainId: chainId_, role: ROLE_PAYMENT, registered: true});
        escrows[assetEscrow_] = EscrowMeta({chainId: chainId_, role: ROLE_ASSET, registered: true});

        _subscribe(chainId_, paymentEscrow_, PAYMENT_LOCKED_TOPIC_0);
        _subscribe(chainId_, paymentEscrow_, PAYMENT_RELEASED_TOPIC_0);
        _subscribe(chainId_, paymentEscrow_, PAYMENT_REFUNDED_TOPIC_0);
        _subscribe(chainId_, assetEscrow_, ASSET_LOCKED_TOPIC_0);
        _subscribe(chainId_, assetEscrow_, ASSET_RELEASED_TOPIC_0);
        _subscribe(chainId_, assetEscrow_, ASSET_REFUNDED_TOPIC_0);

        if (!cronSubscribed) {
            cronSubscribed = true;
            _subscribe(block.chainid, LEGACY_SYSTEM_ADDR, CRON100_TOPIC_0);
        }

        emit VenueRegistered(chainId_, paymentEscrow_, assetEscrow_);
    }

    function venue(uint256 chainId_)
        external
        view
        returns (address paymentEscrow_, address assetEscrow_, bool registered_)
    {
        VenueRegistration storage v = _venueRegistry[chainId_];
        return (v.paymentEscrow, v.assetEscrow, v.registered);
    }

    function registeredChainIds() external view returns (uint256[] memory) {
        return _registeredChainIds;
    }

    function subscriptionCount() external view returns (uint256) {
        return _registeredChainIds.length * 6 + (cronSubscribed ? 1 : 0);
    }

    /// @notice Removes every subscription (e.g. after the demo, to stop cron billing).
    /// @dev Refuses to unregister while any order on that venue is still open, so
    ///      in-flight funds can always be settled or refunded.
    function unsubscribeAll() external onlyOwner {
        // Snapshot the ids before we start mutating the registry array.
        uint256 len = _registeredChainIds.length;
        uint256[] memory chainIds = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) chainIds[i] = _registeredChainIds[i];

        for (uint256 i = 0; i < len; ++i) {
            uint256 chainId = chainIds[i];
            _requireVenueIdle(chainId);
        }

        for (uint256 i = 0; i < len; ++i) {
            uint256 chainId = chainIds[i];
            VenueRegistration storage v = _venueRegistry[chainId];
            if (!v.registered) continue;
            // Cache before delete so the event carries the real addresses.
            address paymentEscrow = v.paymentEscrow;
            address assetEscrow = v.assetEscrow;
            _unsubscribeEscrow(chainId, paymentEscrow, ROLE_PAYMENT);
            _unsubscribeEscrow(chainId, assetEscrow, ROLE_ASSET);
            delete escrows[paymentEscrow];
            delete escrows[assetEscrow];
            delete _venueRegistry[chainId];
            emit VenueUnregistered(chainId, paymentEscrow, assetEscrow);
        }
        delete _registeredChainIds;

        if (cronSubscribed) {
            SYSTEM.unsubscribe(
                block.chainid, LEGACY_SYSTEM_ADDR, CRON100_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
            cronSubscribed = false;
        }
    }

    function coverDebt() external {
        _coverDebt();
    }

    /// @notice Rescue lREACT sent directly to this RC address. Only the RC's own
    ///         balance is touched; system `reserves` are prepaid credit and are not
    ///         withdrawable through the pinned system-contract ABI.
    /// @dev FUTURE-ONLY: post-Cron100-redeploy only — not part of the live deployment.
    ///      A positive system debt or a balance that would fall below the fee floor
    ///      blocks the rescue so subscriptions keep running.
    function rescueNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 debt = SYSTEM.debt(address(this));
        if (debt != 0) revert OutstandingDebt(debt);
        uint256 remaining = address(this).balance - amount; // checked: amount > balance reverts
        if (remaining < NATIVE_RESCUE_FLOOR) revert RescueWouldStarveSubscriptions(remaining, NATIVE_RESCUE_FLOOR);

        emit NativeRescued(to, amount, debt);
        to.sendValue(amount);
    }

    // --------------------------------------------------------------- order lifecycle

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
    ) external {
        if (orders[orderId_].buyer != address(0)) revert DuplicateOrder();
        // Bounded registry: an attacker cannot grow _orderIds past MAX_ORDERS and make
        // _requireVenueIdle()/unsubscribeAll() gas-DoS-able or starve _sweep().
        if (_orderIds.length >= MAX_ORDERS) revert TooManyOrders();
        // address(0) publishes an open order any seller can match; self-dealing stays banned.
        if (seller_ == msg.sender) revert InvalidSeller();
        if (paymentToken_ == address(0) || assetToken_ == address(0)) revert InvalidToken();
        if (paymentAmount_ == 0 || assetAmount_ == 0) revert ZeroAmount();
        if (durationSeconds_ < MIN_DURATION || durationSeconds_ > MAX_DURATION) revert InvalidDuration();
        if (!_isTestnet(paymentChainId_) || !_isTestnet(assetChainId_)) revert InvalidVenue();
        if (paymentChainId_ == assetChainId_) revert InvalidVenue();
        if (!_validEscrow(paymentEscrow_, paymentChainId_, ROLE_PAYMENT)) revert InvalidVenue();
        if (!_validEscrow(assetEscrow_, assetChainId_, ROLE_ASSET)) revert InvalidVenue();

        Order storage o = orders[orderId_];
        o.buyer = msg.sender;
        o.seller = seller_;
        o.paymentToken = paymentToken_;
        o.paymentAmount = paymentAmount_;
        o.assetToken = assetToken_;
        o.assetAmount = assetAmount_;
        o.deadline = block.timestamp + durationSeconds_;
        o.venue = Venue({
            paymentChainId: paymentChainId_,
            paymentEscrow: paymentEscrow_,
            assetChainId: assetChainId_,
            assetEscrow: assetEscrow_
        });
        _orderIds.push(orderId_);

        emit OrderStateChanged(orderId_, "CREATED", 0);
    }

    /// @notice Buyer-only cancellation of an open order before any seller matches it.
    ///         `invalid` keeps cron from settling and `refundRequested` routes a late
    ///         PaymentLocked log through _refundLateLeg. The shared refund helper also
    ///         requests the refund callback immediately for an already-seen payment leg,
    ///         so cancellation does not depend on a later retry() or cron tick.
    function cancelOrder(bytes32 orderId_) external {
        Order storage o = orders[orderId_];
        if (o.buyer == address(0)) revert UnknownOrder();
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.seller != address(0)) revert NotOpenOrder();
        if (o.winner != address(0)) revert OrderMatched();
        if (block.timestamp >= o.deadline) revert DeadlineReached();
        if (o.invalid || o.refundRequested) return; // already cancelled / refund-pending
        if (o.settleRequested) return; // hard invariant: settlement already requested

        o.invalid = true;
        // Bumps the nonce, sets refundRequested/lastActionTimestamp and requests a
        // refund callback for every seen, unclosed leg. It returns early if settlement
        // has been requested, preserving the terminal invariant.
        _requestRefundForLegs(orderId_, o, true, true);
        emit OrderStateChanged(orderId_, "CANCELLED", o.nonce);
    }

    /// @notice Permissionless expiry for a stranded order: retry() only re-requests an
    ///         existing refund decision and _sweep() requires an open leg, so an expired
    ///         order with no decision and no seen legs would otherwise stay stuck.
    /// @dev FUTURE-ONLY: post-Cron100-redeploy only — not part of the live deployment.
    ///      A settlement decision is final; cooldown and idempotence bound spam.
    function expire(bytes32 orderId_) external {
        Order storage o = orders[orderId_];
        if (o.buyer == address(0)) revert UnknownOrder();
        // No-op cases first: a settlement decision is final at ANY time, and repeated
        // calls are silent no-ops regardless of deadline or cooldown.
        if (o.settleRequested) return; // hard invariant: never refund after settlement
        if (o.refundRequested || (o.paymentClosed && o.assetClosed)) return;
        if (block.timestamp < o.deadline) revert DeadlineReached();
        if (o.lastActionTimestamp != 0 && block.timestamp < o.lastActionTimestamp + RETRY_COOLDOWN) {
            revert CooldownActive();
        }

        _requestRefundForLegs(orderId_, o, true, true);
        // _requestRefundForLegs bumps the nonce; emit the new value so the indexer
        // can tell this from a buyer CANCELLED at the same nonce.
        emit OrderStateChanged(orderId_, "EXPIRED", o.nonce);
    }

    /// @notice An order id may be removed from the sweep index once it is provably
    ///         fund-free: both legs have terminal events, OR no leg was ever seen and the
    ///         order has a refund/invalid decision with its deadline behind it. The second
    ///         case is what lets permissionless `expire()` + pruning clear empty orders
    ///         that would otherwise permanently fill MAX_ORDERS.
    /// @dev `orders[id]` is never deleted, so a delayed Locked log for a pruned id is still
    ///      processed and refunded by react(). Only the bounded sweep/index is compacted.
    function _prunable(Order storage o_) internal view returns (bool) {
        if (o_.buyer == address(0)) return false;
        if (o_.paymentClosed && o_.assetClosed) return true;
        return !o_.paymentSeen && !o_.assetSeen && (o_.refundRequested || o_.invalid)
            && block.timestamp >= o_.deadline;
    }

    /// @notice Permissionless, bounded removal of terminal/fund-free orders from the
    ///         sweep index. Only `_orderIds` is compacted — `orders[id]` (including its
    ///         terms and closed flags) stays readable forever — so `_requireVenueIdle()`
    ///         and `_sweep()` remain bounded even though createOrder() is permissionless.
    /// @dev Single forward pass with swap-and-pop; at most `limit_` removals. `sweepCursor`
    ///      points at the NEXT id to process, so when the tail element is moved into
    ///      slot i the cursor follows it to i. A cursor equal to the new length simply
    ///      wraps at the start of _sweep().
    function pruneClosedOrders(uint256 limit_) external {
        uint256 len = _orderIds.length;
        uint256 removed;
        for (uint256 i = 0; i < len && removed < limit_;) {
            if (!_prunable(orders[_orderIds[i]])) {
                i += 1;
                continue;
            }

            uint256 last = len - 1;
            if (i != last) {
                _orderIds[i] = _orderIds[last];
                // The cursor had already consumed the tail element; it now lives at i.
                if (sweepCursor == last) sweepCursor = i;
            }
            _orderIds.pop();
            len -= 1;
            removed += 1;
            // Do not advance i: the id swapped into slot i still needs inspection.
        }
        if (removed != 0) emit OrdersPruned(removed, len);
    }

    /// @notice Canonical terms hash both escrow legs must carry. The UI computes this
    ///         from getOrder(orderId) before enabling the lock buttons. Venue fields are
    ///         included so a deposit cannot be replayed against another venue.
    function termsHash(bytes32 orderId_) public view returns (bytes32) {
        Order storage o = orders[orderId_];
        return keccak256(
            abi.encode(
                o.buyer,
                o.seller,
                o.paymentToken,
                o.paymentAmount,
                o.assetToken,
                o.assetAmount,
                o.deadline,
                o.venue.paymentChainId,
                o.venue.paymentEscrow,
                o.venue.assetChainId,
                o.venue.assetEscrow
            )
        );
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
        } else if (topic == CRON100_TOPIC_0 && log_.contractAddress == LEGACY_SYSTEM_ADDR) {
            _sweep();
        }
        // Unrecognized topic0 / source: deliberate no-op.
    }

    function _handleLocked(IReactive.LogRecord calldata log_, bool isPayment_) internal {
        if (log_.opCode != 4) return;

        // Derive role and venue from the actual log source. Logs from lookalike or
        // unregistered escrows, and logs whose venue does not match the order, are ignored.
        EscrowMeta memory meta = escrows[log_.contractAddress];
        if (!meta.registered) return;
        if (isPayment_ ? meta.role != ROLE_PAYMENT : meta.role != ROLE_ASSET) return;
        // The venue chain comes from the escrow registry, never from the log. A log
        // that claims a different chain is ignored before any state is touched.
        if (log_.chainId != meta.chainId) return;
        if (log_.data.length < 128) return;

        bytes32 id = bytes32(log_.topic1);
        address depositor = address(uint160(log_.topic2));
        address counterparty = address(uint160(log_.topic3));
        (address token, uint256 amount, bytes32 receivedTermsHash, uint256 deadline) =
            abi.decode(log_.data, (address, uint256, bytes32, uint256));

        Order storage o = orders[id];
        if (o.buyer == address(0)) return; // no order: ignore logs from lookalike contracts
        if (isPayment_) {
            if (o.venue.paymentChainId != meta.chainId || o.venue.paymentEscrow != log_.contractAddress) return;
        } else {
            if (o.venue.assetChainId != meta.chainId || o.venue.assetEscrow != log_.contractAddress) return;
            // Minimal party sanity check before counting: the escrow's depositor is
            // always msg.sender, so a zero depositor is malformed and never processed.
            // Deeper terms/party validation follows below and is deliberately left
            // after the counter so race-loser refunds keep their existing semantics.
            if (depositor == address(0)) return;
            // Stop counting at the cap so react() can never overflow. Over-cap locks
            // are NOT ignored: refund that depositor as a race loser so no seller is
            // stranded, without touching the winner's settlement state. A redelivered
            // log for the winner stays a no-op — its own leg must never be refunded.
            if (o.assetLockCount >= MAX_ASSET_LOCKS) {
                if (depositor != o.winner) _refundRaceLoser(id, o, depositor);
                return;
            }
            o.assetLockCount += 1; // every accepted asset lock, winner or loser
        }

        // Hard safety invariant: after settlement has been requested the order can
        // never enter the refund path. A late asset lock can only be a race loser and
        // is refunded to its own depositor without changing the winner's settlement.
        if (o.settleRequested) {
            if (!isPayment_ && depositor != o.winner) _refundRaceLoser(id, o, depositor);
            return;
        }

        // A lock that arrives after a refund decision or after both legs closed cannot
        // settle: refund that leg right away so its depositor is never stranded.
        if (o.refundRequested || (o.paymentClosed && o.assetClosed)) {
            if (isPayment_) {
                _refundLateLeg(id, o);
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

        // Token / amount / deadline / terms hash are identical for both market styles.
        // Only the party checks differ. For an open order the seller field is address(0)
        // in the terms hash itself (the UI encodes it that way), so no encoding changes.
        bool termsMatch = token == (isPayment_ ? o.paymentToken : o.assetToken)
            && amount == (isPayment_ ? o.paymentAmount : o.assetAmount) && deadline == o.deadline
            && receivedTermsHash == termsHash(id);

        bool partiesMatch;
        if (o.seller == address(0)) {
            // Open order: payment must come from the buyer with counterparty 0 (the
            // escrow's open marker); the asset may come from ANY nonzero seller as long
            // as it is addressed to the buyer.
            partiesMatch = isPayment_
                ? depositor == o.buyer && counterparty == address(0)
                : depositor != address(0) && counterparty == o.buyer;
        } else {
            // Named-seller orders: unchanged.
            partiesMatch = isPayment_
                ? depositor == o.buyer && counterparty == o.seller
                : depositor == o.seller && counterparty == o.buyer;
        }
        bool termsOk = termsMatch && partiesMatch;

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

        EscrowMeta memory meta = escrows[log_.contractAddress];
        if (!meta.registered) return;
        if (isPayment_ ? meta.role != ROLE_PAYMENT : meta.role != ROLE_ASSET) return;
        // Defence in depth: the terminal log must claim the venue's registered chain.
        if (log_.chainId != meta.chainId) return;
        if (log_.data.length < 64) return;

        bytes32 id = bytes32(log_.topic1);
        address recipient = address(uint160(log_.topic2));
        (, uint64 nonce) = abi.decode(log_.data, (uint256, uint64));

        Order storage o = orders[id];
        if (o.buyer == address(0)) return;
        if (isPayment_) {
            if (o.venue.paymentChainId != meta.chainId || o.venue.paymentEscrow != log_.contractAddress) return;
        } else {
            if (o.venue.assetChainId != meta.chainId || o.venue.assetEscrow != log_.contractAddress) return;
        }

        // The per-leg value is the FIRST nonce requested for that leg; retry()/sweep()
        // bump only the global nonce. Accept any terminal event from that first request
        // through the latest global nonce so a delayed event still closes its leg.
        // Older-than-floor and future nonces remain stale and are rejected.
        uint64 legFloor = isPayment_ ? o.paymentRequestNonce : o.assetRequestNonce;
        if (legFloor == 0 || nonce < legFloor || nonce > o.nonce) return;

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

    /// @notice Records the FIRST callback nonce requested for a leg. Retries and cron
    ///         repair requests bump the global nonce but must never overwrite this floor,
    ///         otherwise a terminal event from the original request becomes unconfirmable.
    function _setLegRequestFloor(Order storage o_, bool isPayment_, uint64 nonce_) internal {
        if (isPayment_) {
            if (o_.paymentRequestNonce == 0) o_.paymentRequestNonce = nonce_;
        } else {
            if (o_.assetRequestNonce == 0) o_.assetRequestNonce = nonce_;
        }
    }

    function _requestSettle(bytes32 id_, Order storage o_, bool payment_, bool asset_) internal {
        if (o_.refundRequested) return; // never mix a settlement with a refund decision
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        o_.settleRequested = true;
        uint64 nonce = o_.nonce;
        Venue storage v = o_.venue;

        if (payment_ && !o_.paymentClosed) {
            // A named seller receives payment directly. An open order's seller field is
            // zero, so pay the winning seller instead — never address(0).
            address paymentRecipient = o_.seller != address(0) ? o_.seller : o_.winner;
            if (paymentRecipient == address(0)) revert NoWinner();
            _setLegRequestFloor(o_, true, nonce);
            SYSTEM.requestCallbackV_1_0(
                ISystemContract.CallbackConfiguration_V_1_0({
                    chainId: v.paymentChainId,
                    recipient: v.paymentEscrow,
                    gasLimit: CALLBACK_GAS_LIMIT,
                    payload: abi.encodeWithSignature(
                        "release(address,bytes32,address,uint256,uint64)",
                        address(0),
                        id_,
                        paymentRecipient,
                        o_.paymentAmount,
                        nonce
                    )
                })
            );
        }
        if (asset_ && !o_.assetClosed) {
            _setLegRequestFloor(o_, false, nonce);
            address seller = o_.winner == address(0) ? o_.seller : o_.winner;
            SYSTEM.requestCallbackV_1_0(
                ISystemContract.CallbackConfiguration_V_1_0({
                    chainId: v.assetChainId,
                    recipient: v.assetEscrow,
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
        if (o_.settleRequested) return; // hard invariant: no refunds after settlement
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        o_.refundRequested = true;
        uint64 nonce = o_.nonce;
        Venue storage v = o_.venue;

        if (payment_ && o_.paymentSeen && !o_.paymentClosed) {
            _setLegRequestFloor(o_, true, nonce);
            o_.paymentRefundRequested = true;
            _requestPaymentRefund(v, id_, nonce);
        }
        if (asset_ && o_.assetSeen && !o_.assetClosed) {
            _setLegRequestFloor(o_, false, nonce);
            o_.assetRefundRequested = true;
            _requestAssetRefund(v, id_, o_.winner, nonce);
        }
        emit OrderStateChanged(id_, "REFUND_REQUESTED", nonce);
    }

    /// @notice Refund a payment leg whose Locked log arrived after the order entered
    ///         refund mode. Payment-only: a late asset lock always goes through the
    ///         race-loser path instead, which preserves the winner and its callbacks.
    function _refundLateLeg(bytes32 id_, Order storage o_) internal {
        if (o_.settleRequested) return; // hard invariant
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        o_.refundRequested = true;
        uint64 nonce = o_.nonce;
        Venue storage v = o_.venue;

        o_.paymentSeen = true;
        _setLegRequestFloor(o_, true, nonce);
        o_.paymentRefundRequested = true;
        _requestPaymentRefund(v, id_, nonce);
        emit OrderStateChanged(id_, "LATE_REFUND", nonce);
    }

    /// @notice Refund a later seller in race mode; does not alter winner settlement state.
    ///         Also used for asset logs beyond MAX_ASSET_LOCKS so over-cap depositors are
    ///         refunded instead of stranded, while the counter itself stays capped.
    function _refundRaceLoser(bytes32 id_, Order storage o_, address seller_) internal {
        o_.nonce += 1;
        o_.lastActionTimestamp = block.timestamp;
        uint64 nonce = o_.nonce;
        _requestAssetRefund(o_.venue, id_, seller_, nonce);
        emit OrderStateChanged(id_, "RACE_LOSER_REFUND", nonce);
    }

    function _requestPaymentRefund(Venue storage v_, bytes32 id_, uint64 nonce_) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: v_.paymentChainId,
                recipient: v_.paymentEscrow,
                gasLimit: CALLBACK_GAS_LIMIT,
                payload: abi.encodeWithSignature("refund(address,bytes32,uint64)", address(0), id_, nonce_)
            })
        );
    }

    function _requestAssetRefund(Venue storage v_, bytes32 id_, address seller_, uint64 nonce_) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: v_.assetChainId,
                recipient: v_.assetEscrow,
                gasLimit: CALLBACK_GAS_LIMIT,
                payload: abi.encodeWithSignature("refund(address,bytes32,address,uint64)", address(0), id_, seller_, nonce_)
            })
        );
    }

    // ------------------------------------------------------------------ retry/sweep

    /// @notice Permissionless retry. Once settlement is requested it may only re-request
    ///         settlement for unclosed legs — never a refund.
    function retry(bytes32 orderId_) external {
        Order storage o = orders[orderId_];
        if (o.buyer == address(0)) revert UnknownOrder();
        if (o.paymentClosed && o.assetClosed) return;
        if (o.lastActionTimestamp != 0 && block.timestamp < o.lastActionTimestamp + RETRY_COOLDOWN) {
            revert CooldownActive();
        }

        if (o.settleRequested) {
            if ((o.paymentSeen && !o.paymentClosed) || (o.assetSeen && !o.assetClosed)) {
                _requestSettle(orderId_, o, o.paymentSeen && !o.paymentClosed, o.assetSeen && !o.assetClosed);
            }
            return;
        }
        if (o.refundRequested) {
            if ((o.paymentSeen && !o.paymentClosed) || (o.assetSeen && !o.assetClosed)) {
                _requestRefundForLegs(orderId_, o, true, true);
            }
        }
    }

    /// @notice Cursor-bounded cron work: at most 8 orders per Cron100 tick.
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
            if (o.lastActionTimestamp != 0 && block.timestamp < o.lastActionTimestamp + RETRY_COOLDOWN) continue;

            bool hasOpenLeg = (o.paymentSeen && !o.paymentClosed) || (o.assetSeen && !o.assetClosed);
            if (!hasOpenLeg) continue;

            if (o.settleRequested) {
                // Hard invariant: expiry never converts a settling order into a refund.
                _requestSettle(id, o, o.paymentSeen && !o.paymentClosed, o.assetSeen && !o.assetClosed);
            } else if (block.timestamp >= o.deadline) {
                _requestRefundForLegs(id, o, true, true);
            } else if (o.paymentSeen && o.assetSeen && !o.invalid && !o.refundRequested) {
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

    function isClosed(bytes32 orderId_) external view returns (bool) {
        Order storage o = orders[orderId_];
        return o.paymentClosed && o.assetClosed;
    }

    // ------------------------------------------------------------------- internals

    function _subscribe(uint256 chainId_, address contract_, uint256 topic0_) internal {
        SYSTEM.subscribe(chainId_, contract_, topic0_, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _unsubscribeEscrow(uint256 chainId_, address escrow_, uint8 role_) internal {
        uint256 locked = role_ == ROLE_PAYMENT ? PAYMENT_LOCKED_TOPIC_0 : ASSET_LOCKED_TOPIC_0;
        uint256 released = role_ == ROLE_PAYMENT ? PAYMENT_RELEASED_TOPIC_0 : ASSET_RELEASED_TOPIC_0;
        uint256 refunded = role_ == ROLE_PAYMENT ? PAYMENT_REFUNDED_TOPIC_0 : ASSET_REFUNDED_TOPIC_0;
        SYSTEM.unsubscribe(chainId_, escrow_, locked, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.unsubscribe(chainId_, escrow_, released, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.unsubscribe(chainId_, escrow_, refunded, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _validEscrow(address escrow_, uint256 chainId_, uint8 role_) internal view returns (bool) {
        EscrowMeta storage meta = escrows[escrow_];
        return meta.registered && meta.chainId == chainId_ && meta.role == role_;
    }

    /// @notice A venue may not be replaced or removed while an order that uses it
    ///         can still receive callbacks. Removing the escrow metadata would make
    ///         react() ignore that order's events, stranding locked funds.
    function _requireVenueIdle(uint256 chainId_) internal view {
        uint256 len = _orderIds.length;
        for (uint256 i = 0; i < len; ++i) {
            Order storage o = orders[_orderIds[i]];
            if (o.paymentClosed && o.assetClosed) continue;
            if (o.venue.paymentChainId == chainId_ || o.venue.assetChainId == chainId_) {
                revert VenueInUse();
            }
        }
    }

    function _isTestnet(uint256 chainId_) internal pure returns (bool) {
        return chainId_ == BASE_SEPOLIA || chainId_ == UNICHAIN_SEPOLIA || chainId_ == REACTIVE_LASNA
            || chainId_ == ETHEREUM_SEPOLIA;
    }
}
