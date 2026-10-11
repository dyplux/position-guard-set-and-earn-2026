# Private seller submission on chain 97

`operations/seller-submit.cjs` is an isolated Mac operator command. The public
server doesn't import it. It has no default execution mode, no mainnet target,
and no borrower, settlement, claim or dispute function.

The command reads a private input file with `job_id`, `funding_tx_hash`, the
issued signed quote in `envelope`, and exact persisted manifest bytes encoded
as lowercase `manifest_hex`. It verifies the paid job at its funding block and
current state through two fixed public RPCs. Synthetic proof is rejected.

The manifest must contain an observed, read-only policy receipt for the wallet
in the signed task. The command rechecks the receipt against policy 0.2.0. A
`NEED_EVIDENCE` outcome requires the signed quality terms to contain
`NEED_EVIDENCE accepted`; storing that result doesn't establish service completion.
The fixed public delivery URL must return the exact canonical bytes before
preparation and again during the final pre-sign preflight.

```sh
node operations/seller-submit.cjs seal
node operations/seller-submit.cjs prepare /private/input.json
node operations/seller-submit.cjs execute /private/input.json /private/packet.json
node operations/seller-submit.cjs reconcile /private/packet.json 0xTRANSACTION_HASH
```

`seal` records code, installed dependency files, Node and Python binary hashes
in the real Mac operator's `.config/position-guard-submit/seals`. It doesn't
create a grant. Source and dependency files must be operator/root-owned and
not writable by other users; installation with `umask 022` avoids writable
dependency trees. The operating system and operator account remain trusted.

`prepare` returns an unsigned packet with chain 97, agent 2583, provider F9,
Commerce, one job, exact commitment/calldata, nonce, gas, gas price, deadline
and source seal. Gas is bounded to 500,000 and its maximum cost to 0.001 testBNB.
The minimum remaining native reserve is 0.001 testBNB. Preparation doesn't
authorize signing, publish an offer or count as a marketplace hire.

Execution requires an owner-private `operator.json` in that authority directory,
binding the existing local `wallet_env` to provider F9. It also requires an
explicit approved `grants/<packet SHA-256>.json`. The grant pins the full packet,
source seal, expiry, maximum gas cost, reserve, one signature and one dispatch.
The wallet isn't copied to the VPS. Caller JSON can't provide a grant, wallet
path, target, RPC URL or source seal override.

The grant schema is defined in `operations/seller_submit_guard.cjs`. Its pure
`assertPermit` checks the schema only and returns `authority_verified: false`.
The executable obtains authority from the fixed private filesystem and performs
its own fresh public verification before any key load.

Nonce and job locks are exclusive and fsynced before signing. Each phase is an
append-only fsynced journal. A partial lock/write/sign failure remains consumed
for manual reconciliation. The exact serialized transaction is recovered and
compared with the packet before one broadcast attempt. An ambiguous response
never resends. Stdout contains status, counts and the transaction hash, with
no key, serialized transaction or signed quote.

`reconcile` is read-only. It checks the receipt, unique `JobSubmitted` event,
transaction fields, commitment, two confirmations, current job state and two-RPC
agreement. `SUBMISSION_RECONCILED` and `COMPLETED` are separate outcomes. Only
real verified rail state 3 produces `completed_onchain: true`. Mock/fork transports
remain synthetic. Missing receipts remain pending; a pending observation never
authorizes another dispatch.

No execution grant or real funded job is shipped with this code. Paid public
negotiation stays disabled until the operator has authorized and verified the
service's fulfilment path and availability. Submission is a marketplace action;
it doesn't count as a lending maintenance action.
