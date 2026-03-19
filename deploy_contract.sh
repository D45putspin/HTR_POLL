#!/bin/bash
set -e

WALLET_API=${WALLET_API:-https://wallet.localnet.hathor.works}
WALLET_ID=${WALLET_ID:-genesis}
WALLET_SEED=${WALLET_SEED:-"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"}
POLL_CREATION_FEE=${POLL_CREATION_FEE:-0}
EXISTING_BLUEPRINT_ID=${EXISTING_BLUEPRINT_ID:-}
MAX_WALLET_RETRIES=${MAX_WALLET_RETRIES:-30}
POLL_INTERVAL_SEC=${POLL_INTERVAL_SEC:-3}
BLUEPRINT_MINING_RETRIES=${BLUEPRINT_MINING_RETRIES:-120}

json_field() {
  local payload="$1"
  local filter="$2"
  printf '%s\n' "$payload" | jq -r "$filter"
}

start_wallet() {
  curl -s -X POST "$WALLET_API/start" \
    -H "Content-Type: application/json" \
    -d "{\"wallet-id\": \"$WALLET_ID\", \"seed\": $(jq -Rs . <<< "$WALLET_SEED")}" >/dev/null || true
}

wait_for_wallet_ready() {
  for i in $(seq 1 "$MAX_WALLET_RETRIES"); do
    local status
    status=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/status")
    local code
    code=$(json_field "$status" '.statusCode') || true
    if [ "$code" = "3" ]; then
      return 0
    fi
    sleep "$POLL_INTERVAL_SEC"
  done
  echo "Wallet not ready."
  exit 1
}

fetch_wallet_address() {
  local address_resp
  address_resp=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/address")
  WALLET_ADDRESS=$(json_field "$address_resp" '.address // .addresses[0] // empty')
  if [ -z "$WALLET_ADDRESS" ]; then
    echo "Failed to obtain wallet address."
    exit 1
  fi
}

start_wallet
wait_for_wallet_ready
fetch_wallet_address

if [ -n "$EXISTING_BLUEPRINT_ID" ]; then
  BLUEPRINT_ID="$EXISTING_BLUEPRINT_ID"
else
  BLUEPRINT_CODE=$(cat contract/poll.py)
  BLUEPRINT_RESP=$(curl -s -X POST \
    -H "X-Wallet-Id: $WALLET_ID" \
    -H "Content-Type: application/json" \
    -d "{\"code\": $(jq -Rs . <<< "$BLUEPRINT_CODE"), \"address\": \"$WALLET_ADDRESS\"}" \
    "$WALLET_API/wallet/nano-contracts/create-on-chain-blueprint")

  BLUEPRINT_ID=$(json_field "$BLUEPRINT_RESP" '.hash')
  if [ -z "$BLUEPRINT_ID" ] || [ "$BLUEPRINT_ID" = "null" ]; then
    echo "Failed to register blueprint."
    echo "$BLUEPRINT_RESP"
    exit 1
  fi

  for i in $(seq 1 "$BLUEPRINT_MINING_RETRIES"); do
    BLUEPRINT_TX_INFO=$(curl -s "$WALLET_API/wallet/transaction?id=$BLUEPRINT_ID" -H "X-Wallet-Id: $WALLET_ID")
    FIRST_BLOCK=$(json_field "$BLUEPRINT_TX_INFO" '.first_block') || true
    if [ "$FIRST_BLOCK" != "null" ] && [ -n "$FIRST_BLOCK" ]; then
      break
    fi
    sleep "$POLL_INTERVAL_SEC"
  done

  if [ "$FIRST_BLOCK" = "null" ] || [ -z "$FIRST_BLOCK" ]; then
    echo "Blueprint mining timeout."
    exit 1
  fi
fi

CREATE_CONTRACT_PAYLOAD=$(jq -n \
  --arg blueprint_id "$BLUEPRINT_ID" \
  --arg address "$WALLET_ADDRESS" \
  --argjson fee "$POLL_CREATION_FEE" \
  '{
    blueprint_id: $blueprint_id,
    address: $address,
    data: {
      actions: [],
      args: [$fee]
    }
  }')

RESP=$(echo "$CREATE_CONTRACT_PAYLOAD" | curl -s -X POST \
  -H "X-Wallet-Id: $WALLET_ID" \
  -H "Content-Type: application/json" \
  -d @- \
  "$WALLET_API/wallet/nano-contracts/create")

CONTRACT_ID=$(json_field "$RESP" '.hash')
if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" = "null" ]; then
  echo "Failed to create contract."
  echo "$RESP"
  exit 1
fi

echo "BLUEPRINT_ID=$BLUEPRINT_ID"
echo "CONTRACT_ID=$CONTRACT_ID"
