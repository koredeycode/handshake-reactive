// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {HandshakeReactive} from "../src/HandshakeReactive.sol";
import {MockSystemContract} from "./Mocks.sol";

contract HandshakeReactiveTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address constant LEGACY_SYSTEM = 0x0000000000000000000000000000000000fffFfF;

    uint256 constant BASE_CHAIN = 84532;
    uint256 constant UNICHAIN_CHAIN = 1301;
    uint256 constant SEPOLIA_CHAIN = 11155111;

    // Six distinct escrows: one payment + one asset per registered chain.
    address constant BASE_ESCROW = address(0xE5B); // base payment (the default payment leg)
    address constant BASE_ASSET_ESCROW = address(0xE5B2);
    address constant UNICHAIN_PAYMENT_ESCROW = address(0xE5A2);
    address constant UNICHAIN_ESCROW = address(0xE5A); // unichain asset (the default asset leg)
    address constant SEPOLIA_PAYMENT_ESCROW = address(0xE5E1);
    address constant SEPOLIA_ASSET_ESCROW = address(0xE5E2);

    // Fresh escrows for the venue-replacement test.
    address constant NEW_PAYMENT_ESCROW = address(0xE5C1);
    address constant NEW_ASSET_ESCROW = address(0xE5C2);

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
        rc.setVenue(BASE_CHAIN, BASE_ESCROW, BASE_ASSET_ESCROW);
        rc.setVenue(UNICHAIN_CHAIN, UNICHAIN_PAYMENT_ESCROW, UNICHAIN_ESCROW);
        rc.setVenue(SEPOLIA_CHAIN, SEPOLIA_PAYMENT_ESCROW, SEPOLIA_ASSET_ESCROW);
        _createOrder(keccak256("order-1"), 120);
        _useOrder(keccak256("order-1"));
    }

    // ------------------------------------------------------------------- helpers

    function _createOrderWith(
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
        uint256 duration_
    ) internal {
        vm.prank(BUYER);
        rc.createOrder(
            orderId_,
            seller_,
            paymentToken_,
            paymentAmount_,
            paymentChainId_,
            paymentEscrow_,
            assetToken_,
            assetAmount_,
            assetChainId_,
            assetEscrow_,
            duration_
        );
    }

    function _createOrderAt(
        bytes32 orderId_,
        address seller_,
        uint256 paymentChainId_,
        address paymentEscrow_,
        uint256 assetChainId_,
        address assetEscrow_,
        uint256 duration_
    ) internal {
        _createOrderWith(
            orderId_,
            seller_,
            PAYMENT_TOKEN,
            PAYMENT_AMOUNT,
            paymentChainId_,
            paymentEscrow_,
            ASSET_TOKEN,
            ASSET_AMOUNT,
            assetChainId_,
            assetEscrow_,
            duration_
        );
    }

    /// @dev The default order: payment on Base, asset on Unichain.
    function _createOrder(bytes32 orderId_, uint256 duration_) internal {
        _createOrderAt(orderId_, SELLER, BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, duration_);
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

    /// @dev Build a Locked log from an explicit chain + escrow (for venue-filter tests).
    function _lockedLogFrom(
        bool payment_,
        address depositor_,
        address counterparty_,
        uint256 chainId_,
        address escrow_
    ) internal view returns (IReactive.LogRecord memory) {
        return IReactive.LogRecord({
            chainId: chainId_,
            contractAddress: escrow_,
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

    /// @dev Locked logs follow the *order's venue*, not a hardcoded chain/escrow pair.
    function _lockedLog(bool payment_, address depositor_, address counterparty_)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        HandshakeReactive.Venue memory v = rc.getOrder(id).venue;
        return _lockedLogFrom(
            payment_,
            depositor_,
            counterparty_,
            payment_ ? v.paymentChainId : v.assetChainId,
            payment_ ? v.paymentEscrow : v.assetEscrow
        );
    }

    /// @dev Build a terminal log from an explicit chain + escrow.
    function _terminalLogFrom(
        bool payment_,
        bool release_,
        address recipient_,
        uint256 amount_,
        uint64 nonce_,
        uint256 chainId_,
        address escrow_
    ) internal view returns (IReactive.LogRecord memory) {
        return IReactive.LogRecord({
            chainId: chainId_,
            contractAddress: escrow_,
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

    function _terminalLog(bool payment_, bool release_, address recipient_, uint256 amount_, uint64 nonce_)
        internal
        view
        returns (IReactive.LogRecord memory)
    {
        HandshakeReactive.Venue memory v = rc.getOrder(id).venue;
        return _terminalLogFrom(
            payment_,
            release_,
            recipient_,
            amount_,
            nonce_,
            payment_ ? v.paymentChainId : v.assetChainId,
            payment_ ? v.paymentEscrow : v.assetEscrow
        );
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

    /// @dev The six subscriptions a venue contributes, in the order setVenue() installs them.
    function _fillVenueExpectations(
        uint256[] memory topics_,
        uint256[] memory chains_,
        address[] memory contracts_,
        uint256 offset_,
        uint256 chainId_,
        address paymentEscrow_,
        address assetEscrow_
    ) internal pure {
        topics_[offset_] = PAYMENT_LOCKED_TOPIC;
        chains_[offset_] = chainId_;
        contracts_[offset_] = paymentEscrow_;
        topics_[offset_ + 1] = PAYMENT_RELEASED_TOPIC;
        chains_[offset_ + 1] = chainId_;
        contracts_[offset_ + 1] = paymentEscrow_;
        topics_[offset_ + 2] = PAYMENT_REFUNDED_TOPIC;
        chains_[offset_ + 2] = chainId_;
        contracts_[offset_ + 2] = paymentEscrow_;
        topics_[offset_ + 3] = ASSET_LOCKED_TOPIC;
        chains_[offset_ + 3] = chainId_;
        contracts_[offset_ + 3] = assetEscrow_;
        topics_[offset_ + 4] = ASSET_RELEASED_TOPIC;
        chains_[offset_ + 4] = chainId_;
        contracts_[offset_ + 4] = assetEscrow_;
        topics_[offset_ + 5] = ASSET_REFUNDED_TOPIC;
        chains_[offset_ + 5] = chainId_;
        contracts_[offset_ + 5] = assetEscrow_;
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
        assertEq(o.venue.paymentChainId, BASE_CHAIN);
        assertEq(o.venue.paymentEscrow, BASE_ESCROW);
        assertEq(o.venue.assetChainId, UNICHAIN_CHAIN);
        assertEq(o.venue.assetEscrow, UNICHAIN_ESCROW);
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
        _createOrderWith(
            keccak256("zero"), SELLER, PAYMENT_TOKEN, 0, BASE_CHAIN, BASE_ESCROW, ASSET_TOKEN, ASSET_AMOUNT,
            UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120
        );

        vm.expectRevert(abi.encodeWithSignature("ZeroAmount()"));
        _createOrderWith(
            keccak256("zero-asset"), SELLER, PAYMENT_TOKEN, PAYMENT_AMOUNT, BASE_CHAIN, BASE_ESCROW, ASSET_TOKEN, 0,
            UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120
        );

        vm.expectRevert(abi.encodeWithSignature("InvalidToken()"));
        _createOrderWith(
            keccak256("bad-token"), SELLER, address(0), PAYMENT_AMOUNT, BASE_CHAIN, BASE_ESCROW, ASSET_TOKEN,
            ASSET_AMOUNT, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120
        );

        vm.expectRevert(abi.encodeWithSignature("InvalidDuration()"));
        _createOrder(keccak256("short"), 29);

        vm.expectRevert(abi.encodeWithSignature("InvalidDuration()"));
        _createOrder(keccak256("long"), 31 days);

        vm.expectRevert(abi.encodeWithSignature("InvalidSeller()"));
        _createOrderAt(keccak256("self"), BUYER, BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120);

        assertEq(rc.orderCount(), 1);
    }

    // --------------------------------------------------------------- subscriptions

    function testSetVenueOwnerOnlyAndInstallsNineteenSubscriptions() public view {
        (address paymentEscrow, address assetEscrow, bool registered) = rc.venue(BASE_CHAIN);
        assertEq(paymentEscrow, BASE_ESCROW);
        assertEq(assetEscrow, BASE_ASSET_ESCROW);
        assertTrue(registered);
        (paymentEscrow, assetEscrow, registered) = rc.venue(UNICHAIN_CHAIN);
        assertEq(paymentEscrow, UNICHAIN_PAYMENT_ESCROW);
        assertEq(assetEscrow, UNICHAIN_ESCROW);
        assertTrue(registered);
        (paymentEscrow, assetEscrow, registered) = rc.venue(SEPOLIA_CHAIN);
        assertEq(paymentEscrow, SEPOLIA_PAYMENT_ESCROW);
        assertEq(assetEscrow, SEPOLIA_ASSET_ESCROW);
        assertTrue(registered);

        uint256[] memory chains = rc.registeredChainIds();
        assertEq(chains.length, 3);
        assertEq(chains[0], BASE_CHAIN);
        assertEq(chains[1], UNICHAIN_CHAIN);
        assertEq(chains[2], SEPOLIA_CHAIN);
        assertTrue(rc.cronSubscribed());
        assertEq(rc.subscriptionCount(), 19);
        assertEq(sys.subscriptionCount(), 19);

        uint256[] memory expectedTopics = new uint256[](19);
        uint256[] memory expectedChains = new uint256[](19);
        address[] memory expectedContracts = new address[](19);

        _fillVenueExpectations(expectedTopics, expectedChains, expectedContracts, 0, BASE_CHAIN, BASE_ESCROW, BASE_ASSET_ESCROW);
        // Cron is installed once, immediately after the first venue.
        expectedTopics[6] = CRON10_TOPIC;
        expectedChains[6] = block.chainid;
        expectedContracts[6] = LEGACY_SYSTEM;
        _fillVenueExpectations(
            expectedTopics, expectedChains, expectedContracts, 7, UNICHAIN_CHAIN, UNICHAIN_PAYMENT_ESCROW, UNICHAIN_ESCROW
        );
        _fillVenueExpectations(
            expectedTopics, expectedChains, expectedContracts, 13, SEPOLIA_CHAIN, SEPOLIA_PAYMENT_ESCROW,
            SEPOLIA_ASSET_ESCROW
        );

        for (uint256 i = 0; i < 19; i++) {
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
        rc.setVenue(BASE_CHAIN, STRANGER, STRANGER);

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", STRANGER));
        vm.prank(STRANGER);
        rc.unsubscribeAll();
    }

    function testSetVenueRejectsMainnetChainIds() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(1, BASE_ESCROW, BASE_ASSET_ESCROW);
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(11155110, SEPOLIA_PAYMENT_ESCROW, SEPOLIA_ASSET_ESCROW);
        assertEq(sys.subscriptionCount(), 19);
    }

    function testSetVenueRejectsInvalidEscrowConfigurations() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(BASE_CHAIN, address(0), BASE_ASSET_ESCROW);

        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(BASE_CHAIN, BASE_ESCROW, address(0));

        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(BASE_CHAIN, BASE_ESCROW, BASE_ESCROW);

        // An escrow already registered for another chain cannot be reused.
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(SEPOLIA_CHAIN, BASE_ESCROW, SEPOLIA_ASSET_ESCROW);

        // An asset escrow cannot be re-registered as a payment escrow.
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        rc.setVenue(BASE_CHAIN, BASE_ASSET_ESCROW, NEW_PAYMENT_ESCROW);

        assertEq(sys.subscriptionCount(), 19);
        assertEq(rc.registeredChainIds().length, 3);
    }

    function testReplaceVenueUnsubscribesOldAndSubscribesNew() public {
        uint256 subscriptionsBefore = sys.subscriptionCount();
        uint256 unsubscriptionsBefore = sys.unsubscriptionCount();

        rc.setVenue(BASE_CHAIN, NEW_PAYMENT_ESCROW, NEW_ASSET_ESCROW);

        assertEq(sys.unsubscriptionCount(), unsubscriptionsBefore + 6);
        // The mock logs every subscribe call; it never prunes replaced ones.
        assertEq(sys.subscriptionCount(), subscriptionsBefore + 6);
        // The RC's net active count is unchanged: 6 removed, 6 added, cron untouched.
        assertEq(rc.subscriptionCount(), 19);
        assertTrue(rc.cronSubscribed());

        (address paymentEscrow, address assetEscrow, bool registered) = rc.venue(BASE_CHAIN);
        assertEq(paymentEscrow, NEW_PAYMENT_ESCROW);
        assertEq(assetEscrow, NEW_ASSET_ESCROW);
        assertTrue(registered);

        (uint256 chain, uint8 role, bool escrowRegistered) = rc.escrows(BASE_ESCROW);
        assertEq(chain, 0);
        assertEq(role, 0);
        assertFalse(escrowRegistered);
        (, role, escrowRegistered) = rc.escrows(BASE_ASSET_ESCROW);
        assertFalse(escrowRegistered);
        (chain, role, escrowRegistered) = rc.escrows(NEW_PAYMENT_ESCROW);
        assertEq(chain, BASE_CHAIN);
        assertEq(role, 1);
        assertTrue(escrowRegistered);
        (chain, role, escrowRegistered) = rc.escrows(NEW_ASSET_ESCROW);
        assertEq(chain, BASE_CHAIN);
        assertEq(role, 2);
        assertTrue(escrowRegistered);

        uint256[] memory oldTopics = new uint256[](6);
        oldTopics[0] = PAYMENT_LOCKED_TOPIC;
        oldTopics[1] = PAYMENT_RELEASED_TOPIC;
        oldTopics[2] = PAYMENT_REFUNDED_TOPIC;
        oldTopics[3] = ASSET_LOCKED_TOPIC;
        oldTopics[4] = ASSET_RELEASED_TOPIC;
        oldTopics[5] = ASSET_REFUNDED_TOPIC;
        for (uint256 i = 0; i < 6; i++) {
            (uint256 removedChain, address removedContract, uint256 removedTopic,,,) = sys.unsubscriptions(i);
            assertEq(removedChain, BASE_CHAIN);
            assertEq(removedTopic, oldTopics[i]);
            assertEq(removedContract, i < 3 ? BASE_ESCROW : BASE_ASSET_ESCROW);
        }
    }

    function testCreateOrderRejectsMismatchedOrUnregisteredEscrows() public {
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("unregistered"), SELLER, BASE_CHAIN, STRANGER, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120
        );

        // Registered, but with the wrong role.
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("payment-role"), SELLER, BASE_CHAIN, BASE_ASSET_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120
        );
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("asset-role"), SELLER, BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_PAYMENT_ESCROW, 120
        );

        // Registered with the right role, but on a different chain.
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("payment-chain"), SELLER, BASE_CHAIN, UNICHAIN_PAYMENT_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120
        );
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("asset-chain"), SELLER, BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, SEPOLIA_ASSET_ESCROW, 120
        );

        // Same-chain pairs are never allowed, even with valid per-chain escrows.
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("same-chain-base"), SELLER, BASE_CHAIN, BASE_ESCROW, BASE_CHAIN, BASE_ASSET_ESCROW, 120
        );
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(
            keccak256("same-chain-sepolia"), SELLER, SEPOLIA_CHAIN, SEPOLIA_PAYMENT_ESCROW, SEPOLIA_CHAIN,
            SEPOLIA_ASSET_ESCROW, 120
        );

        // Mainnet is not a venue.
        vm.expectRevert(abi.encodeWithSignature("InvalidVenue()"));
        _createOrderAt(keccak256("mainnet"), SELLER, 1, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120);

        assertEq(rc.orderCount(), 1);
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
        assertEq(p.chainId, BASE_CHAIN);
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
        assertEq(a.chainId, UNICHAIN_CHAIN);
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
        IReactive.LogRecord memory log_ = _lockedLog(true, BUYER, SELLER);
        vm.expectRevert();
        vm.prank(STRANGER);
        rc.react(log_);
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

    // ------------------------------------------------------ venue filtering in react

    function testReactIgnoresLogsFromUnregisteredEscrow() public {
        _useOrder(id);

        IReactive.LogRecord memory lockLog = _lockedLogFrom(true, BUYER, SELLER, BASE_CHAIN, STRANGER);
        _react(lockLog);
        assertEq(sys.callbackCount(), 0);
        assertFalse(rc.getOrder(id).paymentSeen);

        // An unregistered terminal source cannot close a leg either.
        _paymentLock();
        assertEq(sys.callbackCount(), 0);
        _react(_terminalLogFrom(true, true, SELLER, PAYMENT_AMOUNT, 1, BASE_CHAIN, STRANGER));
        assertFalse(rc.getOrder(id).paymentClosed);
    }

    function testReactIgnoresLogsFromDifferentRegisteredEscrow() public {
        _useOrder(id);

        // Correct role, wrong chain/escrow for this order's asset venue.
        _react(_lockedLogFrom(false, SELLER, BUYER, SEPOLIA_CHAIN, SEPOLIA_ASSET_ESCROW));
        assertFalse(rc.getOrder(id).assetSeen);
        assertEq(sys.callbackCount(), 0);

        // Correct role, but the other chain's payment escrow.
        _react(_lockedLogFrom(true, BUYER, SELLER, UNICHAIN_CHAIN, UNICHAIN_PAYMENT_ESCROW));
        assertFalse(rc.getOrder(id).paymentSeen);
        assertEq(sys.callbackCount(), 0);

        // Login from a registered escrow with the wrong role is ignored too.
        _react(_lockedLogFrom(true, BUYER, SELLER, BASE_CHAIN, BASE_ASSET_ESCROW));
        assertFalse(rc.getOrder(id).paymentSeen);

        _paymentLock();
        _react(_terminalLogFrom(true, true, SELLER, PAYMENT_AMOUNT, 1, UNICHAIN_CHAIN, UNICHAIN_PAYMENT_ESCROW));
        assertFalse(rc.getOrder(id).paymentClosed);

        // The genuine venue still works.
        _react(_lockedLog(false, SELLER, BUYER));
        assertTrue(rc.getOrder(id).settleRequested);
        assertEq(sys.callbackCount(), 2);
    }

    function testNonDefaultVenuesAreUsedInCallbackChainIdAndRecipient() public {
        bytes32 sepoliaPaymentId = keccak256("venue-sepolia-payment");
        _createOrderAt(
            sepoliaPaymentId, SELLER, SEPOLIA_CHAIN, SEPOLIA_PAYMENT_ESCROW, BASE_CHAIN, BASE_ASSET_ESCROW, 120
        );
        _useOrder(sepoliaPaymentId);
        _paymentLock();
        _assetLock();

        assertEq(sys.callbackCount(), 2);
        assertEq(_callback(0).chainId, SEPOLIA_CHAIN);
        assertEq(_callback(0).recipient, SEPOLIA_PAYMENT_ESCROW);
        assertEq(_callback(1).chainId, BASE_CHAIN);
        assertEq(_callback(1).recipient, BASE_ASSET_ESCROW);
        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        assertTrue(rc.isClosed(id));

        bytes32 sepoliaAssetId = keccak256("venue-sepolia-asset");
        _createOrderAt(
            sepoliaAssetId, SELLER, BASE_CHAIN, BASE_ESCROW, SEPOLIA_CHAIN, SEPOLIA_ASSET_ESCROW, 120
        );
        _useOrder(sepoliaAssetId);
        sys.resetCallbacks();
        _paymentLock();
        _assetLock();

        assertEq(sys.callbackCount(), 2);
        assertEq(_callback(0).chainId, BASE_CHAIN);
        assertEq(_callback(0).recipient, BASE_ESCROW);
        assertEq(_callback(1).chainId, SEPOLIA_CHAIN);
        assertEq(_callback(1).recipient, SEPOLIA_ASSET_ESCROW);
        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        assertTrue(rc.isClosed(id));
    }

    // -------------------------------------------------------------- invalid terms

    function testTermsHashIncludesVenueFields() public {
        bytes32 first = keccak256("terms-venue-a");
        bytes32 second = keccak256("terms-venue-b");
        _createOrderAt(first, SELLER, BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120);
        _createOrderAt(second, SELLER, BASE_CHAIN, BASE_ESCROW, SEPOLIA_CHAIN, SEPOLIA_ASSET_ESCROW, 120);

        HandshakeReactive.Order memory a = rc.getOrder(first);
        HandshakeReactive.Order memory b = rc.getOrder(second);
        assertEq(a.buyer, b.buyer);
        assertEq(a.seller, b.seller);
        assertEq(a.paymentToken, b.paymentToken);
        assertEq(a.paymentAmount, b.paymentAmount);
        assertEq(a.assetToken, b.assetToken);
        assertEq(a.assetAmount, b.assetAmount);
        assertEq(a.deadline, b.deadline); // identical terms and timing, different venue

        assertEq(
            rc.termsHash(first),
            keccak256(
                abi.encode(
                    BUYER,
                    SELLER,
                    PAYMENT_TOKEN,
                    PAYMENT_AMOUNT,
                    ASSET_TOKEN,
                    ASSET_AMOUNT,
                    a.deadline,
                    BASE_CHAIN,
                    BASE_ESCROW,
                    UNICHAIN_CHAIN,
                    UNICHAIN_ESCROW
                )
            )
        );
        assertNotEq(rc.termsHash(first), rc.termsHash(second));
    }

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

    function testLateAssetLockedAfterRefundRequestedRefundsOnlyThatDepositor() public {
        _useOrder(id);
        _paymentLock();
        vm.warp(deadline + 1);
        _react(_cronLog()); // refund decision made for the already-seen payment leg
        HandshakeReactive.Order memory before = rc.getOrder(id);
        assertTrue(before.refundRequested);
        assertFalse(before.settleRequested);
        assertEq(sys.callbackCount(), 1);

        // The asset Locked log is delivered only after refundRequested is already true.
        // It must produce a single-leg refund to its depositor, never a settlement.
        _react(_lockedLog(false, SELLER, BUYER));
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(sys.callbackCount(), 2);
        assertEq(o.nonce, 2);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);

        CallbackRecord memory a = _callback(1);
        assertEq(a.chainId, UNICHAIN_CHAIN);
        assertEq(a.recipient, UNICHAIN_ESCROW);
        assertEq(a.gasLimit, 500_000);
        assertEq(bytes4(a.payload), REFUND_ASSET_SELECTOR);
        (address injected, bytes32 cbOrder, address depositor, uint64 nonce) =
            abi.decode(_args(a.payload), (address, bytes32, address, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(depositor, SELLER);
        assertEq(nonce, 2);

        // The payment leg's request state and its earlier refund callback are untouched.
        assertEq(o.paymentRequestNonce, before.paymentRequestNonce);
        assertEq(o.paymentRefundRequested, before.paymentRefundRequested);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);
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

    // --------------------------------------------------------- hard safety invariant

    function testSettleRequestedTerminalInvariant() public {
        _useOrder(id);
        _paymentLock();
        _assetLock(); // settlement requested with nonce 1; both callbacks issued
        HandshakeReactive.Order memory settled = rc.getOrder(id);
        assertTrue(settled.settleRequested);
        assertFalse(settled.refundRequested);
        assertEq(settled.nonce, 1);
        assertEq(sys.callbackCount(), 2);

        sys.resetCallbacks();
        vm.warp(deadline + 1);

        // Expiry + cron may re-request settlement of open legs, never a refund.
        _react(_cronLog());
        assertEq(rc.getOrder(id).nonce, 2);
        assertFalse(rc.getOrder(id).refundRequested);
        assertGt(sys.callbackCount(), 0);
        _assertAllCallbacksAreReleases();

        // Permissionless retry is equally forbidden from entering the refund path.
        sys.resetCallbacks();
        vm.warp(block.timestamp + 31);
        vm.prank(STRANGER);
        rc.retry(id);
        assertEq(rc.getOrder(id).nonce, 3);
        assertFalse(rc.getOrder(id).refundRequested);
        _assertAllCallbacksAreReleases();

        // A late asset lock from a different seller is a race loser: refund that seller only.
        sys.resetCallbacks();
        _react(_lockedLog(false, SELLER_TWO, BUYER));
        assertEq(sys.callbackCount(), 1);
        assertEq(bytes4(_callback(0).payload), REFUND_ASSET_SELECTOR);
        (,, address loser, uint64 loserNonce) =
            abi.decode(_args(_callback(0).payload), (address, bytes32, address, uint64));
        assertEq(loser, SELLER_TWO);
        assertEq(loserNonce, 4);
        assertFalse(rc.getOrder(id).refundRequested);
        assertTrue(rc.getOrder(id).settleRequested);
        assertEq(rc.getOrder(id).winner, SELLER);
        assertEq(rc.getOrder(id).paymentRequestNonce, 3);
        assertEq(rc.getOrder(id).assetRequestNonce, 3);

        // A duplicate payment lock after settlement is ignored, not refunded.
        sys.resetCallbacks();
        _react(_lockedLog(true, BUYER, SELLER));
        assertEq(sys.callbackCount(), 0);
        assertFalse(rc.getOrder(id).refundRequested);

        // The race loser's refund event cannot close the winner's asset leg.
        _react(_terminalLog(false, false, SELLER_TWO, ASSET_AMOUNT, 4));
        assertFalse(rc.getOrder(id).assetClosed);

        // The winner's settlement callbacks (nonce 3) still confirm.
        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 3));
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 3));
        assertTrue(rc.isClosed(id));
    }

    function _assertAllCallbacksAreReleases() internal view {
        for (uint256 i = 0; i < sys.callbackCount(); i++) {
            bytes4 selector = bytes4(_callback(i).payload);
            assertTrue(
                selector == RELEASE_PAYMENT_SELECTOR || selector == RELEASE_ASSET_SELECTOR,
                "settled order emitted a refund callback"
            );
        }
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
        assertFalse(rc.cronSubscribed());
        assertEq(rc.registeredChainIds().length, 0);
        assertEq(rc.subscriptionCount(), 0);
        assertEq(sys.unsubscriptionCount(), 19); // 3 chains x 6 topics + cron
    }

    // --------------------------------------------------------------- open orders

    function _createOpenOrder(bytes32 orderId_, uint256 duration_) internal {
        _createOrderAt(orderId_, address(0), BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, duration_);
    }

    function _openPaymentLock() internal {
        _useOrder(id);
        _react(_lockedLog(true, BUYER, address(0)));
    }

    function _openAssetLock(address seller_) internal {
        _useOrder(id);
        _react(_lockedLog(false, seller_, BUYER));
    }

    function testOpenOrderCreationWithZeroSellerKeepsTermsHashEncoding() public {
        bytes32 openId = keccak256("open-create");
        _createOpenOrder(openId, 120);
        _useOrder(openId);

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(o.buyer, BUYER);
        assertEq(o.seller, address(0));
        assertEq(
            terms,
            keccak256(
                abi.encode(
                    BUYER,
                    address(0),
                    PAYMENT_TOKEN,
                    PAYMENT_AMOUNT,
                    ASSET_TOKEN,
                    ASSET_AMOUNT,
                    o.deadline,
                    o.venue.paymentChainId,
                    o.venue.paymentEscrow,
                    o.venue.assetChainId,
                    o.venue.assetEscrow
                )
            )
        );

        // Self-dealing is still rejected for open orders too.
        vm.expectRevert(abi.encodeWithSignature("InvalidSeller()"));
        _createOrderAt(keccak256("open-self"), BUYER, BASE_CHAIN, BASE_ESCROW, UNICHAIN_CHAIN, UNICHAIN_ESCROW, 120);
        assertEq(rc.orderCount(), 2);
    }

    function testOpenOrderPaymentFirstSettlesToWinningSeller() public {
        bytes32 openId = keccak256("open-payment-first");
        _createOpenOrder(openId, 120);
        _useOrder(openId);

        _openPaymentLock();
        assertTrue(rc.getOrder(id).paymentSeen);
        assertFalse(rc.getOrder(id).assetSeen);
        assertEq(sys.callbackCount(), 0);

        _openAssetLock(SELLER);
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertTrue(o.paymentSeen);
        assertTrue(o.assetSeen);
        assertTrue(o.settleRequested);
        assertEq(o.winner, SELLER);
        assertEq(o.nonce, 1);
        assertEq(sys.callbackCount(), 2); // both callbacks in one react tx

        CallbackRecord memory p = _callback(0);
        assertEq(p.chainId, BASE_CHAIN);
        assertEq(p.recipient, BASE_ESCROW);
        assertEq(bytes4(p.payload), RELEASE_PAYMENT_SELECTOR);
        (address injected, bytes32 cbOrder, address recipient, uint256 amount, uint64 nonce) =
            abi.decode(_args(p.payload), (address, bytes32, address, uint256, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(recipient, SELLER); // NEVER address(0) for an open order
        assertEq(amount, PAYMENT_AMOUNT);
        assertEq(nonce, 1);

        CallbackRecord memory a = _callback(1);
        assertEq(a.chainId, UNICHAIN_CHAIN);
        assertEq(a.recipient, UNICHAIN_ESCROW);
        assertEq(bytes4(a.payload), RELEASE_ASSET_SELECTOR);
        (address injectedA, bytes32 cbOrderA, address seller, address buyer, uint256 assetAmount, uint64 nonceA) =
            abi.decode(_args(a.payload), (address, bytes32, address, address, uint256, uint64));
        assertEq(injectedA, address(0));
        assertEq(cbOrderA, id);
        assertEq(seller, SELLER);
        assertEq(buyer, BUYER);
        assertEq(assetAmount, ASSET_AMOUNT);
        assertEq(nonceA, 1);

        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        assertTrue(rc.getOrder(id).paymentClosed);
        assertFalse(rc.getOrder(id).assetClosed);
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        assertTrue(rc.isClosed(id));
    }

    function testOpenOrderAssetFirstRaceWinnerPaidLoserRefunded() public {
        bytes32 openId = keccak256("open-asset-first-race");
        _createOpenOrder(openId, 120);
        _useOrder(openId);

        _openAssetLock(SELLER);
        assertEq(rc.getOrder(id).winner, SELLER);
        assertEq(sys.callbackCount(), 0);

        // A second seller races and loses.
        _openAssetLock(SELLER_TWO);
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(o.winner, SELLER);
        assertEq(o.assetLockCount, 2);
        assertEq(o.nonce, 1);
        assertEq(sys.callbackCount(), 1);
        assertEq(bytes4(_callback(0).payload), REFUND_ASSET_SELECTOR);
        (,, address loser, uint64 loserNonce) =
            abi.decode(_args(_callback(0).payload), (address, bytes32, address, uint64));
        assertEq(loser, SELLER_TWO);
        assertEq(loserNonce, 1);

        // The payment lock now releases to the winner, not the first/losing depositor.
        _openPaymentLock();
        o = rc.getOrder(id);
        assertTrue(o.settleRequested);
        assertEq(o.nonce, 2);
        assertEq(o.paymentRequestNonce, 2);
        assertEq(o.assetRequestNonce, 2);
        assertEq(sys.callbackCount(), 3);

        (,, address paymentRecipient,, uint64 paymentNonce) =
            abi.decode(_args(_callback(1).payload), (address, bytes32, address, uint256, uint64));
        assertEq(paymentRecipient, SELLER);
        assertEq(paymentNonce, 2);
        (,,,,, uint64 assetNonce) =
            abi.decode(_args(_callback(2).payload), (address, bytes32, address, address, uint256, uint64));
        assertEq(bytes4(_callback(2).payload), RELEASE_ASSET_SELECTOR);
        assertEq(assetNonce, 2);

        // The race-loser refund must not close the winner's asset leg.
        _react(_terminalLog(false, false, SELLER_TWO, ASSET_AMOUNT, 1));
        assertFalse(rc.getOrder(id).assetClosed);

        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 2));
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 2));
        assertTrue(rc.isClosed(id));
    }

    function testOpenOrderTermsHashMismatchIsRefunded() public {
        bytes32 openId = keccak256("open-bad-terms");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        _openPaymentLock();

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
    }

    function testOpenOrderWrongTokenIsRefunded() public {
        bytes32 openId = keccak256("open-bad-token");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        _openPaymentLock();

        IReactive.LogRecord memory assetLog = _lockedLog(false, SELLER, BUYER);
        assetLog.data = abi.encode(STRANGER, ASSET_AMOUNT, terms, deadline);
        _react(assetLog);

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertTrue(o.invalid);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);
        assertEq(bytes4(_callback(1).payload), REFUND_ASSET_SELECTOR);
    }

    function testOpenOrderExpiredDeadlineIsRefunded() public {
        bytes32 openId = keccak256("open-expired");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        _openPaymentLock();
        vm.warp(deadline + 1);
        _openAssetLock(SELLER);

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertFalse(o.invalid); // terms were fine; the clock was not
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);
        assertEq(bytes4(_callback(1).payload), REFUND_ASSET_SELECTOR);
    }

    function testOpenOrderLateRaceLoserKeepsWinnerCallbacksConfirmable() public {
        bytes32 openId = keccak256("open-late-loser");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        _openPaymentLock();
        _openAssetLock(SELLER); // settlement requested with nonce 1

        _openAssetLock(SELLER_TWO); // loser refund bumps the global nonce to 2
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(o.nonce, 2);
        assertEq(o.paymentRequestNonce, 1);
        assertEq(o.assetRequestNonce, 1);
        assertEq(o.winner, SELLER);
        assertEq(sys.callbackCount(), 3);

        _react(_terminalLog(false, false, SELLER_TWO, ASSET_AMOUNT, 2));
        assertFalse(rc.getOrder(id).assetClosed);

        _react(_terminalLog(true, true, SELLER, PAYMENT_AMOUNT, 1));
        _react(_terminalLog(false, true, BUYER, ASSET_AMOUNT, 1));
        assertTrue(rc.isClosed(id));
    }

    // ------------------------------------------------------------ buyer cancellation

    function testCancelOrderBuyerOnlyBeforeAssetLock() public {
        bytes32 openId = keccak256("open-cancel");
        _createOpenOrder(openId, 120);
        _useOrder(openId);

        vm.expectEmit(true, false, false, true);
        emit HandshakeReactive.OrderStateChanged(id, "CANCELLED", 1);
        vm.prank(BUYER);
        rc.cancelOrder(id);

        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertTrue(o.invalid);
        assertTrue(o.refundRequested);
        assertFalse(o.settleRequested);
        assertEq(o.winner, address(0));
        assertEq(o.nonce, 1);
        assertEq(o.lastActionTimestamp, block.timestamp);

        // Repeated cancellation is a no-op: nonce semantics stay intact.
        vm.prank(BUYER);
        rc.cancelOrder(id);
        assertEq(rc.getOrder(id).nonce, 1);

        vm.expectRevert(abi.encodeWithSignature("NotBuyer()"));
        vm.prank(STRANGER);
        rc.cancelOrder(id);
    }

    function testCancelOrderRejectsNamedOrder() public {
        vm.expectRevert(abi.encodeWithSignature("NotOpenOrder()"));
        vm.prank(BUYER);
        rc.cancelOrder(id); // named order created in setUp()
    }

    function testCancelOrderRejectsAfterAssetLock() public {
        bytes32 openId = keccak256("open-cancel-matched");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        _openAssetLock(SELLER);

        vm.expectRevert(abi.encodeWithSignature("OrderMatched()"));
        vm.prank(BUYER);
        rc.cancelOrder(id);
    }

    function testCancelOrderRejectsAfterDeadline() public {
        bytes32 openId = keccak256("open-cancel-late");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        vm.warp(deadline);

        vm.expectRevert(abi.encodeWithSignature("DeadlineReached()"));
        vm.prank(BUYER);
        rc.cancelOrder(id);
    }

    function testLatePaymentAfterCancellationIsRefunded() public {
        bytes32 openId = keccak256("open-cancel-late-payment");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        vm.prank(BUYER);
        rc.cancelOrder(id);

        _openPaymentLock(); // arrives after the cancellation decision
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(sys.callbackCount(), 1);
        assertEq(o.nonce, 2);
        assertEq(o.paymentRequestNonce, 2);
        assertTrue(o.paymentRefundRequested);
        assertFalse(o.settleRequested);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);
        (address injected, bytes32 cbOrder, uint64 refundNonce) =
            abi.decode(_args(_callback(0).payload), (address, bytes32, uint64));
        assertEq(injected, address(0));
        assertEq(cbOrder, id);
        assertEq(refundNonce, 2);
    }

    function testSellerAssetLockAfterCancellationIsRefunded() public {
        bytes32 openId = keccak256("open-cancel-late-asset");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        vm.prank(BUYER);
        rc.cancelOrder(id);

        _openAssetLock(SELLER);
        HandshakeReactive.Order memory o = rc.getOrder(id);
        assertEq(o.winner, address(0)); // never matched
        assertFalse(o.assetSeen);
        assertTrue(o.invalid);
        assertFalse(o.settleRequested);
        assertEq(o.nonce, 2);
        assertEq(sys.callbackCount(), 1);
        assertEq(bytes4(_callback(0).payload), REFUND_ASSET_SELECTOR);
        (,, address depositor, uint64 refundNonce) =
            abi.decode(_args(_callback(0).payload), (address, bytes32, address, uint64));
        assertEq(depositor, SELLER);
        assertEq(refundNonce, 2);

        _react(_lockedLog(true, BUYER, address(0)));
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(1).payload), REFUND_PAYMENT_SELECTOR);
        assertFalse(rc.getOrder(id).settleRequested);
    }

    function testCancelledOrderCronAndRetryNeverSettle() public {
        bytes32 openId = keccak256("open-cancel-cron");
        _createOpenOrder(openId, 120);
        _useOrder(openId);
        _openPaymentLock(); // buyer locked before cancelling
        vm.prank(BUYER);
        rc.cancelOrder(id);
        assertEq(rc.getOrder(id).nonce, 1);

        vm.warp(deadline + 1);
        _react(_cronLog());
        assertEq(sys.callbackCount(), 1);
        assertEq(bytes4(_callback(0).payload), REFUND_PAYMENT_SELECTOR);

        vm.warp(block.timestamp + 31);
        vm.prank(STRANGER);
        rc.retry(id);
        assertEq(sys.callbackCount(), 2);
        assertEq(bytes4(_callback(1).payload), REFUND_PAYMENT_SELECTOR);
        assertTrue(rc.getOrder(id).invalid);
        assertFalse(rc.getOrder(id).settleRequested);
    }

    // ------------------------------------------------------- named-seller regression

    function testNamedSellerBehaviourUnchanged() public {
        _useOrder(id);
        _paymentLock();
        _assetLock();
        assertEq(sys.callbackCount(), 2);

        (,, address recipient,,) = abi.decode(_args(_callback(0).payload), (address, bytes32, address, uint256, uint64));
        assertEq(recipient, SELLER); // named seller is always paid directly

        // A wrong depositor for a named order (before any winner) is still invalid.
        bytes32 wrongSellerId = keccak256("named-wrong-seller");
        _createOrder(wrongSellerId, 120);
        _useOrder(wrongSellerId);
        _react(_lockedLog(false, SELLER_TWO, BUYER));
        HandshakeReactive.Order memory bad = rc.getOrder(id);
        assertTrue(bad.invalid);
        assertTrue(bad.refundRequested);
        assertEq(bad.winner, SELLER_TWO);
        assertEq(sys.callbackCount(), 3);
        assertEq(bytes4(_callback(2).payload), REFUND_ASSET_SELECTOR);

        // The open marker on a named order's payment leg is still rejected.
        bytes32 namedId = keccak256("named-open-marker");
        _createOrder(namedId, 120);
        _useOrder(namedId);
        _react(_lockedLog(true, BUYER, address(0)));
        assertTrue(rc.getOrder(id).invalid);
        assertEq(sys.callbackCount(), 4);
        assertEq(bytes4(_callback(3).payload), REFUND_PAYMENT_SELECTOR);
    }
}
