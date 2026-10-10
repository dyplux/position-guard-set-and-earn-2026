import copy
import unittest
from datetime import datetime, timezone

from keeper_plan import CONTROLLER, MARKET, OWNER, plan_native_setup

NOW = 1_800_000_000


def state(**changes):
    value = {
        "owner": OWNER, "chain_id": 97, "vtoken_address": MARKET, "controller": CONTROLLER,
        "actual_source_verified": True, "complete_position": True, "block_number": 1,
        "block_hash": "0x" + "ab" * 32, "timestamp": NOW, "native_balance_wei": "14000000000000000",
        "vtoken_balance_raw": "0", "borrow_balance_raw": "0", "vai_debt_raw": "0",
        "entered_markets": [], "sources_verified": True,
    }
    value.update(changes)
    return value


class KeeperPlanTests(unittest.TestCase):
    def test_untrusted_self_attestation_stops(self):
        result = plan_native_setup(state(), now=NOW)
        self.assertEqual(result["status"], "STOP")
        self.assertEqual(result["reasons"], ["READER_ATTESTATION_REQUIRED"])

    def test_boundary_mismatches(self):
        for field, bad in (("owner", "0x" + "1" * 40), ("chain_id", 56),
                           ("vtoken_address", OWNER), ("controller", OWNER)):
            with self.subTest(field=field):
                self.assertEqual(plan_native_setup(state(**{field: bad}), True, NOW)["status"], "STOP")

    def test_stale_future_and_boolean_fields(self):
        for changes in ({"timestamp": NOW - 61}, {"timestamp": NOW + 3},
                        {"timestamp": True}, {"block_number": True}, {"chain_id": True}):
            with self.subTest(changes=changes):
                self.assertEqual(plan_native_setup(state(**changes), True, NOW)["status"], "STOP")

    def test_malformed_raw_unknown_market_and_debt(self):
        for changes in ({"native_balance_wei": True}, {"vtoken_balance_raw": "1e3"},
                        {"borrow_balance_raw": "1"}, {"entered_markets": [OWNER]}, {"entered_markets": [{}]}):
            with self.subTest(changes=changes):
                self.assertEqual(plan_native_setup(state(**changes), True, NOW)["status"], "STOP")

    def test_supply_abi_and_caps(self):
        result = plan_native_setup(state(), True, NOW)
        self.assertEqual(result["status"], "READY")
        tx = result["unsigned_tx"]
        self.assertEqual(tx["data"], "0x1249c58b")
        self.assertEqual(tx["value_wei"], "1000000000000000")
        self.assertEqual(tx["max_fee_wei"], 3000000000000000)
        self.assertEqual(tx["gas_cap"], 1000000)

    def test_enter_and_noop(self):
        entered = plan_native_setup(state(vtoken_balance_raw="1"), True, NOW)
        expected = "0xc2998238" + (32).to_bytes(32, "big").hex() + (1).to_bytes(32, "big").hex()
        expected += (int(MARKET[2:], 16)).to_bytes(32, "big").hex()
        self.assertEqual(entered["unsigned_tx"]["data"], expected)
        noop = plan_native_setup(state(vtoken_balance_raw="1", entered_markets=[MARKET]), True, NOW)
        self.assertEqual(noop["status"], "NO_ACTION")
        self.assertNotIn("unsigned_tx", noop)

    def test_binding_is_stable_and_cli_boundary_is_safe(self):
        a = plan_native_setup(state(), True, datetime.fromtimestamp(NOW, timezone.utc))
        b = plan_native_setup(copy.deepcopy(state()), True, NOW)
        self.assertEqual(a["binding_sha256"], b["binding_sha256"])
        self.assertFalse(a["execution_enabled"])


if __name__ == "__main__":
    unittest.main()
