# LST trial: closure and redemption on 17 October 2026

Checked at 2026-10-17T14:13:13.548Z. Chain 97, F9 `0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982`, the same finite trial as [day 1](lst-trial-day1-2026-10-15.md) and [day 2](lst-trial-day2-2026-10-16.md). [Receipts, measured state and scope](lst-trial-day3-2026-10-17.json).

The local operator fully repaid the remaining LST debt and redeemed **0.002 WBNB** on 17 October. The authenticated ledger records **12 confirmed transactions and five economic actions across 15, 16 and 17 October UTC**: supply, borrow, partial repayment, full repayment and redemption. Each transaction had at least 12 confirmations in both RPC checks. Campaign qualification remains the organizers' decision.

| Day-3 transaction | Confirmed transaction | UTC receipt time | Amount, raw WBNB units | Fee, wei of testBNB |
|---|---|---|---|---|
| Original interest topup, nonce 46 | [0x5b7fed3dd7ff59d31c80b6638b4aa017edaf90060f1f97a88d235bbd05d69551](https://testnet.bscscan.com/tx/0x5b7fed3dd7ff59d31c80b6638b4aa017edaf90060f1f97a88d235bbd05d69551) | 2026-10-17T11:52:04.000Z | 2913519633541 | 5587600000000 |
| Recovery interest topup, nonce 47 | [0x1f2d96a5f9ed00591d3a9de3f141c1e88cc694ac5cc046c0c4367ebc5217a859](https://testnet.bscscan.com/tx/0x1f2d96a5f9ed00591d3a9de3f141c1e88cc694ac5cc046c0c4367ebc5217a859) | 2026-10-17T13:50:01.000Z | 4663101173822 | 5587600000000 |
| Full repayment, nonce 48 | [0x6e3416b50bdaa02216469364f0d4b490da7b5d7ff62897a007fa11f7e85a1756](https://testnet.bscscan.com/tx/0x6e3416b50bdaa02216469364f0d4b490da7b5d7ff62897a007fa11f7e85a1756) | 2026-10-17T13:51:46.000Z | 251961170967424 | 79429600000000 |
| Clear allowance, nonce 49 | [0x844360d2588d6645b86be9d378b468538b8de17c8ddc90c92765f5943f243f00](https://testnet.bscscan.com/tx/0x844360d2588d6645b86be9d378b468538b8de17c8ddc90c92765f5943f243f00) | 2026-10-17T13:53:32.000Z | 0 | 4816000000000 |
| Redeem principal, nonce 50 | [0x8e0f2af362b136b573e78692be89d4d31e2bf11adbb786c8f3e3af8524657dd1](https://testnet.bscscan.com/tx/0x8e0f2af362b136b573e78692be89d4d31e2bf11adbb786c8f3e3af8524657dd1) | 2026-10-17T13:55:18.000Z | 2000020925428902 | 91791000000000 |

The two interest topups are support transactions and don't add economic actions. Approvals, wrapping the original seed, market entry and allowance cleanup are also excluded from the five-action count. The repayment packet's 0.0006 WBNB cap isn't the actual repayment amount; the table reports the measured debt reduction.

## Exit recovery and custody

The earlier planned CLOSE stopped before signing, with zero signature attempts and zero dispatches for that packet. Its ordinary funding window expired. A separately reviewed exit-only authority permitted one additional interest topup, repayment, allowance cleanup and redemption within the same F9 position. It used a new fixed 3600-slot compound-interest budget from the fresh topup observation and a rate ceiling of 5000000000000 raw units, with no renewal of that origin. This was a declared recovery amendment; it didn't preserve the expired normal window.

Original records, capture bytes and the aborted reservation were retained. Recovery created no new seed or loan. All twelve transactions share the original 0.001 testBNB aggregate gas cap, 0.01 testBNB native reserve and 0.0001 testBNB aggregate interest-topup cap. Fees for all twelve transactions were 526705800000000 wei; both interest topups combined were 7576620807363 raw WBNB units.

Redeemed WBNB remains owned by F9. No UNWRAP was executed, and no empty-wallet or complete-dust-cleanup claim is made.

## Exact redemption rounding and read-only reconciliation

The redemption requested `2000000000000000` raw WBNB units. The confirmed transfer received `2000020925428902`, including `20925428902` extra raw units from the contract's upward rounding of vTokens. The receipt burned `48968` vToken units. The measured exchange rate `40843426838525212286755375346` reproduces the burn and transfer exactly under the pinned Venus source.

The private operator stopped after dispatch with `REDEEM_EFFECT_STOP`: its effect check expected the transfer to equal the request exactly. The same signed transaction succeeded. A separate read-only reconciliation verified the signature, canonical receipts, exact events, balances, fees and rounding; it added no transaction and left that original validator unchanged. Its capture and review hashes are recorded in the JSON.

The fourth recovery capture uses live historical reads from PublicNode and Sentio. Dataseed had already pruned that historical state and returned `missing trie node`; the new reads also match the original two-RPC balance diagnostic captured immediately after redemption. All three endpoint names and the separate fourth-capture provenance are disclosed. No stored reply is presented as a new live RPC result.

## Measured final state

At block 137331812, hash `0x164d3135e14e7b80e955b16b189e8d7acb4301937d196805c39edddd335f226f`, checked at 2026-10-17T14:13:13.548Z:

- Current debt: `0` raw WBNB units.
- Stored debt: `0` raw WBNB units.
- Allowance: `0` raw WBNB units.
- F9 WBNB balance: `2004594683423403` raw units, including redeemed principal and any unused interest buffer.
- Residual vToken balance: `331` raw units.
- Native balance: `14733160296337508` wei of testBNB.
- Entered markets: `["0x231dED0Dfc99634e52EE1a1329586bc970d773b3"]`.

All WBNB quantities use 18 decimals. These are dated measurements. The public assessment service remains read-only; the finite signer remained local. Alternate-receipt provenance and source-matching limits from [day 2](lst-trial-day2-2026-10-16.md) remain applicable. Distinct RPC URLs don't certify backend independence, and no Merkle proof or security audit is claimed. This controlled trial doesn't certify customer-wallet independence or organizer acceptance.
