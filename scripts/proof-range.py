#!/usr/bin/env python3
"""Find the block height of each proof hop for one or more order IDs.

Prints shell exports (PROOF_FROM_BLOCK_<id> / PROOF_TO_BLOCK_<id>) suitable for
scripts/proof.sh, so each order can be proven with tiny eth_getLogs scans even
though the three testnets have very different block heights.
"""
import json
import os
import sys
import urllib.request

ORDERS = [a for a in sys.argv[1:] if a]
if not ORDERS:
    print('usage: proof-range.py <orderId> [orderId...]', file=sys.stderr)
    sys.exit(2)

TOPIC0 = {
    'order': '0x49ecf21afe0244f5a25b83eafd7d9c0eb898acbb8338e37040e2d0999b9ae306',
    'payment_locked': '0xeb5b40d9e18193862e588be5f3887ec6b361ac7d7ad78e42e11adbd4cd697664',
    'asset_locked': '0xe158058005a726fed86812e55f6199567efd4d6208f3367a8f61078ce1c3489a',
}
MANIFEST = json.load(open(os.environ.get('DEPLOYMENT_MANIFEST', 'deployments.json')))
VENUES = MANIFEST['venues']
RC = MANIFEST['reactive'].lower()

CHAINS = [
    (5318007, os.environ.get('REACTIVE_RPC', 'https://lasna-rpc.rnk.dev/'), 30000, [RC], [TOPIC0['order']]),
    (84532, os.environ.get('BASE_RPC', 'https://sepolia.base.org'), 200,
     [VENUES['84532'][k].lower() for k in ('paymentEscrow', 'assetEscrow')],
     [TOPIC0['payment_locked'], TOPIC0['asset_locked']]),
    (1301, os.environ.get('UNICHAIN_RPC', 'https://sepolia.unichain.org'), 100,
     [VENUES['1301'][k].lower() for k in ('paymentEscrow', 'assetEscrow')],
     [TOPIC0['payment_locked'], TOPIC0['asset_locked']]),
    (11155111, os.environ.get('SEPOLIA_RPC', 'https://ethereum-sepolia-rpc.publicnode.com'), 500,
     [VENUES['11155111'][k].lower() for k in ('paymentEscrow', 'assetEscrow')],
     [TOPIC0['payment_locked'], TOPIC0['asset_locked']]),
]


def rpc_call(rpc, method, params):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    req = urllib.request.Request(rpc, data=payload, headers={
        'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; HandshakeProof/1.0)'
    })
    with urllib.request.urlopen(req, timeout=20) as res:
        body = json.load(res)
    if 'error' in body:
        raise RuntimeError(body['error'].get('message', str(body['error'])))
    return body['result']


def find(cid, rpc, chunk, addresses, topic0s, order):
    latest = int(rpc_call(rpc, 'eth_blockNumber', []), 16)
    floor = int(os.environ.get(f'RANGE_FLOOR_{cid}', max(0, latest - 100000)))
    hits = []
    block = floor
    while block <= latest:
        end = min(block + chunk - 1, latest)
        for t0 in topic0s:
            filt = {'fromBlock': hex(block), 'toBlock': hex(end), 'address': addresses, 'topics': [t0, order]}
            try:
                logs = rpc_call(rpc, 'eth_getLogs', [filt])
            except Exception:
                continue
            hits.extend(int(x['blockNumber'], 16) for x in logs)
        block = end + 1
    return hits


for order in ORDERS:
    order = order.lower()
    print(f'# order {order}')
    for cid, rpc, chunk, addresses, topics in CHAINS:
        blocks = find(cid, rpc, chunk, addresses, topics, order)
        if not blocks:
            print(f'#   chain {cid}: NO LOGS FOUND (raise RANGE_FLOOR_{cid} if needed)')
            continue
        lo, hi = min(blocks) - 20, max(blocks) + 300
        print(f'PROOF_FROM_BLOCK_{cid}={lo} PROOF_TO_BLOCK_{cid}={hi}  # {len(blocks)} logs, blocks {[hex(b) for b in sorted(set(blocks))]}')
