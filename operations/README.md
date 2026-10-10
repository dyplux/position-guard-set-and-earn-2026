# Scoped operator reference

The public HTTP/A2A server never loads wallet secrets or imports the operator. The testnet operator is a local owner-only component, restricted to registered wallet `0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982`. It supplies 0.001 testBNB and then enters the one vBNB market. It has no borrow, repay, token approval, mainnet or general wallet path.

The reviewed execution ran from private owner-only state and journal directories. `native-setup.cjs` is the same economic logic with configurable operational paths. It isn't an independently deployed build. The two source SHA-256 values are recorded in [setup evidence](../docs/native-setup-2026-10-10.json).

The reference intentionally fails closed unless the owner provisions `GUARD_OPERATIONS_DIR` with the reviewed reader, sealed source/dependency hashes and private journals, plus `GUARD_WALLET_ENV` outside this repository. The file must have owner-only permissions and the key must derive to the fixed registered address. Node and viem are optional operator dependencies; they aren't needed for the read-only product. No key or private journal is distributed.

Don't delete a one-shot lock or retry a signed/dispatched operation. Reconcile the first transaction hash. `enter` requires the successful supply receipt, exact transaction, journal and independent positive-balance/zero-debt reconciliation.

For a reproducible key-free check, use:

```sh
python3 keeper_snapshot.py
python3 -m unittest discover -v
```

That command observes the actual registered wallet, verifies deployed code/route/ownership and evaluates the pure setup planner. After the recorded setup it should return `NO_ACTION_SETUP_COMPLETE`, rather than propose another supply. The receipt checksum isn't a proof of source authenticity.
