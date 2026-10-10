# Isolated one-shot quote signer

`operations/seller-quote.cjs` is an operator-only component. It isn't deployed or imported by the public server. One private internal compatibility quote was signed on 2026-10-10 with a 60-second expiry, recovered to the expected provider, and never released as a public offer. No transaction was dispatched.

On Linux, execution requires UID 0 and the fixed private authority root `/var/lib/position-guard-quote`; the wallet source is `wallet.env`. On macOS, the OS account's real home directory and UID anchor `.config/position-guard-quote`; an owner-only `operator.json` binds the existing wallet environment path, allowing local signing without copying the key to a VPS. Directory and file ownership must match that operator, directories must be private nonsymlinks, and regular files must be mode 0600, opened with O_NOFOLLOW. The grant is selected by exact draft SHA-256 from `grants/<sha>.json`. Callers can't supply an authority grant, wallet source or alternate lock directory through request JSON or environment variables.

The grant pins chain 97, agent 2583, provider F9, Commerce, testnet $U, price, exact draft hash, expiry and one signature with zero transaction dispatches. The exported `preflight` is a schema check only, with `authority_verified: false`; it doesn't authorize execution. Approval/provisioning is an operator responsibility. This filesystem trust boundary doesn't resist the operator who already controls the coin key.

An exclusive durable lock is written before loading the key or signing. Any ambiguous failure leaves that lock for reconciliation, with no automatic retry. The component derives the provider address, rechecks the grant before and after signing, verifies EIP-191 recovery, and stores the envelope privately. Stdout contains status/path/hash/counts, never the key or raw signature. There is no broadcast API.

The BNB SDK quote hash retains its standard field shape. The signed quality terms contain a fixed Position Guard 97/2583 assessment marker; recovery binds the provider. Onchain identity/provider/job binding remains necessary at ingestion. A quote isn't a lending mandate and doesn't allow access to a buyer's funds.

Prepare an unsigned draft with `marketplace/negotiation.cjs`. Provision an approved matching grant and the private wallet environment only after the service and permission review. The command is:

```sh
node operations/seller-quote.cjs /private/path/draft.json
```

Until those operator artifacts exist, execution stops. No private key or approval file is committed to this repository.
