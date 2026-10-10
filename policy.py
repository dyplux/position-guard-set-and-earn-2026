"""Read-only lending position policy for BNB Smart Chain testnet."""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import math
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_CEILING, localcontext
from pathlib import Path
from typing import Any


POLICY_VERSION = "0.2.0"
CHAIN_ID = 97
PROTOCOL = "venus-core"
MAX_AGE_SECONDS = 60
FUTURE_TOLERANCE_SECONDS = 2
REVIEW_THRESHOLD = Decimal("1.35")
TARGET_HEALTH_FACTOR = Decimal("1.6")
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
NETWORK_NAMES = {"bnb-testnet", "bsc-testnet", "bnb smart chain testnet", "bsc testnet"}


def _result(decision: str, reasons: list[str], *, health_factor: str | None = None,
            suggested_repay_usd: str | None = None, evidence_kind: str = "UNKNOWN",
            normalized_snapshot: Any = None) -> dict[str, Any]:
    result = {
        "decision": decision,
        "reasons": reasons,
        "health_factor": health_factor,
        "suggested_repay_usd": suggested_repay_usd,
        "evidence_kind": evidence_kind,
        "authority": "NONE",
        "execution_enabled": False,
        "policy_version": POLICY_VERSION,
        "normalized_snapshot": normalized_snapshot,
    }
    result["receipt_sha256"] = _digest(result)
    return result


def _digest(receipt_without_hash: dict[str, Any]) -> str:
    payload = json.dumps(receipt_without_hash, ensure_ascii=True, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _safe_normalize(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("nonfinite value")
        return value
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("nonfinite value")
        return format(value, "f")
    if isinstance(value, list):
        return [_safe_normalize(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("non-string key")
        return {key: _safe_normalize(item) for key, item in value.items()}
    raise ValueError("unsupported value")


def _decimal_string(snapshot: dict[str, Any], field: str) -> Decimal:
    value = snapshot[field]
    if not isinstance(value, str) or not value.strip() or len(value) > 64:
        raise ValueError(f"{field} must be a decimal string")
    try:
        number = Decimal(value)
    except (InvalidOperation, ValueError):
        raise ValueError(f"{field} must be a decimal string") from None
    if not number.is_finite() or number < 0 or number > Decimal("1e30") or number.as_tuple().exponent < -30:
        raise ValueError(f"{field} must be finite and non-negative")
    return number


def _timestamp(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field} must be a non-negative integer")
    return value


def _checked_epoch(value: Any) -> int:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("checked_at must be an ISO UTC timestamp")
    try:
        parsed = _dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        raise ValueError("checked_at must be an ISO UTC timestamp") from None
    if parsed.tzinfo is None or parsed.utcoffset() != _dt.timedelta(0):
        raise ValueError("checked_at must be an ISO UTC timestamp")
    return int(parsed.timestamp())


def assess(data: Any, *, collector_attested: bool = False) -> dict[str, Any]:
    """Assess a supplied snapshot without signing, submitting, or executing anything."""
    evidence_kind = "UNKNOWN"
    normalized = None
    if isinstance(data, dict) and isinstance(data.get("source_kind"), str) and data.get("source_kind") in {"OBSERVED", "SYNTHETIC"}:
        evidence_kind = data["source_kind"] if data["source_kind"] == "SYNTHETIC" or collector_attested else "SUPPLIED_UNVERIFIED"
    try:
        normalized = _safe_normalize(data)
        if not isinstance(data, dict):
            raise ValueError("snapshot must be an object")
        required = {
            "chain_id", "block_number", "block_timestamp", "checked_at", "wallet_address",
            "protocol", "collateral_value_usd", "debt_value_usd",
            "liquidation_adjusted_collateral_usd", "markets_complete", "rpc_url", "source_kind",
        }
        missing = sorted(required - data.keys())
        if missing:
            raise ValueError("missing fields: " + ",".join(missing))
        if not isinstance(data["chain_id"], int) or data["chain_id"] != CHAIN_ID or isinstance(data["chain_id"], bool):
            raise ValueError("network must be chain_id 97")
        if "network" in data and (not isinstance(data["network"], str) or
                                    data["network"].strip().lower() not in NETWORK_NAMES):
            raise ValueError("conflicting network")
        if data["protocol"] != PROTOCOL:
            raise ValueError("conflicting protocol")
        if not isinstance(data["wallet_address"], str) or not ADDRESS_RE.fullmatch(data["wallet_address"]):
            raise ValueError("invalid wallet address")
        if not isinstance(data["rpc_url"], str) or not data["rpc_url"].strip():
            raise ValueError("missing rpc_url")
        if data["source_kind"] not in {"OBSERVED", "SYNTHETIC"}:
            raise ValueError("source_kind must be OBSERVED or SYNTHETIC")
        if not isinstance(data["markets_complete"], bool) or not data["markets_complete"]:
            raise ValueError("markets are incomplete")
        _timestamp(data["block_number"], "block_number")
        block_timestamp = _timestamp(data["block_timestamp"], "block_timestamp")
        checked_epoch = _checked_epoch(data["checked_at"])
        age = checked_epoch - block_timestamp
        if age > MAX_AGE_SECONDS or age < -FUTURE_TOLERANCE_SECONDS:
            raise ValueError("snapshot is stale or from the future")
        collateral = _decimal_string(data, "collateral_value_usd")
        debt = _decimal_string(data, "debt_value_usd")
        adjusted = _decimal_string(data, "liquidation_adjusted_collateral_usd")
        if adjusted > collateral:
            raise ValueError("adjusted collateral exceeds collateral")
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        return _result("NEED_EVIDENCE", ["INVALID_OR_INCOMPLETE_SNAPSHOT"],
                       evidence_kind=evidence_kind, normalized_snapshot=normalized)

    if debt == 0:
        return _result("NO_DEBT", ["NO_DEBT"], evidence_kind=evidence_kind,
                       normalized_snapshot=normalized)

    with localcontext() as context:
        context.prec = 60
        health_factor = adjusted / debt
        repay = max(Decimal(0), debt - (adjusted / TARGET_HEALTH_FACTOR))
        repay = min(debt, repay).quantize(Decimal("0.000001"), rounding=ROUND_CEILING)
        repay = min(debt, repay)
        health_text = format(health_factor, "f")
        repay_text = format(repay, "f")
    if health_factor < 1:
        decision, reasons = "LIQUIDATION_RISK", ["HEALTH_FACTOR_BELOW_1"]
    elif health_factor < REVIEW_THRESHOLD:
        decision, reasons = "ACTION_REVIEW", ["HEALTH_FACTOR_BELOW_REVIEW_THRESHOLD"]
    else:
        decision, reasons = "HOLD", ["HEALTH_FACTOR_AT_OR_ABOVE_REVIEW_THRESHOLD"]
    return _result(decision, reasons, health_factor=health_text,
                   suggested_repay_usd=repay_text, evidence_kind=evidence_kind,
                   normalized_snapshot=normalized)


def verify_receipt(receipt: Any) -> bool:
    if not isinstance(receipt, dict) or not isinstance(receipt.get("receipt_sha256"), str):
        return False
    supplied = receipt["receipt_sha256"]
    copy = dict(receipt)
    del copy["receipt_sha256"]
    try:
        return supplied == _digest(copy)
    except (TypeError, ValueError, OverflowError):
        return False


def _main() -> int:
    parser = argparse.ArgumentParser(description="Assess a Position Guard snapshot")
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    try:
        with args.input.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        payload = None
    print(json.dumps(assess(payload), ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(_main())
