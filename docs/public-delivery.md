# Consented public delivery

The public manifest database is separate from private jobs and issued quotes.
Only exact immutable manifest bytes are exported. The HTTP process opens it
read-only; its service group has read permission on a root-owned `0640` file
inside a root-owned `0750` directory.

```sh
python3 -m marketplace.publish --job-id 123 \
  --state-dir /private/seller/state \
  --public-store /operator/public/public.sqlite \
  --node /absolute/path/to/node
```

The publisher rechecks real public funding/quote proof, the job, wallet,
contracts and policy receipt. It requires the exact service terms in
`marketplace/service_terms.py`, including public JSON delivery and 45-day
retention. Price remains bound to the signed quote and funded budget, with a
testnet cap of one $U; the token is fixed. This cap doesn't establish a tariff.

Retention starts at the assessment's original UTC timestamp. Expired entries
stop being served. Publication doesn't change the receipt, reserialize bytes,
submit a transaction or establish onchain completion. Authenticated/custom RPC
URLs, synthetic evidence, conflicting bytes and unknown terms are rejected.

The server's `--delivery-store` accepts only this public table. A private jobs
database or legacy deliveries table isn't a public export. Hosting is opt-in;
no customer report is shipped with the repository.

`--negotiation-probe` advertises an availability check for marketplace dispatch
testing. It always returns `accepted: false` and `PAID_SERVICE_NOT_READY`, with
no signature or price. Only a task hash is logged. This establishes reachability
when a marketplace invokes the endpoint; it doesn't prove a completed paid
hire or enable funding.
