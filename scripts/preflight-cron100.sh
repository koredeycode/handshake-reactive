#!/usr/bin/env bash
# =============================================================================
# FUTURE-ONLY — CRON100 REDEPLOY PREFLIGHT. NOT FOR THE LIVE DEPLOYMENT.
# =============================================================================
# Plan-stage companion to scripts/preflight.sh. Do NOT run against the current
# contracts, do NOT run as part of platform work, and do NOT treat a PASS here
# as permission to demo the old system. All addresses passed in via env vars
# must be the NEW RC + 6 NEW escrows from the Cron100 redeploy.
#
# STRICTLY READ-ONLY. The only network operations below are eth_call
# (`cast call`), eth_getCode (`cast code`), eth_getBalance (`cast balance`) and
# read-only JSON-RPC eth_getLogs/eth_blockNumber via python3 urllib. `cast sig`
# and `cast keccak` are local hashing only.
#
# This script NEVER broadcasts a transaction: there is no `cast send`, no
# `--account` on any call, no setVenue, no retry, no expire, no rescue*, and NO
# TEST ORDER is ever created. Big-int comparisons use python3 (bash arithmetic
# overflows above 2^63).
#
# HARD GATE — "no testing till the indexer is ready to receive new events":
# After deploying the new RC + 6 escrows, NO test transaction and NO test order
# may be sent until the indexer/backend has been redeployed with the new RC +
# escrow addresses AND /health has been verified against them. Transactions
# sent first fall outside the tiny initial backfill window (Base 1000,
# Unichain 5000, Sepolia 2500 blocks) and will never be indexed — orders show
# empty terms and empty timelines. See personal/CRON100-RUNBOOK.md,
# "Indexer/backend cutover — MUST precede test transactions". This read-only
# preflight does not satisfy that cutover by itself.
#
# Set: RC_ADDRESS, PAYMENT_ESCROW_ADDRESS (Base payment),
# BASE_ASSET_ESCROW_ADDRESS, UNICHAIN_PAYMENT_ESCROW_ADDRESS,
# ASSET_ESCROW_ADDRESS (Unichain asset), SEPOLIA_PAYMENT_ESCROW_ADDRESS,
# SEPOLIA_ASSET_ESCROW_ADDRESS, and SEPOLIA_PROXY.
# Optional: RC_RESERVE_MAX_WEI, RC_BALANCE_FLOOR_WEI, MIN_ACTIVE_SUBSCRIPTIONS,
# SUBSCRIPTION_FROM_BLOCK, SUBSCRIPTION_LOOKBACK_BLOCKS, *_RPC, *_PROXY.

set -uo pipefail

SYSTEM="0x8888888888888888888888888888888888888888"
LEGACY_SYSTEM="0x0000000000000000000000000000000000fffFfF"
ZERO="0x0000000000000000000000000000000000000000"
# FUTURE Cron100 constant from the Reactive legacy system contract. Cron10 is
# ignored by react(); it must NOT be subscribed to alongside Cron100.
CRON100_TOPIC="0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70"
# The old interval must NOT also be subscribed: a block divisible by 100 would
# fire both and bill twice (personal/CRON100-RUNBOOK.md, "Exact contract change").
CRON10_TOPIC="0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687"
SUBSCRIBE_TOPIC="0xe9b38458922e1af481b2244c7c2bb32e465e90c352946042d2a09472fad6c246"
UNSUBSCRIBE_TOPIC="0x15fca4b8348be4e206988055f4ba52d98f0ba260e633cf0968042fcfb004a944"

REACTIVE_RPC="${REACTIVE_RPC:-https://lasna-rpc.rnk.dev/}"
BASE_RPC="${BASE_RPC:-https://sepolia.base.org}"
UNICHAIN_RPC="${UNICHAIN_RPC:-https://sepolia.unichain.org}"
ETH_SEPOLIA_RPC="${ETH_SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
BASE_PROXY="${BASE_PROXY:-0x476F44b11F5C942c58f4c8E3d0300E5710743585}"
UNICHAIN_PROXY="${UNICHAIN_PROXY:-0x775c9B990ADe401060B78D0e98684eEf8d2466C1}"
SEPOLIA_PROXY="${SEPOLIA_PROXY:-}"

