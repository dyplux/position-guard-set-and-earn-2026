"""First offline gate. No repayment proposal until reader and mandate exist."""


def plan_maintenance(state, mandate=None, now=None):
    result = {"status": "STOP", "action": None, "authority": "NONE",
              "execution_enabled": False, "reason": "READER_AND_MANDATE_NOT_IMPLEMENTED"}
    if not isinstance(state, dict) or state.get("synthetic") is not True:
        return result
    debt = state.get("debt_wei")
    if type(debt) is not int or debt < 0:
        return {**result, "reason": "INVALID_DEBT"}
    if debt == 0 or state.get("verdict") == "HOLD":
        return {**result, "status": "NO_ACTION", "reason": "ZERO_DEBT_OR_HOLD"}
    return result
