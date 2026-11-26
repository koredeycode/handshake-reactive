#!/usr/bin/env bash
# Handshake preflight — run before every demo/video take (PRD §9e item 9).
# Checks: debt == 0 and reserves > 0 on all three contracts, wallet balances,
# and active event subscriptions. All fix commands use Foundry keystore
# `--account` (no raw private keys, no key material in this file).

set -uo pipefail

SYSTEM="0x8888888888888888888888888888888888888888"
BASE_PROXY="0x476F44b11F5C942c58f4c8E3d0300E5710743585"
UNICHAIN_PROXY="0x775c9B990ADe401060B78D0e98684eEf8d2466C1"
# Role-based overrides. Defaults are the live forward market, so existing runs are unchanged.
# For a reverse market set PAYMENT_* to Unichain and ASSET_* to Base (see MARKETS.md).
PAYMENT_PROXY="${PAYMENT_PROXY:-$BASE_PROXY}"
ASSET_PROXY="${ASSET_PROXY:-$UNICHAIN_PROXY}"
PAYMENT_CHAIN_ID="${PAYMENT_CHAIN_ID:-84532}"
ASSET_CHAIN_ID="${ASSET_CHAIN_ID:-1301}"
PAYMENT_CHAIN_LABEL="${PAYMENT_CHAIN_LABEL:-Base Sepolia}"
ASSET_CHAIN_LABEL="${ASSET_CHAIN_LABEL:-Unichain Sepolia}"
SUBSCRIBE_TOPIC="0xe9b38458922e1af481b2244c7c2bb32e465e90c352946042d2a09472fad6c246"
UNSUBSCRIBE_TOPIC="0x15fca4b8348be4e206988055f4ba52d98f0ba260e633cf0968042fcfb004a944"

REACTIVE_RPC="${REACTIVE_RPC:-https://lasna-rpc.rnk.dev/}"
BASE_RPC="${BASE_RPC:-https://sepolia.base.org}"
UNICHAIN_RPC="${UNICHAIN_RPC:-https://sepolia.unichain.org}"
PAYMENT_RPC="${PAYMENT_RPC:-$BASE_RPC}"
ASSET_RPC="${ASSET_RPC:-$UNICHAIN_RPC}"
ETH_SEPOLIA_RPC="${ETH_SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
ACCOUNT="${FOUNDRY_ACCOUNT:-main}"
LASNA_FAUCET="0x9b9BB25f1A81078C544C829c5EB7822d747Cf434"

RC="${RC_ADDRESS:-}"
PAYMENT_ESCROW="${PAYMENT_ESCROW_ADDRESS:-}"
ASSET_ESCROW="${ASSET_ESCROW_ADDRESS:-}"
DEPLOYER="${DEPLOYER_ADDRESS:-}"
BUYER="${BUYER_ADDRESS:-}"
SELLER="${SELLER_ADDRESS:-}"

MIN_LASNA="${MIN_LASNA_BALANCE:-100000000000000000}"
MIN_BASE="${MIN_BASE_BALANCE:-10000000000000000}"
MIN_UNICHAIN="${MIN_UNICHAIN_BALANCE:-5000000000000000}"
MIN_PAYMENT="${MIN_PAYMENT_BALANCE:-$MIN_BASE}"
MIN_ASSET="${MIN_ASSET_BALANCE:-$MIN_UNICHAIN}"
MIN_SUBS="${MIN_ACTIVE_SUBSCRIPTIONS:-7}"
LOOKBACK="${SUBSCRIPTION_LOOKBACK_BLOCKS:-300000}"

FAILURES=0

