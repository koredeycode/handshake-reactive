// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";
import {AssetEscrow} from "../src/AssetEscrow.sol";
import {HandshakeReactive} from "../src/HandshakeReactive.sol";
import {TestUSD} from "../src/tokens/TestUSD.sol";
import {TestAsset} from "../src/tokens/TestAsset.sol";
import {
    FeeOnTransferToken,
    MockCallbackProxy,
    ReentrantToken,
    OutboundFeeToken,
    MockSystemContract
} from "./Mocks.sol";

contract EscrowTest is Test {
    address constant BASE_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    address constant UNICHAIN_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    address constant SEPOLIA_PROXY = 0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4;
    address constant REACTIVE = address(0xA11CE);
    address constant RC_SYSTEM = 0x8888888888888888888888888888888888888888;
    uint256 constant PAY_CHAIN = 84532;
    uint256 constant ASSET_CHAIN = 1301;

    address constant BUYER = address(0xB0B);
    address constant SELLER = address(0x51E);
    address constant SELLER_TWO = address(0x520);
    address constant STRANGER = address(0xD00D);
    address constant RESCUE_TO = address(0xCAFE);

    bytes32 constant ORDER = keccak256("order-escrow");
    bytes32 constant TERMS = bytes32("terms");
    uint256 constant PAYMENT_AMOUNT = 100e6;
    uint256 constant ASSET_AMOUNT = 1e18;

    TestUSD usd;
    TestAsset asset;
    PaymentEscrow paymentEscrow;
    AssetEscrow assetEscrow;
    uint256 deadline;

    // Local RC fixture for log-recovery integration tests (no fork, no broadcast).
    MockSystemContract rcSys;
    HandshakeReactive rc;
    bytes32 rcOrder;
    uint256 rcDeadline;
    bytes32 rcTerms;

    function setUp() public {
        vm.etch(BASE_PROXY, address(new MockCallbackProxy()).code);
        vm.etch(UNICHAIN_PROXY, address(new MockCallbackProxy()).code);
        vm.etch(SEPOLIA_PROXY, address(new MockCallbackProxy()).code);

        usd = new TestUSD();
        asset = new TestAsset();
        // Escrows are token-agnostic: the token is supplied on each lock() call.
        paymentEscrow = new PaymentEscrow(IPayable(payable(BASE_PROXY)), REACTIVE);
        assetEscrow = new AssetEscrow(IPayable(payable(UNICHAIN_PROXY)), REACTIVE);
        deadline = block.timestamp + 120;

        usd.mint(BUYER, 1_000e6);
        asset.mint(SELLER, 10e18);
        asset.mint(SELLER_TWO, 10e18);
    }

    function _lockPayment() internal {
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        paymentEscrow.lock(ORDER, address(usd), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();
    }

    function _lockAsset(address seller_) internal {
        vm.startPrank(seller_);
        asset.approve(address(assetEscrow), ASSET_AMOUNT);
        assetEscrow.lock(ORDER, address(asset), ASSET_AMOUNT, BUYER, TERMS, deadline);
        vm.stopPrank();
    }

    // --------------------------------------------------------------- happy paths

    function testPublicMintAndTokenMetadata() public view {
        assertEq(usd.balanceOf(BUYER), 1_000e6);
        assertEq(usd.decimals(), 6);
        assertEq(asset.balanceOf(SELLER), 10e18);
        assertEq(asset.symbol(), "tASSET");
    }

    function testPaymentLockStoresLegAndEmitsExactEvent() public {
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentLocked(ORDER, BUYER, SELLER, address(usd), PAYMENT_AMOUNT, TERMS, deadline);
        paymentEscrow.lock(ORDER, address(usd), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();

        PaymentEscrow.Leg memory leg = paymentEscrow.getLeg(ORDER);
        assertEq(leg.depositor, BUYER);
        assertEq(leg.counterparty, SELLER);
        assertEq(leg.token, address(usd));
        assertEq(leg.amount, PAYMENT_AMOUNT);
        assertEq(leg.termsHash, TERMS);
        assertEq(leg.deadline, deadline);
        assertEq(uint8(leg.state), uint8(PaymentEscrow.LegState.LOCKED));
        assertEq(usd.balanceOf(address(paymentEscrow)), PAYMENT_AMOUNT);
        assertEq(usd.balanceOf(BUYER), 1_000e6 - PAYMENT_AMOUNT);
    }

    function testAssetLockStoresLegKeyedBySeller() public {
        _lockAsset(SELLER);
        assertEq(assetEscrow.getLeg(ORDER, SELLER).depositor, SELLER);
        assertEq(assetEscrow.getLeg(ORDER, SELLER).counterparty, BUYER);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.LOCKED));
        assertEq(assetEscrow.sellersOf(ORDER).length, 1);
        assertEq(assetEscrow.sellersOf(ORDER)[0], SELLER);
    }

    function testReleaseThroughCanonicalProxyThenIdempotent() public {
        _lockPayment();

        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 7))
        );

        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.RELEASED));
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 7);
        assertEq(usd.balanceOf(SELLER), PAYMENT_AMOUNT);
        assertEq(usd.balanceOf(address(paymentEscrow)), 0);

        // A duplicated (or stale) callback is a no-op: no second transfer.
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 8))
        );
        assertEq(usd.balanceOf(SELLER), PAYMENT_AMOUNT);
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 7);
    }

    function testAssetReleaseToBuyer() public {
        _lockAsset(SELLER);
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(REACTIVE, ORDER, SELLER, BUYER, ASSET_AMOUNT, 3);
        assertEq(asset.balanceOf(BUYER), ASSET_AMOUNT);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.RELEASED));
    }

    function testRefundAfterDeadlineAndAfterReleaseNoop() public {
        _lockPayment();
        vm.warp(deadline + 1);

        vm.prank(BASE_PROXY);
        paymentEscrow.refund(REACTIVE, ORDER, 9);
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.REFUNDED));
        assertEq(usd.balanceOf(BUYER), 1_000e6);

        vm.prank(BASE_PROXY);
        paymentEscrow.refund(REACTIVE, ORDER, 10);
        assertEq(usd.balanceOf(BUYER), 1_000e6);
    }

    /// @dev F-05: a token with no inbound fee but a 1% outbound fee can be locked, yet
    ///      cannot consume the leg. The recipient delta check reverts release BEFORE any
    ///      state is finalized, so the leg stays LOCKED and lockedByToken is unchanged.
    function testOutboundFeeTokenCannotConsumePaymentRelease() public {
        OutboundFeeToken token = new OutboundFeeToken();
        bytes32 feeOrder = keccak256("outbound-fee-payment");
        uint256 amount = PAYMENT_AMOUNT;
        token.mint(BUYER, amount);
        vm.startPrank(BUYER);
        token.approve(address(paymentEscrow), amount);
        paymentEscrow.lock(feeOrder, address(token), amount, SELLER, TERMS, deadline);
        vm.stopPrank();

        assertEq(paymentEscrow.lockedByToken(address(token)), amount);
        uint256 escrowBalance = token.balanceOf(address(paymentEscrow));
        uint256 received = amount - amount / 100; // 1% fee on outgoing transfer

        vm.expectRevert(abi.encodeWithSignature("InsufficientReceived(uint256,uint256)", amount, received));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, feeOrder, SELLER, amount, 7);

        PaymentEscrow.Leg memory leg = paymentEscrow.getLeg(feeOrder);
        assertEq(uint8(leg.state), uint8(PaymentEscrow.LegState.LOCKED));
        assertEq(leg.nonce, 0);
        assertEq(paymentEscrow.lockedByToken(address(token)), amount);
        assertEq(token.balanceOf(address(paymentEscrow)), escrowBalance);
        assertEq(token.balanceOf(SELLER), 0);
    }

    /// @dev F-05: the same outbound check applies to refunds in both escrows.
    function testOutboundFeeTokenCannotConsumeRefunds() public {
        OutboundFeeToken paymentToken = new OutboundFeeToken();
        bytes32 paymentOrder = keccak256("outbound-fee-payment-refund");
        paymentToken.mint(BUYER, PAYMENT_AMOUNT);
        vm.startPrank(BUYER);
        paymentToken.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        paymentEscrow.lock(paymentOrder, address(paymentToken), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();

        uint256 paymentReceived = PAYMENT_AMOUNT - PAYMENT_AMOUNT / 100;
        vm.expectRevert(
            abi.encodeWithSignature("InsufficientReceived(uint256,uint256)", PAYMENT_AMOUNT, paymentReceived)
        );
        vm.prank(BASE_PROXY);
        paymentEscrow.refund(REACTIVE, paymentOrder, 9);
        assertEq(uint8(paymentEscrow.getLeg(paymentOrder).state), uint8(PaymentEscrow.LegState.LOCKED));
        assertEq(paymentToken.balanceOf(BUYER), 0);
        assertEq(paymentEscrow.lockedByToken(address(paymentToken)), PAYMENT_AMOUNT);

        OutboundFeeToken assetToken = new OutboundFeeToken();
        bytes32 assetOrder = keccak256("outbound-fee-asset-refund");
        assetToken.mint(SELLER, ASSET_AMOUNT);
        vm.startPrank(SELLER);
        assetToken.approve(address(assetEscrow), ASSET_AMOUNT);
        assetEscrow.lock(assetOrder, address(assetToken), ASSET_AMOUNT, BUYER, TERMS, deadline);
        vm.stopPrank();

        uint256 assetReceived = ASSET_AMOUNT - ASSET_AMOUNT / 100;
        vm.expectRevert(abi.encodeWithSignature("InsufficientReceived(uint256,uint256)", ASSET_AMOUNT, assetReceived));
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.refund(REACTIVE, assetOrder, SELLER, 9);
        assertEq(uint8(assetEscrow.getLeg(assetOrder, SELLER).state), uint8(AssetEscrow.LegState.LOCKED));
        assertEq(assetToken.balanceOf(SELLER), 0);
        assertEq(assetEscrow.lockedByToken(address(assetToken)), ASSET_AMOUNT);
    }

    /// @dev F-05: the new delta check must not disturb ordinary ERC-20s — release and
    ///      refund still deliver the full amount in both escrows.
    function testNormalTokenReleaseAndRefundStillMoveFullAmount() public {
        _lockPayment();
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 7))
        );
        assertEq(usd.balanceOf(SELLER), PAYMENT_AMOUNT);
        assertEq(paymentEscrow.lockedByToken(address(usd)), 0);

        bytes32 refundOrder = keccak256("normal-refund");
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        paymentEscrow.lock(refundOrder, address(usd), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.refund, (REACTIVE, refundOrder, 7))
        );
        assertEq(usd.balanceOf(BUYER), 900e6); // 1000 - first lock 100 - second lock 100 + refund 100
        assertEq(paymentEscrow.lockedByToken(address(usd)), 0);

        _lockAsset(SELLER);
        MockCallbackProxy(UNICHAIN_PROXY).forward(
            address(assetEscrow), abi.encodeCall(AssetEscrow.release, (REACTIVE, ORDER, SELLER, BUYER, ASSET_AMOUNT, 5))
        );
        assertEq(asset.balanceOf(BUYER), ASSET_AMOUNT);
        assertEq(assetEscrow.lockedByToken(address(asset)), 0);
    }

    // --------------------------------------------------------------- negative paths

    function testReleaseFromEoaReverts() public {
        _lockPayment();
        vm.expectRevert(abi.encodeWithSignature("NotAuthorized(address,address)", address(this), BASE_PROXY));
        paymentEscrow.release(REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 1);
    }

    function testReleaseViaProxyWithWrongReactiveReverts() public {
        _lockPayment();
        vm.expectRevert(abi.encodeWithSignature("CallbackNotAuthorized(address,address)", address(0xBAD), REACTIVE));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(address(0xBAD), ORDER, SELLER, PAYMENT_AMOUNT, 1);
    }

    function testStaleNonceReverts() public {
        _lockPayment();
        vm.expectRevert(abi.encodeWithSignature("StaleNonce()"));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 0);
    }

    function testWrongRecipientAndAmountRevert() public {
        _lockPayment();
        vm.expectRevert(abi.encodeWithSignature("WrongRecipient()"));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, ORDER, BUYER, PAYMENT_AMOUNT, 1);

        vm.expectRevert(abi.encodeWithSignature("WrongAmount()"));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT - 1, 1);
    }

    function testLockAfterDeadlineReverts() public {
        vm.warp(deadline);
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        vm.expectRevert(abi.encodeWithSignature("DeadlinePassed()"));
        paymentEscrow.lock(ORDER, address(usd), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();
    }

    /// @dev A zero address is never a valid ERC-20; both escrows reject it.
    function testLockRejectsZeroToken() public {
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        vm.expectRevert(abi.encodeWithSignature("WrongToken()"));
        paymentEscrow.lock(ORDER, address(0), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();

        vm.startPrank(SELLER);
        asset.approve(address(assetEscrow), ASSET_AMOUNT);
        vm.expectRevert(abi.encodeWithSignature("WrongToken()"));
        assetEscrow.lock(ORDER, address(0), ASSET_AMOUNT, BUYER, TERMS, deadline);
        vm.stopPrank();

        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.NONE));
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.NONE));
    }

    /// @dev `lock` now accepts any nonzero ERC-20; the duplicate-leg guard is unchanged.
    function testLockAcceptsAnyNonzeroTokenAndDuplicateStillReverts() public {
        bytes32 altOrder = keccak256("order-alt-token");
        asset.mint(BUYER, ASSET_AMOUNT);
        vm.startPrank(BUYER);
        asset.approve(address(paymentEscrow), ASSET_AMOUNT);
        paymentEscrow.lock(altOrder, address(asset), ASSET_AMOUNT, SELLER, TERMS, deadline);
        vm.expectRevert(abi.encodeWithSignature("LegAlreadyExists()"));
        paymentEscrow.lock(altOrder, address(asset), ASSET_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();

        PaymentEscrow.Leg memory leg = paymentEscrow.getLeg(altOrder);
        assertEq(leg.token, address(asset));
        assertEq(leg.amount, ASSET_AMOUNT);
        assertEq(uint8(leg.state), uint8(PaymentEscrow.LegState.LOCKED));
        assertEq(asset.balanceOf(address(paymentEscrow)), ASSET_AMOUNT);

        // The other token still works in its original escrow.
        _lockPayment();
        assertEq(paymentEscrow.getLeg(ORDER).token, address(usd));
    }

    /// @dev A token that transfers less than requested must not under-collateralise a leg.
    function testFeeOnTransferTokenIsRejectedByBalanceDelta() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        uint256 amount = 1_000e6;
        uint256 received = amount - (amount / 100);

        feeToken.mint(BUYER, amount);
        vm.startPrank(BUYER);
        feeToken.approve(address(paymentEscrow), amount);
        vm.expectRevert(abi.encodeWithSignature("InsufficientReceived(uint256,uint256)", amount, received));
        paymentEscrow.lock(ORDER, address(feeToken), amount, SELLER, TERMS, deadline);
        vm.stopPrank();
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.NONE));

        feeToken.mint(SELLER_TWO, amount);
        vm.startPrank(SELLER_TWO);
        feeToken.approve(address(assetEscrow), amount);
        vm.expectRevert(abi.encodeWithSignature("InsufficientReceived(uint256,uint256)", amount, received));
        assetEscrow.lock(ORDER, address(feeToken), amount, BUYER, TERMS, deadline);
        vm.stopPrank();
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER_TWO).state), uint8(AssetEscrow.LegState.NONE));
    }

    /// @dev Both escrows inherit OpenZeppelin's ReentrancyGuard on lock().
    function testLockReentrancyGuardOnBothEscrows() public {
        ReentrantToken token = new ReentrantToken();
        token.mint(BUYER, 1_000e6);
        token.mint(SELLER, 10e18);

        bytes32 paymentOuter = keccak256("reentrant-payment-outer");
        bytes memory paymentInner = abi.encodeCall(
            PaymentEscrow.lock,
            (keccak256("reentrant-payment-inner"), address(token), PAYMENT_AMOUNT, SELLER, TERMS, deadline)
        );
        token.arm(address(paymentEscrow), paymentInner);
        vm.startPrank(BUYER);
        token.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        vm.expectRevert(abi.encodeWithSignature("ReentrancyGuardReentrantCall()"));
        paymentEscrow.lock(paymentOuter, address(token), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();
        assertEq(uint8(paymentEscrow.getLeg(paymentOuter).state), uint8(PaymentEscrow.LegState.NONE));

        ReentrantToken assetToken = new ReentrantToken();
        assetToken.mint(SELLER, 10e18);
        bytes memory assetInner = abi.encodeCall(
            AssetEscrow.lock,
            (keccak256("reentrant-asset-inner"), address(assetToken), ASSET_AMOUNT, BUYER, TERMS, deadline)
        );
        assetToken.arm(address(assetEscrow), assetInner);
        vm.startPrank(SELLER);
        assetToken.approve(address(assetEscrow), ASSET_AMOUNT);
        vm.expectRevert(abi.encodeWithSignature("ReentrancyGuardReentrantCall()"));
        assetEscrow.lock(keccak256("reentrant-asset-outer"), address(assetToken), ASSET_AMOUNT, BUYER, TERMS, deadline);
        vm.stopPrank();
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.NONE));
    }

    /// @dev A third chain's callback proxy is accepted by the token-agnostic escrow constructor.
    function testEscrowWorksWithSepoliaProxy() public {
        PaymentEscrow sepoliaEscrow = new PaymentEscrow(IPayable(payable(SEPOLIA_PROXY)), REACTIVE);
        vm.startPrank(BUYER);
        usd.approve(address(sepoliaEscrow), PAYMENT_AMOUNT);
        sepoliaEscrow.lock(ORDER, address(usd), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSignature("NotAuthorized(address,address)", address(this), SEPOLIA_PROXY));
        sepoliaEscrow.release(REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 1);

        MockCallbackProxy(SEPOLIA_PROXY).forward(
            address(sepoliaEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 1))
        );
        assertEq(uint8(sepoliaEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.RELEASED));
        assertEq(usd.balanceOf(SELLER), PAYMENT_AMOUNT);
    }

    // ----------------------------------------------------------------- race mode

    function testRaceLoserRefundDoesNotAffectWinner() public {
        _lockAsset(SELLER);
        _lockAsset(SELLER_TWO);

        assertEq(assetEscrow.sellersOf(ORDER).length, 2);
        assertEq(assetEscrow.getLeg(ORDER, SELLER).depositor, SELLER);
        assertEq(assetEscrow.getLeg(ORDER, SELLER_TWO).depositor, SELLER_TWO);

        vm.prank(UNICHAIN_PROXY);
        assetEscrow.refund(REACTIVE, ORDER, SELLER_TWO, 5);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER_TWO).state), uint8(AssetEscrow.LegState.REFUNDED));
        assertEq(asset.balanceOf(SELLER_TWO), 10e18);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.LOCKED));

        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(REACTIVE, ORDER, SELLER, BUYER, ASSET_AMOUNT, 6);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.RELEASED));
        assertEq(asset.balanceOf(BUYER), ASSET_AMOUNT);
    }

    // -------------------------------------------------------------- open payment legs

    function _lockOpenPayment() internal {
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        paymentEscrow.lock(ORDER, address(usd), PAYMENT_AMOUNT, address(0), TERMS, deadline);
        vm.stopPrank();
    }

    function testOpenPaymentLockAcceptsZeroCounterpartyWithoutStructChange() public {
        _lockOpenPayment();
        PaymentEscrow.Leg memory leg = paymentEscrow.getLeg(ORDER);
        assertEq(leg.depositor, BUYER);
        assertEq(leg.counterparty, address(0));
        assertEq(leg.amount, PAYMENT_AMOUNT);
        assertEq(uint8(leg.state), uint8(PaymentEscrow.LegState.LOCKED));
        assertEq(usd.balanceOf(address(paymentEscrow)), PAYMENT_AMOUNT);
    }

    function testOpenPaymentReleasePaysChosenWinnerAndIsIdempotent() public {
        _lockOpenPayment();

        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow),
            abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER_TWO, PAYMENT_AMOUNT, 7))
        );
        assertEq(usd.balanceOf(SELLER_TWO), PAYMENT_AMOUNT);
        assertEq(usd.balanceOf(address(paymentEscrow)), 0);
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.RELEASED));
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 7);

        // A duplicate callback cannot pay a second seller.
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 8))
        );
        assertEq(usd.balanceOf(SELLER), 0);
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 7);
    }

    function testOpenPaymentReleaseRejectsZeroRecipient() public {
        _lockOpenPayment();
        vm.expectRevert(abi.encodeWithSignature("WrongRecipient()"));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, ORDER, address(0), PAYMENT_AMOUNT, 1);
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.LOCKED));
    }

    function testNamedPaymentReleaseStillRequiresExactNonzeroRecipient() public {
        _lockPayment();
        vm.expectRevert(abi.encodeWithSignature("WrongRecipient()"));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, ORDER, address(0), PAYMENT_AMOUNT, 1);

        vm.expectRevert(abi.encodeWithSignature("WrongRecipient()"));
        vm.prank(BASE_PROXY);
        paymentEscrow.release(REACTIVE, ORDER, SELLER_TWO, PAYMENT_AMOUNT, 1);

        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 2))
        );
        assertEq(usd.balanceOf(SELLER), PAYMENT_AMOUNT);
    }

    function testOpenPaymentRefundReturnsFundsToBuyer() public {
        _lockOpenPayment();
        vm.warp(deadline + 1);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.refund, (REACTIVE, ORDER, 3))
        );
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.REFUNDED));
        assertEq(usd.balanceOf(BUYER), 1_000e6);
    }

    // ------------------------------------------------------- owner-only rescue paths
    // Strictly local: tokens/native are minted or vm.deal-ed in the Foundry VM. There
    // are no forks, broadcasts, or transactions against any deployed contract here.

    function testRescueTokenOwnerOnlyAndZeroInputs() public {
        _lockPayment();
        usd.mint(address(paymentEscrow), 1e6); // otherwise-valid excess amount

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", STRANGER));
        vm.prank(STRANGER);
        paymentEscrow.rescueToken(address(usd), RESCUE_TO, 1e6);

        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        paymentEscrow.rescueToken(address(usd), address(0), 1e6);

        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        paymentEscrow.rescueToken(address(0), RESCUE_TO, 1e6);

        vm.expectRevert(abi.encodeWithSignature("ZeroAmount()"));
        paymentEscrow.rescueToken(address(usd), RESCUE_TO, 0);

        assertEq(usd.balanceOf(address(paymentEscrow)), PAYMENT_AMOUNT + 1e6);
    }

    function testRescueNativeOwnerOnlyAndZeroInputs() public {
        vm.deal(address(paymentEscrow), 2 ether);

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", STRANGER));
        vm.prank(STRANGER);
        paymentEscrow.rescueNative(payable(RESCUE_TO), 1 ether);

        vm.expectRevert(abi.encodeWithSignature("ZeroAddress()"));
        paymentEscrow.rescueNative(payable(address(0)), 1 ether);

        vm.expectRevert(abi.encodeWithSignature("ZeroAmount()"));
        paymentEscrow.rescueNative(payable(RESCUE_TO), 0);

        assertEq(address(paymentEscrow).balance, 2 ether);
    }

    function testLockedFundsUntouchableEvenAfterDeadline() public {
        _lockPayment();
        vm.warp(deadline + 1); // expiry never makes a locked leg rescueable

        uint256 locked = paymentEscrow.lockedByToken(address(usd));
        uint256 escrowBalance = usd.balanceOf(address(paymentEscrow));
        assertEq(locked, PAYMENT_AMOUNT);
        assertEq(escrowBalance, PAYMENT_AMOUNT);

        vm.expectRevert(
            abi.encodeWithSignature("RescueWouldSeizeLockedFunds(uint256,uint256)", locked, escrowBalance)
        );
        paymentEscrow.rescueToken(address(usd), RESCUE_TO, PAYMENT_AMOUNT);

        // Even a 1-wei nibble of a locked leg is refused.
        vm.expectRevert(
            abi.encodeWithSignature("RescueWouldSeizeLockedFunds(uint256,uint256)", locked, escrowBalance)
        );
        paymentEscrow.rescueToken(address(usd), RESCUE_TO, 1);

        assertEq(usd.balanceOf(address(paymentEscrow)), escrowBalance);
        assertEq(paymentEscrow.lockedByToken(address(usd)), locked);
    }

    function testExcessAndMistakenTransfersRescueableWithEvent() public {
        _lockPayment();
        uint256 dust = 7e6;
        // A mistaken direct transfer while a leg is locked is pure excess.
        usd.mint(address(paymentEscrow), dust);
        assertEq(usd.balanceOf(address(paymentEscrow)), PAYMENT_AMOUNT + dust);
        assertEq(paymentEscrow.lockedByToken(address(usd)), PAYMENT_AMOUNT);

        vm.expectEmit(true, true, false, true);
        emit PaymentEscrow.TokenRescued(address(usd), RESCUE_TO, dust);

        paymentEscrow.rescueToken(address(usd), RESCUE_TO, dust);

        assertEq(usd.balanceOf(RESCUE_TO), dust);
        assertEq(usd.balanceOf(address(paymentEscrow)), PAYMENT_AMOUNT);
        assertEq(paymentEscrow.lockedByToken(address(usd)), PAYMENT_AMOUNT);
    }

    function testUnusedTokenRescueableInFull() public {
        TestAsset stray = new TestAsset();
        uint256 amount = 3e18;
        stray.mint(address(paymentEscrow), amount);
        assertEq(paymentEscrow.lockedByToken(address(stray)), 0);

        vm.expectEmit(true, true, false, true);
        emit PaymentEscrow.TokenRescued(address(stray), RESCUE_TO, amount);

        paymentEscrow.rescueToken(address(stray), RESCUE_TO, amount);

        assertEq(stray.balanceOf(RESCUE_TO), amount);
        assertEq(stray.balanceOf(address(paymentEscrow)), 0);
    }

    function testReleaseDecrementsLockedByTokenThenDustRescueable() public {
        _lockPayment();
        assertEq(paymentEscrow.lockedByToken(address(usd)), PAYMENT_AMOUNT);

        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 7))
        );
        assertEq(paymentEscrow.lockedByToken(address(usd)), 0);
        assertEq(usd.balanceOf(address(paymentEscrow)), 0);

        // With no locked exposure, a later mistaken transfer is fully rescueable.
        uint256 dust = 2e6;
        usd.mint(address(paymentEscrow), dust);
        vm.expectEmit(true, true, false, true);
        emit PaymentEscrow.TokenRescued(address(usd), RESCUE_TO, dust);
        paymentEscrow.rescueToken(address(usd), RESCUE_TO, dust);
        assertEq(usd.balanceOf(RESCUE_TO), dust);
    }

    function testRefundDecrementsLockedByTokenThenDustRescueable() public {
        _lockPayment();
        vm.warp(deadline + 1);
        vm.prank(BASE_PROXY);
        paymentEscrow.refund(REACTIVE, ORDER, 9);
        assertEq(paymentEscrow.lockedByToken(address(usd)), 0);
        assertEq(usd.balanceOf(address(paymentEscrow)), 0);

        uint256 dust = 2e6;
        usd.mint(address(paymentEscrow), dust);
        vm.expectEmit(true, true, false, true);
        emit PaymentEscrow.TokenRescued(address(usd), RESCUE_TO, dust);
        paymentEscrow.rescueToken(address(usd), RESCUE_TO, dust);
        assertEq(usd.balanceOf(RESCUE_TO), dust);
    }

    /// @dev Two sellers race on the same asset token. lockedByToken must aggregate both
    ///      legs, then fall by exactly one leg on the race-loser refund and to zero on
    ///      the winner's release — never making a still-locked leg rescueable.
    function testRaceLoserTracksLockedByTokenPerSellerAndAggregates() public {
        _lockAsset(SELLER);
        _lockAsset(SELLER_TWO);
        uint256 total = 2 * ASSET_AMOUNT;
        assertEq(assetEscrow.lockedByToken(address(asset)), total);
        assertEq(asset.balanceOf(address(assetEscrow)), total);

        vm.expectRevert(
            abi.encodeWithSignature("RescueWouldSeizeLockedFunds(uint256,uint256)", total, total)
        );
        assetEscrow.rescueToken(address(asset), RESCUE_TO, 1);

        // Refund the race loser: exposure drops by one leg, not both.
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.refund(REACTIVE, ORDER, SELLER_TWO, 5);
        assertEq(assetEscrow.lockedByToken(address(asset)), ASSET_AMOUNT);

        vm.expectRevert(
            abi.encodeWithSignature("RescueWouldSeizeLockedFunds(uint256,uint256)", ASSET_AMOUNT, ASSET_AMOUNT)
        );
        assetEscrow.rescueToken(address(asset), RESCUE_TO, 1);

        // Release the winner: no locked exposure remains.
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(REACTIVE, ORDER, SELLER, BUYER, ASSET_AMOUNT, 6);
        assertEq(assetEscrow.lockedByToken(address(asset)), 0);

        uint256 dust = ASSET_AMOUNT / 2;
        asset.mint(address(assetEscrow), dust);
        vm.expectEmit(true, true, false, true);
        emit AssetEscrow.TokenRescued(address(asset), RESCUE_TO, dust);
        assetEscrow.rescueToken(address(asset), RESCUE_TO, dust);
        assertEq(asset.balanceOf(RESCUE_TO), dust);
    }

    function testRescueNativeMovesExactAmountEmitsEventAndRejectsOverdraw() public {
        uint256 funding = 2 ether;
        uint256 amount = 0.75 ether;
        vm.deal(address(paymentEscrow), funding);
        uint256 before = RESCUE_TO.balance;

        vm.expectEmit(true, false, false, true);
        emit PaymentEscrow.EscrowNativeRescued(RESCUE_TO, amount);
        paymentEscrow.rescueNative(payable(RESCUE_TO), amount);

        assertEq(RESCUE_TO.balance, before + amount);
        assertEq(address(paymentEscrow).balance, funding - amount);

        uint256 available = address(paymentEscrow).balance;
        uint256 requested = available + 1;
        vm.expectRevert(abi.encodeWithSignature("InsufficientBalance(uint256,uint256)", available, requested));
        paymentEscrow.rescueNative(payable(RESCUE_TO), requested);
        assertEq(address(paymentEscrow).balance, available);
    }

    function testAssetEscrowRescueNativeEmitsEvent() public {
        uint256 funding = 1 ether;
        uint256 amount = 0.5 ether;
        vm.deal(address(assetEscrow), funding);
        uint256 before = RESCUE_TO.balance;

        vm.expectEmit(true, false, false, true);
        emit AssetEscrow.EscrowNativeRescued(RESCUE_TO, amount);
        assetEscrow.rescueNative(payable(RESCUE_TO), amount);

        assertEq(RESCUE_TO.balance, before + amount);
        assertEq(address(assetEscrow).balance, funding - amount);
    }

    // ------------------------------------------------- terminal replay / reannounce

    /// @dev A replayed release on a RELEASED leg re-emits the stored PaymentReleased with
    ///      the stored nonce/recipient/amount, ignoring the replay's arguments. No funds
    ///      move and no state changes. Calling refund on that leg re-emits the same truth.
    function testPaymentTerminalReplayReemitsStoredRelease() public {
        _lockPayment();
        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentReleased(ORDER, SELLER, PAYMENT_AMOUNT, 7);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 7))
        );
        uint256 sellerBalance = usd.balanceOf(SELLER);
        uint256 escrowBalance = usd.balanceOf(address(paymentEscrow));

        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentReleased(ORDER, SELLER, PAYMENT_AMOUNT, 7);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, BUYER, PAYMENT_AMOUNT - 1, 99))
        );
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.RELEASED));
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 7);
        assertEq(usd.balanceOf(SELLER), sellerBalance);
        assertEq(usd.balanceOf(address(paymentEscrow)), escrowBalance);
        assertEq(paymentEscrow.lockedByToken(address(usd)), 0);

        // A refund callback on a RELEASED leg must not invent a refund event.
        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentReleased(ORDER, SELLER, PAYMENT_AMOUNT, 7);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.refund, (REACTIVE, ORDER, 8))
        );
        assertEq(usd.balanceOf(SELLER), sellerBalance);
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 7);
    }

    /// @dev The symmetric case: a release callback on a REFUNDED leg re-emits the stored
    ///      PaymentRefunded, so the RC can close a refund leg whose event was lost.
    function testPaymentTerminalReplayReemitsStoredRefund() public {
        bytes32 refundOrder = keccak256("terminal-refund-replay");
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        paymentEscrow.lock(refundOrder, address(usd), PAYMENT_AMOUNT, SELLER, TERMS, deadline);
        vm.stopPrank();

        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentRefunded(refundOrder, BUYER, PAYMENT_AMOUNT, 9);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.refund, (REACTIVE, refundOrder, 9))
        );
        uint256 buyerBalance = usd.balanceOf(BUYER);

        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentRefunded(refundOrder, BUYER, PAYMENT_AMOUNT, 9);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow),
            abi.encodeCall(PaymentEscrow.release, (REACTIVE, refundOrder, SELLER, PAYMENT_AMOUNT, 10))
        );
        assertEq(uint8(paymentEscrow.getLeg(refundOrder).state), uint8(PaymentEscrow.LegState.REFUNDED));
        assertEq(paymentEscrow.getLeg(refundOrder).nonce, 9);
        assertEq(usd.balanceOf(BUYER), buyerBalance);
        assertEq(paymentEscrow.lockedByToken(address(usd)), 0);
    }

    /// @dev Asset legs are keyed by (orderId, seller); terminal replay is truthful there too.
    function testAssetTerminalReplayReemitsStoredEvents() public {
        _lockAsset(SELLER);
        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetReleased(ORDER, BUYER, ASSET_AMOUNT, 3);
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(REACTIVE, ORDER, SELLER, BUYER, ASSET_AMOUNT, 3);
        uint256 buyerBalance = asset.balanceOf(BUYER);

        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetReleased(ORDER, BUYER, ASSET_AMOUNT, 3);
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(REACTIVE, ORDER, SELLER, BUYER, ASSET_AMOUNT - 1, 4);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.RELEASED));
        assertEq(assetEscrow.getLeg(ORDER, SELLER).nonce, 3);
        assertEq(asset.balanceOf(BUYER), buyerBalance);
        assertEq(assetEscrow.lockedByToken(address(asset)), 0);

        bytes32 loserOrder = keccak256("asset-refund-replay");
        asset.mint(SELLER_TWO, ASSET_AMOUNT);
        vm.startPrank(SELLER_TWO);
        asset.approve(address(assetEscrow), ASSET_AMOUNT);
        assetEscrow.lock(loserOrder, address(asset), ASSET_AMOUNT, BUYER, TERMS, deadline);
        vm.stopPrank();
        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetRefunded(loserOrder, SELLER_TWO, ASSET_AMOUNT, 5);
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.refund(REACTIVE, loserOrder, SELLER_TWO, 5);
        uint256 loserBalance = asset.balanceOf(SELLER_TWO);

        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetRefunded(loserOrder, SELLER_TWO, ASSET_AMOUNT, 5);
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(REACTIVE, loserOrder, SELLER_TWO, BUYER, ASSET_AMOUNT, 6);
        assertEq(uint8(assetEscrow.getLeg(loserOrder, SELLER_TWO).state), uint8(AssetEscrow.LegState.REFUNDED));
        assertEq(assetEscrow.getLeg(loserOrder, SELLER_TWO).nonce, 5);
        assertEq(asset.balanceOf(SELLER_TWO), loserBalance);
    }

    /// @dev Reannounce is permissionless and event-only: it re-emits the stored Locked
    ///      data without changing leg state, nonce, balances or lockedByToken, and is a
    ///      no-op once the leg is terminal.
    function testReannounceIsEventOnlyAndPermissionless() public {
        _lockPayment();
        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentLocked(ORDER, BUYER, SELLER, address(usd), PAYMENT_AMOUNT, TERMS, deadline);
        vm.prank(STRANGER);
        paymentEscrow.reannounce(ORDER);
        assertEq(uint8(paymentEscrow.getLeg(ORDER).state), uint8(PaymentEscrow.LegState.LOCKED));
        assertEq(paymentEscrow.getLeg(ORDER).nonce, 0);
        assertEq(usd.balanceOf(address(paymentEscrow)), PAYMENT_AMOUNT);
        assertEq(paymentEscrow.lockedByToken(address(usd)), PAYMENT_AMOUNT);

        _lockAsset(SELLER);
        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetLocked(ORDER, SELLER, BUYER, address(asset), ASSET_AMOUNT, TERMS, deadline);
        vm.prank(STRANGER);
        assetEscrow.reannounce(ORDER, SELLER);
        assertEq(uint8(assetEscrow.getLeg(ORDER, SELLER).state), uint8(AssetEscrow.LegState.LOCKED));
        assertEq(assetEscrow.lockedByToken(address(asset)), ASSET_AMOUNT);

        // Terminal legs produce no event on reannounce.
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (REACTIVE, ORDER, SELLER, PAYMENT_AMOUNT, 7))
        );
        vm.recordLogs();
        vm.prank(STRANGER);
        paymentEscrow.reannounce(ORDER);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    // ------------------------------------------------- RC log-recovery integration

    function _setupReactiveRecovery() internal {
        vm.etch(RC_SYSTEM, address(new MockSystemContract()).code);
        rcSys = MockSystemContract(payable(RC_SYSTEM));
        // Escrows pinned to the RC address so the mock proxy's forwarding is authorized.
        paymentEscrow = new PaymentEscrow(IPayable(payable(BASE_PROXY)), RC_SYSTEM);
        assetEscrow = new AssetEscrow(IPayable(payable(UNICHAIN_PROXY)), RC_SYSTEM);
        rc = new HandshakeReactive{value: 1 ether}();
        rc.setVenue(PAY_CHAIN, address(paymentEscrow), address(0xA1));
        rc.setVenue(ASSET_CHAIN, address(0xA2), address(assetEscrow));

        rcOrder = keccak256("log-recovery-order");
        vm.prank(BUYER);
        rc.createOrder(
            rcOrder,
            SELLER,
            address(usd),
            PAYMENT_AMOUNT,
            PAY_CHAIN,
            address(paymentEscrow),
            address(asset),
            ASSET_AMOUNT,
            ASSET_CHAIN,
            address(assetEscrow),
            120
        );
        rcDeadline = rc.getOrder(rcOrder).deadline;
        rcTerms = rc.termsHash(rcOrder);
    }

    /// @dev A second order isolates the asset leg so a reannounced asset Locked log is
    ///      marked seen rather than routed through the late-asset refund path.
    function _createSecondRcOrder() internal {
        bytes32 second = keccak256("log-recovery-asset-order");
        vm.prank(BUYER);
        rc.createOrder(
            second,
            SELLER,
            address(usd),
            PAYMENT_AMOUNT,
            PAY_CHAIN,
            address(paymentEscrow),
            address(asset),
            ASSET_AMOUNT,
            ASSET_CHAIN,
            address(assetEscrow),
            120
        );
        rcOrder = second;
        rcDeadline = rc.getOrder(second).deadline;
        rcTerms = rc.termsHash(second);
    }

    function _lockRcPayment() internal {
        vm.startPrank(BUYER);
        usd.approve(address(paymentEscrow), PAYMENT_AMOUNT);
        paymentEscrow.lock(rcOrder, address(usd), PAYMENT_AMOUNT, SELLER, rcTerms, rcDeadline);
        vm.stopPrank();
    }

    function _lockRcAsset() internal {
        vm.startPrank(SELLER);
        asset.approve(address(assetEscrow), ASSET_AMOUNT);
        assetEscrow.lock(rcOrder, address(asset), ASSET_AMOUNT, BUYER, rcTerms, rcDeadline);
        vm.stopPrank();
    }

    function _reactRc(IReactive.LogRecord memory log_) internal {
        vm.prank(RC_SYSTEM);
        rc.react(log_);
    }

    function _rcLockedLog(
        bool payment_,
        address depositor_,
        address counterparty_,
        address token_,
        uint256 amount_
    ) internal view returns (IReactive.LogRecord memory) {
        HandshakeReactive.Venue memory v = rc.getOrder(rcOrder).venue;
        uint256 topic = payment_
            ? uint256(keccak256("PaymentLocked(bytes32,address,address,address,uint256,bytes32,uint256)"))
            : uint256(keccak256("AssetLocked(bytes32,address,address,address,uint256,bytes32,uint256)"));
        return IReactive.LogRecord({
            chainId: payment_ ? v.paymentChainId : v.assetChainId,
            contractAddress: payment_ ? v.paymentEscrow : v.assetEscrow,
            topic0: topic,
            topic1: uint256(rcOrder),
            topic2: uint256(uint160(depositor_)),
            topic3: uint256(uint160(counterparty_)),
            data: abi.encode(token_, amount_, rcTerms, rcDeadline),
            blockNumber: 1,
            opCode: 4,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
    }

    function _rcTerminalLog(bool payment_, bool released_, address party_, uint256 amount_, uint64 nonce_)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        HandshakeReactive.Venue memory v = rc.getOrder(rcOrder).venue;
        uint256 topic;
        if (payment_) {
            topic = released_
                ? uint256(keccak256("PaymentReleased(bytes32,address,uint256,uint64)"))
                : uint256(keccak256("PaymentRefunded(bytes32,address,uint256,uint64)"));
        } else {
            topic = released_
                ? uint256(keccak256("AssetReleased(bytes32,address,uint256,uint64)"))
                : uint256(keccak256("AssetRefunded(bytes32,address,uint256,uint64)"));
        }
        return IReactive.LogRecord({
            chainId: payment_ ? v.paymentChainId : v.assetChainId,
            contractAddress: payment_ ? v.paymentEscrow : v.assetEscrow,
            topic0: topic,
            topic1: uint256(rcOrder),
            topic2: uint256(uint160(party_)),
            topic3: 0,
            data: abi.encode(amount_, nonce_),
            blockNumber: 2,
            opCode: 3,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
    }

    /// @dev Lost terminal event: settle at nonce 1, suppress delivery, retry at nonce 2,
    ///      then replay the callbacks. Both escrows re-emit their stored nonce-1 terminal
    ///      events, which the RC's floor/range check accepts, closing both legs.
    function testLostTerminalEventsRecoveredAfterRetry() public {
        _setupReactiveRecovery();
        _lockRcPayment();
        _lockRcAsset();
        _reactRc(_rcLockedLog(true, BUYER, SELLER, address(usd), PAYMENT_AMOUNT));
        _reactRc(_rcLockedLog(false, SELLER, BUYER, address(asset), ASSET_AMOUNT));
        assertTrue(rc.getOrder(rcOrder).settleRequested);
        assertEq(rc.getOrder(rcOrder).nonce, 1);
        assertEq(rcSys.callbackCount(), 2);

        // Original terminal callbacks execute on the escrows but their events are lost.
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (RC_SYSTEM, rcOrder, SELLER, PAYMENT_AMOUNT, 1))
        );
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(RC_SYSTEM, rcOrder, SELLER, BUYER, ASSET_AMOUNT, 1);
        assertFalse(rc.getOrder(rcOrder).paymentClosed);
        assertFalse(rc.getOrder(rcOrder).assetClosed);

        vm.warp(block.timestamp + 31);
        vm.prank(STRANGER); // permissionless
        rc.retry(rcOrder);
        assertEq(rc.getOrder(rcOrder).nonce, 2);

        // Retry callbacks replay on already-terminal legs: truthful stored nonce 1 events.
        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentReleased(rcOrder, SELLER, PAYMENT_AMOUNT, 1);
        MockCallbackProxy(BASE_PROXY).forward(
            address(paymentEscrow), abi.encodeCall(PaymentEscrow.release, (RC_SYSTEM, rcOrder, SELLER, PAYMENT_AMOUNT, 2))
        );
        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetReleased(rcOrder, BUYER, ASSET_AMOUNT, 1);
        vm.prank(UNICHAIN_PROXY);
        assetEscrow.release(RC_SYSTEM, rcOrder, SELLER, BUYER, ASSET_AMOUNT, 2);

        _reactRc(_rcTerminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        assertTrue(rc.getOrder(rcOrder).paymentClosed);
        assertFalse(rc.getOrder(rcOrder).assetClosed);
        _reactRc(_rcTerminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        assertTrue(rc.isClosed(rcOrder));
    }

    /// @dev Lost Locked events: nobody told the RC about the legs. Permissionless
    ///      reannounce replays the stored terms; past the deadline the RC marks each leg
    ///      seen and requests a refund instead of stranding the depositor. The two legs
    ///      use separate orders because a refund decision already made legitimately sends
    ///      any later asset lock through the race-loser refund path.
    function testReannounceRecoversMissedLocksIntoRefundPath() public {
        _setupReactiveRecovery();
        _lockRcPayment(); // PaymentLocked log lost in transit
        assertFalse(rc.getOrder(rcOrder).paymentSeen);
        vm.warp(rcDeadline + 1);

        vm.expectEmit(true, true, true, true);
        emit PaymentEscrow.PaymentLocked(rcOrder, BUYER, SELLER, address(usd), PAYMENT_AMOUNT, rcTerms, rcDeadline);
        vm.prank(STRANGER); // permissionless
        paymentEscrow.reannounce(rcOrder);
        _reactRc(_rcLockedLog(true, BUYER, SELLER, address(usd), PAYMENT_AMOUNT));

        HandshakeReactive.Order memory o = rc.getOrder(rcOrder);
        assertTrue(o.paymentSeen);
        assertFalse(o.assetSeen);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertTrue(o.paymentRefundRequested);
        assertFalse(o.assetRefundRequested);
        assertEq(rcSys.callbackCount(), 1);
        (,,, bytes memory paymentPayload) = rcSys.callbacks(0);
        assertEq(bytes4(paymentPayload), bytes4(keccak256("refund(address,bytes32,uint64)")));

        // Isolated asset order: the reannounced asset lock becomes the winner's seen leg.
        _createSecondRcOrder();
        _lockRcAsset(); // AssetLocked log lost in transit
        vm.warp(rcDeadline + 1);
        vm.expectEmit(true, true, true, true);
        emit AssetEscrow.AssetLocked(rcOrder, SELLER, BUYER, address(asset), ASSET_AMOUNT, rcTerms, rcDeadline);
        vm.prank(STRANGER);
        assetEscrow.reannounce(rcOrder, SELLER);
        _reactRc(_rcLockedLog(false, SELLER, BUYER, address(asset), ASSET_AMOUNT));

        o = rc.getOrder(rcOrder);
        assertTrue(o.assetSeen);
        assertFalse(o.paymentSeen);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertTrue(o.assetRefundRequested);
        assertEq(o.winner, SELLER);
        assertEq(rcSys.callbackCount(), 2);
        (,,, bytes memory assetPayload) = rcSys.callbacks(1);
        assertEq(bytes4(assetPayload), bytes4(keccak256("refund(address,bytes32,address,uint64)")));
    }
}
