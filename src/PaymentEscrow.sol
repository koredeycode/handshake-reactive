// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";

/// @title PaymentEscrow
/// @notice Holds the buyer's payment leg. Token-agnostic: any standard ERC-20 can be
///         locked, and the reactive contract validates it against the order's terms.
///         Only an authenticated callback from the pinned reactive contract, posted
///         through the pinned callback proxy, can release or refund it.
/// @dev Fee-on-transfer tokens are UNSUPPORTED for legs in either direction. `lock()`
///      rejects an inbound shortfall by comparing the escrow's balance delta, and
///      `release()`/`refund()` reject an outbound shortfall by comparing the recipient's
///      balance delta. This keeps `lockedByToken` in sync with what recipients actually
///      receive, so dust/rescue accounting cannot silently diverge. Rebasing tokens are
///      excluded for the same reason.
contract PaymentEscrow is AbstractCallback, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    enum LegState {
        NONE,
        LOCKED,
        RELEASED,
        REFUNDED
    }

    struct Leg {
        address depositor;
        address counterparty;
        address token;
        uint256 amount;
        bytes32 termsHash;
        uint256 deadline;
        LegState state;
        uint64 nonce;
    }

    event PaymentLocked(
        bytes32 indexed orderId,
        address indexed depositor,
        address indexed counterparty,
        address token,
        uint256 amount,
        bytes32 termsHash,
        uint256 deadline
    );
    event PaymentReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce);
    event PaymentRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce);
    /// @notice Emitted by rescueToken(); FUTURE-ONLY, post-Cron100-redeploy only.
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    /// @notice Emitted by rescueNative(); FUTURE-ONLY, post-Cron100-redeploy only.
    event EscrowNativeRescued(address indexed to, uint256 amount);

    error WrongToken();
    error ZeroAmount();
    error DeadlinePassed();
    error LegAlreadyExists();
    error NotLocked();
    error StaleNonce();
    error WrongRecipient();
    error WrongAmount();
    error InsufficientReceived(uint256 expected, uint256 received);
    error ZeroAddress();
    error RescueWouldSeizeLockedFunds(uint256 locked, uint256 balance);
    error InsufficientBalance(uint256 available, uint256 requested);

    mapping(bytes32 => Leg) public legs;
    /// @notice Aggregate tokens held against LOCKED legs; never rescuable.
    mapping(address => uint256) public lockedByToken;
    /// @notice The actual payout recipient of a RELEASED leg. Kept out of `Leg` so the
    ///         public getter stays an 8-field tuple for the UI's fixed-tuple decoder.
    ///         Used to re-emit a truthful PaymentReleased when a terminal callback replays.
    mapping(bytes32 => address) private _releaseRecipient;

    constructor(IPayable proxy_, address reactiveSender_) payable AbstractCallback(proxy_, reactiveSender_) Ownable(msg.sender) {}

    /// @notice Locks payment for an order. Anyone may lock, but the reactive contract
    ///         only accepts a lock whose terms match the order created on Lasna.
    /// @dev The balance delta is checked so fee-on-transfer / rebasing tokens cannot
    ///      under-collateralise a leg.
    function lock(
        bytes32 orderId_,
        address token_,
        uint256 amount_,
        address counterparty_,
        bytes32 termsHash_,
        uint256 deadline_
    ) external nonReentrant {
        Leg storage leg = legs[orderId_];
        if (leg.state != LegState.NONE) revert LegAlreadyExists();
        if (token_ == address(0)) revert WrongToken();
        if (amount_ == 0) revert ZeroAmount();
        if (deadline_ <= block.timestamp) revert DeadlinePassed();
        // counterparty == address(0) is the open-order marker: the winning seller is
        // chosen later by the reactive contract, so no seller is fixed at lock time.
        // The Leg struct stays 8 fields for the UI's fixed-tuple decoder.

        IERC20 token = IERC20(token_);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount_);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received != amount_) revert InsufficientReceived(amount_, received);
        lockedByToken[token_] += received;

        leg.depositor = msg.sender;
        leg.counterparty = counterparty_;
        leg.token = token_;
        leg.amount = received;
        leg.termsHash = termsHash_;
        leg.deadline = deadline_;
        leg.state = LegState.LOCKED;

        emit PaymentLocked(orderId_, msg.sender, counterparty_, token_, received, termsHash_, deadline_);
    }

    /// @notice Releases the locked payment to the order's counterparty (the seller).
    /// @dev A replay on an already-terminal leg re-emits the TRUTHFUL stored terminal
    ///      event (with the stored nonce/amount/recipient) and moves no funds. This lets
    ///      the RC close a leg whose original terminal event was lost in transit.
    ///      The recipient's balance delta is verified before any state is finalized:
    ///      an outbound fee-on-transfer token reverts the whole call and the leg stays
    ///      LOCKED rather than desyncing `lockedByToken`.
    function release(address reactive_, bytes32 orderId_, address recipient_, uint256 amount_, uint64 nonce_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
        nonReentrant
    {
        Leg storage leg = legs[orderId_];
        if (leg.state == LegState.NONE) return;
        if (leg.state != LegState.LOCKED) {
            _reemitTerminal(orderId_, leg);
            return;
        }
        if (nonce_ <= leg.nonce) revert StaleNonce();
        // A zero recipient can never receive funds. Named legs keep the exact-equality
        // check; open legs (counterparty == 0) accept any nonzero winning seller.
        if (recipient_ == address(0)) revert WrongRecipient();
        if (leg.counterparty != address(0) && recipient_ != leg.counterparty) revert WrongRecipient();
        if (amount_ != leg.amount) revert WrongAmount();

        // Outbound delta check: no state is finalized until the recipient really got
        // the full amount. A reverting token leaves the leg LOCKED and the debt intact.
        IERC20 token = IERC20(leg.token);
        uint256 beforeBalance = token.balanceOf(recipient_);
        token.safeTransfer(recipient_, amount_);
        uint256 received = token.balanceOf(recipient_) - beforeBalance;
        if (received != amount_) revert InsufficientReceived(amount_, received);

        leg.state = LegState.RELEASED;
        leg.nonce = nonce_;
        _releaseRecipient[orderId_] = recipient_;
        lockedByToken[leg.token] -= leg.amount;
        emit PaymentReleased(orderId_, recipient_, amount_, nonce_);
    }

    /// @notice Returns the locked payment to its original depositor (the buyer).
    /// @dev Same outbound balance-delta check as `release()`; an outbound fee reverts
    ///      the whole call and leaves the leg LOCKED. A replay on a terminal leg re-emits
    ///      the stored PaymentRefunded (or PaymentReleased) event without moving funds.
    function refund(address reactive_, bytes32 orderId_, uint64 nonce_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
        nonReentrant
    {
        Leg storage leg = legs[orderId_];
        if (leg.state == LegState.NONE) return;
        if (leg.state != LegState.LOCKED) {
            _reemitTerminal(orderId_, leg);
            return;
        }
        if (nonce_ <= leg.nonce) revert StaleNonce();

        IERC20 token = IERC20(leg.token);
        uint256 beforeBalance = token.balanceOf(leg.depositor);
        token.safeTransfer(leg.depositor, leg.amount);
        uint256 received = token.balanceOf(leg.depositor) - beforeBalance;
        if (received != leg.amount) revert InsufficientReceived(leg.amount, received);

        leg.state = LegState.REFUNDED;
        leg.nonce = nonce_;
        lockedByToken[leg.token] -= leg.amount;
        emit PaymentRefunded(orderId_, leg.depositor, leg.amount, nonce_);
    }

    /// @notice Permissionless re-announcement of a still-LOCKED leg's original terms.
    ///         Emits the stored PaymentLocked event only; no state changes and no funds
    ///         move. This recovers a Locked log lost during callback-delivery debt — the
    ///         RC still validates source venue, terms hash, parties and deadline in react().
    function reannounce(bytes32 orderId_) external {
        Leg storage leg = legs[orderId_];
        if (leg.state != LegState.LOCKED) return;
        emit PaymentLocked(
            orderId_, leg.depositor, leg.counterparty, leg.token, leg.amount, leg.termsHash, leg.deadline
        );
    }

    /// @dev Replays the truthful stored terminal event. The stored nonce is the one the
    ///      RC originally requested; its per-leg floor/range check accepts it even after
    ///      retry() has bumped the global nonce. Falls back to the locked counterparty (or
    ///      depositor for an open-order marker) for legacy legs with no stored recipient.
    function _reemitTerminal(bytes32 orderId_, Leg storage leg_) internal {
        if (leg_.state == LegState.RELEASED) {
            address recipient = _releaseRecipient[orderId_];
            if (recipient == address(0)) {
                recipient = leg_.counterparty != address(0) ? leg_.counterparty : leg_.depositor;
            }
            emit PaymentReleased(orderId_, recipient, leg_.amount, leg_.nonce);
        } else if (leg_.state == LegState.REFUNDED) {
            emit PaymentRefunded(orderId_, leg_.depositor, leg_.amount, leg_.nonce);
        }
    }

    /// @notice Rescue ERC-20s not attributable to a LOCKED leg (mistaken transfers,
    ///         unused tokens, dust). Expiry never makes a locked leg rescuable — only
    ///         the pinned RC callback may refund it, or RC bookkeeping would diverge.
    /// @dev FUTURE-ONLY: post-Cron100-redeploy only — not part of the live deployment.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 locked = lockedByToken[token];
        if (balance < locked) revert RescueWouldSeizeLockedFunds(locked, balance);
        uint256 eligible = balance - locked;
        if (amount > eligible) revert RescueWouldSeizeLockedFunds(locked, balance);

        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    /// @notice Rescue native lREACT held by this escrow; no leg holds native funds.
    /// @dev FUTURE-ONLY: post-Cron100-redeploy only — not part of the live deployment.
    function rescueNative(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = address(this).balance;
        if (amount > available) revert InsufficientBalance(available, amount);

        to.sendValue(amount);
        emit EscrowNativeRescued(to, amount);
    }

    function getLeg(bytes32 orderId_) external view returns (Leg memory) {
        return legs[orderId_];
    }
}
