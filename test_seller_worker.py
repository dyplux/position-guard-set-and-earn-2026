import copy
import datetime as dt
import hashlib
import json
import tempfile
import sqlite3
import unittest
from pathlib import Path
from marketplace.atlas_bridge import AtlasBridge
from marketplace.store import DeliveryStore
from marketplace.worker import AssessmentWorker, canonical_bytes
from policy import assess, verify_receipt
from server import fixture


class SellerWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name)/'seller.sqlite')
        self.now = 2000000000
        self.wallet = '0x'+'1'*40
        self.contracts = {key:'0x'+digit*40 for key,digit in [('commerce','2'),('router','3'),('policy','4')]}
        self.key = f"erc8183:97:{self.contracts['commerce']}:7"
        task = {'task':'assess_venus_position','chain_id':97,'wallet':self.wallet}
        observation = {'attested':True,'synthetic':True,'chain_id':97,'agent_id':2583,
                       'deployment':self.contracts['commerce'],
                       'job':{'id':'7','provider':self.wallet,'client':'0x'+'5'*40,
                              'statusName':'FUNDED','budget':'1','expiredAt':str(self.now+100),
                              'description':json.dumps(task)}}
        bridge = AtlasBridge(read_verified_job=lambda _:observation,provider=self.wallet,
                             deployment=self.contracts['commerce'],store_path=self.path)
        request = {'jsonrpc':'2.0','id':1,'method':'message/send','params':{'message':{
            'role':'user','parts':[{'kind':'data','data':{'skill':'notify_funded','job_id':7}}]}}}
        self.assertIn('result',bridge.handle(request,now=self.now))
        bridge.close()
        self.snapshot = fixture('hold')
        self.snapshot.update(wallet_address=self.wallet,block_timestamp=self.now,
                             checked_at=dt.datetime.fromtimestamp(self.now,dt.timezone.utc).isoformat())
        self.calls = 0
        self.store = DeliveryStore(self.path)
        self.worker = self.make_worker()

    def make_worker(self):
        def collect(_):
            self.calls += 1
            return copy.deepcopy(self.snapshot)
        return AssessmentWorker(store=self.store,collect_fn=collect,assess_fn=assess,
                                verify_receipt_fn=verify_receipt,contracts=self.contracts,clock_fn=lambda:self.now)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_restart_replays_exact_bytes_without_collection(self):
        first = self.worker.process(self.key)
        self.store.close()
        self.store = DeliveryStore(self.path)
        self.worker = self.make_worker()
        second = self.worker.process(self.key)
        self.assertEqual(first,second)
        self.assertEqual(self.calls,1)
        self.assertEqual(self.store.serve_bytes(self.key,first['manifest_sha256']),first['manifest_bytes'])
        self.assertFalse(first['completed_onchain'])
        self.assertIsNone(first['manifest_keccak256'])

    def test_stale_and_wallet_mismatch_stop(self):
        original = copy.deepcopy(self.snapshot)
        for change in [{'block_timestamp':self.now-61},{'wallet_address':'0x'+'6'*40},
                       {'checked_at':'2000-01-01T00:00:00+00:00'},{'chain_id':56}]:
            self.snapshot = {**original,**change}
            with self.assertRaises(ValueError):self.worker.process(self.key)
            self.assertIsNone(self.store.get(self.key))

    def test_need_evidence_is_preserved_without_completion(self):
        self.snapshot['markets_complete'] = False
        result = self.worker.process(self.key)
        receipt = json.loads(result['receipt_bytes'])
        self.assertEqual(receipt['decision'],'NEED_EVIDENCE')
        self.assertTrue(verify_receipt(receipt))
        self.assertFalse(result['completed_onchain'])

    def test_conflict_and_corruption_never_recompute(self):
        result = self.worker.process(self.key)
        with self.assertRaises(ValueError):self.store.persist(self.key,b'changed',result['manifest_bytes'])
        with self.assertRaises(sqlite3.IntegrityError):
            with self.store.db:self.store.db.execute('UPDATE deliveries SET manifest=? WHERE job_key=?',(b'corrupt',self.key))
        # Offline corruption fixture deliberately bypasses the append-only guard.
        with self.store.db:
            self.store.db.execute('DROP TRIGGER delivery_no_update')
            self.store.db.execute('UPDATE deliveries SET manifest=? WHERE job_key=?',(b'corrupt',self.key))
        with self.assertRaises(ValueError):self.worker.process(self.key)
        self.assertEqual(self.calls,1)

    def test_unknown_job_and_bad_clock_stop(self):
        with self.assertRaises(ValueError):self.worker.process('unknown')
        for now in [True,self.now-10,float('nan')]:
            with self.assertRaises(ValueError):self.worker.process(self.key,now=now)
        self.assertEqual(self.calls,0)

    def test_unicode_and_hash_validation(self):
        self.assertEqual(canonical_bytes({'z':'ação','a':1}),b'{"a":1,"z":"a\\u00e7\\u00e3o"}')
        result = self.worker.process(self.key)
        self.assertEqual(result['receipt_sha256'],hashlib.sha256(result['receipt_bytes']).hexdigest())
        for digest in ['../escape','0'*64,result['receipt_sha256']]:
            with self.assertRaises(ValueError):self.store.serve_bytes(self.key,digest)

    def test_expiry_during_assessment_stops_before_persistence(self):
        def slow_assess(snapshot, **kwargs):
            receipt = assess(snapshot, **kwargs)
            self.now += 101
            return receipt
        self.worker.assess = slow_assess
        with self.assertRaises(ValueError):self.worker.process(self.key)
        self.assertIsNone(self.store.get(self.key))

    def test_untrusted_collector_and_receipt_binding(self):
        self.snapshot['source_kind'] = 'OBSERVED'
        record = self.worker.process(self.key)
        self.assertEqual(json.loads(record['receipt_bytes'])['evidence_kind'],'SUPPLIED_UNVERIFIED')

    def test_malformed_snapshot_and_foreign_receipt_stop(self):
        self.snapshot['checked_at'] = None
        with self.assertRaises(ValueError):self.worker.process(self.key)
        self.snapshot['checked_at'] = dt.datetime.fromtimestamp(self.now,dt.timezone.utc).isoformat()
        self.worker.assess = lambda _snapshot,**_kwargs:assess(fixture('hold'))
        with self.assertRaises(ValueError):self.worker.process(self.key)
        self.assertIsNone(self.store.get(self.key))


if __name__ == '__main__':unittest.main()
