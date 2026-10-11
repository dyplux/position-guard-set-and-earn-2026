import hashlib
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from marketplace.preissued import PreissuedNegotiator, ERROR
from marketplace.service_terms import DELIVERABLES, QUALITY


TASK = "Assess Venus Core testnet position for wallet 0x" + "a" * 40 + ". I consent to public JSON delivery retained for 45 days."
TERMS = {"deliverables": DELIVERABLES, "quality_standards": QUALITY}


class PreissuedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.chmod(self.tmp.name, 0o700)
        self.path = os.path.join(self.tmp.name, "release.json")
        self.envelope = {"quote_expires_at": 150, "request": {"task_description": TASK},
                         "response": {"terms": TERMS}, "quote": "synthetic"}
        self.release = {"schema_version": 1, "scope": "PREISSUED_QUOTE_RELEASE", "state": "AUTHORIZED",
                        "provider": "0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982", "agent_id": 2583,
                        "chain_id": 97, "authorized_until": 140, "envelope_sha256": self.digest(),
                        "envelope": self.envelope}
        self.write()
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def digest(self):
        return hashlib.sha256(json.dumps(self.envelope, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def write(self, value=None):
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(self.release if value is None else value, handle, separators=(",", ":"))
        os.chmod(self.path, 0o600)

    def runner(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps({"status": "VERIFIED_PREISSUED_QUOTE",
            "envelope": self.envelope, "envelope_sha256": self.release["envelope_sha256"]}).encode())

    def negotiator(self, clock=lambda: 100, runner=None):
        return PreissuedNegotiator(self.path, "/usr/bin/node", clock=clock, runner=runner or self.runner)

    def test_success_and_exact_verifier_contract(self):
        self.assertEqual(self.negotiator()({"skill": "negotiate", "task_description": TASK, "terms": TERMS}), self.envelope)
        self.assertEqual(self.calls[0][0][-1], os.path.abspath(os.path.join(os.path.dirname(__file__), "marketplace/offer_verifier.cjs")))
        self.assertIn("--max-old-space-size=64", self.calls[0][0])
        self.assertEqual(json.loads(self.calls[0][1]["input"]), {"envelope": self.envelope, "task": TASK, "now": 100})

    def test_request_and_terms_reject(self):
        for key, value in (("skill", "other"), ("task_description", TASK.replace("a" * 40, "b" * 40)),
                           ("terms", {"deliverables": "x"}), ("terms", {"deliverables": "é", "quality_standards": "x"}),
                           ("terms", {"deliverables": "other", "quality_standards": "other"})):
            data = {"skill": "negotiate", "task_description": TASK, "terms": TERMS}
            data[key] = value
            with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()(data)

    def test_grant_expiry_hash_and_envelope_reject(self):
        for field, value in (("provider", "0x" + "0" * 40), ("agent_id", 2584), ("chain_id", 56),
                             ("authorized_until", 100), ("envelope_sha256", "0" * 64),
                             ("envelope", {"quote_expires_at": 150, "request": {"task_description": "wrong"}})):
            changed = dict(self.release); changed[field] = value; self.write(changed)
            with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()(dict(skill="negotiate", task_description=TASK, terms=TERMS))
            self.write()

    def test_clock_bool_duplicate_and_nonfinite_reject(self):
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator(clock=lambda: True)({"skill": "negotiate", "task_description": TASK, "terms": TERMS})
        raw = json.dumps(self.release).replace('"scope":', '"scope":"PREISSUED_QUOTE_RELEASE","scope":', 1)
        with open(self.path, "w") as handle: handle.write(raw)
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()({"skill": "negotiate", "task_description": TASK, "terms": TERMS})

    def test_file_safety_and_verifier_failures(self):
        os.chmod(self.path, 0o644)
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()({"skill": "negotiate", "task_description": TASK, "terms": TERMS})
        self.write(); os.chmod(self.path, 0o600); os.unlink(self.path); os.symlink("missing", self.path)
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()({"skill": "negotiate", "task_description": TASK, "terms": TERMS})
        os.unlink(self.path)
        self.write(); os.chmod(self.path, 0o600)
        os.chmod(self.tmp.name, 0o702)
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()({"skill": "negotiate", "task_description": TASK, "terms": TERMS})
        os.chmod(self.tmp.name, 0o700)
        with open(self.path, "ab") as handle: handle.write(b"x" * 32768)
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator()({"skill": "negotiate", "task_description": TASK, "terms": TERMS})
        self.write()
        bad = lambda *a, **k: SimpleNamespace(returncode=1, stdout=b"")
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator(runner=bad)({"skill": "negotiate", "task_description": TASK, "terms": TERMS})
        bad_json = lambda *a, **k: SimpleNamespace(returncode=0, stdout=b"{")
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator(runner=bad_json)({"skill": "negotiate", "task_description": TASK, "terms": TERMS})

    def test_expiry_during_verification(self):
        ticks = iter((100, 140))
        with self.assertRaisesRegex(ValueError, ERROR): self.negotiator(clock=lambda: next(ticks))({"skill": "negotiate", "task_description": TASK, "terms": TERMS})

    def test_argparse_path_objects_work_and_schema_bool_is_rejected(self):
        n = PreissuedNegotiator(Path(self.path), "/usr/bin/node", clock=lambda: 100, runner=self.runner)
        self.assertEqual(n(dict(skill="negotiate", task_description=TASK, terms=TERMS)), self.envelope)
        self.release["schema_version"] = True
        self.write()
        with self.assertRaisesRegex(ValueError, ERROR): n(dict(skill="negotiate", task_description=TASK, terms=TERMS))

    def test_clock_rollback_or_changed_verifier_envelope_is_rejected(self):
        ticks = iter((100, 99))
        with self.assertRaisesRegex(ValueError, ERROR):
            self.negotiator(clock=lambda: next(ticks))(dict(skill="negotiate", task_description=TASK, terms=TERMS))
        def changed(*a, **k):
            return SimpleNamespace(returncode=0, stdout=json.dumps({"status": "VERIFIED_PREISSUED_QUOTE",
                "envelope": {}, "envelope_sha256": self.release["envelope_sha256"]}).encode())
        with self.assertRaisesRegex(ValueError, ERROR):
            self.negotiator(runner=changed)(dict(skill="negotiate", task_description=TASK, terms=TERMS))


if __name__ == "__main__":
    unittest.main()
