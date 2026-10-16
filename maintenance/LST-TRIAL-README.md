# Wrapped-native LST trial

## Live checkpoint, 16 October 2026

A separate local operator supplied 0.002 WBNB, borrowed 0.0004 WBNB and partially repaid 0.000151041691845438 WBNB on testnet97. Seven transactions confirmed across 15 and 16 October, with three economic actions and no economic retry. [Day-1 receipts and boundaries](../docs/lst-trial-day1-2026-10-15.md). The public modules below remain unsigned and read-only. Full close, redemption and five useful actions across three days remain unproven. [Day-2 receipts and transport provenance](../docs/lst-trial-day2-2026-10-16.md).

The initial 500,000-gas mint simulation failed before signing. The reviewed private resource envelope used 650,000 for the five market stages, within the actor's existing 1,000,000 ceiling. Both RPCs estimated the mint at 503,843. The 12-stage maximum is 4,225,000 gas at 0.2 gwei, 0.000845 testBNB, below the unchanged 0.001 aggregate cap. This is a resource bound, not a promise that future simulations pass.

## Original unsigned preparation

This slice contains a bounded read-only collector and a pure unsigned planner. It has no signer, key loader, grant issuer, scheduler or dispatch. Every planner result has `financial_ready=false`. At this planner's original preparation checkpoint, the PSR and reward0 sources weren't bound. The later source checkpoint below records their resolution. No seed transaction is recorded in this preparation package.

## Fixed scope and choices

Chain 97, F9, LST controller `0x596B11acAACF03217287939f88d63b51d3771704`, vWBNB `0x231dED0Dfc99634e52EE1a1329586bc970d773b3`, WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` only. Core collateral doesn't enter LST calculations. All LST market rows and separate Core debt/VAI checks must be observed completely.

Both variants seed exactly 0.002 native and keep hard floor 2, comfort target 4, native reserve 0.01, maximum borrow 0.0005 WBNB, finite close cap 0.0006 WBNB, and aggregate gas cap 0.001 native. At CF 0.45/LT 0.50:

| Variant | Proposed borrow | CF coverage | Liquidation HF | Purpose |
|---|---:|---:|---:|---|
| COMFORT_SAFE | 0.0002 | 4.5 | 5 | Comfort; day-2 maintenance may be NO_ACTION |
| FUNCTIONAL_TRIAL | 0.0004 | 2.25 | 2.5 | Small protection trial below comfort, above hard floor |

Measured exchange-rate/source truncation determines actual ratios. Oracle source, route and age remain mandatory even for the same underlying asset.

## Finite sequence

1. Day 1: wrap seed, exact approve, mint, enter this market; observe every receipt/effect, then borrow once after fresh admission guards.
2. At least 24 hours after the confirmed seed, on a later UTC day: calculate accrued debt minus the debt compatible with liquidation HF 4. NO_ACTION when nonpositive. Otherwise add finite 300-slot rate headroom, approve at most 0.0006 once, repay only the measured amount, and leave positive debt.
3. At least 48 hours after seed, on the third UTC day: close via ERC20 `repayBorrow(0.0006)`. Use residual allowance from partial, or one approval if partial was skipped. Wrap only actual debt shortfall plus bounded headroom, at most 0.0001 additional native. Revoke allowance after confirmed repayment. Debt must be exactly zero before redeeming exactly 0.002.

`emergencyClose` bypasses the three-day wait with all caps/source barriers retained. `emergencyRedeem` permits zero-debt seed rollback. Both remain NOT_EXECUTABLE. Exiting market and unwrapping fresh own WBNB are support calls; unwrap is capped at 0.002, matching the separate actor's cap.

The source clamps ERC20 repayment to accrued debt before `transferFrom`; excess WBNB stays in F9's wallet and unused allowance must be revoked. Finite close/headroom doesn't guarantee zero debt at inclusion. Redeeming exact seed can leave yield/vToken dust; capped unwrap can leave WBNB residue. No full-cleanup claim.

The five action receipts omit support transactions from their fee subtotal. `fee_ledger_complete=false`: an actual adapter must reconcile **every transaction's fee**, reserve emergency gas, and enforce the 0.001 aggregate before any financial use. The original unsigned template listed 3,655,000 gas including optional market exit, 0.000731 native at 0.2 gwei. That dated preparation subtotal is separate from the current 12-stage resource envelope above: 4,225,000 gas, 0.000845 testBNB, with fresh simulations and the unchanged 0.001 aggregate cap.

Focused tests: `npm ci --prefix read_only --ignore-scripts`, then `node --test test_lst_reader.cjs test_lst_trial.cjs`. No actions or counts are guaranteed; wrapping and approvals aren't useful-action claims.

## Later source checkpoint

The source gaps emitted by this frozen unsigned planner describe its original preparation checkpoint. [The 15 October source comparison](../docs/lst-source-comparison-2026-10-15.md) supersedes those source-only gaps. It leaves the planner unsigned and financial execution disabled; source binding alone doesn't install a trusted operator.
