#!/usr/bin/env bash
# Handshake per-loop proof collector (EXPANSION-PLAN §5.4).
# Queries Base Sepolia, Unichain Sepolia, Ethereum Sepolia and Reactive Lasna for one
# order ID, then prints a Markdown table ready to paste into docs/DEPLOYMENT.md.
# Escrow addresses come from deployments.json (or env overrides) — never hardcoded.
# Every hash printed is read from a real log. Missing events are fatal.
#
# Usage: bash scripts/proof.sh <orderId>
# Env:   DEPLOYMENT_MANIFEST, RC_ADDRESS, *_RPC, PROOF_LOOKBACK_BLOCKS, PROOF_FROM_BLOCK,
#        PAYMENT_ESCROW_ADDRESS, ASSET_ESCROW_ADDRESS, BASE_ASSET_ESCROW_ADDRESS,
#        UNICHAIN_PAYMENT_ESCROW_ADDRESS, SEPOLIA_PAYMENT_ESCROW_ADDRESS,
#        SEPOLIA_ASSET_ESCROW_ADDRESS

set -uo pipefail

ORDER_ID="${1:-}"
if [ -z "$ORDER_ID" ]; then
  printf 'Usage: bash scripts/proof.sh <orderId>\n' >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf 'proof.sh: python3 is required\n' >&2
  exit 2
fi

MANIFEST="${DEPLOYMENT_MANIFEST:-deployments.json}"
REACTIVE_RPC="${REACTIVE_RPC:-https://lasna-rpc.rnk.dev/}"
BASE_RPC="${BASE_RPC:-https://sepolia.base.org}"
UNICHAIN_RPC="${UNICHAIN_RPC:-https://sepolia.unichain.org}"
SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
SYSTEM_CONTRACT="${SYSTEM_CONTRACT:-0x8888888888888888888888888888888888888888}"
RC="${RC_ADDRESS:-}"
LOOKBACK="${PROOF_LOOKBACK_BLOCKS:-200000}"
FROM_BLOCK="${PROOF_FROM_BLOCK:-}"

python3 - "$ORDER_ID" "$MANIFEST" "$REACTIVE_RPC" "$BASE_RPC" "$UNICHAIN_RPC" "$SEPOLIA_RPC" "$RC" "$SYSTEM_CONTRACT" "$LOOKBACK" "$FROM_BLOCK" <<'PY'
import json
import os
import sys
import urllib.request

(
    order_arg, manifest_path, lasna_rpc, base_rpc, unichain_rpc, sepolia_rpc,
    rc_arg, system_contract, lookback_arg, from_block_arg,
) = sys.argv[1:11]

ZERO = '0x' + '0' * 40
CHAIN_NAMES = {5318007: 'Reactive Lasna', 84532: 'Base Sepolia', 1301: 'Unichain Sepolia', 11155111: 'Ethereum Sepolia'}
RPCS = {5318007: lasna_rpc, 84532: base_rpc, 1301: unichain_rpc, 11155111: sepolia_rpc}
# Base caps eth_getLogs hard (~200 blocks), Unichain tolerates ~1000, Ethereum
# Sepolia is conservative and measured (grows only after clean chunks), Lasna 30k.
BASE_CHUNK = {84532: 200, 1301: 1000, 11155111: 500, 5318007: 30000}
MAX_CHUNK = {84532: 2000, 1301: 5000, 11155111: 2000, 5318007: 30000}

