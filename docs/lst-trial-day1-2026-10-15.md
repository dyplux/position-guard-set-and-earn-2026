# First live LST protection trial, 15 October 2026

Position Guard's bounded local F9 operator supplied **0.002 WBNB** and borrowed **0.0004 WBNB** in Venus Liquid Staked BNB on BNB testnet97. Five transactions were confirmed on two RPCs, with at least 12 confirmations at capture. Gas spent: **0.000249892 testBNB**. No economic retry occurred.

[Machine-readable receipts, state and caps](lst-trial-day1-2026-10-15.json).

| Stage | Transaction |
|---|---|
| Wrap own seed | [f69b5bd0…281930a](https://testnet.bscscan.com/tx/0xf69b5bd0f0944acd36aa4b4a69df3ce70160e959e6f1d5e81f9ecb3bd281930a) |
| Exact approval | [9fa50389…57b0d0f](https://testnet.bscscan.com/tx/0x9fa503891a6461bcbd84f13ae0bd51c9ef7a7831400c8d36a57db55bf57b0d0f) |
| Supply | [84b6b0c5…bba5d9e](https://testnet.bscscan.com/tx/0x84b6b0c5d69cc33021b20a462f8e042e5187218282a546a3d529846b5bba5d9e) |
| Enter market | [59cbd3b0…235aec](https://testnet.bscscan.com/tx/0x59cbd3b04a79d5659cfcc9326f8625db12f105683704a25dcfbcb1299e235aec) |
| Borrow | [93386add…bcc09c](https://testnet.bscscan.com/tx/0x93386add11b7764126a7d447839d00bcf337c25cbdf33764cd0131efecbcc09c) |

The five transactions establish **two economic actions**, supply and borrow, on one UTC date. Wrap, approval and market entry aren't counted as three extra useful lending actions. Repayment, debt closure, redemption and the full three-day loop remain unproven.

The trial's next permitted times are **16 October 11:45:34 UTC** for measured partial repayment and **17 October 11:45:34 UTC** for closure. These derive from the real mint receipt and the trial's 24/48-hour guards. Future times aren't completed evidence.

## Verify the live LST observation without a key

From the repository root:

```sh
npm ci --prefix read_only --ignore-scripts
node -e "require('./maintenance/lst_reader.cjs').observe().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;})"
```

This fixed-scope reader observes the registered F9 address in the LST pool on two RPCs. It doesn't sign, approve, borrow or repay. The browser console continues to inspect Venus Core, a separate scope. A Core `NO_DEBT` result doesn't describe this LST loan.

## Execution and evidence boundaries

- The public service runs on the VPS. The finite financial signer stays local; no wallet key was installed on the VPS.
- Source/runtime/route, oracle age, Prime/access-controller exclusions, nonce, admission, gas, reserve and simulation guards were checked before each signature. Source matching isn't a security audit.
- The mint's initial 500,000-gas simulation failed before signing. A reviewed 650,000 market-stage resource envelope passed real simulations, with both RPCs estimating 503,843. The aggregate gas cap remains 0.001 testBNB; the native reserve remains 0.01.
- Canonical RPC reads omit only validated optional transaction timestamps and RPC block size metadata, retaining response hashes. The first wrap's historical custody required PublicNode and the responding Sentio endpoint after the official RPC pruned that state. Actual canonical-versus-custody source roles are retained in the private proof; no Merkle proof or certified backend independence is claimed.
- Private source extensions and anchor metadata revisions are retained. Capture bytes, original hashes, economic caps and aggregate transaction counts were preserved. The checkpoint source hash doesn't claim every earlier support transaction used identical private code.
- This is a controlled testnet protection trial. Campaign eligibility and whether actions satisfy its useful-action requirement remain organizer decisions.
