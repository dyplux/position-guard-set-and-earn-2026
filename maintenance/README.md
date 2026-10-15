# Local native maintenance candidate

This private preparation candidate is pinned to chain97, F9 and the native vBNB market. It supports `REPAY_BOUNDED`, with `repayBorrow()` payable (`0x4e4d9fea`) and an exact native value. It never signs or broadcasts. `NO_SIGNER`, `authority=NONE`, `execution_enabled=false`, `signing_ready=false` and `financial_ready=false` are fixed outputs.

Run the public read and local policy:

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix read_only
node maintenance/native_closeout.cjs --read
```

The reader uses two fixed public RPCs, a fresh common block, full vBNB runtime hashing, controller binding, quorum and reorg checks. `getAccountSnapshot(address)` supplies stored debt; `borrowBalanceCurrent(address)` supplies accrued debt through `eth_call`. It reads actual `getAssetsIn(address)` and native balance. That list describes entered collateral markets; it can't establish debts in every other market. `complete_native_scope` describes the entered assets; `complete_position=false` preserves the wider position gap. The controller runtime hash is observed and compared across RPCs, without claiming a financial source match.

The native mandate binds owner, borrower, chain, market, `wei` units, allowed action, expiry, repayment cap, maximum gas cost and reserve. Python rejects missing fields, booleans as amounts, invalid strings, negative values and invalid units. Monetary wire fields (`max_value_wei`, `max_gas_wei`, `reserve_wei`) accept strict canonical decimal strings within uint256, including the `10000000000000000` wei reserve. The JavaScript bridge converts compatible safe integers to strings and rejects unsafe numeric JSON amounts. Python parses the strings into exact integers at the wire boundary. Chain and timestamps remain safe integer fields. The Python wire parser rejects duplicate JSON keys and nonfinite numeric constants. A valid local mandate doesn't grant payment authority.

Debt zero returns `NO_ACTION`, without calldata or a proposal hash. Positive debt requires complete position and financial proofs. The current production reader returns oracle freshness `UNKNOWN` and financial source review `false`. The planner stops real financial proposals even if a caller supplies asserted proof flags; adding a genuine financial proof route requires a separately reviewed change. Synthetic fixtures exercise the positive bounded policy path, taking the minimum of debt, mandate cap and available native balance after reserve and maximum gas cost.

For an eligible synthetic proposal, the simulator recomputes policy and binds the entire canonical draft. It checks chain, runtime, common block, hash, fresh accrued debt and balance across both RPCs; calls use exactly two parameters with no state overrides. Each provider must accept the native call with empty return data and estimate gas within the mandate budget and reserve. It checks the block again for reorg and expiry/freshness before returning. Production simulation discards supplied state and makes a fresh observation.

Plain `eth_call` doesn't expose resulting storage or produce a receipt. The output therefore records counterfactual debt and reserve conditions, `SIMULATED_EFFECT_UNVERIFIED` and `effect_verified=false`. Future execution would require a separately authorized signer path, receipt binding and a measured post-state reconciliation. The expected same-block debt subtraction can't substitute for that evidence because later blocks accrue interest.

Focused regression:

```sh
python3 -m unittest test_native_planner test_mandate test_offline
node --test test_native_reader.cjs test_native_testnet.cjs test_native_closeout.cjs test_mainnet_unsigned.cjs
```

Synthetic tests aren't lending actions or qualification evidence. Refund, Maximillion, borrow, redeem, mainnet and other wallets are outside this candidate.

## Separate Core observation reader

```sh
node maintenance/core_position_reader.cjs --read
node --test test_core_position_reader.cjs
```

This reader observes the complete registered Core market list and the separate VAI repay getter. It queries `getAllMarkets()` and `getAssetsIn(F9)` at one fresh common block across the two fixed public RPCs. It accepts at most 64 unique nonzero market addresses. Each market needs code, a matching Core Comptroller, a canonical account snapshot and an independently attempted `borrowBalanceCurrent(F9)` call. The native market also needs its full runtime pin. Other runtime hashes are observations, without a financial source proof claim.

The ledger keeps each market's debt in its own underlying raw units; native debt uses wei. It never adds debt amounts across tokens. Unsupported snapshot ABI, errors or mismatches stay `UNKNOWN`, with null primary fields. An independently observed accrued getter can appear as separate evidence while its market remains incomplete. Ten legacy markets return 192 bytes from the external snapshot getter instead of the declared 128. Their fixed address/full-runtime profiles now use the source-backed `delegateToViewImplementation(bytes)` getter: the outer bytes envelope and the inner 128-byte four-uint tuple must both be canonical. The external 192-byte return is never treated as a six-field tuple, trimmed or accepted by prefix. Unknown or changed profiles stay unknown.

`complete_core_observation=true` requires all registered market observations, VAI and native oracle evidence to be canonical, coherent across providers and fresh. It describes these getter observations within the Core scope. `complete_position=false` still excludes other pools/protocols and financial proof. The VAI getter uses the stored VAI mint index; its separately labelled amount doesn't prove interest freshly accrued to the observation block. `current_accrual_verified=false` records that limit.

Native oracle evidence includes the controller's oracle, native-market binding, pause/configuration, enabled main adapter, direct price, returned native price and configured feed. A nonzero direct override is labelled `DIRECT_OVERRIDE_WITHOUT_TIMESTAMP`, with `effective_price_updated_at=null`. A feed path can record the configured feed's round as separate evidence, while its effective price timestamp and freshness remain unknown until the source is bound. Feed `updatedAt` can't establish the override's freshness. Neither path raises a financial flag.

Each provider runs at most eight market reads concurrently. The reader has a 30 second deadline, bounds response size, rejects HTTP redirects, duplicate JSON keys and nonfinite values, requires the exact JSON-RPC 2.0/id/result envelope without an error property, and validates ABI encodings, checks fresh block age, compares both complete provider rows and rereads the block hash/timestamp for reorg. Production transport only allows chain/head/header/code and `eth_call`, with no state overrides. Costs report measured RPC/eth_call counts and elapsed time. The CLI creates no proposal, grants or signer path; it leaves the financial planner intact.

## Bound legacy getter compatibility

The compatibility route is restricted to ten explicit proxy addresses and their full runtime SHA256 pins in `LEGACY.proxies`. It additionally reads each proxy's implementation getter and checks the full implementation runtime at the same common block. A changed proxy or implementation makes that market unknown. The implementation code check is shared within each provider's fixed-block read; both providers must independently agree on the resulting ledger.

The proxy executable was reproduced from [Venus's original source commit7867510](https://github.com/VenusProtocol/venus-protocol/blob/786751084f6a45161d66dd2f600d7a0c5c76eb95/contracts/VBep20Delegator.sol), with Solidity0.5.17 and optimizer200. Its executable SHA256 is `c7b947f11eae137421ec4c445c697200234c1bfd2ab9a311f1b471bb8145abec`. The compiled and deployed runtimes have the same compiler/CBOR layout and differ only in the 32-byte bzzr1 metadata digest. Production still compares complete fixed runtime pins; it doesn't strip or mask metadata.

The current implementation is `0x73fF75092Da265b87b25ffB943c47C90419a04A6`. Its full runtime SHA256 `2359bce83d9f956f4e31177d0433d561d97e4ff571b0fa13f864e66f828100da` matches the [official pinned deployment artifact](https://github.com/VenusProtocol/venus-protocol/blob/46afc66b1dbd61a707d0a3492b3ec21bf90fc17a/deployments/bsctestnet/VBep20Delegate.json), including its Solidity0.8.25 compiler and literal source hashes. This binds getter decoding; it doesn't approve the lending, rewards or other financial paths.

Synthetic tests carry compressed public runtime fixtures so pin checks run without network or private paths. They cover all ten profiles in a49-market observation and reject changed proxy/implementation code, changed implementation address, padded inner/outer ABI and provider disagreement. Financial flags, VAI accrual semantics and oracle timestamp unknowns are retained.
