# LST source comparison, 15 October 2026

This dated source comparison closes three previously recorded binding gaps. It doesn't enable the public service to move funds.

| Component | Recorded result |
|---|---|
| Current Protocol Share Reserve implementation | All 13,898 runtime bytes, including metadata, match the literal-source compile and constructor replay. Source: official Venus PR 170. |
| First rewards distributor implementation | All 11,850 executable bytes match. The only 32 differing bytes are the declared IPFS metadata digest; full build metadata equality remains unproven. |
| Chainlink feed aggregator | All 23,824 executable bytes match the literal-source compile and current-getter constructor replay. The declared IPFS digest differs by 32 bytes; original deployment inputs aren't claimed. |
| Primary pool registry implementation | Full runtime and metadata match. Its exact `(controller, WBNB)` mapping must resolve the selected market before every operation. |

The ordered two-registry configuration is checked. The second registry's source remains unbound; a checked successful primary mapping short-circuits it. Changes in route, implementation, bytecode or feed aggregator stop the fixed trial.

[Exact addresses, hashes, compiler settings and limitations](lst-source-comparison-2026-10-15.json). The WBNB source comparison also retains its separately disclosed legacy metadata difference. Source matching isn't a complete protocol security audit.

## Execution boundary

Financial maintenance remains OFF in the public service. The fixed-wallet testnet planner and read-only preflight don't provide signing authority. Receipt capture, recovery without historical RPC state, finite repayment and a reviewed local operator are separate requirements before a trial can start. Five useful lending actions across three real days remain NOT PROVEN. Campaign qualification remains NOT_ATTESTED.
