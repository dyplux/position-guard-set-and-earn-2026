import copy
import json
import tempfile
import unittest
from pathlib import Path
from marketplace.atlas_bridge import AtlasBridge


class AtlasBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'jobs.sqlite')
        self.provider = '0x' + '1' * 40
        self.deployment = '0x' + '2' * 40
        self.observation = {'attested': True, 'synthetic': True, 'chain_id': 97, 'agent_id': 2583,
                            'deployment': self.deployment, 'block_hash': '0x' + '3' * 64,
                            'job': {'id': '7', 'provider': self.provider, 'client': '0x' + '4' * 40,
                                    'statusName': 'FUNDED', 'budget': '100', 'expiredAt': '1000',
                                    'description': json.dumps({'task': 'assess_venus_position',
                                                              'chain_id': 97, 'wallet': self.provider})}}
        self.bridge = self.open_bridge()
        self.request = {'jsonrpc': '2.0', 'id': 'request-1', 'method': 'message/send',
                        'params': {'message': {'role': 'user', 'messageId': 'test',
                                              'parts': [{'kind': 'data', 'data': {'skill': 'notify_funded', 'job_id': 7}}]}}}

    def open_bridge(self):
        return AtlasBridge(read_verified_job=lambda _: copy.deepcopy(self.observation),
                           provider=self.provider, deployment=self.deployment, store_path=self.path)

    def tearDown(self):
        self.bridge.close()
        self.tmp.cleanup()

    def test_restart_and_replay_do_not_duplicate(self):
        first = self.bridge.handle(self.request, now=100)
        self.assertEqual(first['result']['parts'][0]['data']['status'], 'recorded')
        self.bridge.close()
        self.bridge = self.open_bridge()
        self.assertEqual(first, self.bridge.handle(self.request, now=101))
        self.assertEqual(self.bridge.db.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_binding_and_funding_gates(self):
        original = copy.deepcopy(self.observation)
        for field, value in [('attested', False), ('chain_id', 56), ('agent_id', 2574), ('deployment', self.provider)]:
            self.observation = {**original, field: value}
            self.assertIn('error', self.bridge.handle(self.request, now=100))
        for field, value in [('provider', self.deployment), ('budget', '0'), ('expiredAt', '100'),
                             ('id', '8'), ('statusName', 'SUBMITTED'), ('description', '{}')]:
            self.observation = {**original, 'job': {**original['job'], field: value}}
            self.assertIn('error', self.bridge.handle(self.request, now=100))

    def test_conflict_and_forged_payload_fail(self):
        self.bridge.handle(self.request, now=100)
        self.observation['job']['budget'] = '101'
        self.assertIn('error', self.bridge.handle(self.request, now=100))
        for job_id in [True, 2**53, '7', -1]:
            self.request['params']['message']['parts'][0]['data']['job_id'] = job_id
            self.assertIn('error', self.bridge.handle(self.request, now=100))

    def test_quote_has_no_signing_fallback(self):
        self.request['params']['message']['parts'][0]['data'] = {'skill': 'negotiate'}
        self.assertIn('error', self.bridge.handle(self.request, now=100))

    def test_malformed_and_invalid_clock_are_sanitized(self):
        for request in [[], None, {}, {'jsonrpc': '2.0', 'method': 'message/send',
                                     'params': {'message': {'role': 'user', 'parts': []}}}]:
            self.assertIn('error', self.bridge.handle(request, now=100))
        for now in [True, float('nan'), -1, '100', 2**63]:
            self.assertIn('error', self.bridge.handle(self.request, now=now))
        self.request['padding'] = 'x' * 32769
        self.assertIn('error', self.bridge.handle(self.request, now=100))

    def test_structured_task_inside_atlas_quote(self):
        task = self.observation['job']['description']
        self.observation['job']['description'] = json.dumps({'task': task, 'chain_id': 97})
        self.assertIn('result', self.bridge.handle(self.request, now=100))

    def test_lossy_reader_values_are_rejected(self):
        original = copy.deepcopy(self.observation)
        for field, value in [('id', 7.9), ('budget', True), ('expiredAt', 1000.9),
                             ('budget', '01'), ('provider', 'not-an-address'), ('client', 'wrong')]:
            self.observation = {**original, 'job': {**original['job'], field: value}}
            self.assertIn('error', self.bridge.handle(self.request, now=100))


if __name__ == '__main__':
    unittest.main()
