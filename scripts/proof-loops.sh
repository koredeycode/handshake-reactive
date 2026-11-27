#!/usr/bin/env bash
# Generates the tiered proof loops from personal/EXPANSION-PLAN.md §5.3 against the
# live Option B deployment. Never fabricates hashes: every order is really submitted.
# Usage: bash scripts/proof-loops.sh [tier1|extra]
set -uo pipefail

cd "$(dirname "$0")/.."
set -a && . ./.env && set +a

RC="${RC_ADDRESS}"
BUYER="${BUYER_ADDRESS}"
SELLER="${SELLER_ADDRESS}"
LASNA="${REACTIVE_RPC}"

declare -A CID RPC GAS PESC AESC TUSD TASSET
CID[base]=84532;        RPC[base]=https://sepolia.base.org;                 GAS[base]=0.1gwei
PESC[base]=0x3ad68Ab1b7E03057864F3c76aC63476315E513b5
AESC[base]=0x5Ee944ddc392a9729d52702AB4c2e327848533a1
TUSD[base]=0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6
TASSET[base]=0x1B07c8fc7FE5984a68b206152cC7d3352deD0f19

CID[unichain]=1301;     RPC[unichain]=https://sepolia.unichain.org;        GAS[unichain]=0.1gwei
PESC[unichain]=0x577f9DCAD6E2E529c2091C47a5C2FBa3c6a655F0
AESC[unichain]=0x58084d4Ce053e9eD8aD16C107A72e8E8649Dd00d
TUSD[unichain]=0xbc2037b06278633968d869253f6f512562f86306
TASSET[unichain]=0x6d1Da6e00066f4b3A16Fec64010478165BAb34E6

CID[sepolia]=11155111;  RPC[sepolia]=${SEPOLIA_RPC};                       GAS[sepolia]=5gwei
PESC[sepolia]=0x6f28EDb5cC37d3078012b1e9250748A0381a3480
AESC[sepolia]=0x679d9B730c1eB7B88E1e6cFD501d12113F6F4E2F
TUSD[sepolia]=0xD894D5bAade0C06137D45C616Cb9D2e6cbFa5fD4
TASSET[sepolia]=0x9ffd2f7795fa3c029548c9faeac8da5cdb79047d

PAIR_AMT_USD=1000000
PAIR_AMT_ASSET=1000000000000000000

declare -A NONCE
send() {
  local rpc="$1" acct="$2" to="$3" sig="$4" gas="$5"; shift 5
  local key="$acct@$rpc"
  if [ -z "${NONCE[$key]:-}" ]; then
    NONCE[$key]=$(cast nonce "$(cast_wallet_addr "$acct")" --rpc-url "$rpc")
  fi
  local nonce=${NONCE[$key]}
  local gasarg=(); [ "$gas" != 0 ] && gasarg=(--gas-price "$gas")
  local out; out=$(cast send "$to" "$sig" "$@" --rpc-url "$rpc" --account "$acct" --password "" \
    "${gasarg[@]}" --nonce "$nonce" --json 2>&1)
  local hash; hash=$(printf '%s' "$out" | jq -r '.transactionHash // empty' 2>/dev/null)
  if [ -z "$hash" ]; then
    unset 'NONCE[$key]'
    printf 'SEND FAILED: %s %s\n%s\n' "$acct" "$sig" "$out" >&2
    return 1
  fi
  NONCE[$key]=$((nonce + 1))
  printf '%s' "$hash"
}

cast_wallet_addr() { case "$1" in hs-buyer) echo "$BUYER";; hs-seller) echo "$SELLER";; hs-deployer) echo "$DEPLOYER_ADDRESS";; esac; }

