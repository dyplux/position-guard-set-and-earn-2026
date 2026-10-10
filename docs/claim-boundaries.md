# Evidence and campaign boundaries

Checked 10 October 2026. Position Guard is an original read-only Venus Core testnet position assessment candidate, chain 97. Its configured lending actions are disabled.

| Evidence | Status |
|---|---|
| Five real-lens comparisons with synthetic state overrides | PASS, synthetic only |
| Public-address empty-position observation | Observed, NO_DEBT |
| Real borrower assessment | NOT PROVEN |
| Native lending setup | Supplied 0.001 testBNB and entered vBNB, recorded onchain |
| Borrow or repayment | NOT EXECUTED |
| Automatic repayment | NOT IMPLEMENTED |
| ERC-8004 identity | Agent ID 2583, chain 97, owner and token URI checked |
| Marketplace listing | NOT LISTED |
| Campaign registration | Founder-confirmed submitted for the identity owner |
| Three independent client hires | 0 proven |
| Five useful onchain actions on three days | Two setup transactions on one day; qualification incomplete |

The [campaign](https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn) requires registration before qualifying tasks, genuine independent clients and category-consistent lending actions. Public deployment alone doesn't qualify. No controlled or funded client wallets will be counted.

[Conformance evidence](lens-conformance.json) uses ephemeral synthetic state overrides in eth_call. No actual loan was created. The later MarketFacet recompilation matched all deployed runtime bytes. vBNB matches every executable byte with an explicit metadata digest difference. Original v0.2 pin-only output remains dated to that reader implementation. Historical public-address inputs aren't a campaign-wallet nomination.

[Identity evidence](identity-2026-10-10.json). The explorer may restrict automated access; ownership and URI were independently read from the chain. Registration isn't lending execution.
