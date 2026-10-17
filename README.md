# Position Guard by Dyplux

Position Guard 0.2.0 assesses Venus Core positions on BNB Chain testnet, chain 97. The public assessment service has no signer, automatic repayment or wallet-secret handling. Bounded testnet collateral setup is recorded. ERC-8004 identity 2583 on chain 97 is currently listed on Pokter, and three paid testnet customer hires have completed through that marketplace. Set and Earn campaign qualification remains `NOT_ATTESTED`.

The four UI examples are labelled `SYNTHETIC`. Five synthetic state-override conformance checks matched the real lens. The original bounded Venus Core sample didn't establish real borrower handling. A separate F9 trial has now supplied **0.002 WBNB** and borrowed **0.0004 WBNB** in the Liquid Staked BNB pool on testnet97. [Five confirmed transactions and exact scope](docs/lst-trial-day1-2026-10-15.md). A partial repayment of **0.000151041691845438 WBNB** confirmed on 16 October. [Day-2 receipts and scope](docs/lst-trial-day2-2026-10-16.md). Full repayment and redemption confirmed on 17 October. The same trial records five economic actions, 12 confirmed transactions and three UTC dates, 15, 16 and 17 October. Redeemed WBNB remains in F9. [Day-3 receipts, recovery and measured residuals](docs/lst-trial-day3-2026-10-17.md). Campaign qualification remains the organizers' decision.

## Internal marketplace rehearsal, 13 October 2026

Job **1444** completed on BNB Chain testnet: one signed quote, seven transactions, a public `NO_DEBT` assessment and a confirmed **0.1 testU** payout. It was a self-hire, so it doesn't count as an external customer. [Recorded transaction and delivery evidence](docs/internal-hire-2026-10-13.json).

The browser's **Connect wallet** button reads the selected address and chain. It doesn't sign or send transactions. Public assessments remain read-only. The separate local LST trial's five-action evidence is recorded in the dated day-3 proof; the public browser doesn't execute those actions.

## Customer hires, 14 October 2026

Jobs **1447**, **1449** and **1450** completed on BNB Chain testnet. Each paid **0.1 testU** and produced a public `NO_DEBT` report. Job 1450 was settled by an external caller whose identity is unknown. [Sanitized report and verification limits](docs/customer-hires-2026-10-14.md) · [Evidence JSON](docs/customer-hires-2026-10-14.json).

## Current evidence, 17 October 2026

The registered wallet hired **three other agents across Pokter and HelloFugu**. Both Pokter jobs completed, with token payouts verified through two RPC providers. The HelloFugu subscription event is confirmed; its specific paid-report linkage remains UNKNOWN. [Outgoing hire evidence](docs/outgoing-hires-2026-10-15.md).

A separate read-only Core reader now handles the ten pinned legacy proxy getter encodings. The recorded observation has **49/49 complete account snapshots**. The effective native oracle override has no timestamp, so freshness remains UNKNOWN. This doesn't enable automatic financial maintenance. [Recorded getter evidence](docs/core-getter-compatibility-2026-10-15.json) · [Maintenance modules](maintenance/README.md).

The Chainlink feed proxy executable is now reproduced from an earlier official source revision: **9,518 executable bytes match exactly**. Only the 32-byte IPFS metadata digest differs. [Source, compiler and comparison](docs/feed-proxy-source-2026-10-15.json). The dated public recovery helper remains unsigned. The actual day-3 exit used a separately reviewed private recovery authority after the normal funding window expired, including one additional interest topup within the original aggregate caps. [Recovery scope and receipts](docs/lst-trial-day3-2026-10-17.md).

The public service and adapter remain read-only and have no signer. A separate finite local operator confirmed supply and borrow on 15 October, partial repayment on 16 October, and full repayment and redemption on 17 October: five economic actions, 12 confirmed transactions and three UTC dates, 15, 16 and 17 October. Both interest topups are support transactions. The 0.001 testBNB aggregate gas cap and 0.01 testBNB reserve were retained. Redeemed WBNB remains in F9; final debt, allowance and residuals are measured in the [day-3 proof](docs/lst-trial-day3-2026-10-17.md). The [dated source comparison](docs/lst-source-comparison-2026-10-15.md) retains its source and metadata limits. Organizer qualification remains unconfirmed. [Trial boundaries](maintenance/LST-TRIAL-README.md).

## Identity

Agent ID **2583**, BNB Chain testnet, chain **97**. Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`. Owner: `0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982`.

[Recorded onchain proof](docs/identity-2026-10-10.json) · [Registration transaction](https://testnet.bscscan.com/tx/0x9b8bae8df548aaa1444b0ddb8cd97038825c842f2ea228bc40ee99f06af2cc30)

Identity registration and test funding are preparation steps. The separate LST trial records supply, borrow, partial repayment, full repayment and redemption in its dated receipts. The earlier Venus Core collateral setup is recorded below.

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

The collector uses effective liquidation weights, the spot oracle and exact integer truncation, including nominal VAI debt. It requires agreement with onchain account liquidity and a second RPC backend. Runtime routes, code and block hash are checked. Lens, PolicyFacet and Diamond bytes matched the pinned repository; the original v0.2 reader uses a strict MarketFacet code pin; a later full source recompilation is recorded below.

Oracle feed timestamps and accrued-current balances remain limitations. The 1.35 review threshold and 1.60 target are candidate settings. A suggested USD repayment isn't token calldata or a guarantee. Receipts prove canonical consistency, not source authenticity.

Run the offline public configuration and security tests:

```sh
python3 -m unittest -v test_server.py
```

## Use from an AI agent

Configure a stdio MCP server with command `python3` and args containing the absolute path to `mcp_stdio.py`. The three read-only tools observe a public testnet wallet, assess a supplied snapshot and verify a receipt. Supplied data stays `SUPPLIED_UNVERIFIED`; only the controlled collector produces `OBSERVED`. No tool can sign or transact.

## Recorded native collateral setup

The registered wallet supplied **0.001 testBNB** to Venus Core vBNB and entered that market. Both transactions were reconciled from receipts and position state. That dated Core setup had no debt; it is separate from the later LST loan. That earlier Core sample contains two setup transactions on one day. The later three-date LST evidence is a separate trial.

[Actual setup evidence](docs/native-setup-2026-10-10.json) · [Pure setup planner](keeper_plan.py) · [Local operator reference and limits](operations/README.md)

```sh
python3 keeper_snapshot.py
```

This key-free command observes the registered wallet and evaluates the planner. Completed setup returns `NO_ACTION_SETUP_COMPLETE`; it doesn't manufacture another transaction.

Supplemental verification: [Core MarketFacet full runtime match](docs/core-market-source-2026-10-10.json), [vBNB exact executable logic with metadata digest difference](docs/vbnb-source-2026-10-10.json), [Maximillion source/binding](docs/maximillion-source-2026-10-10.json). The unchanged v0.2 collector still prints its older conservative pin-only wording. The later source proofs are separate, and no code/route check was removed. Source matching isn't a security audit.
