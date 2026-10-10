# Durable local seller worker

Implemented on 2026-10-10. A locally validated job can now produce an assessment receipt and canonical manifest, persisted together in SQLite with FULL synchronous writes. No public handler or economic dispatch is enabled.

`marketplace/worker.py` reads the local `jobs` row recorded by AtlasBridge, verifies its fingerprint and testnet/deployment/job-key binding, checks expiry, collects the requested wallet, compares snapshot freshness to the current clock and applies the existing policy. It verifies the receipt before persisting. `NEED_EVIDENCE` stays unchanged; storing it doesn't establish successful fulfilment under service terms.

`marketplace/store.py` persists receipt and manifest bytes in one transaction with append-only API behavior and SQLite update/delete rejection triggers. These guards don't resist an operator who can alter the schema or replace the database. A replay after restart returns those bytes without another collection. Conflicting deliveries and checksum corruption stop. `serve_bytes` returns the stored bytes by exact content hash; it doesn't reserialize or fetch URLs. No public deliverable route exists yet. SQLite atomicity provides crash consistency; these tests don't certify every disk/power-loss mode.

Receipt SHA-256 and manifest SHA-256 are separate local checksums. The onchain manifest keccak256 remains absent until the reviewed rail codec/submission step. `completed_onchain` stays false.

Injected collectors default to untrusted. Only an explicit local trust configuration can set `collector_attested`; snapshot JSON can't set it. The CLI preserves the untrusted classification until a reviewed source/dependency seal is provisioned. Receipt policy version and normalized snapshot are bound before persistence.

Run a single job from an existing local validated store:

```sh
python3 -m marketplace.worker --store /private/path/seller.sqlite --job-key 'erc8183:97:<commerce-address>:<job-id>'
```

The current observational ERC-8183 reader returns `attested: false`, so it cannot populate authorized live jobs through AtlasBridge. Runtime onboarding, reviewed identity/provider/quote reader, delivery hosting, submission permissions and completion reconciliation are still required. A test fixture isn't an accepted marketplace hire.

`maintenance/mandate.py` adds a frozen unsigned local policy: owner/borrower binding, chain, selected operation kinds, maximum value/gas, expiry and remaining reserve. It doesn't prove cryptographic consent or authorize a transaction. Contract/function pins, oracle/position preflight and a separate executor remain required.

Validation uses synthetic jobs and snapshots with the real policy. Tests cover expiry/freshness, wallet mismatch, corruption, immutable conflict, exact bytes, Unicode canonicalization, restart/replay and mandate boundaries. The public server, policy and participant wallets weren't changed by this increment.
