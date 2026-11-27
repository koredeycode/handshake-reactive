// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";

/// @title PaymentEscrow
/// @notice Holds the buyer's payment leg. Token-agnostic: any standard ERC-20 can be
///         locked, and the reactive contract validates it against the order's terms.
///         Only an authenticated callback from the pinned reactive contract, posted
///         through the pinned callback proxy, can release or refund it.
contract PaymentEscrow is AbstractCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

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

    error WrongToken();
    error ZeroAmount();
    error DeadlinePassed();
    error LegAlreadyExists();
    error NotLocked();
    error StaleNonce();
    error WrongRecipient();
    error WrongAmount();
    error InsufficientReceived(uint256 expected, uint256 received);

    mapping(bytes32 => Leg) public legs;

    constructor(IPayable proxy_, address reactiveSender_) payable AbstractCallback(proxy_, reactiveSender_) {}

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
    /// @dev Terminal states return silently, making duplicated callbacks harmless.
    function release(address reactive_, bytes32 orderId_, address recipient_, uint256 amount_, uint64 nonce_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
        nonReentrant
    {
        Leg storage leg = legs[orderId_];
        if (leg.state != LegState.LOCKED) return;
        if (nonce_ <= leg.nonce) revert StaleNonce();
        // A zero recipient can never receive funds. Named legs keep the exact-equality
        // check; open legs (counterparty == 0) accept any nonzero winning seller.
        if (recipient_ == address(0)) revert WrongRecipient();
        if (leg.counterparty != address(0) && recipient_ != leg.counterparty) revert WrongRecipient();
        if (amount_ != leg.amount) revert WrongAmount();

        leg.state = LegState.RELEASED;
        leg.nonce = nonce_;
        IERC20(leg.token).safeTransfer(recipient_, amount_);
        emit PaymentReleased(orderId_, recipient_, amount_, nonce_);
    }

    /// @notice Returns the locked payment to its original depositor (the buyer).
    function refund(address reactive_, bytes32 orderId_, uint64 nonce_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
        nonReentrant
    {
        Leg storage leg = legs[orderId_];
        if (leg.state != LegState.LOCKED) return;
        if (nonce_ <= leg.nonce) revert StaleNonce();

        leg.state = LegState.REFUNDED;
        leg.nonce = nonce_;
        IERC20(leg.token).safeTransfer(leg.depositor, leg.amount);
        emit PaymentRefunded(orderId_, leg.depositor, leg.amount, nonce_);
    }

    function getLeg(bytes32 orderId_) external view returns (Leg memory) {
        return legs[orderId_];
    }
}
