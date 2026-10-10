"""Fixed-block, read-only Venus Core collector. No signing or transaction methods."""
import argparse
import datetime as dt
import hashlib
import json
import re
import urllib.request
from decimal import Decimal, localcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SELECTORS = json.loads((ROOT / "selectors.json").read_text())
PINS = json.loads((ROOT / "runtime_pins.json").read_text())
RPC = "https://bsc-testnet-dataseed.bnbchain.org"
RPC_VERIFY = "https://bsc-testnet-rpc.publicnode.com"
CONTROLLER = "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D"
SOURCE_COMMIT = "0cc9211d9722694492553b9c2951724f76c9ee63"
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


class Reader:
    def __init__(self, rpc=RPC):
        if rpc not in {RPC, RPC_VERIFY}:
            raise ValueError("RPC_NOT_ALLOWLISTED")
        self.rpc = rpc
        self.calls = 0

    def batch(self, calls):
        requests = []
        for method, params in calls:
            if method not in {"eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getBalance"}:
                raise ValueError("RPC_METHOD_NOT_READ_ONLY")
            self.calls += 1
            if self.calls > 160:
                raise ValueError("READ_BUDGET_EXCEEDED")
            requests.append({"jsonrpc": "2.0", "id": self.calls, "method": method, "params": params})
        req = urllib.request.Request(self.rpc, data=json.dumps(requests).encode(),
                                     headers={"Content-Type": "application/json", "User-Agent": "PositionGuard/0.1"})
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("RPC_RESPONSE_TOO_LARGE")
        responses = json.loads(raw)
        if not isinstance(responses, list):
            raise ValueError("BATCH_RESPONSE_INVALID")
        by_id = {}
        for item in responses:
            if not isinstance(item, dict) or type(item.get("id")) is not int:
                raise ValueError("RPC_ITEM_SHAPE_INVALID")
            if item.get("id") in by_id:
                raise ValueError("DUPLICATE_RPC_ID")
            by_id[item.get("id")] = item
        if set(by_id) != {r["id"] for r in requests}:
            raise ValueError("RPC_RESPONSE_ID_CONFLICT")
        result = []
        for request in requests:
            item = by_id.get(request["id"], {})
            if "error" in item or "result" not in item:
                raise ValueError("RPC_READ_FAILED:" + request["method"])
            result.append(item["result"])
        return result

    def call(self, method, params):
        return self.batch([(method, params)])[0]


def words(value):
    if not isinstance(value, str) or not value.startswith("0x") or (len(value)-2) % 64:
        raise ValueError("ABI_SHAPE_INVALID")
    return [int(value[i:i+64], 16) for i in range(2, len(value), 64)]


def address_array(value):
    data = words(value)
    if len(data) < 2 or data[0] != 32 or data[1] > 64 or len(data) != data[1]+2:
        raise ValueError("ABI_ADDRESS_ARRAY_INVALID")
    if any(v >= 2**160 for v in data[2:]):
        raise ValueError("ABI_ADDRESS_INVALID")
    return ["0x"+format(v, "040x") for v in data[2:]]


def encoded(name, address=None):
    return SELECTORS[name] + (address[2:].lower().rjust(64, "0") if address else "")


def runtime_binding(reader, block):
    components = PINS["components"]
    queries = [
        encoded("comptrollerImplementation()"), encoded("comptrollerLens()"),
        SELECTORS["facetAddress(bytes4)"]+SELECTORS["getAccountLiquidity(address)"][2:].ljust(64, "0"),
        SELECTORS["facetAddress(bytes4)"]+SELECTORS["getEffectiveLtvFactor(address,address,uint8)"][2:].ljust(64, "0"),
    ]
    addresses = reader.batch([("eth_call", [{"to": CONTROLLER, "data": q}, block]) for q in queries])
    names = ["diamond", "lens", "policy", "market"]
    for name, value in zip(names, addresses):
        data = words(value)
        if len(data) != (2 if name in {"policy", "market"} else 1) or data[0] >= 2**160:
            raise ValueError("RUNTIME_ROUTE_SHAPE_INVALID")
        if "0x"+format(data[0], "040x") != components[name]["address"].lower():
            raise ValueError("RUNTIME_ROUTE_CHANGED:"+name)
    codes = reader.batch([("eth_getCode", [components[n]["address"], block]) for n in names])
    for name, code in zip(names, codes):
        if hashlib.sha256(bytes.fromhex(code[2:])).hexdigest() != components[name]["sha256"]:
            raise ValueError("RUNTIME_CODE_CHANGED:"+name)
    return {"status": "PINNED_RUNTIME_MATCH", "components": components,
            "interpretation": "Verified lens/policy LT path; market is an observed code pin, not a source match"}


