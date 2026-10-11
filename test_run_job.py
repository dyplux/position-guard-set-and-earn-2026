import contextlib
import copy
import datetime as dt
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from marketplace.run_job import WorkerBusy, _run_job, _worker_lock, main
from marketplace.pokter import COMMERCE, PROVIDER, CURRENCY
from policy import assess, verify_receipt
from server import fixture


class RunJobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)
        self.state.chmod(0o700)
        self.now = 2000000000
        self.calls, self.reads = [], []
        digest, signature = '0x'+'a'*64, '0x'+'b'*130
        task = 'Assess Venus testnet wallet 0x'+'1'*40
        description = {'protocol':'pokter-job','version':1,'identity':{'chainId':97,'tokenId':'2583'},
            'provider':PROVIDER,'category':'health-factor','task':task,
            'quote':{'negotiationHash':digest,'providerSignature':signature}}
        self.observed = {'attested':True,'synthetic':False,'source_kind':'OBSERVED',
            'funding_verified':True,'agent_id':2583,'chain_id':97,'deployment':COMMERCE,
            'job':{'id':'7','client':'0x'+'2'*40,'provider':PROVIDER,'evaluator':'0x'+'3'*40,
                'hook':'0x'+'3'*40,'statusName':'FUNDED','status':1,'budget':'100',
                'expiredAt':str(self.now+900),'description':json.dumps(description),
                'submittedAt':'0','deliverable':'0x'+'0'*64},
            'funding':{'chain_id':97,'deployment':COMMERCE,'block_timestamp':self.now},
            'verified_quote':{'verified_at_funding':True,'envelope':{'negotiation_hash':digest,
                'provider_sig':signature,'request':{'task_description':task},'chain_id':97,
                'verifying_contract':COMMERCE,'response':{'terms':{'currency':CURRENCY,'price':'100'}}}}}
        # Only the external RPC boundary is replaced; ingress/store/worker/policy are real.
        outer = self
        class Reader:
            def __init__(self, **_): pass
            def read(self, job_id):
                outer.reads.append(job_id)
                return copy.deepcopy(outer.observed)
        self.reader_cls = Reader

    def tearDown(self):
        self.tmp.cleanup()

    def collect(self, wallet):
        self.calls.append(wallet)
        snapshot = fixture('hold')
        snapshot.update(wallet_address=wallet,block_timestamp=self.now,
            checked_at=dt.datetime.fromtimestamp(self.now,dt.timezone.utc).isoformat().replace('+00:00','Z'))
        return snapshot

    def run_job(self):
        return _run_job(7,str(self.state),'/absolute/node',reader_cls=self.reader_cls,
            collector_fn=self.collect,assess_fn=assess,verify_receipt_fn=verify_receipt,
            clock_fn=lambda:self.now)

    def test_replay_revalidates_rpc_and_preserves_exact_persisted_bytes(self):
        first, second = self.run_job(), self.run_job()
        self.assertEqual(first['receipt_bytes'],second['receipt_bytes'])
        self.assertEqual(first['manifest_bytes'],second['manifest_bytes'])
        self.assertEqual(json.loads(first['receipt_bytes'])['decision'],'HOLD')
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.reads,[7,7])
        self.assertFalse(first['completed_onchain'])

    def test_forged_or_unfunded_never_collects(self):
        original = copy.deepcopy(self.observed)
        for changes in [{'attested':False},{'synthetic':True},
                        {'job':{**original['job'],'statusName':'OPEN','status':0}}]:
            self.observed = {**original,**changes}
            with self.assertRaises(ValueError): self.run_job()
        self.assertEqual(self.calls,[])

    def test_advanced_job_requires_reconciliation_without_collection(self):
        self.run_job()
        self.observed['job'].update(statusName='SUBMITTED',status=2)
        result = self.run_job()
        self.assertEqual(result['state'],'RECONCILIATION_REQUIRED')
        self.assertFalse(result['completed_onchain'])
        self.assertEqual(len(self.calls),1)

    def test_lock_and_unsafe_paths_stop_before_rpc(self):
        with _worker_lock(str(self.state/'worker.lock')):
            with self.assertRaises(WorkerBusy): self.run_job()
        self.assertEqual(self.reads,[])
        (self.state/'quotes.sqlite').unlink()
        (self.state/'quotes.sqlite').symlink_to('/tmp/nonexistent-quote-file')
        with self.assertRaises(ValueError): self.run_job()
        self.state.chmod(0o755)
        with self.assertRaises(ValueError): self.run_job()
        self.assertEqual(self.reads,[])

    def test_cli_error_is_sanitized(self):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = main(['--job-id','7','--state-dir',str(self.state),'--node','relative'])
        self.assertEqual(code,1)
        self.assertEqual(json.loads(stream.getvalue()),{'status':'RUN_JOB_STOP',
            'execution_enabled':False,'completed_onchain':False})


if __name__ == '__main__': unittest.main()
