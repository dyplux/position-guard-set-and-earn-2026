import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from marketplace.deliverables import read_manifest_bytes
from marketplace.public_store import PublicDeliveryStore


KEY = "erc8183:97:0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de:7"
QUOTE = "0x" + "a" * 64


class PublicStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "public.sqlite"
        self.store = PublicDeliveryStore(self.path)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_atomic_immutable_replay_and_conflict(self):
        record = self.store.publish(KEY, b"manifest", expires_at=2**53 - 1, quote_hash=QUOTE)
        self.assertNotIn("manifest", record)
        self.assertEqual(record, self.store.publish(KEY, b"manifest", expires_at=2**53 - 1, quote_hash=QUOTE))
        with self.assertRaisesRegex(ValueError, "CONFLICTING"):
            self.store.publish(KEY, b"different", expires_at=2**53 - 1, quote_hash=QUOTE)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute("UPDATE public_deliveries SET quote_hash=? WHERE job_key=?", (QUOTE, KEY))
        self.store.db.rollback()

    def test_expiry_and_corrupt_bytes(self):
        now = 2000000000
        record = self.store.publish(KEY, b"manifest", expires_at=now + 1, quote_hash=QUOTE)
        self.assertEqual(read_manifest_bytes(self.path, KEY, record["manifest_sha"], now=now), b"manifest")
        with self.assertRaises(ValueError):
            read_manifest_bytes(self.path, KEY, record["manifest_sha"], now=record["expires_at"])
        self.store.close()
        db = sqlite3.connect(self.path)
        db.execute("DROP TRIGGER public_delivery_no_update")
        db.execute("UPDATE public_deliveries SET manifest_sha=? WHERE job_key=?", ("0" * 64, KEY))
        db.commit()
        db.close()
        self.store = PublicDeliveryStore(self.path)
        with self.assertRaises(ValueError):
            read_manifest_bytes(self.path, KEY, record["manifest_sha"], now=0)

    def test_limits_namespace_and_private_path(self):
        with self.assertRaises(ValueError):
            self.store.publish(KEY, b"x" * (262144 + 1), expires_at=1, quote_hash=QUOTE)
        with self.assertRaises(ValueError):
            self.store.publish(KEY.replace(":7", ":0"), b"x", expires_at=1, quote_hash=QUOTE)
        with self.assertRaises(ValueError):
            self.store.publish(KEY, b"x", expires_at=1, quote_hash="0X" + "a" * 64)
        link = Path(self.tmp.name) / "link.sqlite"
        link.symlink_to(self.path)
        with self.assertRaises(ValueError):
            PublicDeliveryStore(link)
        os.chmod(self.path, 0o666)
        with self.assertRaises(ValueError):
            PublicDeliveryStore(self.path)


if __name__ == "__main__":
    unittest.main()
