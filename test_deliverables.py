import io
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from marketplace.public_store import PublicDeliveryStore
from marketplace.deliverables import read_manifest_bytes
from server import Handler


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'deliveries.sqlite'
        self.store=PublicDeliveryStore(str(self.path));self.key='erc8183:97:0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de:7'
        self.record=self.store.publish(self.key,b'{"text":"a\\u00e7\\u00e3o"}',expires_at=int(time.time())+3600,
                                       quote_hash='0x'+'1'*64)

    def tearDown(self):self.store.close();self.tmp.cleanup()

    def test_exact_manifest_http_bytes_and_default_disabled(self):
        handler=object.__new__(Handler);handler.authorize=lambda:True
        handler.path=f"/deliverables/{self.key}/{self.record['manifest_sha']}.json"
        handler.server=SimpleNamespace(delivery_store=None);captured={}
        handler.send_json=lambda status,value:captured.update(status=status,value=value)
        handler.do_GET();self.assertEqual(captured['status'],404)
        handler.server.delivery_store=self.path;handler.wfile=io.BytesIO()
        handler.send_response=lambda status:captured.update(status=status)
        handler.send_header=lambda *_:None;handler.end_headers=lambda:None
        handler.do_GET();self.assertEqual(captured['status'],200)
        self.assertEqual(handler.wfile.getvalue(),b'{"text":"a\\u00e7\\u00e3o"}')

    def test_path_traversal_and_hash_mismatch_are_rejected(self):
        for key,digest in [('../escape',self.record['manifest_sha']),(self.key,'0'*64),(self.key,'../../x'),
                           ('erc8183:97:0x'+'1'*40+':7',self.record['manifest_sha']),
                           (self.key[:-1]+str(2**53),self.record['manifest_sha'])]:
            with self.assertRaises(ValueError):read_manifest_bytes(self.path,key,digest)
        with self.assertRaises(ValueError):read_manifest_bytes(self.path.parent/'missing.sqlite',self.key,self.record['manifest_sha'])


if __name__=='__main__':unittest.main()
