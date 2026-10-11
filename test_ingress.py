import copy
import json
import tempfile
import unittest
from pathlib import Path
from marketplace.ingress import PokterIngress
from marketplace.pokter import COMMERCE,PROVIDER,CURRENCY


class IngressTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=str(Path(self.tmp.name)/'jobs.sqlite');self.now=2000000000
        digest='0x'+'a'*64;sig='0x'+'b'*130;task='Assess Venus wallet 0x'+'1'*40
        envelope={'protocol':'pokter-job','version':1,'identity':{'chainId':97,'tokenId':'2583'},
            'provider':PROVIDER,'category':'health-factor','task':task,'quote':{'negotiationHash':digest,'providerSignature':sig}}
        self.observation={'attested':True,'synthetic':False,'source_kind':'OBSERVED','funding_verified':True,'agent_id':2583,'chain_id':97,'deployment':COMMERCE,
            'job':{'id':'7','client':'0x'+'2'*40,'provider':PROVIDER,'evaluator':'0x'+'3'*40,'hook':'0x'+'3'*40,
                   'statusName':'FUNDED','status':1,'budget':'100','expiredAt':str(self.now+900),'description':json.dumps(envelope),'submittedAt':'0','deliverable':'0x'+'0'*64},
            'funding':{'chain_id':97,'deployment':COMMERCE,'block_timestamp':self.now},
            'verified_quote':{'verified_at_funding':True,'envelope':{'negotiation_hash':digest,'provider_sig':sig,
                'request':{'task_description':task},'chain_id':97,'verifying_contract':COMMERCE,'response':{'terms':{'currency':CURRENCY,'price':'100'}}}}}
        self.ingress=PokterIngress(store_path=self.path,read_verified_job=lambda _:copy.deepcopy(self.observation))

    def tearDown(self):self.ingress.close();self.tmp.cleanup()

    def test_replay_then_advanced_state_reconciles_without_duplicate(self):
        first=self.ingress.ingest(7,now=self.now);self.assertEqual(first,self.ingress.ingest(7,now=self.now))
        self.observation['job'].update(statusName='SUBMITTED',status=2,submittedAt=str(self.now+1),deliverable='0x'+'c'*64)
        result=self.ingress.ingest(7,now=self.now+2)
        self.assertEqual(result['state'],'RECONCILIATION_REQUIRED');self.assertFalse(result['completed_onchain'])
        self.assertEqual(self.ingress.db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)

    def test_unknown_quote_and_conflicting_task_are_rejected(self):
        self.ingress.ingest(7,now=self.now)
        self.observation['verified_quote']['verified_at_funding']=False
        with self.assertRaises(ValueError):self.ingress.ingest(7,now=self.now)
        self.observation['verified_quote']['verified_at_funding']=True;self.observation['job']['budget']='101'
        with self.assertRaises(ValueError):self.ingress.ingest(7,now=self.now)

    def test_synthetic_requires_explicit_local_harness(self):
        self.observation.update(attested=False,synthetic=True,source_kind='SYNTHETIC')
        with self.assertRaises(ValueError):self.ingress.ingest(7,now=self.now)
        self.ingress.close();self.ingress=PokterIngress(store_path=self.path,read_verified_job=lambda _:self.observation,allow_synthetic=True)
        self.assertTrue(self.ingress.ingest(7,now=self.now)['synthetic'])

    def test_clock_and_expiry_fail(self):
        for value in [True,7.5,'7',-1]:
            with self.assertRaises(ValueError):self.ingress.ingest(value,now=self.now)
        with self.assertRaises(ValueError):self.ingress.ingest(7,now=self.now+900)


if __name__=='__main__':unittest.main()
