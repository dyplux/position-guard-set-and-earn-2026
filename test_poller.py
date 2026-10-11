import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from unittest.mock import patch
from types import SimpleNamespace

from marketplace.poller import (COMMERCE, PROVIDER, Poller, PollDB, ReorgStop,
                                ScanUnavailable, _validate_scan)


def event(job=7, block=10, tx="a", bh="b"):
    return {"job_id": job, "tx_hash": "0x" + tx * 64, "log_index": 0,
            "block_number": block, "block_hash": "0x" + bh * 64}


def scan(events=None, previous=None, to=10):
    return {"status": "SCANNED", "attested": True, "synthetic": False,
            "chain_id": 97, "deployment": COMMERCE, "provider": PROVIDER,
            "from_block": 1, "to_block": to, "previous_hash": previous or "0x" + "1" * 64,
            "to_hash": "0x" + "2" * 64, "events": events or []}


class PollerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = self.tmp.name + "/state"
        os.mkdir(self.state, 0o700)
        self.responses = [scan([event()])]

    def tearDown(self):
        self.tmp.cleanup()

    def runner(self, args, **kwargs):
        return SimpleNamespace(returncode=0, stdout=json.dumps(self.responses.pop(0)))

    def test_atomic_queue_and_cursor(self):
        p = Poller(self.state, "/usr/bin/node", runner=self.runner, run_job=lambda *a: {"state": "DELIVERABLE_PERSISTED","execution_enabled":False,"completed_onchain":False})
        p.db.initialize(1)
        result = p.once()
        self.assertEqual(result["next_block"], 11)
        row = p.db.db.execute("SELECT state FROM queue WHERE job_id=7").fetchone()
        self.assertEqual(row[0], "DELIVERABLE_PERSISTED")
        self.assertEqual(p.db.db.execute("SELECT block_number,block_hash FROM queue WHERE job_id=7").fetchone(),(10,"0x"+"b"*64))
        p.close()

    def test_restart_replays_processing_job(self):
        calls = []
        p = Poller(self.state, "/usr/bin/node", runner=self.runner, run_job=lambda *a: calls.append(a[0]) or {"state": "DELIVERABLE_PERSISTED","execution_enabled":False,"completed_onchain":False})
        p.db.initialize(1); p.once(); p.close()
        # Simulate a crash after durable PROCESSING.
        db = sqlite3.connect(self.state + "/poll.sqlite")
        db.execute("UPDATE queue SET state='PROCESSING'"); db.commit(); db.close()
        p = Poller(self.state, "/usr/bin/node", runner=lambda *a, **k: SimpleNamespace(returncode=0, stdout=json.dumps({"status":"WAIT_CONFIRMATIONS","attested":True,"synthetic":False,"chain_id":97,"deployment":COMMERCE,"provider":PROVIDER,"from_block":11,"previous_hash":"0x"+"2"*64,"events":[]})), run_job=lambda *a: calls.append(a[0]) or {"state":"DELIVERABLE_PERSISTED","execution_enabled":False,"completed_onchain":False})
        # PROCESSING is replayed with the same immutable job id after a crash.
        p.db.initialize(1)
        self.assertEqual(p.db.next_job(0)[0], 7)
        self.assertEqual(p.once()["processed"],"DELIVERABLE_PERSISTED")
        self.assertEqual(calls,[7,7])
        p.close()

    def test_forged_and_provenance_conflict_pause(self):
        with self.assertRaises(ScanUnavailable):
            _validate_scan({**scan([event()]), "chain_id": 56}, 1, None)
        db = PollDB(self.state + "/x.sqlite"); db.initialize(1)
        db.scan_commit(scan([event()]), 1)
        with self.assertRaises(ReorgStop):
            db.scan_commit(scan([event(tx="c")]), 2)
        self.assertEqual(db.checkpoint()[0], 11)
        db.close()

    def test_bounds_and_backpressure(self):
        with self.assertRaises(ScanUnavailable):
            _validate_scan({**scan([event()]), "events": [event()] * 65}, 1, None)
        db = PollDB(self.state + "/x.sqlite"); db.initialize(1)
        db.db.executemany("INSERT INTO queue(job_id,tx_hash,log_index,block_number,block_hash,state,payload,updated) VALUES (?,?,?,?,?,?,?,?)",
                          [(i, "0x"+"a"*64, 0, 1, "0x"+"b"*64, "DISCOVERED", "{}", 1) for i in range(1,257)])
        with self.assertRaises(ScanUnavailable): db.scan_commit(scan([event(300)]), 1)
        db.close()

    def test_retry_does_not_move_scan_cursor(self):
        p = Poller(self.state, "/usr/bin/node", runner=self.runner, run_job=lambda *a: (_ for _ in ()).throw(OSError()))
        p.db.initialize(1); result = p.once()
        self.assertEqual(result["next_block"], 11)
        self.assertEqual(p.db.db.execute("SELECT state,attempts FROM queue").fetchone(), ("RETRY", 1))
        p.close()

    def test_real_reader_exit_one_reorg_pauses_durably(self):
        p=Poller(self.state,"/usr/bin/node",runner=lambda *a,**k:SimpleNamespace(returncode=1,stdout='{"status":"REORG_STOP"}'))
        p.db.initialize(1)
        with self.assertRaises(ReorgStop):p.once()
        self.assertTrue(p.db.paused());self.assertEqual(p.db.checkpoint()[0],1)
        p.close()

    def test_unavailable_rpc_and_unknown_worker_result_do_not_claim_delivery(self):
        p=Poller(self.state,"/usr/bin/node",runner=lambda *a,**k:SimpleNamespace(returncode=1,stdout='{"status":"SCAN_UNAVAILABLE"}'))
        p.db.initialize(1)
        with self.assertRaises(ScanUnavailable):p.once()
        self.assertEqual(p.db.checkpoint()[0],1);self.assertFalse(p.db.paused())
        p.runner=self.runner;p.run_job=lambda *a:{"state":"OK"}
        self.assertEqual(p.once()["processed"],"RETRY")
        p.close()

    def test_scan_only_queues_without_collecting_and_replay_does_not_duplicate(self):
        p=Poller(self.state,"/usr/bin/node",runner=self.runner,run_job=lambda *a:self.fail("scan-only mustn't collect"))
        p.db.initialize(1)
        self.assertIsNone(p.once(process=False)["processed"])
        self.assertEqual(p.db.db.execute("SELECT state FROM queue").fetchone()[0],"DISCOVERED")
        p.db.scan_commit(scan([event()]),2)
        self.assertEqual(p.db.db.execute("SELECT count(*) FROM queue").fetchone()[0],1)
        p.close()

    def test_three_read_failures_terminalize_without_economic_dispatch(self):
        stamp=[1]
        response=scan([event()])
        p=Poller(self.state,"/usr/bin/node",runner=lambda *a,**k:SimpleNamespace(returncode=0,stdout=json.dumps(response)),
            run_job=lambda *a:(_ for _ in ()).throw(OSError()),clock=lambda:stamp[0])
        p.db.initialize(1);p.once()
        response.update(status="WAIT_CONFIRMATIONS",from_block=11,previous_hash="0x"+"2"*64,events=[])
        stamp[0]=100;p.once();stamp[0]=200;p.once()
        self.assertEqual(p.db.db.execute("SELECT state,attempts FROM queue").fetchone(),("FAILED",3))
        p.close()

    def test_claimed_status_and_economic_worker_flags_are_not_success(self):
        p=Poller(self.state,"/usr/bin/node",runner=self.runner,run_job=lambda *a:{"status":"DELIVERABLE_PERSISTED"})
        p.db.initialize(1);self.assertEqual(p.once()["processed"],"RETRY");p.close()

    def test_cli_preparation_is_explicit_and_does_not_enable_publication(self):
        from marketplace.poller import main
        from marketplace.fulfilment import prepare_fulfilment
        args = ["--state-dir", self.state, "--node", "/usr/bin/node", "--start-block", "1"]
        with patch("marketplace.poller.Poller") as factory, redirect_stdout(StringIO()):
            factory.return_value.once.return_value = {"status": "WAIT_CONFIRMATIONS"}
            self.assertEqual(main(args), 0)
            self.assertNotIn("run_job", factory.call_args.kwargs)
            self.assertEqual(main(args + ["--prepare-delivery"]), 0)
            self.assertIs(factory.call_args.kwargs["run_job"], prepare_fulfilment)
            factory.return_value.once.assert_called_with(process=True)

    def test_cli_scan_only_and_preparation_cannot_be_combined(self):
        from marketplace.poller import main
        args = ["--state-dir", self.state, "--node", "/usr/bin/node", "--start-block", "1",
                "--scan-only", "--prepare-delivery"]
        with patch("marketplace.poller.Poller") as factory, redirect_stderr(StringIO()):
            with self.assertRaises(SystemExit) as error:
                main(args)
            self.assertEqual(error.exception.code, 2)
            factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
