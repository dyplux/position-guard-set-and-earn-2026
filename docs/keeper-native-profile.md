# Native setup planner

`keeper_plan.py` is a pure, bounded proposal planner for the reviewed read-only profile.
It never signs, broadcasts, borrows, repays, delegates, approves, or claims lending actions.

Only `trusted_reader=True` can pass the reader-attestation boundary. The caller must supply
an audited private RPC reader result for the fixed owner, chain 97, vBNB, controller, source
proof, complete position, block proof, and fresh timestamp. `sources_verified` alone has no
authority. The CLI always uses `trusted_reader=False`.

The only proposals are a 0.001 testBNB `mint()` call when no vToken or market exists, or a
standard dynamic-ABI `enterMarkets([vBNB])` call when vToken exists without an entered market.
The planner requires enough native balance to retain 0.01 testBNB after the value and 0.003
testBNB fee reserve. A vToken balance already entered in vBNB returns `NO_ACTION`.

Every proposal is unsigned and bounded to chain 97, the fixed owner, gas cap 1,000,000,
gas-price cap 3,000,000,000 wei, and max fee 0.003 testBNB. Results include a SHA-256 binding
over normalized state and result fields, excluding any receipt field.
