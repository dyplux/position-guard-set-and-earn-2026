import json
import os
import sqlite3
import stat
import tempfile
import unittest

from marketplace.quote_store import QuoteStore


COMMERCE = "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE"
CURRENCY = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"


def envelope(**changes):
    value = {"negotiation_hash": "0x" + "ab" * 32, "provider_sig": "0x" + "cd" * 65,
             "negotiated_at": 100, "quote_expires_at": 200, "chain_id": 97,
             "verifying_contract": COMMERCE, "request": {"task_description": "assess wallet"},
             "response": {"accepted": True, "terms": {"price": "100", "currency": CURRENCY}}}
    for key, item in changes.items():
        if key in ("request", "response"):
            value[key].update(item)
        else:
            value[key] = item
    return value


class QuoteStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "quotes.sqlite")

    def tearDown(self):
        self.tmp.cleanup()

    def test_replay_restart_and_missing(self):
        quote = envelope()
        store = QuoteStore(self.path)
        self.assertEqual(store.archive(quote), quote)
        self.assertEqual(store.archive(json.loads(json.dumps(quote))), quote)
        store.close()
        store = QuoteStore(self.path)
        self.assertEqual(store.get(quote["negotiation_hash"]), quote)
        self.assertIsNone(store.get("0x" + "00" * 32))
        store.close()

    def test_conflict_and_rejections(self):
        store = QuoteStore(self.path)
        store.archive(envelope())
        with self.assertRaises(ValueError): store.archive(envelope(response={"terms": {"price": "101"}}))
        cases = [envelope(provider_sig=None), envelope(chain_id=True), envelope(chain_id=56),
                 envelope(response={"accepted": False}), envelope(response={"terms": {"price": "01"}}),
                 envelope(quote_expires_at=1000)]
        for bad in cases:
            with self.assertRaises(ValueError): store.archive(bad)
        store.close()

    def test_corruption_permissions_and_immutable_guards(self):
        store = QuoteStore(self.path)
        quote = envelope()
        store.archive(quote)
        store.close()

        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o600)
        os.chmod(self.path, 0o640)
        with self.assertRaises(ValueError): QuoteStore(self.path)
        os.chmod(self.path, 0o600)
        offline = sqlite3.connect(self.path)
        offline.execute("DROP TRIGGER quote_archive_no_update")
        offline.execute("UPDATE quote_archive SET envelope=?", (b"broken",))
        offline.commit(); offline.close()
        store = QuoteStore(self.path)
        with self.assertRaises(ValueError): store.get(quote["negotiation_hash"])
        store.close()

    def test_unsafe_parent_and_hardlinks_stop(self):
        os.chmod(self.tmp.name,0o755)
        with self.assertRaises(ValueError):QuoteStore(self.path)
        os.chmod(self.tmp.name,0o700)
        store=QuoteStore(self.path);store.close()
        os.link(self.path,self.path+'.alias')
        with self.assertRaises(ValueError):QuoteStore(self.path)


if __name__ == "__main__":
    unittest.main()
