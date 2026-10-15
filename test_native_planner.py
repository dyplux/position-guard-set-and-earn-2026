"""Explicit synthetic fixtures. No onchain actions or source proof."""
import unittest
import json
import subprocess
import sys
from dataclasses import replace
from maintenance.mandate import Mandate
from maintenance.planner import plan_maintenance, OWNER, MARKET, CONTROLLER


def state(**changes):
    value = dict(kind="SYNTHETIC", chain_id=97, wallet=OWNER, vbnb=MARKET, controller=CONTROLLER,
                 assets_entered_observed=True, complete_native_scope=True, complete_position=True,
                 financial_source_review=True, authority="NONE", execution_enabled=False, signing_ready=False,
                 oracle_freshness="VERIFIED", block_timestamp=1000, block_number="100",block_hash="0x"+"a"*64, current_accrued_debt_raw="100",
                 stored_borrow_raw="99", native_balance_wei="200")
    value.update(changes)
    return value


def mandate(**changes):
    value=dict(owner=OWNER,borrower=OWNER,chain_id=97,allowed_kinds=("REPAY_BOUNDED",),
               max_value_wei=80,max_gas_wei=20,reserve_wei=30,expires_at=1100,native_market=MARKET,units="wei")
    value.update(changes)
    return Mandate(**value)


class NativePlannerTests(unittest.TestCase):
    def test_positive_synthetic_bounded_path(self):
        x=plan_maintenance(state(),mandate(),1000)
        self.assertEqual(x["status"],"UNSIGNED_PROPOSAL")
        self.assertEqual(x["amount_wei"],"80")
        self.assertEqual(x["expected_debt_after_wei"],"20")
        self.assertFalse(x["financial_ready"])
        self.assertFalse(x["execution_enabled"])
        self.assertEqual(x["authority"],"NONE")

    def test_debt_cap_balance_reserve_gas_bounds(self):
        for changes, expected in ((dict(current_accrued_debt_raw="70",stored_borrow_raw="60"),"70"),
                                  (dict(native_balance_wei="90"),"40")):
            self.assertEqual(plan_maintenance(state(**changes),mandate(),1000)["amount_wei"],expected)
        self.assertEqual(plan_maintenance(state(native_balance_wei="50"),mandate(),1000)["status"],"STOP")

    def test_zero_real_debt_is_no_action_without_mandate(self):
        x=plan_maintenance(state(kind="OBSERVED",current_accrued_debt_raw="0",stored_borrow_raw="0",
                                oracle_freshness="UNKNOWN",complete_position=False,financial_source_review=False),None,1000)
        self.assertEqual(x["status"],"NO_ACTION")
        self.assertIsNone(x["action"])

    def test_unknown_incomplete_or_real_financial_proof_stops(self):
        for changes in ({"oracle_freshness":"UNKNOWN"},{"complete_position":False},{"complete_native_scope":False},
                        {"financial_source_review":False},{"kind":"OBSERVED"}):
            self.assertEqual(plan_maintenance(state(**changes),mandate(),1000)["status"],"STOP")

    def test_expiry_wrong_network_owner_units_market(self):
        for changes in ({"expires_at":1000},{"chain_id":56},{"owner":"0x"+"1"*40},
                        {"units":"BNB"},{"native_market":None},{"allowed_kinds":("CLOSE_REMAINING_DEBT",)},
                        {"max_gas_wei":False},{"max_value_wei":float("nan")},{"reserve_wei":-1}):
            self.assertEqual(plan_maintenance(state(),mandate(**changes),1000)["status"],"STOP")

    def test_invalid_missing_boolean_string_negative_nan_and_stale(self):
        for field,value in (("chain_id",True),("complete_position","true"),("financial_source_review",None),
                            ("current_accrued_debt_raw",-1),("current_accrued_debt_raw","-1"),
                            ("current_accrued_debt_raw","01"),("native_balance_wei",float("nan")),
                            ("block_timestamp",True),("execution_enabled",0)):
            self.assertEqual(plan_maintenance(state(**{field:value}),mandate(),1000)["status"],"STOP")
        for field in state():
            invalid=state();del invalid[field]
            self.assertEqual(plan_maintenance(invalid,mandate(),1000)["status"],"STOP",field)
        for now in (None,True,"1000",999,1121):
            self.assertEqual(plan_maintenance(state(),mandate(),now)["status"],"STOP")


    def run_cli(self, text):
        output = subprocess.run([sys.executable, "-m", "maintenance.planner"], input=text,
                                capture_output=True, text=True, check=True,
                                env={"PATH": "/usr/bin:/bin"})
        return json.loads(output.stdout)

    def wire_payload(self):
        values = dict(mandate().__dict__)
        values["allowed_kinds"] = list(values["allowed_kinds"])
        for key in ("max_value_wei", "max_gas_wei", "reserve_wei"):
            values[key] = str(values[key])
        return {"state": state(), "mandate": values, "now": 1000}

    def test_direct_cli_exact_strings_and_duplicate_keys(self):
        wire = json.dumps(self.wire_payload())
        self.assertEqual(self.run_cli(wire)["status"], "UNSIGNED_PROPOSAL")
        for name, value in (("max_value_wei", '"80"'), ("owner", json.dumps(OWNER)),
                            ("chain_id", "97")):
            needle = json.dumps(name) + ": " + value
            duplicate = wire.replace(needle, needle + ", " + needle, 1)
            self.assertEqual(self.run_cli(duplicate)["reason"], "INVALID_PAYLOAD")

    def test_direct_cli_rejects_nonfinite_constants_and_unsafe_monetary_numbers(self):
        wire = json.dumps(self.wire_payload())
        for invalid in ("NaN", "Infinity", "-Infinity", "10000000000000000"):
            malformed = wire.replace('"max_value_wei": "80"', '"max_value_wei": ' + invalid)
            self.assertEqual(self.run_cli(malformed)["reason"], "INVALID_PAYLOAD")


if __name__ == '__main__': unittest.main()