pass() { printf '  PASS  %s\n' "$1"; }
warn() { printf '  WARN  %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1"
  if [ -n "${2:-}" ]; then printf '        FIX: %s\n' "$2"; fi
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

check_health() {
  local label="$1" rpc="$2" payer="$3" target="$4"
  printf '\n[%s]\n' "$label"
  if [ -z "$target" ] || [ "$target" = "0x0000000000000000000000000000000000000000" ]; then
    fail "$label address not set" "export the matching *_ADDRESS env var (see .env.example)"
    return
  fi

  local raw debt reserves
  raw=$(cast call --rpc-url "$rpc" "$payer" 'debt(address)(uint256)' "$target" 2>&1)
  if [ $? -ne 0 ]; then
    fail "$label: debt() call failed: $raw" "check the RPC URL and that $payer is correct on this chain"
    return
  fi
  debt=$(to_dec "$raw")
  if [ "$debt" = "0" ]; then
    pass "$label debt == 0"
  else
    fail "$label debt == $debt (execution paused)" \
      "cast send --rpc-url $rpc --account $ACCOUNT $payer \"depositTo(address)\" $target --value 0.05ether"
  fi

  raw=$(cast call --rpc-url "$rpc" "$payer" 'reserves(address)(uint256)' "$target" 2>/dev/null)
  if [ $? -ne 0 ] || [ -z "$raw" ]; then
    warn "$label: reserves() not exposed by this system/proxy build (debt check still authoritative)"
    return
  fi
  reserves=$(to_dec "$raw")
  if [ "$reserves" != "?" ] && [ "$reserves" -gt 0 ] 2>/dev/null; then
    pass "$label reserves == $reserves wei > 0"
  else
    fail "$label reserves == $reserves (not funded)" \
      "cast send --rpc-url $rpc --account $ACCOUNT $payer \"depositTo(address)\" $target --value 0.02ether"
  fi
}

check_balance() {
  local label="$1" rpc="$2" wallet="$3" min="$4" fix="$5"
  if [ -z "$wallet" ]; then
    warn "$label wallet address not set (skipped)"
    return
  fi
  local raw wei
  raw=$(cast balance --rpc-url "$rpc" "$wallet" 2>/dev/null)
  if [ $? -ne 0 ]; then
    fail "$label balance lookup failed" "check $rpc"
    return
  fi
  wei=$(to_dec "$raw")
  # Bash integer arithmetic overflows above 2^63; lREACT balances are ~2e19 wei.
  if [ "$wei" != "?" ] && python3 -c "import sys; sys.exit(0 if int('$wei') >= int('$min') else 1)" 2>/dev/null; then
    pass "$label balance $raw wei >= $min"
  else
    fail "$label balance $wei wei < $min" "$fix"
  fi
}

check_subscriptions() {
  printf '\n[Lasna subscriptions]\n'
  if [ -z "$RC" ]; then
    fail "RC_ADDRESS not set" "export RC_ADDRESS=<deployed reactive contract>"
    return
  fi
  local output status
  output=$(python3 - "$REACTIVE_RPC" "$RC" "$LOOKBACK" "${SUBSCRIPTION_FROM_BLOCK:-}" "$SYSTEM" "$SUBSCRIBE_TOPIC" "$UNSUBSCRIBE_TOPIC" <<'PY'
import json, sys, urllib.request

rpc, rc, lookback, explicit_from, system, subscribe_topic, unsubscribe_topic = sys.argv[1:8]
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
chunk = 30000  # Lasna caps eth_getLogs range at 30000 blocks.
for topic in (subscribe_topic, unsubscribe_topic):
    block = start
    while block <= latest:
        end = min(block + chunk - 1, latest)
        result = call('eth_getLogs', [{
            'address': system,
            'fromBlock': hex(block), 'toBlock': hex(end),
            'topics': [topic, rc_topic],
        }])
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

print(len(active))
for (chain_id, contract, data), log in sorted(active.items()):
    print(f'{chain_id} {contract} {data[:66]} {log["transactionHash"]}')
PY
  )
  status=$?
  if [ $status -ne 0 ]; then
    fail "subscription log query failed: $output" "set SUBSCRIPTION_FROM_BLOCK near the RC deployment block and retry"
    return
  fi
  local count detail
  count=$(printf '%s\n' "$output" | head -n 1)
  if [ "$count" -ge "$MIN_SUBS" ] 2>/dev/null; then
    pass "active subscriptions == $count (>= $MIN_SUBS)"
  else
    fail "active subscriptions == $count (< $MIN_SUBS)" \
      "cast send --rpc-url $REACTIVE_RPC --account $ACCOUNT $RC \"setVenues(uint256,address,uint256,address)\" $PAYMENT_CHAIN_ID $PAYMENT_ESCROW $ASSET_CHAIN_ID $ASSET_ESCROW"
  fi
  detail=$(printf '%s\n' "$output" | tail -n +2)
  if [ -n "$detail" ]; then
    printf '%s\n' "$detail" | while read -r chain contract topic tx; do
      printf '        · chain %s contract %s topic %s tx %s\n' "$chain" "$contract" "$topic" "$tx"
    done
  fi
}

printf '=== Handshake preflight ===\n'
printf 'Account (keystore): %s\n' "$ACCOUNT"
check_health 'Reactive arbiter (Lasna)' "$REACTIVE_RPC" "$SYSTEM" "$RC"
check_health "Payment escrow ($PAYMENT_CHAIN_LABEL)" "$PAYMENT_RPC" "$PAYMENT_PROXY" "$PAYMENT_ESCROW"
check_health "Asset escrow ($ASSET_CHAIN_LABEL)" "$ASSET_RPC" "$ASSET_PROXY" "$ASSET_ESCROW"

printf '\n[Wallet balances]\n'
check_balance 'Deployer on Lasna' "$REACTIVE_RPC" "$DEPLOYER" "$MIN_LASNA" \
  "cast send --rpc-url $ETH_SEPOLIA_RPC --account $ACCOUNT $LASNA_FAUCET \"request(address)\" $DEPLOYER --value 2ether"
check_balance 'Deployer on Base Sepolia' "$BASE_RPC" "$DEPLOYER" "$MIN_BASE" \
  'https://www.coinbase.com/developer-platform/products/faucet'
check_balance 'Deployer on Unichain Sepolia' "$UNICHAIN_RPC" "$DEPLOYER" "$MIN_UNICHAIN" \
  'https://faucet.zalalena.com/unichain'
check_balance 'Buyer on Lasna' "$REACTIVE_RPC" "$BUYER" "$MIN_LASNA" \
  "cast send --rpc-url $ETH_SEPOLIA_RPC --account $ACCOUNT $LASNA_FAUCET \"request(address)\" $BUYER --value 2ether"
check_balance "Buyer on $PAYMENT_CHAIN_LABEL" "$PAYMENT_RPC" "$BUYER" "$MIN_PAYMENT" \
  "${PAYMENT_FAUCET:-https://www.coinbase.com/developer-platform/products/faucet}"
check_balance 'Seller on Lasna' "$REACTIVE_RPC" "$SELLER" "$MIN_LASNA" \
  "cast send --rpc-url $ETH_SEPOLIA_RPC --account $ACCOUNT $LASNA_FAUCET \"request(address)\" $SELLER --value 2ether"
check_balance "Seller on $ASSET_CHAIN_LABEL" "$ASSET_RPC" "$SELLER" "$MIN_ASSET" \
  "${ASSET_FAUCET:-https://faucet.zalalena.com/unichain}"

check_subscriptions

printf '\n===============================\n'
if [ "$FAILURES" -eq 0 ]; then
  printf 'PREFLIGHT PASS — safe to demo\n'
  exit 0
fi
printf 'PREFLIGHT FAIL — %d issue(s) above; do not demo yet\n' "$FAILURES"
exit 1
