# Position Guard by Dyplux

Position Guard 0.2.0 is a read-only candidate for assessing Venus Core positions on BNB Chain testnet, chain 97. It has no signer, transaction path, automatic repayment, payment flow or wallet-secret handling. It isn't registered, listed or qualified for Set and Earn.

The four UI examples are labelled `SYNTHETIC`. Five synthetic state-override conformance checks matched the real lens. They weren't loans, transactions or economic execution. A real debt-bearing wallet wasn't found in the bounded sample, so real-loan handling isn't claimed as empirically proven.

## Public preview

Target: https://positionguard.dyplux.com/

Agent Card: https://positionguard.dyplux.com/.well-known/agent-card.json

A2A: https://positionguard.dyplux.com/a2a

Deployment status is confirmed only by public HTTP checks, not by these links. [Evidence and boundaries](docs/claim-boundaries.md).

## Local use

Use Python 3.12 or later. No packages are required.

```sh
python3 server.py --port 8951
```

Open `http://127.0.0.1:8951/`. Local mode keeps the reviewed v0.2 Host and Origin policy. The Agent Card is at `/.well-known/agent-card.json`; the read-only A2A subset accepts `message/send` at `/a2a`.

## Public configuration

Put nginx on the host and pass one exact external origin:

```sh
python3 server.py --port 8951 --public-origin https://guard.example
```

The process always binds `127.0.0.1`. The configured origin must use HTTPS and contain one lowercase hostname, with no credentials, port, path, query or fragment. Public requests need a `Host` header equal to that hostname. `Origin` may be absent or must equal the configured HTTPS origin. `X-Forwarded-For`, `X-Forwarded-Host` and related headers don't grant access.

An nginx location can proxy to `http://127.0.0.1:8951` and set `Host guard.example`. Keep request buffering enabled, set `client_max_body_size 12000`, and use a proxy read timeout slightly above 30 seconds. TLS terminates at nginx.

Public defaults are deliberately small: 8 in-flight connections, 5-second socket reads, 30 seconds for the single live observation subprocess, 262,144 bytes of stdout and 8,192 bytes of stderr, 60 requests per minute per direct peer, 1,024 fixed rate-limit entries, 32 headers, 8,192 aggregate header characters and a 12,000-byte body. nginx connects from loopback, so the application rate limit is normally global. Public errors are generic. Internal paths, RPC addresses and exception text aren't returned.

## Container

Build and run as a non-root process with a read-only filesystem. Host networking is required because the application only listens on host loopback:

```sh
docker build -t position-guard:0.2.0 .
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=1m \
  --network host --cap-drop ALL --security-opt no-new-privileges \
  position-guard:0.2.0 --port 8951 --public-origin https://guard.example
```

Use this host-network command on Linux. Run nginx on the same host. Don't publish the Python port directly.

## Evidence and limits

The collector uses effective liquidation weights, the spot oracle and exact integer truncation, including nominal VAI debt. It requires agreement with onchain account liquidity and a second RPC backend. Runtime routes, code and block hash are checked. Lens, PolicyFacet and Diamond bytes matched the pinned repository; the active MarketFacet is only an observed code pin.

Oracle feed timestamps and accrued-current balances remain limitations. The 1.35 review threshold and 1.60 target are candidate settings. A suggested USD repayment isn't token calldata or a guarantee. Receipts prove canonical consistency, not source authenticity.

Run the offline public configuration and security tests:

```sh
python3 -m unittest -v test_server.py
```

## Use from an AI agent

Configure a stdio MCP server with command `python3` and args containing the absolute path to `mcp_stdio.py`. The three read-only tools observe a public testnet wallet, assess a supplied snapshot and verify a receipt. Supplied data stays `SUPPLIED_UNVERIFIED`; only the controlled collector produces `OBSERVED`. No tool can sign or transact.
