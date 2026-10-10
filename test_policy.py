import copy
import unittest
from policy import assess, verify_receipt
from server import fixture

class PolicyBoundaryTests(unittest.TestCase):
    def test_labelled_cases(self):
        expected = {"review": "ACTION_REVIEW", "hold": "HOLD", "risk": "LIQUIDATION_RISK", "missing": "NEED_EVIDENCE"}
        for name, decision in expected.items():
            with self.subTest(case=name):
                result = assess(fixture(name))
                self.assertEqual(result["decision"], decision)
                self.assertEqual(result["evidence_kind"], "SYNTHETIC")
                self.assertFalse(result["execution_enabled"])
                self.assertEqual(result["authority"], "NONE")
                self.assertTrue(verify_receipt(result))
    def test_tamper_is_rejected(self):
        result = assess(fixture("hold"))
        result["decision"] = "ALLOW"
        self.assertFalse(verify_receipt(result))
    def test_supplied_observed_is_unverified(self):
        data = fixture("hold")
        data["source_kind"] = "OBSERVED"
        self.assertEqual(assess(data)["evidence_kind"], "SUPPLIED_UNVERIFIED")
    def test_wrong_chain_fails_closed(self):
        data = fixture("hold")
        data["chain_id"] = 56
        self.assertEqual(assess(data)["decision"], "NEED_EVIDENCE")

if __name__ == "__main__":
    unittest.main()
