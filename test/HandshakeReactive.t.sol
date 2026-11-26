// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {HandshakeReactive} from "../src/HandshakeReactive.sol";
import {MockSystemContract} from "./Mocks.sol";

contract HandshakeReactiveTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address constant LEGACY_SYSTEM = 0x0000000000000000000000000000000000fffFfF;
    address constant BASE_ESCROW = address(0xE5B);
    address constant UNICHAIN_ESCROW = address(0xE5A);

    address constant BUYER = address(0xB0B);
    address constant SELLER = address(0x51E);
    address constant SELLER_TWO = address(0x520);
    address constant STRANGER = address(0xD00D);

    address constant PAYMENT_TOKEN = address(0x1111);
    address constant ASSET_TOKEN = address(0x2222);

    uint256 constant PAYMENT_AMOUNT = 100e6;
    uint256 constant ASSET_AMOUNT = 1e18;

    uint256 constant PAYMENT_LOCKED_TOPIC =
        uint256(keccak256("PaymentLocked(bytes32,address,address,address,uint256,bytes32,uint256)"));
    uint256 constant ASSET_LOCKED_TOPIC =
        uint256(keccak256("AssetLocked(bytes32,address,address,address,uint256,bytes32,uint256)"));
    uint256 constant PAYMENT_RELEASED_TOPIC = uint256(keccak256("PaymentReleased(bytes32,address,uint256,uint64)"));
    uint256 constant ASSET_RELEASED_TOPIC = uint256(keccak256("AssetReleased(bytes32,address,uint256,uint64)"));
    uint256 constant PAYMENT_REFUNDED_TOPIC = uint256(keccak256("PaymentRefunded(bytes32,address,uint256,uint64)"));
    uint256 constant ASSET_REFUNDED_TOPIC = uint256(keccak256("AssetRefunded(bytes32,address,uint256,uint64)"));
    uint256 constant CRON10_TOPIC = uint256(keccak256("Cron10(uint256)"));

    bytes4 constant RELEASE_PAYMENT_SELECTOR = bytes4(keccak256("release(address,bytes32,address,uint256,uint64)"));
    bytes4 constant RELEASE_ASSET_SELECTOR =
        bytes4(keccak256("release(address,bytes32,address,address,uint256,uint64)"));
    bytes4 constant REFUND_PAYMENT_SELECTOR = bytes4(keccak256("refund(address,bytes32,uint64)"));
    bytes4 constant REFUND_ASSET_SELECTOR = bytes4(keccak256("refund(address,bytes32,address,uint64)"));

    struct CallbackRecord {
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    MockSystemContract sys;
    HandshakeReactive rc;
    bytes32 id;
    uint256 deadline;
    bytes32 terms;

    function setUp() public {
        vm.etch(SYSTEM, address(new MockSystemContract()).code);
        sys = MockSystemContract(payable(SYSTEM));
        rc = new HandshakeReactive{value: 1 ether}();
        rc.setVenues(84532, BASE_ESCROW, 1301, UNICHAIN_ESCROW);
        _createOrder(keccak256("order-1"), 120);
        _useOrder(keccak256("order-1"));
    }

    function _createOrder(bytes32 orderId_, uint256 duration_) internal {
        vm.prank(BUYER);
        rc.createOrder(orderId_, SELLER, PAYMENT_TOKEN, PAYMENT_AMOUNT, ASSET_TOKEN, ASSET_AMOUNT, duration_);
    }

    function _useOrder(bytes32 orderId_) internal {
        id = orderId_;
        HandshakeReactive.Order memory o = rc.getOrder(orderId_);
        deadline = o.deadline;
        terms = rc.termsHash(orderId_);
    }

    function _react(IReactive.LogRecord memory log_) internal {
        vm.prank(SYSTEM);
        rc.react(log_);
    }

    function _callback(uint256 index_) internal view returns (CallbackRecord memory r) {
        (r.chainId, r.recipient, r.gasLimit, r.payload) = sys.callbacks(index_);
    }

    /// @dev Strip the 4-byte selector so the ABI arguments can be decoded.
    function _args(bytes memory payload_) internal pure returns (bytes memory) {
        bytes memory out_ = new bytes(payload_.length - 4);
        for (uint256 i = 4; i < payload_.length; i++) {
            out_[i - 4] = payload_[i];
        }
        return out_;
    }

    function _lockedLog(bool payment_, address depositor_, address counterparty_)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return IReactive.LogRecord({
            chainId: payment_ ? uint256(84532) : uint256(1301),
            contractAddress: payment_ ? BASE_ESCROW : UNICHAIN_ESCROW,
            topic0: payment_ ? PAYMENT_LOCKED_TOPIC : ASSET_LOCKED_TOPIC,
            topic1: uint256(id),
            topic2: uint256(uint160(depositor_)),
            topic3: uint256(uint160(counterparty_)),
            data: abi.encode(
                payment_ ? PAYMENT_TOKEN : ASSET_TOKEN, payment_ ? PAYMENT_AMOUNT : ASSET_AMOUNT, terms, deadline
            ),
            blockNumber: 1,
            opCode: 4,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
    }

    function _terminalLog(bool payment_, bool release_, address recipient_, uint256 amount_, uint64 nonce_)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        return IReactive.LogRecord({
            chainId: payment_ ? uint256(84532) : uint256(1301),
            contractAddress: payment_ ? BASE_ESCROW : UNICHAIN_ESCROW,
            topic0: payment_
                ? (release_ ? PAYMENT_RELEASED_TOPIC : PAYMENT_REFUNDED_TOPIC)
                : (release_ ? ASSET_RELEASED_TOPIC : ASSET_REFUNDED_TOPIC),
            topic1: uint256(id),
            topic2: uint256(uint160(recipient_)),
            topic3: 0,
            data: abi.encode(amount_, nonce_),
            blockNumber: 2,
            opCode: 3,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
    }

    function _cronLog() internal pure returns (IReactive.LogRecord memory) {
        return _cronLog(LEGACY_SYSTEM, CRON10_TOPIC);
    }

    function _cronLog(address contract_, uint256 topic_) internal pure returns (IReactive.LogRecord memory) {
        return IReactive.LogRecord({
            chainId: 5318007,
            contractAddress: contract_,
            topic0: topic_,
            topic1: 0,
            topic2: 0,
            topic3: 0,
            data: abi.encode(uint256(1)),
            blockNumber: 3,
            opCode: 1,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
    }

    function _paymentLock() internal {
        _useOrder(id);
        _react(_lockedLog(true, BUYER, SELLER));
    }

    function _assetLock() internal {
        _useOrder(id);
        _react(_lockedLog(false, SELLER, BUYER));
    }

    // ------------------------------------------------------------ order creation

    function testCreateOrderStoresBuyerTermsAndDeadline() public {
        _useOrder(keccak256("order-1"));
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(o.buyer, BUYER);
        assertEq(o.seller, SELLER);
        assertEq(o.paymentToken, PAYMENT_TOKEN);
        assertEq(o.paymentAmount, PAYMENT_AMOUNT);
        assertEq(o.assetToken, ASSET_TOKEN);
        assertEq(o.assetAmount, ASSET_AMOUNT);
        assertEq(o.deadline, block.timestamp + 120);
        assertEq(rc.orderCount(), 1);
        assertEq(rc.orderIds(0), id);
        assertEq(o.nonce, 0);
        assertFalse(o.paymentClosed);
        assertFalse(o.assetClosed);
    }

    function testCreateOrderValidations() public {
        bytes32 duplicate = keccak256("order-1");
        vm.expectRevert(abi.encodeWithSignature("DuplicateOrder()"));
        _createOrder(duplicate, 120);

        vm.expectRevert(abi.encodeWithSignature("ZeroAmount()"));
        vm.prank(BUYER);
        rc.createOrder(keccak256("zero"), SELLER, PAYMENT_TOKEN, 0, ASSET_TOKEN, ASSET_AMOUNT, 120);

        vm.expectRevert(abi.encodeWithSignature("InvalidDuration()"));
        vm.prank(BUYER);
        rc.createOrder(keccak256("short"), SELLER, PAYMENT_TOKEN, PAYMENT_AMOUNT, ASSET_TOKEN, ASSET_AMOUNT, 29);

        vm.expectRevert(abi.encodeWithSignature("InvalidDuration()"));
        vm.prank(BUYER);
        rc.createOrder(keccak256("long"), SELLER, PAYMENT_TOKEN, PAYMENT_AMOUNT, ASSET_TOKEN, ASSET_AMOUNT, 31 days);

        vm.expectRevert(abi.encodeWithSignature("InvalidSeller()"));
        vm.prank(BUYER);
        rc.createOrder(keccak256("self"), BUYER, PAYMENT_TOKEN, PAYMENT_AMOUNT, ASSET_TOKEN, ASSET_AMOUNT, 120);

        assertEq(rc.orderCount(), 1);
    }

    // --------------------------------------------------------------- subscriptions

    function testSetVenuesOwnerOnlyAndInstallsSevenSubscriptions() public view {
        (uint256 paymentChain, address paymentAddr, uint256 assetChain, address assetAddr) = rc.venues();
        assertEq(paymentChain, 84532);
        assertEq(paymentAddr, BASE_ESCROW);
        assertEq(assetChain, 1301);
        assertEq(assetAddr, UNICHAIN_ESCROW);
        assertTrue(rc.venuesSet());
        assertEq(sys.subscriptionCount(), 7);

        uint256[7] memory expectedTopics = [
            PAYMENT_LOCKED_TOPIC,
            ASSET_LOCKED_TOPIC,
            PAYMENT_RELEASED_TOPIC,
            PAYMENT_REFUNDED_TOPIC,
            ASSET_RELEASED_TOPIC,
            ASSET_REFUNDED_TOPIC,
            CRON10_TOPIC
        ];
        uint256[7] memory expectedChains = [uint256(84532), 1301, 84532, 84532, 1301, 1301, block.chainid];
        address[7] memory expectedContracts =
            [BASE_ESCROW, UNICHAIN_ESCROW, BASE_ESCROW, BASE_ESCROW, UNICHAIN_ESCROW, UNICHAIN_ESCROW, LEGACY_SYSTEM];
        for (uint256 i = 0; i < 7; i++) {
            (uint256 chain, address contract_, uint256 topic0, uint256 t1, uint256 t2, uint256 t3) =
                sys.subscriptions(i);
            assertEq(topic0, expectedTopics[i]);
            assertEq(chain, expectedChains[i]);
            assertEq(contract_, expectedContracts[i]);
            assertEq(t1, 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad);
            assertEq(t2, t1);
            assertEq(t3, t1);
        }
    }

    function testNonOwnerCannotChangeVenuesOrUnsubscribe() public {
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", STRANGER));
        vm.prank(STRANGER);
        rc.setVenues(84532, STRANGER, 1301, STRANGER);

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", STRANGER));
        vm.prank(STRANGER);
        rc.unsubscribeAll();
    }

    function testSetVenuesRejectsMainnetChainIds() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenues(1, BASE_ESCROW, 1301, UNICHAIN_ESCROW);
    }

    // --------------------------------------------------------------- happy paths

    function testPaymentFirstLockRequestsTwoCallbacksInOneReact() public {
        _useOrder(id);
        _react(_lockedLog(true, BUYER, SELLER));
        assertTrue(rc.getOrder(id).paymentSeen);
        assertFalse(rc.getOrder(id).assetSeen);
        assertEq(sys.callbackCount(), 0);

        _react(_lockedLog(false, SELLER, BUYER));
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertTrue(o.paymentSeen);
        assertTrue(o.assetSeen);
        assertTrue(o.settleRequested);
        assertEq(o.nonce, 1);
        assertEq(sys.callbackCount(), 2);

        CallbackRecord memory p = _callback(0);
        assertEq(p.chainId, 84532);
        assertEq(p.recipient, BASE_ESCROW);
        assertEq(p.gasLimit, 500_000);
        assertEq(bytes4(p.payload), RELEASE_PAYMENT_SELECTOR);
        (address injected, bytes32 cbOrder, address recipient, uint256 amount, uint64 nonce) =
            abi.decode(_args(p.payload), (address, bytes32, address, uint256, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(recipient, SELLER);
        assertEq(amount, PAYMENT_AMOUNT);
        assertEq(nonce, 1);

        CallbackRecord memory a = _callback(1);
        assertEq(a.chainId, 1301);
        assertEq(a.recipient, UNICHAIN_ESCROW);
        assertEq(a.gasLimit, 500_000);
        assertEq(bytes4(a.payload), RELEASE_ASSET_SELECTOR);
        (address injectedA, bytes32 cbOrderA, address seller, address buyer, uint256 assetAmount, uint64 nonceA) =
            abi.decode(_args(a.payload), (address, bytes32, address, address, uint256, uint64));
        assertEq(injectedA, address(0));
        assertEq(cbOrderA, id);
        assertEq(seller, SELLER);
        assertEq(buyer, BUYER);
        assertEq(assetAmount, ASSET_AMOUNT);
        assertEq(nonceA, 1);
    }

    function testAssetFirstLockRequestsTwoCallbacksInOneReact() public {
        _useOrder(id);
        _react(_lockedLog(false, SELLER, BUYER));
        assertEq(sys.callbackCount(), 0);
        assertEq(rc.getOrder(id).winner, SELLER);

        _react(_lockedLog(true, BUYER, SELLER));
        assertTrue(rc.getOrder(id).settleRequested);
        assertEq(sys.callbackCount(), 2);
        assertEq(_callback(0).recipient, BASE_ESCROW);
        assertEq(_callback(1).recipient, UNICHAIN_ESCROW);
    }

    function testTerminalEventClosesOnlyItsOwnLeg() public {
        _paymentLock();
        _assetLock();
        assertEq(sys.callbackCount(), 2);

        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        assertTrue(rc.getOrder(id).paymentClosed);
        assertFalse(rc.getOrder(id).assetClosed);
        assertFalse(rc.isClosed(id));

        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        assertTrue(rc.getOrder(id).assetClosed);
        assertTrue(rc.isClosed(id));
    }

    function testStaleTerminalNonceIsIgnored() public {
        _paymentLock();
        _assetLock();
        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 0));
        assertFalse(rc.getOrder(id).paymentClosed);

        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        assertTrue(rc.getOrder(id).paymentClosed);
    }

    function testReactFromEoaReverts() public {
        _useOrder(id);
        vm.expectRevert();
        vm.prank(STRANGER);
        rc.react(_lockedLog(true, BUYER, SELLER));
    }

    function testUnknownTopicAndUnknownOrderAreNoOps() public {
        _useOrder(id);
        IReactive.LogRecord memory log_ = _lockedLog(true, BUYER, SELLER);
        log_.topic0 = 0xdeadbeef;
        _react(log_);

        bytes32 savedId = id;
        id = keccak256("never-created");
        _react(_lockedLog(true, BUYER, SELLER));
        id = savedId;

        assertEq(sys.callbackCount(), 0);
        assertFalse(rc.getOrder(id).paymentSeen);
    }

    // -------------------------------------------------------------- invalid terms

    function testTermsHashMismatchMarksInvalidAndRefundsBothLegs() public {
        _useOrder(id);
        _react(_lockedLog(true, BUYER, SELLER));

        IReactive.LogRecord memory assetLog = _lockedLog(false, SELLER, BUYER);
        assetLog.data = abi.encode(ASSET_TOKEN, ASSET_AMOUNT, bytes32("wrong-terms"), deadline);
        _react(assetLog);

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertTrue(o.invalid);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);
        assertEq(bytes4(_callback(1).payload), REFUND_ASSET_SELECTOR);
        (address injected, bytes32 cbOrder, uint64 paymentNonce) =
            abi.decode(_args(_callback(0).payload), (address, bytes32, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(paymentNonce, 1);
    }

    // ------------------------------------------------------- deadline / cron logic

    function testRefundAfterDeadlineViaCronAndCooldown() public {
        _useOrder(id);
        _paymentLock();
        vm.warp(deadline + 1);

        _react(_cronLog());
        assertEq(sys.callbackCount(), 1);
        assertTrue(rc.getOrder(id).refundRequested);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);

        // Another tick 10s later must not spam the destination proxy.
        vm.warp(block.timestamp + 10);
        _react(_cronLog());
        assertEq(sys.callbackCount(), 1);

        // After the 30s cooldown the still-open leg can be retried by cron.
        vm.warp(block.timestamp + 21);
        _react(_cronLog());
        assertEq(sys.callbackCount(), 2);
    }

    function testStrictCronFilter() public {
        _useOrder(id);
        _paymentLock();
        vm.warp(deadline + 1);

        _react(_cronLog(BASE_ESCROW, CRON10_TOPIC)); // right topic, wrong contract
        assertEq(sys.callbackCount(), 0);

        _react(_cronLog(LEGACY_SYSTEM, uint256(keccak256("Cron1(uint256)")))); // wrong topic
        assertEq(sys.callbackCount(), 0);

        assertFalse(rc.getOrder(id).refundRequested);
    }

    function testLateLockedAfterRefundRequestedIsRefundedImmediately() public {
        _useOrder(id);
        _paymentLock();
        vm.warp(deadline + 1);
        _react(_cronLog());
        assertEq(sys.callbackCount(), 1);

        // The payment lock log is delivered only after the refund decision.
        _react(_lockedLog(true, BUYER, SELLER));
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(sys.callbackCount(), 2);
        assertEq(o.nonce, 2);
        assertTrue(o.paymentRefundRequested);
        assertFalse(o.settleRequested);
        assertEq(bytes4(_callback(1).payload), REFUND_PAYMENT_SELECTOR);
        (address injected, bytes32 cbOrder, uint64 nonce) =
            abi.decode(_args(_callback(1).payload), (address, bytes32, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(nonce, 2);
    }

    function testBothLockedButSecondEventLateRoutesToRefund() public {
        _useOrder(id);
        _paymentLock();
        vm.warp(deadline + 1);
        _react(_lockedLog(false, SELLER, BUYER));

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);
        assertEq(bytes4(_callback(1).payload), REFUND_ASSET_SELECTOR);
    }

    function testCronSweepProcessesAtMostEightOrdersPerTick() public {
        _useOrder(id);
        for (uint256 i = 2; i <= 13; i++) {
            bytes32 newId = keccak256(abi.encodePacked("order", i));
            _createOrder(newId, 120);
        }
        assertEq(rc.orderCount(), 13);
        vm.warp(block.timestamp + 121);

        _react(_cronLog());
        assertLe(sys.callbackCount(), 16); // 8 orders x 2 legs max
        assertEq(rc.sweepCursor(), 8);
    }

    // --------------------------------------------------------------- retry paths

    function testRetryReleaseModeOnlyOpenLeg() public {
        _paymentLock();
        _assetLock();
        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        assertTrue(rc.getOrder(id).paymentClosed);
        assertFalse(rc.getOrder(id).assetClosed);

        vm.warp(block.timestamp + 31);
        vm.prank(STRANGER); // retry is permissionless
        rc.retry(id);

        assertEq(sys.callbackCount(), 3);
        assertEq(_callback(2).recipient, UNICHAIN_ESCROW);
        assertEq(bytes4(_callback(2).payload), RELEASE_ASSET_SELECTOR);
        (,,,,, uint64 nonce) =
            abi.decode(_args(_callback(2).payload), (address, bytes32, address, address, uint256, uint64));
        assertEq(nonce, 2);
        assertTrue(rc.getOrder(id).paymentClosed);

        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 2));
        assertTrue(rc.isClosed(id));
        sys.resetCallbacks();
        vm.warp(block.timestamp + 31);
        rc.retry(id);
        assertEq(sys.callbackCount(), 0); // terminal order: no-op
    }

    function testRetryRefundMode() public {
        _paymentLock();
        vm.warp(deadline + 1);
        _react(_cronLog());
        assertEq(sys.callbackCount(), 1);

        vm.warp(block.timestamp + 31);
        vm.prank(STRANGER);
        rc.retry(id);
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(1).payload), REFUND_PAYMENT_SELECTOR);
        (address injected, bytes32 cbOrder, uint64 nonce) =
            abi.decode(_args(_callback(1).payload), (address, bytes32, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(nonce, 2);
    }

    function testRetryCooldownReverts() public {
        _paymentLock();
        _assetLock();
        vm.expectRevert(abi.encodeWithSignature("CooldownActive()"));
        vm.prank(STRANGER);
        rc.retry(id);
    }

    function testRetryBeforeAnyRequestIsNoOp() public {
        _useOrder(id);
        vm.prank(STRANGER);
        rc.retry(id);
        assertEq(sys.callbackCount(), 0);
    }

    // ------------------------------------------------------------------ race mode

    function testRaceModeWinnerAndLoserRefund() public {
        _useOrder(id);
        _react(_lockedLog(true, BUYER, SELLER));
        _react(_lockedLog(false, SELLER, BUYER)); // first asset lock wins

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(o.winner, SELLER);
        assertEq(o.assetLockCount, 1);
        assertEq(sys.callbackCount(), 2);

        // Second seller races and loses: single-leg refund, global nonce bumps.
        _react(_lockedLog(false, SELLER_TWO, BUYER));
        o = rc.getOrder(id);
        assertEq(o.winner, SELLER);
        assertEq(o.assetLockCount, 2);
        assertEq(o.nonce, 2);
        assertTrue(o.settleRequested);
        assertEq(sys.callbackCount(), 3);
        assertEq(_callback(2).recipient, UNICHAIN_ESCROW);
        assertEq(bytes4(_callback(2).payload), REFUND_ASSET_SELECTOR);
        (address injected, bytes32 cbOrder, address loser, uint64 nonce) =
            abi.decode(_args(_callback(2).payload), (address, bytes32, address, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(loser, SELLER_TWO);
        assertEq(nonce, 2);

        // Loser refund event must not close the winner's asset leg.
        _react(_terminalLog(false, false, SELLER_TWO, ASSET_AMOUNT, 2));
        assertFalse(rc.getOrder(id).assetClosed);

        // Winner settlement callbacks were requested with nonce 1 and still confirm.
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        assertTrue(rc.isClosed(id));
    }

    // --------------------------------------------------------- debt / unsubscribe

    function testCoverDebtAndUnsubscribeAll() public {
        sys.setDebt(address(rc), 0.1 ether);
        rc.coverDebt();
        assertEq(sys.received(), 0.1 ether);

        rc.unsubscribeAll();
        assertFalse(rc.venuesSet());
        assertEq(sys.unsubscriptionCount(), 7);
    }
}
