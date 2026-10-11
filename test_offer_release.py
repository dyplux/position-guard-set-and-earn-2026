import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

from marketplace.offer_release import release_preissued
from marketplace.preissued import PROVIDER, _json_bytes


class OfferReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name); self.root.chmod(0o700)
        self.state = self.root / "state"; self.state.mkdir(mode=0o700)
        self.events = []
        self.envelope = {"negotiation_hash": "0x" + "a" * 64, "quote_expires_at": 200,
                         "request": {"task_description": "SYNTHETIC_INTERNAL_FIXTURE"}}
        self.grant = {"state": "AUTHORIZED", "scope": "PREISSUED_QUOTE_RELEASE", "chain_id": 97,
            "agent_id": 2583, "provider": PROVIDER, "quote_hash": self.envelope["negotiation_hash"],
            "envelope_sha256": hashlib.sha256(_json_bytes(self.envelope)).hexdigest(),
            "expires_at": 180, "max_releases": 1}
        self.offer = self.root / "offer.json"
        self.grant["offer_file"] = str(self.offer)
        for name, value in [("envelope.json", self.envelope), ("grant.json", self.grant)]:
            p = self.root / name; p.write_text(json.dumps(value)); p.chmod(0o600)
        owner = self
        class Negotiator:
            def __init__(self, *_args, **_kwargs): pass
            def __call__(self, request):
                owner.events.append("verify"); return owner.envelope
        class Store:
            def __init__(self, path): owner.events.append("open-archive")
            def archive(self, envelope):
                owner.events.append("archive"); owner.assertFalse(owner.offer.exists()); return envelope
            def close(self): owner.events.append("archive-close")
        self.negotiator, self.store = Negotiator, Store

    def tearDown(self): self.temp.cleanup()

    def run_release(self, **kwargs):
        args = {"clock": lambda: 100, "negotiator_cls": self.negotiator, "store_cls": self.store}
        args.update(kwargs)
        return release_preissued(self.root / "envelope.json", self.root / "grant.json",
            self.state, self.offer, "/usr/bin/node", **args)

    def test_verification_and_archival_precede_release(self):
        result = self.run_release()
        self.assertEqual(result["status"], "PREISSUED_RELEASE_PREPARED")
        self.assertEqual(self.events, ["verify", "open-archive", "archive", "archive-close"])
        self.assertEqual(os.stat(self.offer).st_mode & 0o777, 0o640)
        self.assertEqual(json.loads(self.offer.read_text())["envelope"], self.envelope)

    def test_missing_or_wrong_grant_cannot_release(self):
        for change in [{"state": "PENDING"}, {"chain_id": 56}, {"max_releases": True},
                       {"envelope_sha256": "0" * 64}, {"expires_at": 100}]:
            grant = dict(self.grant); grant.update(change)
            (self.root / "grant.json").write_text(json.dumps(grant))
            with self.assertRaises(ValueError): self.run_release()
            self.assertFalse(self.offer.exists())
        self.assertEqual(self.events, [])

    def test_failed_archive_never_releases(self):
        class FailingStore:
            def __init__(self, *_): pass
            def archive(self, *_): raise ValueError("STOP")
            def close(self): pass
        with self.assertRaises(ValueError): self.run_release(store_cls=FailingStore)
        self.assertFalse(self.offer.exists())

    def test_expiry_after_archival_stops_release(self):
        ticks = iter([100, 180])
        with self.assertRaises(ValueError): self.run_release(clock=lambda: next(ticks))
        self.assertFalse(self.offer.exists())

    def test_grant_cannot_release_to_a_different_file(self):
        self.grant["offer_file"] = str(self.root / "other.json")
        (self.root / "grant.json").write_text(json.dumps(self.grant))
        with self.assertRaises(ValueError): self.run_release()
        self.assertEqual(self.events, [])
        self.assertFalse(self.offer.exists())

    def test_identical_replay_does_not_replace_the_file(self):
        self.run_release()
        before = self.offer.stat().st_ino
        class Store:
            def __init__(self, *_): pass
            def archive(self, envelope): return envelope
            def close(self): pass
        result = self.run_release(store_cls=Store)
        self.assertEqual(result["status"], "RELEASE_REPLAYED")
        self.assertEqual(self.offer.stat().st_ino, before)

    def test_partial_or_conflicting_release_is_never_overwritten(self):
        class Store:
            def __init__(self, *_): pass
            def archive(self, envelope): return envelope
            def close(self): pass
        for contents in (b'{', b'{}'):
            self.offer.write_bytes(contents); self.offer.chmod(0o640)
            with self.assertRaises(ValueError): self.run_release(store_cls=Store)
            self.assertEqual(self.offer.read_bytes(), contents)


if __name__ == "__main__": unittest.main()
