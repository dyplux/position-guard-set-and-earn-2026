"""Pure, bounded native setup planner. It never signs or broadcasts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from typing import Any

OWNER = "0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982"
MARKET = "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c"
CONTROLLER = "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D"
CHAIN_ID = 97
POLICY_VERSION = "setup-native0.1"
WEI = 10**18
MAX_UINT256 = 2**256 - 1
DECIMAL = re.compile(r"^(?:0|[1-9][0-9]*)$")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _result(status: str, reasons: list[str], state: Any = None,
            unsigned_tx: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "status": status, "reasons": reasons, "authority": "OWNER_MANDATE_REQUIRED",
        "execution_enabled": False, "policy_version": POLICY_VERSION,
    }
    if unsigned_tx is not None:
        out["unsigned_tx"] = unsigned_tx
    normalized = {"state": state, "result": {k: v for k, v in out.items() if k != "receipt"}}
    payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    out["binding_sha256"] = hashlib.sha256(payload.encode()).hexdigest()
    return out


def _stop(reason: str, state: Any = None) -> dict[str, Any]:
    return _result("STOP", [reason], state)


def _now_seconds(now: Any) -> int | None:
    if now is None:
        return int(datetime.now(timezone.utc).timestamp())
    if isinstance(now, datetime):
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        return int(now.timestamp())
    if isinstance(now, int) and not isinstance(now, bool) and now > 0:
        return now
    return None


def _uint(raw: Any, field: str) -> tuple[int | None, str | None]:
    if not isinstance(raw, str) or not DECIMAL.fullmatch(raw):
        return None, f"{field}_must_be_decimal_string"
    if len(raw) > 78:
        return None, f"{field}_too_many_digits"
    value = int(raw)
    if value > MAX_UINT256:
        return None, f"{field}_exceeds_uint256"
    return value, None


def _tx(to: str, value: int, data: str) -> dict[str, Any]:
    return {"chain_id": CHAIN_ID, "from": OWNER, "to": to, "value_wei": str(value),
            "data": data, "gas_cap": 1_000_000, "gas_price_cap_wei": 3_000_000_000,
            "max_fee_wei": 3_000_000_000_000_000}


def plan_native_setup(state: dict[str, Any], trusted_reader: bool = False,
                      now: Any = None) -> dict[str, Any]:
    """Return a pure proposal or STOP. ``trusted_reader`` is an external trust boundary."""
    if trusted_reader is not True:
        return _stop("READER_ATTESTATION_REQUIRED")
    if not isinstance(state, dict):
        return _stop("STATE_MUST_BE_OBJECT")
    if state.get("owner") != OWNER:
        return _stop("OWNER_MISMATCH", state)
    if state.get("chain_id") != CHAIN_ID or isinstance(state.get("chain_id"), bool):
        return _stop("CHAIN_MISMATCH", state)
    if state.get("vtoken_address") != MARKET:
        return _stop("VTOKEN_MISMATCH", state)
    if state.get("controller") != CONTROLLER:
        return _stop("CONTROLLER_MISMATCH", state)
    if state.get("actual_source_verified") is not True or state.get("complete_position") is not True:
        return _stop("SOURCE_OR_POSITION_NOT_VERIFIED", state)
    block = state.get("block_number")
    if not isinstance(block, int) or isinstance(block, bool) or block <= 0:
        return _stop("INVALID_BLOCK_NUMBER", state)
    block_hash = state.get("block_hash")
    if not isinstance(block_hash, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", block_hash):
        return _stop("INVALID_BLOCK_HASH", state)
    timestamp = state.get("timestamp")
    if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp <= 0:
        return _stop("INVALID_TIMESTAMP", state)
    current = _now_seconds(now)
    if current is None:
        return _stop("INVALID_NOW", state)
    if timestamp < current - 60 or timestamp > current + 2:
        return _stop("TIMESTAMP_OUT_OF_RANGE", state)
    values: dict[str, int] = {}
    for field in ("native_balance_wei", "vtoken_balance_raw", "borrow_balance_raw", "vai_debt_raw"):
        value, error = _uint(state.get(field), field)
        if error:
            return _stop(error, state)
        values[field] = value  # type: ignore[assignment]
    markets = state.get("entered_markets")
    if not isinstance(markets, list) or len(markets) > 32:
        return _stop("INVALID_ENTERED_MARKETS", state)
    if any(not isinstance(m, str) or not ADDRESS.fullmatch(m) for m in markets) or len({m.lower() for m in markets}) != len(markets):
        return _stop("INVALID_ENTERED_MARKETS", state)
    if any(m != MARKET for m in markets):
        return _stop("UNKNOWN_MARKET", state)
    if values["borrow_balance_raw"] or values["vai_debt_raw"]:
        return _stop("DEBT_OR_VAI_PRESENT", state)
    normalized = dict(state)
    normalized["entered_markets"] = markets
    if values["vtoken_balance_raw"] == 0 and not markets:
        if values["native_balance_wei"] < 14_000_000_000_000_000:
            return _stop("INSUFFICIENT_SUPPLY_AND_RESERVE", normalized)
        tx = _tx(MARKET, 1_000_000_000_000_000, "0x1249c58b")
        return _result("READY", ["SUPPLY_NATIVE_SETUP"], normalized, tx)
    if values["vtoken_balance_raw"] > 0 and not markets:
        data = "0xc2998238" + (32).to_bytes(32, "big").hex() + (1).to_bytes(32, "big").hex()
        data += (int(MARKET[2:], 16)).to_bytes(32, "big").hex()
        return _result("READY", ["ENTER_VTOKEN_MARKET"], normalized, _tx(CONTROLLER, 0, data))
    if values["vtoken_balance_raw"] > 0 and markets == [MARKET]:
        return _result("NO_ACTION", ["NO_ACTION_SETUP_COMPLETE"], normalized)
    return _stop("UNSUPPORTED_SETUP_STATE", normalized)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as handle:
        state = json.load(handle)
    print(json.dumps(plan_native_setup(state, trusted_reader=False), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
