// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";

/// @title AssetEscrow
/// @notice Holds the asset leg on Unichain Sepolia. Legs are keyed by (orderId, seller) so
///         several sellers can race to lock against one order: the first lock wins and
///         every later lock is refunded to its own depositor.
/// @dev Callback payloads reserve the first argument for the injected reactive address:
///      release(address,bytes32,address,address,uint256,uint64)  // (RC, orderId, seller, recipient, amount, nonce)
///      refund(address,bytes32,address,uint64)                   // (RC, orderId, seller, nonce)
contract AssetEscrow is AbstractCallback {
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

    error WrongToken();
    error ZeroAmount();
    error DeadlinePassed();
    error LegAlreadyExists();
    error NotLocked();
    error StaleNonce();
    error WrongRecipient();
    error WrongAmount();

    IERC20 public immutable ASSET_TOKEN;
    mapping(bytes32 => mapping(address => Leg)) public legs;
    mapping(bytes32 => address[]) private _sellers;

    constructor(IPayable proxy_, address reactiveSender_, address assetToken_)
        payable
        AbstractCallback(proxy_, reactiveSender_)
    {
        require(assetToken_ != address(0), "zero token");
        ASSET_TOKEN = IERC20(assetToken_);
    }

    /// @notice Locks the asset against an order. The seller is `msg.sender`, so multiple
    ///         sellers may lock against the same order ID without overwriting each other.
    function lock(
        bytes32 orderId_,
        address token_,
        uint256 amount_,
        address counterparty_,
        bytes32 termsHash_,
        uint256 deadline_
    ) external {
        Leg storage leg = legs[orderId_][msg.sender];
        if (leg.state != LegState.NONE) revert LegAlreadyExists();
        if (token_ != address(ASSET_TOKEN)) revert WrongToken();
        if (amount_ == 0) revert ZeroAmount();
        if (deadline_ <= block.timestamp) revert DeadlinePassed();
        if (counterparty_ == address(0)) revert WrongRecipient();

        leg.depositor = msg.sender;
        leg.counterparty = counterparty_;
        leg.token = token_;
        leg.amount = amount_;
        leg.termsHash = termsHash_;
        leg.deadline = deadline_;
        leg.state = LegState.LOCKED;
        _sellers[orderId_].push(msg.sender);

        ASSET_TOKEN.safeTransferFrom(msg.sender, address(this), amount_);
        emit AssetLocked(orderId_, msg.sender, counterparty_, token_, amount_, termsHash_, deadline_);
    }

    /// @notice Releases the winning seller's asset to the buyer.
    /// @dev Terminal states return silently, making duplicated callbacks harmless.
    function release(
        address reactive_,
        bytes32 orderId_,
        address seller_,
        address recipient_,
        uint256 amount_,
        uint64 nonce_
    ) external onlyServiceProvider onlyCallbackSender(reactive_) {
        Leg storage leg = legs[orderId_][seller_];
        if (leg.state != LegState.LOCKED) return;
        if (nonce_ <= leg.nonce) revert StaleNonce();
        if (recipient_ != leg.counterparty) revert WrongRecipient();
        if (amount_ != leg.amount) revert WrongAmount();

        leg.state = LegState.RELEASED;
        leg.nonce = nonce_;
        ASSET_TOKEN.safeTransfer(recipient_, amount_);
        emit AssetReleased(orderId_, recipient_, amount_, nonce_);
    }

    /// @notice Refunds a seller's locked asset (race loser, expiry, or invalid terms).
    function refund(address reactive_, bytes32 orderId_, address seller_, uint64 nonce_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        Leg storage leg = legs[orderId_][seller_];
        if (leg.state != LegState.LOCKED) return;
        if (nonce_ <= leg.nonce) revert StaleNonce();

        leg.state = LegState.REFUNDED;
        leg.nonce = nonce_;
        ASSET_TOKEN.safeTransfer(leg.depositor, leg.amount);
        emit AssetRefunded(orderId_, leg.depositor, leg.amount, nonce_);
    }

    function getLeg(bytes32 orderId_, address seller_) external view returns (Leg memory) {
        return legs[orderId_][seller_];
    }

    function sellersOf(bytes32 orderId_) external view returns (address[] memory) {
        return _sellers[orderId_];
    }
}