def collect(wallet):
    if not isinstance(wallet, str) or not ADDRESS.fullmatch(wallet):
        raise ValueError("INVALID_PUBLIC_ADDRESS")
    reader = Reader()
    chain, block = reader.batch([("eth_chainId", []), ("eth_getBlockByNumber", ["latest", False])])
    if int(chain, 16) != 97:
        raise ValueError("CHAIN_NOT_97")
    number, timestamp = block["number"], int(block["timestamp"], 16)
    block_hash = block.get("hash")
    if not isinstance(block_hash, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", block_hash):
        raise ValueError("BLOCK_HASH_INVALID")
    binding = runtime_binding(reader, number)
    def view(target, name, arg=None):
        return ("eth_call", [{"to": target, "data": encoded(name, arg)}, number])
    code, balance, markets_raw, assets_raw, oracle_raw, liquidity_raw = reader.batch([
        ("eth_getCode", [CONTROLLER, number]), ("eth_getBalance", [wallet, number]),
        view(CONTROLLER, "getAllMarkets()"), view(CONTROLLER, "getAssetsIn(address)", wallet),
        view(CONTROLLER, "oracle()"), view(CONTROLLER, "getAccountLiquidity(address)", wallet)])
    if not code or code == "0x":
        raise ValueError("CONTROLLER_HAS_NO_CODE")
    markets, entered_list = address_array(markets_raw), address_array(assets_raw)
    if len(set(entered_list)) != len(entered_list):
        raise ValueError("DUPLICATE_ENTERED_MARKET")
    entered = set(entered_list)
    if not entered.issubset(set(markets)) or len(set(markets)) != len(markets):
        raise ValueError("MARKET_MEMBERSHIP_CONFLICT")
    oracle_words, liquidity = words(oracle_raw), words(liquidity_raw)
    if len(oracle_words) != 1 or len(liquidity) != 3 or liquidity[0] != 0:
        raise ValueError("CONTROLLER_ERROR")
    if liquidity[1] and liquidity[2]:
        raise ValueError("CONTROLLER_LIQUIDITY_STATE_CONFLICT")
    if not 0 < oracle_words[0] < 2**160:
        raise ValueError("ORACLE_ADDRESS_INVALID")
    oracle = "0x" + format(oracle_words[0], "040x")
    # Borrow admission joins the borrowed market. Health scope is entered assets,
    # not unrelated legacy/dummy markets in the global testnet catalogue.
    active = sorted(entered)
    if len(active) > 32:
        raise ValueError("ENTERED_MARKET_SCOPE_LIMIT")
    snapshots = reader.batch([view(m, "getAccountSnapshot(address)", wallet) for m in active]) if active else []
    positions = []
    for market, raw in zip(active, snapshots):
        data = words(raw)
        if len(data) != 4 or data[0] != 0:
            raise ValueError("MARKET_SNAPSHOT_ERROR")
        if data[1] or data[2]:
            positions.append({"market": market, "v_balance": data[1], "borrow": data[2], "exchange": data[3], "entered": market in entered})
    reads = []
    for pos in positions:
        factor_call = SELECTORS["getEffectiveLtvFactor(address,address,uint8)"] + wallet[2:].lower().rjust(64, "0") + pos["market"][2:].rjust(64, "0") + format(1, "064x")
        reads.extend([("eth_call", [{"to": CONTROLLER, "data": factor_call}, number]),
                      view(oracle, "getUnderlyingPrice(address)", pos["market"])])
    terms = reader.batch(reads) if reads else []
    with localcontext() as ctx:
        ctx.prec = 90
        collateral = debt = adjusted = Decimal(0)
        for index, pos in enumerate(positions):
            factor_words, price_words = words(terms[index*2]), words(terms[index*2+1])
            if len(factor_words) != 1 or factor_words[0] > 10**18 or len(price_words) != 1 or price_words[0] == 0:
                raise ValueError("MARKET_OR_PRICE_INVALID")
            price, factor = price_words[0], factor_words[0]
            # Reproduce the verified lens's uint256 Exp truncations, not a float approximation.
            tokens_to_denom = ((factor*pos["exchange"])//10**18*price)//10**18
            adjusted_mantissa = tokens_to_denom*pos["v_balance"]//10**18
            supplied_mantissa = (pos["exchange"]*price//10**18)*pos["v_balance"]//10**18
            borrowed_mantissa = price*pos["borrow"]//10**18
            supply_usd = Decimal(supplied_mantissa)/Decimal(10**18)
            borrowed_usd = Decimal(borrowed_mantissa)/Decimal(10**18)
            debt += borrowed_usd
            if pos["entered"]:
                collateral += supply_usd
                adjusted += Decimal(adjusted_mantissa)/Decimal(10**18)
            pos.update({"supply_usd": format(supply_usd, "f"), "borrow_usd": format(borrowed_usd, "f"), "effective_liquidation_factor_mantissa": str(factor), "oracle_price_mantissa": str(price)})
        vai_words = words(reader.call(*view(CONTROLLER, "vaiController()")))
        if len(vai_words) != 1 or vai_words[0] >= 2**160:
            raise ValueError("VAI_CONTROLLER_SHAPE_INVALID")
        vai_debt = 0
        if vai_words[0]:
            vai_address = "0x"+format(vai_words[0], "040x")
            vai_result = words(reader.call(*view(vai_address, "getVAIRepayAmount(address)", wallet)))
            if len(vai_result) != 1:
                raise ValueError("VAI_DEBT_SHAPE_INVALID")
            vai_debt = vai_result[0]
            debt += Decimal(vai_debt)/Decimal(10**18)
        expected = adjusted-debt
        observed = Decimal(liquidity[1]-liquidity[2])/Decimal(10**18)
        if expected != observed:
            raise ValueError("CONTROLLER_RECONCILIATION_MISMATCH")
    checked = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    age = dt.datetime.now(dt.timezone.utc).timestamp() - timestamp
    if age > 60 or age < -2:
        raise ValueError("BLOCK_SNAPSHOT_STALE_OR_FUTURE")
    end_block = reader.call("eth_getBlockByNumber", [number, False])
    if end_block.get("hash") != block_hash:
        raise ValueError("BLOCK_CHANGED_DURING_COLLECTION")
    secondary = Reader(RPC_VERIFY)
    second_chain, second_block, second_liquidity = secondary.batch([
        ("eth_chainId", []), ("eth_getBlockByNumber", [number, False]),
        view(CONTROLLER, "getAccountLiquidity(address)", wallet)])
    if int(second_chain, 16) != 97 or second_block.get("hash") != block_hash or second_liquidity != liquidity_raw:
        raise ValueError("SECONDARY_BACKEND_DISAGREEMENT")
    checked = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    if dt.datetime.now(dt.timezone.utc).timestamp() - timestamp > 60:
        raise ValueError("BLOCK_SNAPSHOT_STALE_AFTER_VERIFICATION")
    return {"chain_id": 97, "block_number": int(number, 16), "block_timestamp": timestamp,
            "checked_at": checked, "block_hash": block_hash, "wallet_address": wallet.lower(), "protocol": "venus-core",
            "collateral_value_usd": format(collateral, "f"), "debt_value_usd": format(debt, "f"),
            "liquidation_adjusted_collateral_usd": format(adjusted, "f"), "markets_complete": True,
            "rpc_url": RPC, "source_kind": "OBSERVED", "controller": CONTROLLER, "oracle": oracle,
            "controller_code_sha256": hashlib.sha256(bytes.fromhex(code[2:])).hexdigest(),
            "source_commit": SOURCE_COMMIT, "market_count": len(markets), "entered_market_count": len(entered), "positions": positions,
            "scope": "Comptroller entered-assets health, not full wallet portfolio",
            "liquidation_weight_semantics": "EFFECTIVE_LTV_STRATEGY_1_LT_SPOT_ORACLE_EXACT_LENS_RECONCILIATION",
            "runtime_binding": binding, "vai_repay_amount_mantissa": str(vai_debt),
            "native_balance_wei": str(int(balance, 16)), "rpc_read_count": reader.calls + secondary.calls,
            "backend_agreement": "TWO_RPC_CHAIN_BLOCK_HASH_AND_LIQUIDITY_MATCH_NOT_FINALITY_PROOF",
            "source_limits": ["Read-only testnet snapshot", "Oracle feed timestamp not established", "Uses stored token balances, no accrued-interest transaction", "VAI debt uses the protocol's nominal unit", "Active market facet has observed code pin, not source verification", "No signer or exact token repayment calldata"]}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--wallet", required=True)
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    result = collect(args.wallet)
    text = json.dumps(result, indent=2)+"\n"
    if args.output:
        args.output.write_text(text)
    else:
        print(text)
