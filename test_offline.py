import unittest
from dataclasses import replace
from marketplace.adapter import FakeAdapter, JobEnvelope
from maintenance.planner import plan_maintenance


class OfflineTests(unittest.TestCase):
    def setUp(self):
        self.adapter = FakeAdapter()
        self.job = JobEnvelope("fixture-1", "0x" + "1" * 40)
        self.adapter.add_job(self.job)

    def test_replay_and_conflict(self):
        self.adapter.add_job(self.job)
        with self.assertRaises(ValueError):
            self.adapter.add_job(replace(self.job, wallet="0x" + "2" * 40))

    def test_fake_gate(self):
        for change in ({"synthetic": False}, {"chain_id": 56}, {"task": "repay"},
                       {"wallet": "0xINVALID"}):
            with self.assertRaises(ValueError):
                self.adapter.add_job(replace(self.job, **change))

    def test_delivery_replay_bytes_and_completion(self):
        first = self.adapter.prepare_submission(self.job.job_id, b'{"result":"HOLD"}')
        self.assertEqual(first, self.adapter.prepare_submission(self.job.job_id, b'{"result":"HOLD"}'))
        self.assertFalse(first["execution_enabled"])
        self.assertIsNone(first["onchain_manifest_hash"])
        self.assertFalse(self.adapter.read_completion(self.job.job_id))
        for data in (b"changed", b"", b"a" * 32769, "text"):
            with self.assertRaises(ValueError):
                self.adapter.prepare_submission(self.job.job_id, data)

    def test_maintenance_gates(self):
        for debt, verdict in ((0, "NO_DEBT"), (4, "HOLD")):
            self.assertEqual(plan_maintenance({"synthetic": True, "debt_wei": debt,
                                              "verdict": verdict})["status"], "NO_ACTION")
        for state in ({}, {"synthetic": True, "debt_wei": True},
                      {"synthetic": True, "debt_wei": 5, "verdict": "ACTION_REVIEW"}):
            self.assertEqual(plan_maintenance(state)["status"], "STOP")


if __name__ == "__main__":
    unittest.main()
