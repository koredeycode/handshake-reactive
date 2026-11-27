// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";
import {AssetEscrow} from "../src/AssetEscrow.sol";
import {TestUSD} from "../src/tokens/TestUSD.sol";
import {TestAsset} from "../src/tokens/TestAsset.sol";
import {FeeOnTransferToken, MockCallbackProxy, ReentrantToken} from "./Mocks.sol";

contract EscrowTest is Test {
    address constant BASE_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    address constant UNICHAIN_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    address constant SEPOLIA_PROXY = 0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4;
    address constant REACTIVE = address(0xA11CE);

    address constant BUYER = address(0xB0B);
    address constant SELLER = address(0x51E);
    address constant SELLER_TWO = address(0x520);

    bytes32 constant ORDER = keccak256("order-escrow");
    bytes32 constant TERMS = bytes32("terms");
    uint256 constant PAYMENT_AMOUNT = 100e6;
    uint256 constant ASSET_AMOUNT = 1e18;

    TestUSD usd;
    TestAsset asset;
    PaymentEscrow paymentEscrow;
    AssetEscrow assetEscrow;
    uint256 deadline;

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
}
