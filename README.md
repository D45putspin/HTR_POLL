# Poll

Poll is a Hathor dApp for creating token-weighted polls and voting on them. Poll creators choose the token, and votes are weighted on-chain by the amount of that token deposited in the vote transaction.

## Architecture
- **Smart contract (Hathor nano-contract)**: `contract/poll.py`
- **Web app (React + Vite)**: `src/`
- **Tests**: `tests/test_poll.py`

## On-Chain Weighting
Hathor nano-contracts cannot read arbitrary wallet balances. To keep weighting on-chain, this project uses **linear deposit-based voting**:
- Voters deposit the chosen token when voting.
- Vote weight is exactly the deposited amount.
- Deposits (and thus vote weight) are **locked until the poll ends**.
- Deposits can be withdrawn after the poll ends via `withdraw_vote`.
- If poll creation fees are enabled, `create_poll` requires the exact HTR fee amount.
- Same-token deposit and withdrawal actions are summed, so split UTXOs are supported.

## Quick Start

### 1. Contract tests
```bash
cd poll
./tests/run_tests.sh
```

### 2. Testnet deployment (existing blueprint + contract)
```bash
cd poll
./deploy_testnet_contract.sh
```
Outputs `BLUEPRINT_ID`, `CONTRACT_ID`, and the testnet explorer URL for the frontend.

The script expects a headless wallet API on `http://localhost:8000` with testnet settings. One working setup is the `hathornetwork/hathor-wallet-headless` container started with:

```bash
docker run -d --name poll-testnet-wallet -p 8000:8000 \
  -e HEADLESS_NETWORK=testnet \
  -e HEADLESS_SERVER=https://node1.testnet.hathor.network/v1a/ \
  -e HEADLESS_TX_MINING_URL=https://txmining.testnet.hathor.network \
  -e HEADLESS_HTTP_PORT=8000 \
  -e HEADLESS_HTTP_BIND_ADDRESS=0.0.0.0 \
  -e HEADLESS_SEED_DEFAULT='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art' \
  hathornetwork/hathor-wallet-headless:latest
```

### 3. Web app
```bash
cd poll
npm install
npm run dev
```

## Web App Environment Variables
Create a `.env` file in `poll/`:
```
VITE_POLL_BLUEPRINT_ID=00d93010e8b5133a9c5ced7b57b3feea3d1b8aac9b514429bb1b23204bcd8f11
VITE_POLL_CONTRACT_ID=
VITE_POLL_CREATION_FEE=0
# Proxied via Vite to Hathor testnet
VITE_HATHOR_NODE_URL=/api/
VITE_HATHOR_CHAIN=testnet
VITE_WALLETCONNECT_PROJECT_ID=
VITE_WALLETCONNECT_RELAY=wss://relay.reown.com
```

## Contract Methods (Summary)
- `initialize(creation_fee_htr=0)`
- `create_poll(title, description, options, token_uid, start_at, end_at, weighting='linear', weight_cap=0)`
- `vote(poll_id, option_index)`
- `withdraw_vote(poll_id)`
- `withdraw_creation_fees()`
- `get_poll_count()`
- `get_owner()`
- `get_creation_fee_balance()`
- `get_poll(poll_id)` (returns `option_count` instead of options array)
- `get_poll_option(poll_id, option_index)`
- `get_poll_results(poll_id)` (returns `[option_index, weight, votes]` rows)
- `get_vote(poll_id, voter_hex)`

Only `weighting='linear'` with `weight_cap=0` is accepted by the contract.
If `creation_fee_htr > 0`, the exact fee is required and the contract owner can later withdraw collected creation fees.

## Weighting Model
- **Linear**: weight = deposit amount
