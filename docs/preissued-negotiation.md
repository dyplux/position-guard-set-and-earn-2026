# Pre-issued assessment quotes

This optional path serves an existing provider-signed quote. The HTTP service
has no wallet, signer, key source, or broadcast capability. It doesn't generate
quotes, grant authority, or alter the read-only assessment policy.

The mode is OFF by default. An operator-released file and absolute Node verifier
are both required:

```sh
python3 server.py --public-origin https://positionguard.dyplux.com \
  --preissued-quote-file /operator/offers/exact-release.json \
  --quote-verifier-node /absolute/path/to/node
```

It can't be combined with `--negotiation-probe`. Requests share the bounded
observation slot, so verification and position collection can't start heavy
children concurrently. The verifier has a five-second deadline and a 64 MiB
V8 heap limit. No task, signature, transport token, or release body is logged.

## Exact brief

The signed request must identify one wallet and include explicit publication
consent:

```text
Assess Venus Core testnet position for wallet 0xPUBLIC_WALLET_ADDRESS. I consent to public JSON delivery retained for 45 days.
```

Replace the placeholder with a 40-hex-character address. This brief purchases
an as-of-block assessment. It grants no authority to move the assessed wallet's
funds. A generic catalogue price enquiry or another task is declined.

The JSON data part is `skill: negotiate`, this exact `task_description`, and
the two Pokter request terms. The response uses the BNB SDK envelope unchanged:
chain 97, provider F9, agent 2583 service marker, testnet U and the fixed Commerce
deployment. Terms include the canonical JSON receipt, `NEED_EVIDENCE accepted`
and 45-day retention. Signature, canonical content hash, task, term shape,
price, currency, domain and expiry are revalidated for each request.

## Operator release

The operator first obtains specific signing authority and produces one private
quote with the existing one-shot signer. A separate approved release grant pins
the quote hash, signed-envelope SHA-256, expiry and exact output path.

```sh
python3 -m marketplace.offer_release \
  --envelope /private/exact-signed-envelope.json \
  --grant /private/exact-release-grant.json \
  --state-dir /private/operator/state \
  --offer-file /operator/offers/exact-release.json \
  --node /absolute/path/to/node
```

The command verifies the existing signature, archives the exact envelope in
`quotes.sqlite`, then creates the immutable release file. Archive failure
prevents release. A partial or conflicting output isn't replaced. Files are
operator-owned, nonsymlinks and bounded; the release may be `0640` for a read-only
HTTP group, while grants and private state remain private. The operator must
configure that group access and publication authority separately.

The server reads only the configured release file. HTTP callers can't provide
grants, file paths, node executables, signatures or a wallet source. Missing,
expired, malformed or unverified releases decline with
`PREISSUED_QUOTE_UNAVAILABLE`.

Repeated retrieval returns the same signed envelope without another signature.
It doesn't prevent a copied quote being referenced by more than one job. This
is an operator-mediated pilot, not standing autonomous pricing or unlimited
fulfilment authority. Each funded job must still pass the funding reader,
assessment, consented publication and an exact submission grant. Activate an
accepted offer only when that fulfilment and signer availability are authorized
and verified; one accepted response isn't a completed hire.

Positive orchestration tests use mocked verification. Real subprocess tests
reject a dummy signature without creating one. No live quote, hire, publication
or completion follows from those tests.