RC="${RC_ADDRESS:-}"
BASE_PAYMENT_ESCROW="${PAYMENT_ESCROW_ADDRESS:-}"
BASE_ASSET_ESCROW="${BASE_ASSET_ESCROW_ADDRESS:-}"
UNICHAIN_PAYMENT_ESCROW="${UNICHAIN_PAYMENT_ESCROW_ADDRESS:-}"
UNICHAIN_ASSET_ESCROW="${ASSET_ESCROW_ADDRESS:-}"
SEPOLIA_PAYMENT_ESCROW="${SEPOLIA_PAYMENT_ESCROW_ADDRESS:-}"
SEPOLIA_ASSET_ESCROW="${SEPOLIA_ASSET_ESCROW_ADDRESS:-}"

# 1 lREACT native fee floor on the RC, upper bound on the funded buffer.
RC_BALANCE_FLOOR_WEI="${RC_BALANCE_FLOOR_WEI:-1000000000000000000}"
RC_RESERVE_MAX_WEI="${RC_RESERVE_MAX_WEI:-300000000000000000000}"
MIN_SUBS="${MIN_ACTIVE_SUBSCRIPTIONS:-19}"
LOOKBACK="${SUBSCRIPTION_LOOKBACK_BLOCKS:-300000}"

FAILURES=0

