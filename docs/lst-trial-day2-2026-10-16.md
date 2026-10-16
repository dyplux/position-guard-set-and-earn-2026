# LST trial: partial repayment on 16 October 2026

Checked at 2026-10-16T14:42:33.175Z. Chain 97, the same finite F9 testnet trial as [day 1](lst-trial-day1-2026-10-15.md). [Machine-readable receipts and scope](lst-trial-day2-2026-10-16.json).

The local operator repaid **0.000151041691845438 WBNB** at **2026-10-16T14:37:36.000Z**. Transaction [`0xb5729430662030a38e67dbd5d1c62af67b798427836d4c9f92ed9535f16d80f4`](https://testnet.bscscan.com/tx/0xb5729430662030a38e67dbd5d1c62af67b798427836d4c9f92ed9535f16d80f4) confirmed through the canonical RPC checks with at least 12 confirmations. The exact approval and repayment are two transactions, one economic action.

The authenticated ledger now has **seven confirmed transactions, three economic actions and two UTC dates**, 15 and 16 October. No economic retry was made. The public service remains a read-only Venus Core assessment; this finite local LST trial has a separate signer.

## Measured state after repayment

- Debt: `250904770008340` raw WBNB units.
- Wrapped balance: `248958308154562` raw WBNB units.
- Allowance: `448958308154562` raw WBNB units.
- Cumulative gas fees: `339494000000000` wei of testBNB.
- The observed position passed the configured comfort and hard-floor checks. These are dated observations, not a guarantee about later state.

All WBNB quantities use 18 decimals. Debt remains open; full close and redemption are not proven. The native reserve of 0.01 testBNB and aggregate gas cap of 0.001 testBNB are unchanged.

## Receipt transport and provenance

PublicNode returned null for the five older receipt lookups. The private transport now obtains live historical receipts from `https://rpc.sentio.xyz/bsc-testnet` only for a protected anchored hash after that null response. The full parsed live receipt must match the immutable captured receipt exactly. The stored receipt is never returned as a live response. Current canonical headers, transaction fields, fees and the other RPC receipt checks remain enforced. Requested and actual endpoints plus response hashes are audited locally.

Three endpoints participate in this observation path. Distinct URLs aren't certified backend independence, and no Merkle proof is claimed. The endpoint documentation limit from day 1 remains disclosed. Historical captures and transactions weren't rewritten.

## Remaining proof

Close and redeem must occur no earlier than **2026-10-17T11:45:34.000Z**, derived from the real supply receipt. They haven't happened in this checkpoint. Five useful lending actions across three days remain **NOT PROVEN**. Final debt, allowance and any native, WBNB or vToken residual must be measured after those receipts. Campaign qualification remains the organizers' decision; this evidence doesn't certify customer-wallet independence.
