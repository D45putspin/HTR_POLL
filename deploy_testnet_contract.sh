#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -f .env ]; then
  export $(grep -v '^\s*#' .env | sed 's/\s*#.*$//' | xargs)
fi

WALLET_API=${WALLET_API:-"http://localhost:8000"}
WALLET_ID=${WALLET_ID:-"poll-testnet-v1"}
WALLET_SEED=${WALLET_SEED:-"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"}
POLL_CREATION_FEE=${POLL_CREATION_FEE:-0}
EXISTING_BLUEPRINT_ID=${EXISTING_BLUEPRINT_ID:-${VITE_POLL_BLUEPRINT_ID:-${NEXT_PUBLIC_POLL_BLUEPRINT_ID:-}}}
EXPECTED_NETWORK="testnet"
MAX_WALLET_RETRIES=${MAX_WALLET_RETRIES:-60}
POLL_INTERVAL_SEC=${POLL_INTERVAL_SEC:-10}
CONTRACT_MINING_RETRIES=${CONTRACT_MINING_RETRIES:-180}

print_json() {
  local payload="$1"
  if printf '%s\n' "$payload" | jq . >/dev/null 2>&1; then
    printf '%s\n' "$payload" | jq
  else
    printf '%s\n' "$payload"
  fi
}

json_field() {
  local payload="$1"
  local filter="$2"
  local value
  if ! value=$(printf '%s\n' "$payload" | jq -r "$filter" 2>/dev/null); then
    printf "${RED}Invalid JSON response${NC}\n"
    printf '%s\n' "$payload"
    return 1
  fi
  printf '%s\n' "$value"
}

start_wallet() {
  printf "Starting wallet %s on testnet...\n" "$WALLET_ID"
  local resp
  resp=$(curl -s -X POST "$WALLET_API/start" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg id "$WALLET_ID" --arg seed "$WALLET_SEED" '{ "wallet-id": $id, "seed": $seed }')")

  local ok
  ok=$(printf '%s\n' "$resp" | jq -r '.success // false' 2>/dev/null || echo false)
  local err_code
  err_code=$(printf '%s\n' "$resp" | jq -r '.errorCode // ""' 2>/dev/null || echo "")

  if [ "$ok" != "true" ] && [ "$err_code" != "WALLET_ALREADY_STARTED" ]; then
    printf "${RED}Failed to start wallet${NC}\n"
    print_json "$resp"
    exit 1
  fi

  if [ "$err_code" = "WALLET_ALREADY_STARTED" ]; then
    printf "${YELLOW}Wallet already started${NC}\n"
  else
    printf "${GREEN}Wallet started${NC}\n"
  fi
}

wait_for_wallet_ready() {
  printf "Waiting for wallet to be ready...\n"
  for i in $(seq 1 "$MAX_WALLET_RETRIES"); do
    local status
    status=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/status")

    local network
    network=$(printf '%s\n' "$status" | jq -r '.network // ""' 2>/dev/null || echo "")
    if [ -n "$network" ] && [ "$network" != "$EXPECTED_NETWORK" ]; then
      printf "${RED}Wallet is on network '%s' but expected '%s'${NC}\n" "$network" "$EXPECTED_NETWORK"
      exit 1
    fi

    local code
    code=$(json_field "$status" '.statusCode') || exit 1
    if [ "$code" = "3" ]; then
      printf "${GREEN}Wallet is ready${NC}\n"
      return 0
    fi

    sleep "$POLL_INTERVAL_SEC"
  done

  printf "${RED}Wallet did not become ready in time${NC}\n"
  exit 1
}

fetch_wallet_address() {
  printf "Fetching wallet address...\n"
  local address_resp
  address_resp=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/address")
  WALLET_ADDRESS=$(json_field "$address_resp" '.address // .addresses[0] // empty') || exit 1
  if [ -z "$WALLET_ADDRESS" ]; then
    printf "${RED}Could not get wallet address${NC}\n"
    print_json "$address_resp"
    exit 1
  fi
  printf "${GREEN}Using address: %s${NC}\n" "$WALLET_ADDRESS"
}

check_wallet_balance() {
  local balance_resp
  balance_resp=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/balance")
  local available
  available=$(json_field "$balance_resp" '.available // 0') || exit 1

  if [ "$available" -le 0 ]; then
    printf "${RED}Wallet balance is 0. You need testnet HTR to deploy the contract.${NC}\n"
    print_json "$balance_resp"
    exit 1
  fi

  printf "${GREEN}Wallet balance: %s units${NC}\n" "$available"
}

create_contract() {
  printf "Creating poll contract on testnet...\n"
  local payload
  payload=$(jq -n \
    --arg blueprint_id "$EXISTING_BLUEPRINT_ID" \
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

  local resp
  resp=$(printf '%s\n' "$payload" | curl -s -X POST \
    -H "X-Wallet-Id: $WALLET_ID" \
    -H "Content-Type: application/json" \
    -d @- \
    "$WALLET_API/wallet/nano-contracts/create")

  CONTRACT_ID=$(json_field "$resp" '.hash // empty') || exit 1
  if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" = "null" ]; then
    printf "${RED}Failed to create contract${NC}\n"
    print_json "$resp"
    exit 1
  fi

  printf "${GREEN}Contract created: %s${NC}\n" "$CONTRACT_ID"
}

wait_for_contract_confirmation() {
  printf "Waiting for testnet confirmation...\n"
  for i in $(seq 1 "$CONTRACT_MINING_RETRIES"); do
    local tx
    tx=$(curl -s -H "X-Wallet-Id: $WALLET_ID" "$WALLET_API/wallet/transaction?id=$CONTRACT_ID")

    local first_block
    first_block=$(json_field "$tx" '.first_block // empty') || exit 1
    local is_voided
    is_voided=$(json_field "$tx" '.is_voided // false') || exit 1

    if [ "$is_voided" = "true" ]; then
      printf "${RED}Contract transaction was voided${NC}\n"
      print_json "$tx"
      exit 1
    fi

    if [ -n "$first_block" ] && [ "$first_block" != "null" ]; then
      printf "${GREEN}Contract confirmed in block: %s${NC}\n" "$first_block"
      return 0
    fi

    if [ $((i % 6)) -eq 0 ]; then
      printf "Still waiting... (%s/%s)\n" "$i" "$CONTRACT_MINING_RETRIES"
    fi

    sleep "$POLL_INTERVAL_SEC"
  done

  printf "${YELLOW}Timed out waiting for confirmation. Check explorer for %s${NC}\n" "$CONTRACT_ID"
}

if [ -z "$EXISTING_BLUEPRINT_ID" ]; then
  printf "${RED}EXISTING_BLUEPRINT_ID is required for testnet deployment.${NC}\n"
  printf "Set VITE_POLL_BLUEPRINT_ID in .env or export EXISTING_BLUEPRINT_ID before running this script.\n"
  exit 1
fi

start_wallet
wait_for_wallet_ready
fetch_wallet_address
check_wallet_balance
create_contract
wait_for_contract_confirmation

printf "\n"
printf "BLUEPRINT_ID=%s\n" "$EXISTING_BLUEPRINT_ID"
printf "CONTRACT_ID=%s\n" "$CONTRACT_ID"
printf "EXPLORER_URL=https://explorer.testnet.hathor.network/transaction/%s\n" "$CONTRACT_ID"
