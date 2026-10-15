# Read-only LST trial integration

This adapter is an unsigned preparation runner for fixed F9 on BNB testnet 97. It has no key loader, grant loader, physical signer, transaction transport or financial CLI. The default prints `NO_EXECUTION`. `--read` performs one bounded live observation and unsigned next-stage simulation. Every result keeps `NO_SIGNER`, `authority: NONE`, `financial_ready: false` and `execution_enabled: false`.

```sh
npm ci --prefix read_only
node --test test_lst_integration.cjs test_lst_actor_core.cjs test_lst_trial.cjs test_lst_reader.cjs test_lst_resume.cjs
node maintenance/lst_live_adapter.cjs --read
```

## Fixed intent and source boundaries

The exact frozen reader, planner and strict wire parser are copied into `maintenance/`. The generic actor is copied with only relative codec/RPC paths and bundled canonical JSON/private file helpers. `lst_baselines.json` records original and copied hashes. It pins the direct copied modules and adapter files before and after reads; it isn't a complete source or package execution seal. There are no absolute private checkout paths, private captures or runtime private file dependencies in this candidate.

`lst_integration.cjs` explicitly maps planner operations to actor stages. `EXIT_MARKET` is rejected. The finite limits stay .002 seed, .0005 maximum borrow, .0006 maximum finite close, .0001 cumulative repay-wrap headroom, .001 aggregate native gas and .01 native reserve. Canonical decimal strings preserve monetary amounts above JSON safe integer precision. No sentinel approvals or repay values are used.

Current controller/market/underlying/oracle identities, complete LST market scope, VAI/native Core debt, oracle configuration/no direct override and feed round/configured age are read by the fixed two-provider reader. Both nonces, runtime pins and common-block/reorg checks are repeated. The extra source route guards re-read:

- PSR implementation/code, its exact ordered two-registry array and the primary registry implementation/code plus exact `(controller, WBNB) => vWBNB` mapping;
- all four reward implementation slots and full code hashes;
- the feed proxy's current aggregator, full code hash, decimals and min/max answer.

The second registry is never called. A missing/changed primary route, implementation, code, reward order or feed aggregator stops observation. Same-block route guards run again before the proposed stage simulation. Stable proxy bytecode alone doesn't establish its implementation identity.

The financial source anchor remains absent. `sourceGate` accepts a strict proof descriptor schema but always stops without an independently reviewed root trust anchor and executable/package/callgraph seal. Callback hashes and PASS booleans don't establish proof. New source-only proofs and matching live runtime pins aren't financial execution authority. The frozen planner retains its historical source gap labels; it remains unsigned regardless of subsequent external source research.

## Complete fee ledger and progress

`authenticateLedger(ledger, profile)` validates strict profile/trial/stage/nonce structure, recovers every original F9 signed transaction, verifies its exact hash and transaction fields on both fixed RPCs, obtains >=12-confirmation receipts and stable receipt/prior-block headers, and independently reads custody/allowance/debt before and after each transaction. This includes all wrap, approval, entry, repay, revocation, redemption and unwrap support fees. Failed transactions consume fees and their one-use stage. Normal progression stops. Explicit emergency progression can derive a different unconsumed cleanup stage only after both providers prove unchanged failed-transaction custody, native fee and current debt. A failed stage can't be retried. The archive path still stops on missing historic state, nonce gaps, incomplete custody or quorum failure. Unknown values aren't filled with zero.

Only module-private branded authentication results can drive `derive`. Synthetic results can't be relabelled OBSERVED. The initial empty ledger means no observed trial transactions and its starting nonce must match both live nodes; it confers no mandate or source authority. Root-owned protected packet/history/source provenance remains required before any future financial integration. The current CLI doesn't load private ledger/raw files.

### Durable custody capture and root trust boundary

