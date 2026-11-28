// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";

/// @title AssetEscrow
/// @notice Holds the asset leg. Token-agnostic: any standard ERC-20 can be locked, and
///         the reactive contract validates it against the order's terms. Legs are keyed
///         by (orderId, seller) so several sellers can race: the first lock wins and
///         every later lock is refunded to its own depositor.
/// @dev Fee-on-transfer tokens are UNSUPPORTED for legs in either direction. `lock()`
///      rejects an inbound shortfall by comparing the escrow's balance delta, and
///      `release()`/`refund()` reject an outbound shortfall by comparing the recipient's
///      balance delta. This keeps `lockedByToken` in sync with what recipients actually
///      receive, so dust/rescue accounting cannot silently diverge. Rebasing tokens are
///      excluded for the same reason.
/// @dev Callback payloads reserve the first argument for the injected reactive address:
///      release(address,bytes32,address,address,uint256,uint64)  // (RC, orderId, seller, recipient, amount, nonce)
///      refund(address,bytes32,address,uint64)                   // (RC, orderId, seller, nonce)
contract AssetEscrow is AbstractCallback, ReentrancyGuard, Ownable {
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

    event AssetLocked(
        bytes32 indexed orderId,
        address indexed depositor,
        address indexed counterparty,
        address token,
        uint256 amount,
        bytes32 termsHash,
        uint256 deadline
    );
    event AssetReleased(bytes32 indexed orderId, address indexed recipient, uint256 amount, uint64 nonce);
    event AssetRefunded(bytes32 indexed orderId, address indexed depositor, uint256 amount, uint64 nonce);
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

    mapping(bytes32 => mapping(address => Leg)) public legs;
    mapping(bytes32 => address[]) private _sellers;
    /// @notice Aggregate tokens held against LOCKED legs, across all (orderId, seller).
    mapping(address => uint256) public lockedByToken;
    /// @notice Stored payout recipient per (orderId, seller), kept out of `Leg` so the
    ///         public getter stays an 8-field tuple. Asset release recipients are also
    ///         available as `leg.counterparty`; the mapping keeps re-emission consistent
    ///         with PaymentEscrow and covers open-order style legs.
    mapping(bytes32 => mapping(address => address)) private _releaseRecipient;

    constructor(IPayable proxy_, address reactiveSender_) payable AbstractCallback(proxy_, reactiveSender_) Ownable(msg.sender) {}

    /// @notice Locks the asset against an order. The seller is `msg.sender`, so multiple
    ///         sellers may lock against the same order ID without overwriting each other.
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
        Leg storage leg = legs[orderId_][msg.sender];
        if (leg.state != LegState.NONE) revert LegAlreadyExists();
        if (token_ == address(0)) revert WrongToken();
        if (amount_ == 0) revert ZeroAmount();
        if (deadline_ <= block.timestamp) revert DeadlinePassed();
        if (counterparty_ == address(0)) revert WrongRecipient();

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
        _sellers[orderId_].push(msg.sender);

        emit AssetLocked(orderId_, msg.sender, counterparty_, token_, received, termsHash_, deadline_);
    }

    /// @notice Releases the winning seller's asset to the buyer.
    /// @dev A replay on an already-terminal leg re-emits the TRUTHFUL stored terminal
    ///      event (with the stored nonce/amount/recipient) and moves no funds, so the RC
    ///      can close a leg whose original terminal event was lost in transit.
    ///      The recipient's balance delta is verified before any state is finalized:
    ///      an outbound fee-on-transfer token reverts the whole call and the leg stays
    ///      LOCKED rather than desyncing `lockedByToken`.
    function release(
        address reactive_,
        bytes32 orderId_,
        address seller_,
        address recipient_,
        uint256 amount_,
        uint64 nonce_
    ) external onlyServiceProvider onlyCallbackSender(reactive_) nonReentrant {
        Leg storage leg = legs[orderId_][seller_];
        if (leg.state == LegState.NONE) return;
        if (leg.state != LegState.LOCKED) {
            _reemitTerminal(orderId_, seller_, leg);
            return;
        }
        if (nonce_ <= leg.nonce) revert StaleNonce();
        if (recipient_ != leg.counterparty) revert WrongRecipient();
        if (amount_ != leg.amount) revert WrongAmount();

        IERC20 token = IERC20(leg.token);
        uint256 beforeBalance = token.balanceOf(recipient_);
        token.safeTransfer(recipient_, amount_);
        uint256 received = token.balanceOf(recipient_) - beforeBalance;
        if (received != amount_) revert InsufficientReceived(amount_, received);

        leg.state = LegState.RELEASED;
        leg.nonce = nonce_;
        _releaseRecipient[orderId_][seller_] = recipient_;
        lockedByToken[leg.token] -= leg.amount;
        emit AssetReleased(orderId_, recipient_, amount_, nonce_);
    }

    /// @notice Refunds a seller's locked asset (race loser, expiry, or invalid terms).
    /// @dev Same outbound balance-delta check as `release()`; an outbound fee reverts
    ///      the whole call and leaves the leg LOCKED. A replay on a terminal leg re-emits
    ///      the stored AssetRefunded (or AssetReleased) event without moving funds.
    function refund(address reactive_, bytes32 orderId_, address seller_, uint64 nonce_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
        nonReentrant
    {
        Leg storage leg = legs[orderId_][seller_];
        if (leg.state == LegState.NONE) return;
        if (leg.state != LegState.LOCKED) {
            _reemitTerminal(orderId_, seller_, leg);
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
        emit AssetRefunded(orderId_, leg.depositor, leg.amount, nonce_);
    }

    /// @notice Permissionless re-announcement of a still-LOCKED leg's original terms.
    ///         Emits the stored AssetLocked event only; no state changes and no funds
    ///         move. This recovers a Locked log lost during callback-delivery debt — the
    ///         RC still validates source venue, terms hash, parties and deadline in react().
    function reannounce(bytes32 orderId_, address seller_) external {
        Leg storage leg = legs[orderId_][seller_];
        if (leg.state != LegState.LOCKED) return;
        emit AssetLocked(
            orderId_, leg.depositor, leg.counterparty, leg.token, leg.amount, leg.termsHash, leg.deadline
        );
    }

    /// @dev Replays the truthful stored terminal event with the stored nonce so the RC's
    ///      per-leg floor/range check accepts it even after a retry bumped the global nonce.
    function _reemitTerminal(bytes32 orderId_, address seller_, Leg storage leg_) internal {
        if (leg_.state == LegState.RELEASED) {
            address recipient = _releaseRecipient[orderId_][seller_];
            if (recipient == address(0)) {
                recipient = leg_.counterparty != address(0) ? leg_.counterparty : leg_.depositor;
            }
            emit AssetReleased(orderId_, recipient, leg_.amount, leg_.nonce);
        } else if (leg_.state == LegState.REFUNDED) {
            emit AssetRefunded(orderId_, leg_.depositor, leg_.amount, leg_.nonce);
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

    function getLeg(bytes32 orderId_, address seller_) external view returns (Leg memory) {
        return legs[orderId_][seller_];
    }

    function sellersOf(bytes32 orderId_) external view returns (address[] memory) {
        return _sellers[orderId_];
    }
}
