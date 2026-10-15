"""Local, unsigned chain97 native repayment policy. No execution authority."""
import json
import re
import sys
from maintenance.mandate import Mandate, validate_mandate, _check_mandate

OWNER = "0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982"
MARKET = "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c"
CONTROLLER = "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D"
UINT = re.compile(r"^(0|[1-9][0-9]{0,77})$")
BASE = {"status": "STOP", "action": None, "authority": "NONE",
        "execution_enabled": False, "signing_ready": False, "financial_ready": False}


def raw(value):
    if type(value) is not str or not UINT.fullmatch(value) or int(value) >= 2**256:
        raise ValueError("canonical raw uint256 string required")
    return int(value)


def integer(value):
    if type(value) is not int or value < 0 or value > 2**53 - 1:
        raise ValueError("nonnegative safe integer required")
    return value


def plan_maintenance(state, mandate=None, now=None):
    """A proposal is local policy evidence, never a payment or signing mandate."""
    result = {**BASE, "reason": "INVALID_OR_INCOMPLETE_INPUT"}
    # Retain the old offline HOLD/zero-debt observation interface only.
    if isinstance(state, dict) and "chain_id" not in state:
        debt = state.get("debt_wei")
        if state.get("synthetic") is True and type(debt) is int and debt >= 0:
            if debt == 0 or state.get("verdict") == "HOLD":
                return {**result, "status": "NO_ACTION", "reason": "ZERO_DEBT_OR_HOLD"}
        return result
    try:
        if type(state) is not dict or state["kind"] not in ("SYNTHETIC", "OBSERVED"):
            raise ValueError("state kind required")
        if type(state["chain_id"]) is not int or state["chain_id"] != 97:
            raise ValueError("chain97 required")
        for field, expected in (("wallet", OWNER), ("vbnb", MARKET), ("controller", CONTROLLER)):
            if type(state[field]) is not str or state[field].lower() != expected.lower():
                raise ValueError("fixed address required")
        for field in ("assets_entered_observed", "complete_native_scope", "complete_position", "financial_source_review"):
            if type(state[field]) is not bool:
                raise ValueError("explicit bool required")
        if state["authority"] != "NONE" or state["execution_enabled"] is not False or state["signing_ready"] is not False:
            raise ValueError("observational state required")
        if state["oracle_freshness"] not in ("UNKNOWN", "VERIFIED"):
            raise ValueError("oracle freshness enum required")
        raw(state["block_number"])
        if type(state["block_hash"]) is not str or not re.fullmatch(r"0x[0-9a-fA-F]{64}", state["block_hash"]):
            raise ValueError("block hash required")
        timestamp, current_time = integer(state["block_timestamp"]), integer(now)
        if current_time < timestamp or current_time - timestamp > 120:
            return {**result, "reason": "STALE_OBSERVATION"}
        debt, stored, balance = (raw(state[k]) for k in ("current_accrued_debt_raw", "stored_borrow_raw", "native_balance_wei"))
        if debt < stored:
            raise ValueError("accrued debt below stored debt")
        result.update(synthetic=state["kind"] == "SYNTHETIC", debt_wei=str(debt),
                      oracle_freshness=state["oracle_freshness"], complete_position=state["complete_position"])
        if debt == 0:
            return {**result, "status": "NO_ACTION", "reason": "NO_NATIVE_DEBT"}
        if not state["assets_entered_observed"] or not state["complete_native_scope"] or not state["complete_position"]:
            return {**result, "reason": "INCOMPLETE_POSITION"}
        if state["oracle_freshness"] != "VERIFIED" or not state["financial_source_review"]:
            return {**result, "reason": "ORACLE_OR_FINANCIAL_SOURCE_UNKNOWN"}
        # This reader cannot establish financial source/freshness for real observations.
        if state["kind"] == "OBSERVED":
            return {**result, "reason": "OBSERVED_FINANCIAL_PROOF_UNSUPPORTED"}
        _check_mandate(mandate)
        if any(n >= 2**256 for n in (mandate.max_value_wei, mandate.max_gas_wei, mandate.reserve_wei)):
            raise ValueError("uint256 mandate limits required")
        integer(mandate.expires_at)
        if mandate.native_market != MARKET or mandate.units != "wei" or mandate.chain_id != 97 or mandate.allowed_kinds != ("REPAY_BOUNDED",):
            return {**result, "reason": "NATIVE_MANDATE_SCOPE_REQUIRED"}
        available = balance - mandate.reserve_wei - mandate.max_gas_wei
        amount = min(debt, mandate.max_value_wei, available)
        if amount <= 0:
            return {**result, "reason": "RESERVE_OR_GAS_EXHAUSTS_BALANCE"}
        if not validate_mandate(mandate, owner=OWNER, borrower=OWNER, chain_id=97,
                                kind="REPAY_BOUNDED", value_wei=amount,
                                gas_wei=mandate.max_gas_wei, balance_wei=balance, now=current_time):
            return {**result, "reason": "MANDATE_POLICY_STOP"}
        return {**result, "status": "UNSIGNED_PROPOSAL", "reason": "SYNTHETIC_BOUNDED_POLICY_PASS",
                "action": "REPAY_BOUNDED", "amount_wei": str(amount),
                "gas_budget_wei": str(mandate.max_gas_wei), "reserve_wei": str(mandate.reserve_wei),
                "expected_debt_after_wei": str(debt - amount), "policy_checked": True}
    except (ValueError, TypeError, KeyError, AttributeError):
        return result


def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def reject_constant(value):
    raise ValueError("nonfinite JSON number")


def cli():
    payload = json.load(sys.stdin, object_pairs_hook=strict_object, parse_constant=reject_constant)
    if type(payload) is not dict or set(payload) != {"state", "mandate", "now"}:
        raise ValueError("payload shape")
    values = payload["mandate"]
    mandate = None
    if values is not None:
        required = {"owner", "borrower", "chain_id", "allowed_kinds", "max_value_wei", "max_gas_wei", "reserve_wei", "expires_at", "native_market", "units"}
        if type(values) is not dict or set(values) != required or type(values["allowed_kinds"]) is not list:
            raise ValueError("mandate shape")
        for key in ("max_value_wei", "max_gas_wei", "reserve_wei"):
            values[key] = raw(values[key])
        values["allowed_kinds"] = tuple(values["allowed_kinds"])
        mandate = Mandate(**values)
    return plan_maintenance(payload["state"], mandate, payload["now"])


if __name__ == "__main__":
    try:
        print(json.dumps(cli(), sort_keys=True))
    except (ValueError, TypeError, KeyError):
        print(json.dumps({**BASE, "reason": "INVALID_PAYLOAD"}))