pass() { printf '  PASS  %s\n' "$1"; }
warn() { printf '  WARN  %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

to_dec() {
  local raw="${1%% *}"   # cast appends "[1.999e16]" to large decimals
  if [[ "$raw" =~ ^0x[0-9a-fA-F]+$ ]]; then
    cast to-dec "$raw" 2>/dev/null || printf '?'
  else
    printf '%s' "$raw"
  fi
}

big_ge() { python3 -c 'import sys; sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)' "$1" "$2"; }
big_le() { python3 -c 'import sys; sys.exit(0 if int(sys.argv[1]) <= int(sys.argv[2]) else 1)' "$1" "$2"; }
big_gt() { python3 -c 'import sys; sys.exit(0 if int(sys.argv[1]) > int(sys.argv[2]) else 1)' "$1" "$2"; }

is_unset() {
  [ -z "${1:-}" ] || [ "${1:-}" = "$ZERO" ]
}

check_rc() {
  printf '\n[New reactive contract (Lasna)]\n'
  if is_unset "$RC"; then
    fail "RC_ADDRESS not set" # no FIX command: this script never sends a tx
    return
  fi
  local raw debt balance
  raw=$(cast call --rpc-url "$REACTIVE_RPC" "$SYSTEM" 'debt(address)(uint256)' "$RC" 2>&1)
  if [ $? -ne 0 ]; then
    fail "RC debt() call failed: $raw"
  else
    debt=$(to_dec "$raw")
    if [ "$debt" = "0" ]; then pass 'RC debt == 0'; else fail "RC debt == $debt (execution paused)"; fi
  fi

  raw=$(cast balance --rpc-url "$REACTIVE_RPC" "$RC" 2>&1)
  if [ $? -ne 0 ]; then
    fail "RC native balance lookup failed: $raw"
    return
  fi
  balance=$(to_dec "$raw")
  if [ "$balance" = "?" ]; then
    fail "RC native balance unreadable ($raw)"
  elif big_ge "$balance" "$RC_BALANCE_FLOOR_WEI" && big_le "$balance" "$RC_RESERVE_MAX_WEI"; then
    pass "RC native balance $balance wei in [floor $RC_BALANCE_FLOOR_WEI, max $RC_RESERVE_MAX_WEI]"
  else
    fail "RC native balance $balance wei outside [floor $RC_BALANCE_FLOOR_WEI, max $RC_RESERVE_MAX_WEI]"
  fi
}

check_escrow() {
  local label="$1" rpc="$2" proxy="$3" escrow="$4"
  printf '\n[%s]\n' "$label"
  if is_unset "$escrow"; then
    fail "$label address not set"
    return
  fi
  if is_unset "$proxy"; then
    fail "$label proxy not set (cannot read debt/reserves)"
    return
  fi
  local raw debt reserves
  raw=$(cast call --rpc-url "$rpc" "$proxy" 'debt(address)(uint256)' "$escrow" 2>&1)
  if [ $? -ne 0 ]; then
    fail "$label debt() call failed: $raw"
  else
    debt=$(to_dec "$raw")
    if [ "$debt" = "0" ]; then pass "$label debt == 0"; else fail "$label debt == $debt"; fi
  fi

  raw=$(cast call --rpc-url "$rpc" "$proxy" 'reserves(address)(uint256)' "$escrow" 2>&1)
  if [ $? -ne 0 ] || [ -z "$raw" ]; then
    fail "$label reserves() call failed: $raw (expected reserves > 0 on every new escrow)"
  else
    reserves=$(to_dec "$raw")
    if [ "$reserves" != "?" ] && big_gt "$reserves" 0; then
      pass "$label reserves == $reserves wei > 0"
    else
      fail "$label reserves == $reserves (not funded)"
    fi
  fi
}

code_has() {
  # case-insensitive fixed-string search for a selector/topic in runtime code.
  local code="$1" needle="${2#0x}"
  printf '%s' "$code" | grep -qiF -- "$needle"
}

check_code_selectors() {
  # ABI-presence smoke check for STATE-CHANGING functions: we must not call
  # them, so we read runtime bytecode (eth_getCode via `cast code`) and look
  # for each 4-byte selector from `cast sig`. This is a heuristic — a selector
  # can also occur inside a constant — so it is NOT a substitute for Sourcify
  # exact-match verification; it only proves the selector is present.
  local label="$1" rpc="$2" address="$3"
  shift 3
  if is_unset "$address"; then
    fail "$label address not set"
    return
  fi
  local code selector signature
  code=$(cast code --rpc-url "$rpc" "$address" 2>/dev/null)
  if [ -z "$code" ] || [ "$code" = "0x" ]; then
    fail "$label: no runtime code at $address (eth_getCode)"
    return
  fi
  for signature in "$@"; do
    selector=$(cast sig "$signature" 2>/dev/null)
    if [ -n "$selector" ] && code_has "$code" "$selector"; then
      pass "$label has $signature ($selector)"
    else
      fail "$label missing $signature ($selector) in runtime bytecode"
    fi
  done
}

check_code_topics() {
  # Same bytecode heuristic for event signatures: `cast keccak` of the exact
  # signature should appear as a PUSH32 where the event is emitted.
  local label="$1" rpc="$2" address="$3"
  shift 3
  if is_unset "$address"; then
    fail "$label address not set"
    return
  fi
  local code topic signature
  code=$(cast code --rpc-url "$rpc" "$address" 2>/dev/null)
  if [ -z "$code" ] || [ "$code" = "0x" ]; then
    fail "$label: no runtime code at $address (eth_getCode)"
    return
  fi
  for signature in "$@"; do
    topic=$(cast keccak "$signature" 2>/dev/null)
    if [ -n "$topic" ] && code_has "$code" "$topic"; then
      pass "$label emits $signature"
    else
      fail "$label missing event topic for $signature ($topic)"
    fi
  done
}

check_escrow_abi() {
  local label="$1" rpc="$2" escrow="$3"
  printf '\n[%s ABI presence]\n' "$label"
  if is_unset "$escrow"; then
    fail "$label address not set"
    return
  fi
  # Read-only eth_call against the new view function: a contract without it
  # reverts / returns empty, so a successful decode proves the new ABI exists.
  local raw
  raw=$(cast call --rpc-url "$rpc" "$escrow" 'lockedByToken(address)(uint256)' "$ZERO" 2>&1)
  if [ $? -eq 0 ] && [ -n "$raw" ]; then
    pass "$label lockedByToken(address) present ($(to_dec "$raw") for token(0))"
  else
    fail "$label lockedByToken(address) missing: $raw"
  fi
  check_code_selectors "$label" "$rpc" "$escrow" \
    'rescueToken(address,address,uint256)' 'rescueNative(address,uint256)'
  check_code_topics "$label" "$rpc" "$escrow" \
    'TokenRescued(address,address,uint256)' 'EscrowNativeRescued(address,uint256)'
}

check_rc_abi() {
  printf '\n[New RC ABI presence]\n'
  if is_unset "$RC"; then
    fail "RC_ADDRESS not set"
    return
  fi
  # expire()/rescueNative() are state-changing and are NEVER called here.
  check_code_selectors 'New RC' "$REACTIVE_RPC" "$RC" \
    'expire(bytes32)' 'rescueNative(address,uint256)'
  check_code_topics 'New RC' "$REACTIVE_RPC" "$RC" \
    'NativeRescued(address,uint256,uint256)'
}

check_subscriptions() {
  printf '\n[Lasna subscriptions — FUTURE Cron100]\n'
  if is_unset "$RC"; then
    fail "RC_ADDRESS not set"
    return
  fi
  local output status
  output=$(python3 - "$REACTIVE_RPC" "$RC" "$LOOKBACK" "${SUBSCRIPTION_FROM_BLOCK:-}" \
    "$SYSTEM" "$SUBSCRIBE_TOPIC" "$UNSUBSCRIBE_TOPIC" "$CRON100_TOPIC" "$LEGACY_SYSTEM" \
    "$CRON10_TOPIC" <<'PY'
import json, sys, urllib.request

(rpc, rc, lookback, explicit_from, system, subscribe_topic,
 unsubscribe_topic, cron100_topic, legacy_system, cron10_topic) = sys.argv[1:11]
rc_topic = '0x' + rc.lower().removeprefix('0x').rjust(64, '0')


def call(method, params):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    request = urllib.request.Request(rpc, data=payload, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read())
    if 'error' in body:
        raise RuntimeError(body['error'].get('message', str(body['error'])))
    return body['result']


latest = int(call('eth_blockNumber', []), 16)
start = int(explicit_from, 0) if explicit_from else max(0, latest - int(lookback))
logs = []
chunk = 30000  # Lasna caps eth_getLogs range at 30000 blocks; halve on RPC errors.
MIN_CHUNK = 1000
for topic in (subscribe_topic, unsubscribe_topic):
    block = start
    while block <= latest:
        end = min(block + chunk - 1, latest)
        try:
            result = call('eth_getLogs', [{
                'address': system,
                'fromBlock': hex(block), 'toBlock': hex(end),
                'topics': [topic, rc_topic],
            }])
        except Exception:
            if chunk <= MIN_CHUNK:
                raise
            chunk = max(MIN_CHUNK, chunk // 2)
            continue
        for log in result:
            logs.append((int(log['blockNumber'], 16), int(log['logIndex'], 16), topic, log))
        block = end + 1

logs.sort(key=lambda item: (item[0], item[1]))
active = {}
for _, _, topic, log in logs:
    chain_id = int(log['topics'][2], 16)
    contract = log['topics'][3]
    data = log['data']
    key = (chain_id, contract, data.lower())
    if topic == subscribe_topic:
        active[key] = log
    else:
        active.pop(key, None)

# Adapted for Cron100: the first data word of a Subscribe log is the subscribed
# topic0, and topics[3] is the contract. Require the legacy system contract's
# Cron100 subscription on Lasna (5318007); Cron10 must NOT be present.
def cron_seen(topic):
    return any(
        chain_id == 5318007
        and int(contract, 16) == int(legacy_system, 16)
        and int(data[:66], 16) == int(topic, 16)
        for (chain_id, contract, data), _log in active.items()
    )


print(len(active))
print('CRON100', 1 if cron_seen(cron100_topic) else 0)
print('CRON10', 1 if cron_seen(cron10_topic) else 0)
for (chain_id, contract, data), log in sorted(active.items()):
    print(f'{chain_id} {contract} {data[:66]} {log["transactionHash"]}')
PY
  )
  status=$?
  if [ $status -ne 0 ]; then
    fail "subscription log query failed: $output" # no FIX command: read-only script
    return
  fi
  local count cron100_flag cron10_flag detail
  count=$(printf '%s\n' "$output" | sed -n '1p')
  cron100_flag=$(printf '%s\n' "$output" | sed -n '2p' | awk '{print $2}')
  cron10_flag=$(printf '%s\n' "$output" | sed -n '3p' | awk '{print $2}')
  if [ "$count" -ge "$MIN_SUBS" ] 2>/dev/null; then
    pass "active subscriptions == $count (>= $MIN_SUBS; 3 venues x 6 + Cron100)"
  else
    fail "active subscriptions == $count (< $MIN_SUBS; expected 19 = 6 x 3 venues + Cron100)"
  fi
  if [ "$cron100_flag" = "1" ]; then
    pass 'Cron100 subscription present on legacy system contract (Lasna)'
  else
    fail 'Cron100 subscription NOT found on the legacy system contract'
  fi
  if [ "$cron10_flag" = "1" ]; then
    fail 'Cron10 is ALSO subscribed (double-billing risk) — unsubscribe it on the new RC'
  else
    pass 'Cron10 not subscribed (no double billing)'
  fi
  detail=$(printf '%s\n' "$output" | tail -n +4)
  if [ -n "$detail" ]; then
    printf '%s\n' "$detail" | while read -r chain contract topic tx; do
      printf '        · chain %s contract %s topic %s tx %s\n' "$chain" "$contract" "$topic" "$tx"
    done
  fi
}

printf '=== Handshake FUTURE Cron100 preflight (READ-ONLY — no transactions) ===\n'
printf 'Keystore account (informational; no signing and no --account on any call): %s\n' \
  "${FOUNDRY_ACCOUNT:-main}"
printf 'NOTE: no test transaction or test order is allowed until the backend/indexer\n'
printf '      is redeployed on the new addresses and /health is verified.\n'

check_rc
check_escrow 'Base payment escrow' "$BASE_RPC" "$BASE_PROXY" "$BASE_PAYMENT_ESCROW"
check_escrow 'Base asset escrow' "$BASE_RPC" "$BASE_PROXY" "$BASE_ASSET_ESCROW"
check_escrow 'Unichain payment escrow' "$UNICHAIN_RPC" "$UNICHAIN_PROXY" "$UNICHAIN_PAYMENT_ESCROW"
check_escrow 'Unichain asset escrow' "$UNICHAIN_RPC" "$UNICHAIN_PROXY" "$UNICHAIN_ASSET_ESCROW"
check_escrow 'Sepolia payment escrow' "$ETH_SEPOLIA_RPC" "$SEPOLIA_PROXY" "$SEPOLIA_PAYMENT_ESCROW"
check_escrow 'Sepolia asset escrow' "$ETH_SEPOLIA_RPC" "$SEPOLIA_PROXY" "$SEPOLIA_ASSET_ESCROW"

check_subscriptions

check_rc_abi
check_escrow_abi 'Base payment escrow' "$BASE_RPC" "$BASE_PAYMENT_ESCROW"
check_escrow_abi 'Base asset escrow' "$BASE_RPC" "$BASE_ASSET_ESCROW"
check_escrow_abi 'Unichain payment escrow' "$UNICHAIN_RPC" "$UNICHAIN_PAYMENT_ESCROW"
check_escrow_abi 'Unichain asset escrow' "$UNICHAIN_RPC" "$UNICHAIN_ASSET_ESCROW"
check_escrow_abi 'Sepolia payment escrow' "$ETH_SEPOLIA_RPC" "$SEPOLIA_PAYMENT_ESCROW"
check_escrow_abi 'Sepolia asset escrow' "$ETH_SEPOLIA_RPC" "$SEPOLIA_ASSET_ESCROW"

printf '\n=========================================================\n'
if [ "$FAILURES" -eq 0 ]; then
  printf 'PREFLIGHT PASS — read-only checks clean; indexer cutover still REQUIRED before any test transaction\n'
  exit 0
fi
printf 'PREFLIGHT FAIL — %d issue(s) above; do not transact\n' "$FAILURES"
exit 1
