# Read-only ERC-8183 seam and mainnet Venus codecs

Checked on 2026-10-10. This increment adds a local bridge prototype and unsigned codecs. It doesn't enable public seller traffic, sign quotes or transactions, submit a deliverable, or promise an Atlas hire.

## Atlas integration boundary

`marketplace/erc8183.cjs` reads the ERC-8183 deployment and `getJob` on chains 56 and 97. It records runtime hashes, EIP-1967 implementation slots/hashes, payment-token binding and a reconciled block hash. These are observations, not reviewed source/deployment seals. The result always has `attested: false` and `atlas_dispatch_proven: false`.

`marketplace/atlas_bridge.py` accepts the Atlas `message/send` data-part shape in a local function. `notify_funded` requires an injected reviewed reader, chain 97, agent ID 2583, the configured provider/deployment, a funded unexpired job and a structured assessment task. Identical jobs survive restart without another insertion; conflicting content stops. SQLite uses FULL synchronous writes. The response says `recorded`, not `accepted`; no processing or delivery is promised. The observational JS reader cannot authorize this bridge. The bridge isn't wired into the public server.

`negotiate` stops because reviewed pricing, service terms and a quote signer aren't configured. Quote verification, finality, provenance, seller identity/operational-wallet binding, reorg handling and a delivery worker remain live gates. Local fixture tests don't prove those gates.

The Atlas source snapshot uses chain 97 and known AgentCore/Cognito seller mappings. A generic external A2A endpoint doesn't acquire those mappings by implementing the message shape. Mainnet support in the Altana SDK doesn't establish mainnet Atlas marketplace support. Source baseline: [Atlas 97aca206](https://github.com/bluescorpio/agent-atlas/tree/97aca206e0d4e09580d45091246fffb66b29a0ce/lib/erc8183), [Altana SDK 6527823a](https://github.com/altananetwork/altana-sdk/blob/6527823a4c8b2dc978c328520c9b8a2ea3959c5a/packages/wallet/src/erc8183.ts).

## Venus native BNB calls

`maintenance/unsigned.cjs` encodes five operation kinds on chain 56:

| Kind | Function | Units |
| --- | --- | --- |
| SUPPLY_COLLATERAL | vBNB `mint()` | native BNB wei |
| ENTER_COLLATERAL_MARKET | Comptroller `enterMarkets([vBNB])` | no amount |
| REPAY_BOUNDED | Maximillion `repayBehalf(owner)` | native BNB wei |
| CLOSE_REMAINING_DEBT | Maximillion `repayBehalf(owner)` | native BNB wei |
| REDEEM_AFTER_CLOSE | vBNB `redeem(redeemTokens)` | raw vToken units |

Both repayment kinds share the same calldata function; their policy reasons and amounts require separate validation. Encoding a redeem doesn't establish that the borrower is debt-free. The builder rejects wrong chains, zero/negative/ambiguous amounts and zero owners. Drafts have `authority: NONE`, `execution_enabled: false` and explicit required checks. There is no signer or borrow builder.

Mainnet targets: Comptroller `0xfD36E2c2a6789Db23113685031d7F16329158384`, vBNB `0xA07c5b74C9B40447a954e1466938b865b6BBea36`, Maximillion `0x5efA1e46F4Fd738FF721F5AebC895b970F13E8A1`. Addresses and ABIs came from the [Venus deployment snapshot](https://github.com/VenusProtocol/venus-protocol/tree/0cc9211d9722694492553b9c2951724f76c9ee63/deployments/bscmainnet) and [Venus interface configuration](https://github.com/VenusProtocol/venus-protocol-interface/blob/86ea4f7aefaaff6685aa97306fc05849a519f0f2/apps/evm/src/libs/contracts/config/index.ts). Runtime/source verification remains required before execution.

`maintenance/simulate.cjs` validates the canonical call shape, invokes `eth_call` and `eth_estimateGas`, and rejects nonzero enter/redeem protocol codes. It doesn't compare against an independently sealed original transaction or mandate; valid changes to owner/amount can form another draft. `draft_seal_verified` stays false. State overrides are labelled synthetic. It never verifies the effect of a transaction. The RPC helper has a read-method allowlist, timeout and response cap; broadcast/signing methods fail before network access.

## Run the local checks

```sh
cd read_only
npm ci --ignore-scripts --no-audit --no-fund
cd ..
python3 -m unittest discover -v
node --test test_mainnet_unsigned.cjs
```

Validated on 2026-10-10: 38 Python tests and 12 Node tests passed. The existing public server, policy and runtime pins weren't changed.

Native price conversion, complete accrued-position/oracle reader, mandates, seals and execution preflight aren't implemented by these codecs. Five operation kinds don't imply five useful or qualifying actions. A zero-debt position still calls for NO_ACTION.