create_order() {
  local label="$1" src="$2" dst="$3" paytok="$4" payamt="$5" asstok="$6" asamt="$7" dur="$8"
  local oid; oid=$(cast keccak "handshake-$label")
  local hash; hash=$(send "$LASNA" hs-buyer "$RC" \
    'createOrder(bytes32,address,address,uint256,uint256,address,address,uint256,uint256,address,uint256)' 0 \
    "$oid" "$SELLER" "$paytok" "$payamt" "${CID[$src]}" "${PESC[$src]}" "$asstok" "$asamt" "${CID[$dst]}" "${AESC[$dst]}" "$dur")
  # Read the deadline from the RC itself: Lasna block.timestamp differs from the
  # local clock by a few seconds, and a mismatched deadline invalidates both legs.
  local raw deadline
  raw=$(cast call "$RC" 'getOrder(bytes32)' "$oid" --rpc-url "$LASNA" | tail -1)
  raw=${raw#0x}
  deadline=$((16#${raw:384:64}))
  printf '%s %s %s %s %s %s %s\n' "$oid" "$deadline" "$src" "$dst" "$paytok" "$payamt" "$asstok"
}

terms_of() { cast call "$RC" 'termsHash(bytes32)(bytes32)' "$1" --rpc-url "$LASNA" | tail -1; }

# Leg is an 8-word tuple; word 6 (0-based) is the LegState enum.
leg_state() { local raw="${1#0x}"; printf '%d' "$((16#${raw:384:64}))"; }

lock_payment() {
  local oid="$1" chain="$2" token="$3" amount="$4" th="$5" deadline="$6"
  send "${RPC[$chain]}" hs-buyer "$token" 'approve(address,uint256)' "${GAS[$chain]}" "${PESC[$chain]}" "$amount" >/dev/null
  send "${RPC[$chain]}" hs-buyer "${PESC[$chain]}" \
    'lock(bytes32,address,uint256,address,bytes32,uint256)' "${GAS[$chain]}" \
    "$oid" "$token" "$amount" "$SELLER" "$th" "$deadline"
}

lock_asset() {
  local oid="$1" chain="$2" token="$3" amount="$4" th="$5" deadline="$6"
  send "${RPC[$chain]}" hs-seller "$token" 'approve(address,uint256)' "${GAS[$chain]}" "${AESC[$chain]}" "$amount" >/dev/null
  send "${RPC[$chain]}" hs-seller "${AESC[$chain]}" \
    'lock(bytes32,address,uint256,address,bytes32,uint256)' "${GAS[$chain]}" \
    "$oid" "$token" "$amount" "$BUYER" "$th" "$deadline"
}

run_settle() {
  local label="$1" src="$2" dst="$3" paytok="$4" payamt="$5" asstok="$6" asamt="$7" order="$8"
  local info; info=$(create_order "$label" "$src" "$dst" "$paytok" "$payamt" "$asstok" "$asamt" 600)
  read -r oid deadline s d pt pa at <<<"$info"
  local th; th=$(terms_of "$oid")
  if [ "$order" = payment-first ]; then
    lock_payment "$oid" "$s" "$pt" "$pa" "$th" "$deadline" >/dev/null
    lock_asset "$oid" "$d" "$at" "$asamt" "$th" "$deadline" >/dev/null
  else
    lock_asset "$oid" "$d" "$at" "$asamt" "$th" "$deadline" >/dev/null
    lock_payment "$oid" "$s" "$pt" "$pa" "$th" "$deadline" >/dev/null
  fi
  # A closed order can also be refunded; require both legs RELEASED (state 2).
  local pstate astate result=refunded
  for i in 1 2 3 4 5 6 7 8; do
    sleep 2
    pstate=$(leg_state "$(cast call "${PESC[$s]}" 'getLeg(bytes32)' "$oid" --rpc-url "${RPC[$s]}" | tail -1)")
    astate=$(leg_state "$(cast call "${AESC[$d]}" 'getLeg(bytes32,address)' "$oid" "$SELLER" --rpc-url "${RPC[$d]}" | tail -1)")
    if [ "$pstate" = 2 ] && [ "$astate" = 2 ]; then result=settled; break; fi
  done
  printf '%s %-28s %s->%s %-14s %s\n' "$oid" "$label" "$s" "$d" "$order" "$result"
}

run_refund() {
  local label="$1" src="$2" dst="$3"
  local info; info=$(create_order "$label" "$src" "$dst" "${TUSD[$src]}" "$PAIR_AMT_USD" "${TASSET[$dst]}" "$PAIR_AMT_ASSET" 30)
  read -r oid deadline s d pt pa at <<<"$info"
  local th; th=$(terms_of "$oid")
  lock_payment "$oid" "$s" "$pt" "$pa" "$th" "$deadline" >/dev/null
  sleep 36
  send "$LASNA" hs-deployer "$RC" 'retry(bytes32)' 0 "$oid" >/dev/null
  local state=''
  for i in 1 2 3 4 5 6; do
    sleep 2
    state=$(leg_state "$(cast call "${PESC[$s]}" 'getLeg(bytes32)' "$oid" --rpc-url "${RPC[$s]}" | tail -1)")
    [ "$state" = 3 ] && break
  done
  printf '%s %-28s %s->%s refund-leg-state=%s\n' "$oid" "$label" "$s" "$d" "$state"
}

TIER="${1:-tier1}"
RUN="${2:-$(date +%s)}"
PAIRS="base:unichain unichain:base base:sepolia sepolia:base unichain:sepolia sepolia:unichain"
for p in $PAIRS; do
  s=${p%%:*}; d=${p##*:}
  run_settle "t1-${RUN}-${s}-${d}-payfirst" "$s" "$d" "${TUSD[$s]}" "$PAIR_AMT_USD" "${TASSET[$d]}" "$PAIR_AMT_ASSET" payment-first
  run_settle "t1-${RUN}-${s}-${d}-assetfirst" "$s" "$d" "${TUSD[$s]}" "$PAIR_AMT_USD" "${TASSET[$d]}" "$PAIR_AMT_ASSET" asset-first
  run_refund "t1-${RUN}-${s}-${d}-refund" "$s" "$d"
done

if [ "$TIER" = extra ]; then
  run_settle "t2-sepolia-same-token" unichain sepolia "${TUSD[unichain]}" "$PAIR_AMT_USD" "${TUSD[sepolia]}" "$PAIR_AMT_USD" payment-first
  run_settle "t3-role-reversal" base unichain "${TASSET[base]}" "$PAIR_AMT_ASSET" "${TUSD[unichain]}" "$PAIR_AMT_USD" payment-first
  run_settle "t2-sepolia-payfirst" base sepolia "${TUSD[base]}" "$PAIR_AMT_USD" "${TASSET[sepolia]}" "$PAIR_AMT_ASSET" payment-first
fi
