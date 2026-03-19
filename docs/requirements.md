# Requirements

## Functional
- Create a poll with title, description, options, start/end time, and token selection.
- Allow voters to cast a vote for one option per poll.
- Weight votes linearly by token deposits at vote time (on-chain), and lock those deposits until poll end.
- Allow withdrawals of deposited voting tokens after the poll ends.
- If creation fees are enabled, require the exact HTR fee and allow the contract owner to withdraw collected fees.
- Show poll results with weighted totals and raw vote counts.
- Prevent voting outside the poll window.

## Non-Functional
- Deterministic vote weighting (based on on-chain deposits).
- Transparent auditability of vote weights.
- Rate limiting / anti-spam controls for poll creation (optional creation fee).
- Support split same-token deposit/withdrawal actions from compatible wallets.

## Data Model (Draft)
- `Poll`: id, creator, title, description, options, token_uid, start_at, end_at, weighting=`linear`, weight_cap=`0`
- `Vote`: poll_id, voter, option_index, weight, deposit

## Open Decisions
- Should polls allow multiple votes per address (weighted by total deposits) or single vote only?
- Should creation fees be mandatory or configurable per contract?
- Maximum poll size and pagination strategy for large poll lists.
