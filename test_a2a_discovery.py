import unittest
from types import SimpleNamespace
from server import Handler, fixture


class DiscoveryTests(unittest.TestCase):
    def handler(self, path):
        handler = object.__new__(Handler)
        handler.path = path
        handler.server = SimpleNamespace(public_origin='https://positionguard.dyplux.com',server_port=8952)
        handler.authorize = lambda:True
        handler.captured = {}
        handler.send_json = lambda status,value:handler.captured.update(status=status,value=value)
        return handler

    def test_cards_resolve_at_all_marketplace_locations(self):
        cards=[]
        for path in ['/.well-known/agent-card.json','/a2a','/a2a/.well-known/agent-card.json']:
            handler=self.handler(path);handler.do_GET()
            self.assertEqual(handler.captured['status'],200)
            cards.append(handler.captured['value'])
        self.assertEqual(cards[0],cards[1]);self.assertEqual(cards[1],cards[2])
        self.assertEqual(cards[0]['category'],'health_factor')

    def test_data_assessment_returns_data_without_execution(self):
        handler=self.handler('/a2a')
        handler.read_payload=lambda:{'jsonrpc':'2.0','id':7,'method':'message/send',
            'params':{'message':{'role':'user','parts':[{'kind':'data','data':{
                'skill':'assess_venus_position','wallet':'0x'+'1'*40,'chain_id':97}}]}}}
        handler.observe=lambda _:fixture('hold')
        handler.do_POST()
        receipt=handler.captured['value']['result']['parts'][0]['data']
        self.assertEqual(receipt['decision'],'HOLD');self.assertFalse(receipt['execution_enabled'])

    def test_unconfigured_negotiation_never_claims_acceptance(self):
        handler=self.handler('/a2a');calls=[]
        handler.read_payload=lambda:{'jsonrpc':'2.0','id':7,'method':'message/send',
            'params':{'message':{'parts':[{'kind':'data','data':{'skill':'negotiate'}}]}}}
        handler.observe=lambda _:calls.append('unexpected')
        handler.do_POST()
        self.assertIn('error',handler.captured['value']);self.assertEqual(calls,[])


if __name__ == '__main__':unittest.main()
