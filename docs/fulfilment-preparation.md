# Private fulfilment preparation

The optional `--prepare-delivery` mode connects funded-job processing to a
private export plan. It doesn't publish an offer, publish a manifest, sign a
quote, submit a transaction, or attest completion.

```sh
python3 -m marketplace.poller --state-dir /private/operator/state \
  --node /absolute/path/to/node --start-block 123 --once --prepare-delivery
```

The start block above is an example. An existing poller must retain its recorded
start block and cursor. This mode is mutually exclusive with `--scan-only`.
Without it, the existing worker remains the default. The live scan-only timer
isn't changed by installing this code.

For each discovered job, preparation:

1. Uses the existing funding reader, ingress and read-only assessment worker.
2. Stops at `RECONCILIATION_REQUIRED` without preparing an export.
3. Rechecks the real funding proof, archived quote and signed publication consent.
4. Validates the stored manifest, receipt, job identity, hashes and retention.
5. Writes only bounded metadata to `export-plans/<job-id>.json` beneath the
   operator's private state directory.

The directory is owner-only `0700`, files are `0600`, and creation is exclusive
and fsynced. Identical bytes can be replayed. Conflicting or incomplete files
require operator reconciliation and aren't overwritten.

The plan contains the hashes, expiry, quote reference and proposed public URL.
It contains no manifest body or signature. Both `publication_enabled` and
`signing_ready` remain false. A successful preparation returns
`DELIVERABLE_PERSISTED` and `export_prepared: true`; it isn't an onchain
submission or completed hire.

The existing `marketplace.publish` command and isolated seller submission
remain separate operator steps with their own checks and authority. A quote
must already be issued and archived, real funding must be verified, and a
valid job must exist before this preparation can succeed. This module doesn't
create those preconditions or remove the need for reliable historical RPC reads.

Focused tests mock the reader and publication validator. They test orchestration,
binding, replay and rejection behavior; they aren't evidence of a live paid hire.