`captureLedgerAttestation(ledger, profile, {trustedAnchor = null, request})` captures the complete before/after custody proof on both fixed RPCs as soon as each original transaction is mined. It doesn't wait twelve confirmations before requesting historic state. Each capture contains original transaction/receipt, both stable receipt/prior headers, prior nonce, fee chain, trial/profile/source/packet/history bindings and observation provenance. A supplied protected prefix is first authenticated at twelve confirmations; new entries alone require historic custody. Capture doesn't produce a module-branded authenticated ledger and doesn't authorize another stage.

The root operator persists the returned canonical bytes immediately, pins their SHA-256 and scope outside the ledger, then calls `authenticateRecordedLedger(ledger, profile, {trustedAnchor, request})`. The `trustedAnchor` contract is `{bytes: Buffer, expected: {sha256, trial_id, profile_sha256, source_sha256}}`. `expected` comes from the root operator's independently protected manifest and loader. It must never be constructed from caller-provided ledger/capture fields. `source_sha256` is the exact `verifyBaselines()` manifest hash; the root operator separately seals its full executable/dependency source. The external loader enforces owner permissions, 0600 files, one link, 0700 directory and fixed expected manifest. This public module doesn't install or discover that loader.

Recorded authentication re-verifies every original raw, recovered F9 intent, reconstructed history prefix and source pin, then obtains current transactions, receipts and stable canonical receipt-block headers on both RPCs with at least twelve confirmations. It compares those originals with the frozen capture, checks all recorded custody effects and fees, and never requests old custody or old nonce state. A changed canonical block, receipt, transaction, external digest or scope stops. A synthetic capture remains synthetic even if later replay uses the default live transport. Twelve archive stages use 504 RPC reads; recorded replay uses 144, within a fixed 672-call/60-second budget. Capture is bounded to twelve entries and 1 MiB strict JSON.

The programmatic `preflight({profile, ledger, emergency, trustedAnchor})` can use this root-provided anchor while retaining full fresh current observation, source route, nonce, runtime and simulation checks. The CLI has no anchor, path or JSON passthrough. Source readiness remains hard OFF in both paths.

Confirmed seed prefixes resume the next approval, mint or entry without rebuilding wrap. Repay approval and close cleanup similarly resume from authenticated state. A confirmed repay wrap resumes finite CLOSE using the remaining 300-slot block window, shortened by twelve slots for rounding and compounding margin. It never proposes a second wrap. Current wrapped balance and residual allowance must cover measured debt plus remaining current-rate headroom; exhausted time, changed rate bounds or insufficient custody stops. Normal resumed CLOSE still waits until day 3. Emergency cleanup can close and redeem earlier. Emergency rollback before borrow clears allowance and returns tracked seed custody; it never starts a new borrow or supply. After borrowing, emergency finite close is available before day 3. Normal partial/close timing uses actual economic seed receipts, not fake clocks. Redemption/unwrap provenance and fees are cumulative, and terminal cleanup doesn't claim deletion of yield/vToken dust or guarantee five actions.

## Unsigned simulations and remaining work

Only exact current-state `eth_call` and `eth_estimateGas` are used, with fixed sender, value, calldata, legacy .2 gwei price and gas cap. No state overrides or hypothetical collateral are created. A future borrow or close can't be positively simulated before the required collateral/debt exists. The pre-seed policy checks current entry/borrow/exit pause/cash/caps and conservative prospective coverage, while clearly leaving future execution unproven. Independent source/profile review and an emergency/receipt policy must close that boundary before opening risk.

The public runner never calls the actor's generic signing engine. A future root-owned financial operator must authenticate the trusted source anchor, all transitive dependencies and protected history, revalidate every source route before each stage, enforce real post-repay HF/debt and reserve/gas, and reconcile original hashes. Keys, grants, source seals, signed raws and captures must stay outside the public repository. Scope is the LST controller's markets plus the explicit Core native/VAI checks, not all protocol positions.

## Public integrity check portability

This public copy checks exact module bytes and rejects symlinked or non-regular sources. It permits ordinary checkout permission masks because it cannot sign or dispatch transactions. Its manifest differs from the separately reviewed private preparation snapshot. A financial operator must independently enforce protected source/dependency permissions and its complete execution seal; this public manifest is never that trust anchor.
