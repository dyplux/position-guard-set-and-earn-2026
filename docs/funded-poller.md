# Funded poller

`marketplace.poller` is an operator-only, read-only funded-event queue. It
invokes the fixed `marketplace/poll_reader.cjs` with exactly one JSON
request on stdin (`from_block`, `previous_hash`). The node executable and fixed
script are local paths; the request is capped at 1024 bytes, stdout at 65536
bytes, and execution at 90 seconds. No RPC URL, secret, signing, publication,
or submission is accepted by the poller.

State lives in a pre-existing or newly-created owner-only directory. The
poller database is `poll.sqlite` (mode 0600), and `poller.lock` is nonblocking.
`--start-block` is recorded once; a later mismatch stops. The cursor advances
only in the same SQLite transaction that inserts the bounded event batch.
Pages are limited to 128 blocks and 64 events, the pending queue to 256 jobs,
and event identity is `(job_id, tx_hash, log_index, block_number, block_hash)`. A conflicting
provenance stops with `REORG_STOP` and never advances the cursor. Reorg pauses,
queue backpressure, and malformed/forged/wrong-chain scanner output require
manual resolution; there is no automatic rewind.

The queue states are `DISCOVERED`, `PROCESSING`, `DELIVERABLE_PERSISTED`,
`RECONCILIATION_REQUIRED`, `RETRY`, and `FAILED`. `PROCESSING` is durable before
the existing private `_run_job` helper is called. A crash leaves the same job
ID for explicit operator requeue/replay; failures retry up to three attempts
with bounded backoff. The helper is the only processing path and remains
read-only: no economic dispatch occurs in this module.

Run one scan and at most one queued job:

```sh
python3 -m marketplace.poller --state-dir /private/operator/state \
  --node /absolute/path/to/node --start-block 123 --once
```

CLI output is sanitized to status, counts, cursor, and hash only. Payloads and
errors are not printed.

If eth_getLogs is disabled, the fixed reader checks block receipts instead. The whole page is capped at 512 receipts and 2048 logs per RPC. Discovery pins the current confirmed deployment; the job runner independently rechecks historical funding, quote and job state before collection. Missing archive state stops that verification.

Use --scan-only to record events without collecting positions. A public scanner observation never grants signing or submission authority.

Receipt fallback runs at most four read requests concurrently per RPC. This bounds network load while allowing the cursor to catch up. Receipt/log/event limits remain global for each page.
