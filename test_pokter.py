import copy
import json
import unittest
from marketplace.pokter import bind_pokter_job,PROVIDER,COMMERCE,CURRENCY


class PokterTests(unittest.TestCase):
    def setUp(self):
        self.task='Assess Venus wallet 0x'+'1'*40+' without moving funds.'
        self.hash='0x'+'a'*64;self.sig='0x'+'b'*130
        self.envelope={'protocol':'pokter-job','version':1,'identity':{'chainId':97,'tokenId':'2583'},
            'provider':PROVIDER,'category':'health-factor','task':self.task,
            'quote':{'negotiationHash':self.hash,'providerSignature':self.sig}}
        self.job={'attested':True,'synthetic':True,'chain_id':97,'deployment':COMMERCE,
                  'job':{'statusName':'FUNDED','provider':PROVIDER,'budget':'100','description':json.dumps(self.envelope)}}
        self.quote={'verified_at_funding':True,'envelope':{'negotiation_hash':self.hash,'provider_sig':self.sig,
            'request':{'task_description':self.task},'chain_id':97,'verifying_contract':COMMERCE,
            'response':{'terms':{'currency':CURRENCY,'price':'100'}}}}

    def test_valid_envelope_binds_only_assessment(self):
        result=bind_pokter_job(self.job,quote_lookup=lambda _:self.quote)
        self.assertEqual(result['wallet'],'0x'+'1'*40);self.assertFalse(result['execution_enabled'])

    def test_wrong_identity_quote_and_budget_stop(self):
        for change in [{'identity':{'chainId':97,'tokenId':'2574'}},{'task':'Different task'},
                       {'provider':'0x'+'2'*40}]:
            observed=copy.deepcopy(self.job);observed['job']['description']=json.dumps({**self.envelope,**change})
            with self.assertRaises(ValueError):bind_pokter_job(observed,quote_lookup=lambda _:self.quote)
        self.job['job']['budget']='101'
        with self.assertRaises(ValueError):bind_pokter_job(self.job,quote_lookup=lambda _:self.quote)

    def test_unverified_readers_never_ingest_paid_job(self):
        with self.assertRaises(ValueError):bind_pokter_job(self.job,quote_lookup=lambda _:None)
        self.quote['verified_at_funding']=False
        with self.assertRaises(ValueError):bind_pokter_job(self.job,quote_lookup=lambda _:self.quote)

    def test_malformed_json_and_types_fail_closed(self):
        for bad in [None,{}, {'attested':True,'chain_id':97,'deployment':COMMERCE,'job':None}]:
            with self.assertRaises(ValueError):bind_pokter_job(bad,quote_lookup=lambda _:self.quote)
        self.job['job']['description']='not-json'
        with self.assertRaises(ValueError):bind_pokter_job(self.job,quote_lookup=lambda _:self.quote)
        self.job['attested']=False
        with self.assertRaises(ValueError):bind_pokter_job(self.job,quote_lookup=lambda _:self.quote)


if __name__=='__main__':unittest.main()
