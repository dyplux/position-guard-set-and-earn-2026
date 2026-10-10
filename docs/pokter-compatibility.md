# VPS seller compatibility for Pokter

Checked on 2026-10-10 against [Pokter source 3ea4d939](https://github.com/successaje/pokter/tree/3ea4d93923c0aefa9662e7ccd86c0d37368055b2/src/lib/erc8183) and [BNB SDK source 7a7a431a](https://github.com/bnb-chain/bnbagent-sdk/tree/7a7a431a61b86279c503b443e98144fdee830a84/typescript/src/erc8183).

Pokter discovers agent 2583 on chain 97. Its quote reader fetches the Agent Card at the registered A2A service endpoint, checks for the `negotiate` skill, and sends a JSON-RPC `message/send` data part. It verifies the quote signature against the registered provider and verifies that its canonical hash covers the requested task, terms, price, token, expiry and chain/Commerce domain. Its testnet provider path accepts an external registry-agent; an AWS runtime isn't a requirement of this path. This code compatibility doesn't establish a completed hire.

The public server now resolves the same read-only Agent Card at `/a2a`, `/a2a/.well-known/agent-card.json` and `/.well-known/agent-card.json`, and accepts an assessment data part. The existing text path remains supported. Unknown seller skills decline; negotiation isn't advertised as enabled.

`marketplace/negotiation.cjs` prepares the BNB SDK canonical quote and negotiation hash without a signature. Identity/provider/assessment bindings are checked locally; provider identity is cryptographically bound by signature recovery. Extra fields weren't added to the SDK hashed content, because that would break its reference verification. Terms that sanitize to empty are rejected, and the original requested task is echoed while its sanitized form enters the SDK content hash. A private approved quote signer remains required.

`marketplace/submission.cjs` prepares `submit(uint256,bytes32,bytes)` with the keccak256 of exact canonical manifest bytes and optParams containing a fixed-domain delivery URL. It checks funded state, deadline, provider, deployment, evaluator/hook and manifest job/contracts. It always returns `signing_ready: false`; quote validation, reviewed reader, permission, hosting and latest simulation remain required.

`--delivery-store` opts into serving exact persisted manifest bytes from a local read-only SQLite database. Without it, `/deliverables/` returns 404. The key is constrained to the pinned testnet Commerce and safe job IDs; the content hash must match stored bytes. No client-controlled path or URL is read. Consent and retention must be established before enabling public hosting. No existing client positions were published.

The candidate service remains a read-only Venus Core testnet assessment. It doesn't promise autonomous repayment or campaign qualification. Paid quotation, verified job ingestion, submission and completion still need integration before a public paid offer.

`marketplace/pokter.py` binds Pokter's `protocol: pokter-job` description to identity 2583, provider F9, exact task, budget and a quote already verified at the funded block by a controlled local lookup. It extracts one Venus wallet into the internal assessment task. It rejects unreviewed jobs and unverified quotes. This helper isn't wired into public ingestion and doesn't replace cryptographic verification, expiry/finality or an execution grant.