# topic0 values from `cast keccak` of the exact event signatures; selectors from `cast sig`.
TOPIC = {
    'order_state': '0x49ecf21afe0244f5a25b83eafd7d9c0eb898acbb8338e37040e2d0999b9ae306',       # OrderStateChanged(bytes32,string,uint64)
    'payment_locked': '0xeb5b40d9e18193862e588be5f3887ec6b361ac7d7ad78e42e11adbd4cd697664',    # PaymentLocked(bytes32,address,address,address,uint256,bytes32,uint256)
    'asset_locked': '0xe158058005a726fed86812e55f6199567efd4d6208f3367a8f61078ce1c3489a',      # AssetLocked(bytes32,address,address,address,uint256,bytes32,uint256)
    'payment_terminal': [
        '0x903a04873fc04f468e31890f89b42c3d9aee337eea5a0e4c35446103b17bbf65',                  # PaymentReleased(bytes32,address,uint256,uint64)
        '0x7ed45eda872966fe5f5f62451acdda28671441ee7b9cce8dc0483b10d95ac77c',                  # PaymentRefunded(bytes32,address,uint256,uint64)
    ],
    'asset_terminal': [
        '0x8e7c2eb1a26bfcaca6a1abcf5add7d581276e708f9f446876015ed75c55397ee',                  # AssetReleased(bytes32,address,uint256,uint64)
        '0x512b6121585cd55600c64960420f18d49179f8611ab38147fe12deb03931f61f',                  # AssetRefunded(bytes32,address,uint256,uint64)
    ],
    'callback_request': '0xef94dbc611c4b95bf4b8ba34b413972180c2faf26fbb480befacedd83e07b133',  # CallbackRequest(uint256,address,address,uint8,bytes)
}
SELECTOR = {
    'get_order': '0x5778472a',
    'terms_hash': '0xecda18dc',
}
# Callback payloads: first argument is proxy-injected reactive address; orderId is arg 2.
CALLBACK_SELECTORS = {
    '7edb855d': ('PaymentEscrow.release', 'payment'),   # release(address,bytes32,address,uint256,uint64)
    'b8012aa0': ('AssetEscrow.release', 'asset'),       # release(address,bytes32,address,address,uint256,uint64)
    '7450e0aa': ('PaymentEscrow.refund', 'payment'),    # refund(address,bytes32,uint64)
    '0c7072f7': ('AssetEscrow.refund', 'asset'),        # refund(address,bytes32,address,uint64)
}


def die(message):
    print('proof.sh: ' + message, file=sys.stderr)
    sys.exit(1)


def norm_addr(value):
    if isinstance(value, str) and value and value.lower() != ZERO:
        return value.lower()
    return None


raw_order = order_arg.strip().lower().removeprefix('0x')
if not raw_order or len(raw_order) > 64 or any(c not in '0123456789abcdef' for c in raw_order):
    die('invalid order ID: ' + order_arg)
order_id = '0x' + raw_order.rjust(64, '0')
order_topic = order_id

