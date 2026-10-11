# Operator job runner

Run one publicly funded, unexpired job from a private state directory:

```sh
python3 -m marketplace.run_job \
  --job-id 123 \
  --state-dir /absolute/private/state \
  --node /absolute/path/to/node
```

The directory must already exist, be owned by the operator, be mode `0700`, and
not be a symlink. The runner creates `quotes.sqlite`, `jobs.sqlite`, and
`worker.lock` as owner-only mode `0600` files. A process-wide nonblocking lock
prevents concurrent collection, including for different jobs.

The reader performs fresh public funding and quote verification on every run.
Synthetic evidence is never accepted. Collection is the bounded server
observation (`30` seconds); assessment is read-only and never submits or
executes on chain.

Stdout is a small JSON status containing only the status, job key, delivery
hashes when available, and the two false execution flags. Operational failures
return `RUN_JOB_STOP` with exit `1`; lock contention returns `WORKER_BUSY` with
exit `2`.
