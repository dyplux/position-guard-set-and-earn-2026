import json
import hashlib
import os
import stat
import tempfile
import unittest
from unittest.mock import patch

from marketplace.fulfilment import prepare_fulfilment


KEY = "erc8183:97:0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de:7"
BLOB = b"manifest"
DIGEST = hashlib.sha256(BLOB).hexdigest()
WORKER = {"state": "DELIVERABLE_PERSISTED", "job_key": KEY,
          "manifest_sha256": DIGEST, "receipt_sha256": "b" * 64,
          "execution_enabled": False, "completed_onchain": False}


class Closeable:
    def __init__(self, value):
        self.value = value
        self.closed = False

    def close(self):
        self.closed = True


class QuoteStore(Closeable):
    pass


class Reader:
    def __init__(self, *, quote_store, node):
        self.quote_store, self.node = quote_store, node

    def read(self, job_id):
        return {"attested": True, "synthetic": False, "source_kind": "OBSERVED"}


class Delivery(Closeable):
    def get(self, key):
        return {"job_key": key, "manifest_bytes": BLOB,
                "manifest_sha256": DIGEST, "receipt_sha256": "b" * 64}


class FulfilmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = self.tmp.name
        os.chmod(self.state, 0o700)
        for name in ("quotes.sqlite", "jobs.sqlite"):
            path = os.path.join(self.state, name)
            open(path, "wb").close()
            os.chmod(path, 0o600)
        self.worker = lambda *_: dict(WORKER)
        self.prepare = patch("marketplace.fulfilment.prepare_publication",
                             return_value={"job_key": KEY, "manifest_bytes": BLOB,
                                           "quote_hash": "0x" + "c" * 64, "expires_at": 200})
        self.prepare.start()

    def tearDown(self):
        self.prepare.stop()
        self.tmp.cleanup()

    def call(self, **kwargs):
        options = {"run_job_fn": self.worker, "quote_store_cls": QuoteStore,
                   "reader_cls": Reader, "delivery_store_cls": Delivery,
                   "clock_fn": lambda: 100}
        options.update(kwargs)
        return prepare_fulfilment(7, self.state, "/usr/bin/node", **options)

    def test_success_and_restart_replay_only_persist_metadata(self):
        result = self.call()
        self.assertEqual(result["export_prepared"], True)
        path = os.path.join(self.state, "export-plans", "7.json")
        with open(path, "rb") as stream:
            first = stream.read()
        self.assertEqual(self.call(), result)
        with open(path, "rb") as stream:
            self.assertEqual(stream.read(), first)
        metadata = json.loads(first)
        self.assertEqual(metadata["deliverable_url"],
                         "https://positionguard.dyplux.com/deliverables/" + KEY + "/" + DIGEST + ".json")
        self.assertNotIn("manifest_bytes", metadata)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)

    def test_reconciliation_returns_without_archive_reads_or_export(self):
        calls = []
        result = prepare_fulfilment(7, self.state, "/usr/bin/node",
                                    run_job_fn=lambda *_: {"state": "RECONCILIATION_REQUIRED",
                                                           "execution_enabled": False,
                                                           "completed_onchain": False},
                                    quote_store_cls=lambda *_: calls.append(1),
                                    clock_fn=lambda: calls.append(2))
        self.assertEqual(result["state"], "RECONCILIATION_REQUIRED")
        self.assertEqual(calls, [])
        self.assertFalse(os.path.exists(os.path.join(self.state, "export-plans")))

    def test_preparation_failure_never_exports(self):
        with patch("marketplace.fulfilment.prepare_publication", side_effect=ValueError("no consent")):
            with self.assertRaises(ValueError): self.call()
        self.assertFalse(os.path.exists(os.path.join(self.state, "export-plans")))

    def test_default_clock_accepts_real_float_epoch_without_coercing_injected_bool(self):
        with patch("marketplace.fulfilment.time.time", return_value=100.75):
            self.assertTrue(self.call(clock_fn=None)["export_prepared"])
        with self.assertRaises(ValueError):
            self.call(clock_fn=lambda: 100.75)

    def test_worker_hashes_are_bound_to_validated_private_delivery(self):
        for key in ("manifest_sha256", "receipt_sha256"):
            worker = dict(WORKER)
            worker[key] = "e" * 64
            with self.assertRaises(ValueError):
                self.call(run_job_fn=lambda *_: worker)
        self.assertFalse(os.path.exists(os.path.join(self.state, "export-plans")))

    def test_expired_or_malformed_preparation_is_rejected(self):
        for change in ({"expires_at": 100}, {"expires_at": True}, {"quote_hash": "c" * 64},
                       {"job_key": KEY[:-1] + "8"}):
            prepared = {"job_key": KEY, "manifest_bytes": BLOB,
                        "quote_hash": "0x" + "c" * 64, "expires_at": 200}
            prepared.update(change)
            with patch("marketplace.fulfilment.prepare_publication", return_value=prepared):
                with self.assertRaises(ValueError): self.call()
        self.assertFalse(os.path.exists(os.path.join(self.state, "export-plans")))

    def test_worker_state_flags_and_key_are_strict(self):
        cases = [dict(state="UNKNOWN"), dict(execution_enabled=True),
                 dict(completed_onchain=True), dict(job_key=KEY[:-1] + "8")]
        for change in cases:
            worker = dict(WORKER); worker.update(change)
            with self.assertRaises(ValueError): self.call(run_job_fn=lambda *_: worker)
        self.assertFalse(os.path.exists(os.path.join(self.state, "export-plans")))

    def test_invalid_inputs_clock_archives_and_permissions(self):
        for value in (True, 0, -1, 2**53, "7"):
            with self.assertRaises(ValueError): prepare_fulfilment(value, self.state, "/usr/bin/node")
        with self.assertRaises(ValueError): prepare_fulfilment(7, self.state, "node")
        with self.assertRaises(ValueError): self.call(clock_fn=lambda: True)
        os.unlink(os.path.join(self.state, "quotes.sqlite"))
        with self.assertRaises(ValueError): self.call()
        open(os.path.join(self.state, "quotes.sqlite"), "wb").close()
        os.chmod(os.path.join(self.state, "quotes.sqlite"), 0o640)
        with self.assertRaises(ValueError): self.call()

    def test_conflict_and_truncated_plan_never_overwrite(self):
        path = os.path.join(self.state, "export-plans")
        os.mkdir(path, 0o700)
        target = os.path.join(path, "7.json")
        with open(target, "wb") as stream:
            stream.write(b"{}\n")
        os.chmod(target, 0o600)
        with self.assertRaises(ValueError): self.call()
        with open(target, "rb") as stream:
            self.assertEqual(stream.read(), b"{}\n")


if __name__ == "__main__":
    unittest.main()