try:
    with open(manifest_path, 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
except (OSError, ValueError):
    manifest = {}

venues = manifest.get('venues') if isinstance(manifest.get('venues'), dict) else {}


def venue_addr(chain_id, role):
    entry = venues.get(str(chain_id)) or {}
    return norm_addr(entry.get(role))


cfg = {
    84532: {
        'payment': norm_addr(os.environ.get('PAYMENT_ESCROW_ADDRESS')) or venue_addr(84532, 'paymentEscrow') or norm_addr(manifest.get('paymentEscrow')),
        'asset': norm_addr(os.environ.get('BASE_ASSET_ESCROW_ADDRESS')) or venue_addr(84532, 'assetEscrow') or norm_addr(manifest.get('assetEscrow')),
    },
    1301: {
        'payment': norm_addr(os.environ.get('UNICHAIN_PAYMENT_ESCROW_ADDRESS')) or venue_addr(1301, 'paymentEscrow'),
        'asset': norm_addr(os.environ.get('UNICHAIN_ASSET_ESCROW_ADDRESS')) or venue_addr(1301, 'assetEscrow') or norm_addr(manifest.get('unichainAssetEscrow')),
    },
    11155111: {
        'payment': norm_addr(os.environ.get('SEPOLIA_PAYMENT_ESCROW_ADDRESS')) or venue_addr(11155111, 'paymentEscrow') or norm_addr(manifest.get('sepoliaPaymentEscrow')),
        'asset': norm_addr(os.environ.get('SEPOLIA_ASSET_ESCROW_ADDRESS')) or venue_addr(11155111, 'assetEscrow') or norm_addr(manifest.get('sepoliaAssetEscrow')),
    },
}
rc = norm_addr(rc_arg) or norm_addr(os.environ.get('RC_ADDRESS')) or norm_addr(manifest.get('reactive'))
system = norm_addr(system_contract)
if not rc:
    die('RC_ADDRESS (or manifest.reactive) is required')
missing_cfg = [
    f'{CHAIN_NAMES[cid]}/{role}' for cid, roles in cfg.items() for role, addr in roles.items() if not addr
]
if missing_cfg:
    die('missing escrow config for ' + ', '.join(missing_cfg) + ' (set env overrides or fill ' + manifest_path + ')')

escrow_meta = {}
for cid, roles in cfg.items():
    for role, addr in roles.items():
        escrow_meta[addr] = (cid, role)


def rpc_call(rpc, method, params):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    request = urllib.request.Request(
        rpc,
        data=payload,
        headers={'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; HandshakeProof/1.0)'},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        body = json.loads(response.read())
    if 'error' in body:
        raise RuntimeError(body['error'].get('message', str(body['error'])))
    return body['result']


def get_logs(chain_id, addresses, topics, from_block, to_block):
    # Public RPCs rate-limit hard. Rotate endpoints per call so a 429 on one
    # provider does not kill proof collection.
    global RPCS
    rpc = RPCS[chain_id]
    if chain_id == 11155111:
        for endpoint in ('https://ethereum-sepolia-rpc.publicnode.com',
                         'https://rpc.sepolia.ethpandaops.io',
                         'https://sepolia.gateway.tenderly.co'):
            if endpoint == rpc:
                continue
            try:
                rpc_call(endpoint, 'eth_blockNumber', [])
                RPCS[chain_id] = endpoint
                break
            except Exception:
                continue
    chunk = BASE_CHUNK[chain_id]
    maximum = MAX_CHUNK[chain_id]
    block = from_block
    logs = []
    clean_streak = 0
    while block <= to_block:
        end = min(block + chunk - 1, to_block)
        filt = {'fromBlock': hex(block), 'toBlock': hex(end), 'topics': topics}
        if addresses:
            filt['address'] = addresses
        try:
            if os.environ.get('PROOF_DEBUG'):
                print(f'  scan {chain_id} {block}-{end} rpc={rpc} topics={topics} addrs={addresses}', file=sys.stderr)
            result = rpc_call(rpc, 'eth_getLogs', [filt])
        except Exception as exc:
            if chunk <= 50:
                raise
            chunk = max(50, chunk // 2)
            clean_streak = 0
            if os.environ.get('PROOF_DEBUG'):
                print(f'  retry {chain_id} {block}-{end}: {exc}', file=sys.stderr)
            continue
        logs.extend(result)
        block = end + 1
        clean_streak += 1
        # "Measured": grow conservatively only after several clean, empty chunks.
        if not result and clean_streak >= 5 and chunk < maximum:
            chunk = min(maximum, chunk + max(1, chunk // 4))
            clean_streak = 0
    return logs


def eth_call(chain_id, to, data):
    result = rpc_call(RPCS[chain_id], 'eth_call', [{'to': to, 'data': data}, 'latest'])
    if not result or result == '0x':
        raise RuntimeError('empty eth_call result')
    return result


def word_hex(word):
    return '0x' + word.hex()


def addr_from_word(word):
    return '0x' + word[12:].hex()


def decode_stage(log):
    data = bytes.fromhex(log['data'][2:])
    if len(data) < 64:
        return None
    offset = int.from_bytes(data[0:32], 'big')
    if offset + 64 > len(data):
        return None
    length = int.from_bytes(data[offset:offset + 32], 'big')
    if offset + 32 + length > len(data):
        return None
    return data[offset + 32:offset + 32 + length].decode('utf-8', 'replace')


def decode_lock(log):
    data = bytes.fromhex(log['data'][2:])
    words = [data[i * 32:(i + 1) * 32] for i in range(4)]
    topics = log['topics']
    return {
        'token': addr_from_word(words[0]),
        'amount': int.from_bytes(words[1], 'big'),
        'termsHash': word_hex(words[2]),
        'deadline': int.from_bytes(words[3], 'big'),
        'depositor': '0x' + topics[2][26:],
        'counterparty': '0x' + topics[3][26:],
        'tx': log['transactionHash'],
        'address': log['address'].lower(),
    }


def decode_terminal(log):
    data = bytes.fromhex(log['data'][2:])
    topics = log['topics']
    return {
        'recipient': '0x' + topics[2][26:],
        'amount': int.from_bytes(data[0:32], 'big'),
        'nonce': int.from_bytes(data[32:64], 'big'),
        'tx': log['transactionHash'],
        'address': log['address'].lower(),
    }


def decode_config(data_hex):
    """CallbackRequest.configuration is abi.encode(CallbackConfiguration_V_1_0): one tuple."""
    try:
        data = bytes.fromhex(data_hex[2:])
        if len(data) < 160:
            return None
        # CallbackRequest data starts with system-contract bookkeeping words; the
        # CallbackConfiguration_V_1_0 tuple begins at the first known chain id word.
        base = None
        for i in range(0, min(len(data), 32 * 16), 32):
            if int.from_bytes(data[i:i + 32], 'big') in (5318007, 84532, 1301, 11155111):
                base = i
                break
        if base is None or base + 128 > len(data):
            return None
        chain_id = int.from_bytes(data[base:base + 32], 'big')
        recipient = addr_from_word(data[base + 32:base + 64])
        gas_limit = int.from_bytes(data[base + 64:base + 96], 'big')
        payload_offset = int.from_bytes(data[base + 96:base + 128], 'big')
        start = base + payload_offset
        if start + 32 > len(data):
            return None
        length = int.from_bytes(data[start:start + 32], 'big')
        payload = data[start + 32:start + 32 + length].hex()
        return {'chainId': chain_id, 'recipient': recipient, 'gasLimit': gas_limit, 'payload': payload}
    except Exception:
        return None


def decode_payload(payload_hex):
    payload = payload_hex[2:] if payload_hex.startswith('0x') else payload_hex
    selector = payload[:8]
    if selector not in CALLBACK_SELECTORS:
        return None
    body = payload[8:]
    words = [body[i * 64:(i + 1) * 64] for i in range(len(body) // 64)]
    if len(words) < 3:
        return None
    name, role = CALLBACK_SELECTORS[selector]
    return {'name': name, 'role': role, 'orderId': '0x' + words[1], 'words': words}


try:
    lookback = int(lookback_arg)
except ValueError:
    die('PROOF_LOOKBACK_BLOCKS must be an integer')
lookback = max(0, lookback)
explicit_from = None
if from_block_arg:
    try:
        explicit_from = int(from_block_arg, 0)
    except ValueError:
        die('PROOF_FROM_BLOCK must be an integer')

# Per-chain overrides win over the shared PROOF_FROM_BLOCK / lookback. This keeps
# scans tiny even though the three testnets have very different block heights.
per_chain_from = {}
per_chain_to = {}
for cid in RPCS:
    raw = os.environ.get(f'PROOF_FROM_BLOCK_{cid}')
    if raw:
        try:
            per_chain_from[cid] = int(raw, 0)
        except ValueError:
            die(f'PROOF_FROM_BLOCK_{cid} must be an integer')
    raw = os.environ.get(f'PROOF_TO_BLOCK_{cid}')
    if raw:
        try:
            per_chain_to[cid] = int(raw, 0)
        except ValueError:
            die(f'PROOF_TO_BLOCK_{cid} must be an integer')

ranges = {}
for cid, rpc in RPCS.items():
    try:
        latest = int(rpc_call(rpc, 'eth_blockNumber', []), 16)
    except Exception as exc:
        die(f'{CHAIN_NAMES[cid]} eth_blockNumber failed: {exc}')
    start = per_chain_from.get(cid)
    if start is None:
        start = explicit_from if explicit_from is not None else max(0, latest - lookback)
    # The default lookback is only meant for recent orders; when the order is on a
    # different chain (or an explicit PROOF_FROM_BLOCK was given for it), scanning
    # every other chain from head is wasted work. Cap unrelated chains to a small
    # window around the earliest explicit from-block.
    if per_chain_from and cid not in per_chain_from and explicit_from is None:
        start = max(0, min(start, min(per_chain_from.values())))
    end = min(per_chain_to.get(cid, latest), latest)
    if end - start > 5000:
        end = start + 5000
    ranges[cid] = (max(0, start), max(max(0, start), end))

missing = []

try:
    state_logs = get_logs(5318007, [rc], [TOPIC['order_state'], order_topic], *ranges[5318007])
except Exception as exc:
    die(f'Lasna OrderStateChanged query failed: {exc}')
created = [log for log in state_logs if decode_stage(log) == 'CREATED']
if not created:
    missing.append('createOrder (OrderStateChanged "CREATED") on Lasna')
create_tx = created[0]['transactionHash'] if created else None

try:
    callback_logs = get_logs(5318007, [system], [TOPIC['callback_request']], *ranges[5318007])
except Exception as exc:
    die(f'Lasna CallbackRequest query failed: {exc}')
by_tx = {}
rc_topic = '0x' + rc[2:].lower().rjust(64, '0')
for log in callback_logs:
    # topic2 is the calling reactive contract; payload arg 2 is the order id.
    if rc_topic not in [t.lower() for t in log['topics'][1:]]:
        continue
    config = decode_config(log['data'])
    if not config:
        continue
    payload = decode_payload(config['payload'])
    if not payload or payload['orderId'].lower() != order_id:
        continue
    by_tx.setdefault(log['transactionHash'], []).append((log, config, payload))
react_candidates = [(tx, items) for tx, items in by_tx.items() if len(items) == 2]
if not react_candidates:
    missing.append('react() tx emitting exactly two CallbackRequest logs on Lasna')
react_tx, callback_items = (sorted(react_candidates, key=lambda pair: int(pair[1][0][0]['blockNumber'], 16))[0]
                            if react_candidates else (None, []))

payment_locks = []
asset_locks = []
payment_terminals = []
asset_terminals = []
payment_addrs = [roles['payment'] for roles in cfg.values()]
asset_addrs = [roles['asset'] for roles in cfg.values()]
for cid in (84532, 1301, 11155111):
    try:
        pl = get_logs(cid, payment_addrs, [TOPIC['payment_locked'], order_topic], *ranges[cid])
        al = get_logs(cid, asset_addrs, [TOPIC['asset_locked'], order_topic], *ranges[cid])
        # Nested topic list = OR across release/refund signatures, AND with orderId.
        pt = get_logs(cid, payment_addrs, [TOPIC['payment_terminal'], order_topic], *ranges[cid])
        at = get_logs(cid, asset_addrs, [TOPIC['asset_terminal'], order_topic], *ranges[cid])
    except Exception as exc:
        die(f'{CHAIN_NAMES[cid]} eth_getLogs failed: {exc}')
    pt = [log for log in pt if len(log['topics']) > 1 and log['topics'][1].lower() == order_topic]
    at = [log for log in at if len(log['topics']) > 1 and log['topics'][1].lower() == order_topic]
    if os.environ.get('PROOF_DEBUG'):
        print(f'  counts {cid}: paymentLocks={len(pl)} assetLocks={len(al)} paymentTerminals={len(pt)} assetTerminals={len(at)}', file=sys.stderr)
    payment_locks.extend(decode_lock(log) for log in pl)
    asset_locks.extend(decode_lock(log) for log in al)
    for log in pt:
        decoded = decode_terminal(log)
        decoded['kind'] = 'PaymentReleased' if log['topics'][0].lower() == TOPIC['payment_terminal'][0] else 'PaymentRefunded'
        payment_terminals.append(decoded)
    for log in at:
        decoded = decode_terminal(log)
        decoded['kind'] = 'AssetReleased' if log['topics'][0].lower() == TOPIC['asset_terminal'][0] else 'AssetRefunded'
        asset_terminals.append(decoded)

if not payment_locks:
    missing.append('PaymentLocked on a registered payment chain')
if not asset_locks:
    missing.append('AssetLocked on a registered asset chain')
if not payment_terminals:
    missing.append('payment release/refund terminal event')
if not asset_terminals:
    missing.append('asset release/refund terminal event')

order = None
terms_hash = None
try:
    raw_order_state = eth_call(5318007, rc, SELECTOR['get_order'] + order_id[2:])
    words = [bytes.fromhex(raw_order_state[2:][i * 64:(i + 1) * 64]) for i in range(26)]
    order = {
        'buyer': addr_from_word(words[0]),
        'seller': addr_from_word(words[1]),
        'paymentToken': addr_from_word(words[2]),
        'paymentAmount': int.from_bytes(words[3], 'big'),
        'assetToken': addr_from_word(words[4]),
        'assetAmount': int.from_bytes(words[5], 'big'),
        'deadline': int.from_bytes(words[6], 'big'),
        'paymentClosed': bool(int.from_bytes(words[11], 'big')),
        'assetClosed': bool(int.from_bytes(words[12], 'big')),
        'nonce': int.from_bytes(words[16], 'big'),
        'winner': addr_from_word(words[18]),
        'paymentChainId': int.from_bytes(words[22], 'big'),
        'paymentEscrow': addr_from_word(words[23]),
        'assetChainId': int.from_bytes(words[24], 'big'),
        'assetEscrow': addr_from_word(words[25]),
    }
except Exception as exc:
    missing.append(f'getOrder state on Lasna ({exc})')
try:
    terms_hash = eth_call(5318007, rc, SELECTOR['terms_hash'] + order_id[2:])
except Exception as exc:
    missing.append(f'termsHash on Lasna ({exc})')


def chain_label(cid):
    return f'{CHAIN_NAMES.get(cid, cid)} ({cid})'


def escrow_label(address):
    meta = escrow_meta.get(address.lower())
    return chain_label(meta[0]) if meta else 'unknown chain'


def money(amount):
    return f'{amount}'


rows = []
rows.append(('createOrder', chain_label(5318007), f'`{create_tx}`' if create_tx else '**MISSING**',
             f'venue payment={order["paymentChainId"]}/{order["paymentEscrow"]} asset={order["assetChainId"]}/{order["assetEscrow"]}; termsHash `{terms_hash}`' if order and terms_hash else '**MISSING**'))
for lock in payment_locks:
    rows.append(('PaymentLocked', escrow_label(lock['address']), f'`{lock["tx"]}`',
                 f'token `{lock["token"]}`, amount {money(lock["amount"])}, termsHash `{lock["termsHash"]}`, deadline {lock["deadline"]}, depositor `{lock["depositor"]}`, counterparty `{lock["counterparty"]}`'))
for lock in asset_locks:
    rows.append(('AssetLocked', escrow_label(lock['address']), f'`{lock["tx"]}`',
                 f'token `{lock["token"]}`, amount {money(lock["amount"])}, termsHash `{lock["termsHash"]}`, deadline {lock["deadline"]}, depositor `{lock["depositor"]}`, counterparty `{lock["counterparty"]}`'))
if callback_items:
    details = '; '.join(
        f'{payload["name"]} → {chain_label(config["chainId"])} recipient `{config["recipient"]}` gas {config["gasLimit"]}'
        for _log, config, payload in callback_items
    )
    rows.append(('react() → 2 CallbackRequest', chain_label(5318007), f'`{react_tx}`', details))
else:
    rows.append(('react() → 2 CallbackRequest', chain_label(5318007), '**MISSING**', 'expected exactly two decoded callback requests'))
for term in payment_terminals:
    rows.append((term['kind'], escrow_label(term['address']), f'`{term["tx"]}`',
                 f'recipient `{term["recipient"]}`, amount {money(term["amount"])}, nonce {term["nonce"]}'))
for term in asset_terminals:
    rows.append((term['kind'], escrow_label(term['address']), f'`{term["tx"]}`',
                 f'recipient `{term["recipient"]}`, amount {money(term["amount"])}, nonce {term["nonce"]}'))
if order:
    rows.append(('Final getOrder', chain_label(5318007), '—',
                 f'paymentClosed={str(order["paymentClosed"]).lower()}, assetClosed={str(order["assetClosed"]).lower()}, winner `{order["winner"]}`, nonce {order["nonce"]}'))
else:
    rows.append(('Final getOrder', chain_label(5318007), '**MISSING**', 'eth_call failed'))

terms_tuple = 'n/a'
if order and terms_hash:
    terms_tuple = (
        f'(buyer `{order["buyer"]}`, seller `{order["seller"]}`, paymentToken `{order["paymentToken"]}`, '
        f'paymentAmount {order["paymentAmount"]}, assetToken `{order["assetToken"]}`, assetAmount {order["assetAmount"]}, '
        f'deadline {order["deadline"]}, paymentChainId {order["paymentChainId"]}, paymentEscrow `{order["paymentEscrow"]}`, '
        f'assetChainId {order["assetChainId"]}, assetEscrow `{order["assetEscrow"]}`)'
    )

print(f'### Order `{order_id}`')
print()
print(f'- Venue: payment **{chain_label(order["paymentChainId"] if order else 0)}** / `{order["paymentEscrow"] if order else "?"}` → asset **{chain_label(order["assetChainId"] if order else 0)}** / `{order["assetEscrow"] if order else "?"}`')
print(f'- `termsHash` = `{terms_hash or "MISSING"}`')
print(f'- Terms tuple = {terms_tuple}')
print()
print('| Hop | Chain | Tx hash | Details |')
print('|---|---|---|---|')
for hop, chain, tx, details in rows:
    print(f'| {hop} | {chain} | {tx} | {details} |')
print()

if missing:
    die('order not proven — missing: ' + '; '.join(missing))

if not (order['paymentClosed'] and order['assetClosed']):
    print('WARNING: both legs are not closed in getOrder — inspect before publishing.', file=sys.stderr)
PY
