# Isolated one-shot quote signer

`operations/seller-quote.cjs` is a prepared operator-only component. It isn't deployed or imported by the public server. No quote has been signed through this component.

Execution requires UID 0 and the fixed private authority root `/var/lib/position-guard-quote`. The `grants` and `state` directories must be root-owned, private and nonsymlinks. It reads the grant named by the exact draft SHA-256 from `grants/<sha>.json`; the wallet source is always `wallet.env`. Both files must be root-owned regular files with owner-only permissions, opened with O_NOFOLLOW. Callers can't supply an authority grant, wallet source or alternate lock directory through JSON or environment variables.

The grant pins chain 97, agent 2583, provider F9, Commerce, testnet $U, price, exact draft hash, expiry and one signature with zero transaction dispatches. The exported `preflight` is a schema check only, with `authority_verified: false`; it doesn't authorize execution. Approval/provisioning is an operator responsibility. This filesystem trust boundary doesn't resist the operator who already controls the coin key.

An exclusive durable lock is written before loading the key or signing. Any ambiguous failure leaves that lock for reconciliation, with no automatic retry. The component derives the provider address, rechecks the grant before and after signing, verifies EIP-191 recovery, and stores the envelope privately. Stdout contains status/path/hash/counts, never the key or raw signature. There is no broadcast API.

The BNB SDK quote hash retains its standard field shape. The signed quality terms contain a fixed Position Guard 97/2583 assessment marker; recovery binds the provider. Onchain identity/provider/job binding remains necessary at ingestion. A quote isn't a lending mandate and doesn't allow access to a buyer's funds.

Prepare an unsigned draft with `marketplace/negotiation.cjs`. Provision an approved matching grant and the private wallet environment only after the service and permission review. The command is:

```sh
node operations/seller-quote.cjs /private/path/draft.json
```

Until those operator artifacts exist, execution stops. No private key or approval file is committed to this repository.
