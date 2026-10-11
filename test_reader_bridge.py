import json
import unittest
from types import SimpleNamespace
from marketplace.reader_bridge import FundingReader


class ReaderBridgeTests(unittest.TestCase):
    def test_only_archived_quote_enters_verifier_over_stdin(self):
        calls=[];envelope={'negotiation_hash':'0x'+'a'*64,'provider_sig':'0x'+'b'*130}
        def runner(argv,**kwargs):
            calls.append((argv,json.loads(kwargs['input'])))
            body={'quote_hash':envelope['negotiation_hash']} if len(calls)==1 else {'attested':True,'funding_verified':True}
            return SimpleNamespace(returncode=0,stdout=json.dumps(body),stderr='')
        store=SimpleNamespace(get=lambda _:envelope)
        result=FundingReader(quote_store=store,runner=runner).read(7)
        self.assertTrue(result['attested']);self.assertEqual(calls[1][1]['envelope'],envelope)
        self.assertNotIn(envelope['provider_sig'],' '.join(calls[1][0]))
        self.assertEqual(set(calls[1][1]),{'mode','job_id','envelope'})

    def test_missing_quote_and_failed_reader_stop(self):
        store=SimpleNamespace(get=lambda _:None)
        runner=lambda *_args,**_kwargs:SimpleNamespace(returncode=0,stdout='{"quote_hash":"0x'+ 'a'*64+'"}',stderr='')
        with self.assertRaises(ValueError):FundingReader(quote_store=store,runner=runner).read(7)
        failed=lambda *_args,**_kwargs:SimpleNamespace(returncode=1,stdout='',stderr='private detail')
        with self.assertRaisesRegex(ValueError,'UNAVAILABLE'):FundingReader(quote_store=store,runner=failed).read(7)
        for job in [True,'7',-1]:
            with self.assertRaises(ValueError):FundingReader(quote_store=store,runner=failed).read(job)


if __name__=='__main__':unittest.main()
