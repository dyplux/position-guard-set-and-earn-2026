import contextlib
import io
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from server import Handler, main
from marketplace.service_terms import DELIVERABLES, QUALITY


TASK = "Assess Venus Core testnet position for wallet 0x1111111111111111111111111111111111111111. I consent to public JSON delivery retained for 45 days."


class PreissuedServerTests(unittest.TestCase):
    def handler(self, negotiator):
        handler = object.__new__(Handler)
        handler.authorize = lambda: True
        handler.server = SimpleNamespace(preissued_negotiator=negotiator, negotiation_probe=False,
            public_origin="https://guard.example", observation_slot=threading.BoundedSemaphore(1))
        handler.path = "/a2a"
        handler.observe = lambda _: self.fail("a quote request mustn't collect a position")
        self.responses = []
        handler.send_json = lambda status, value: self.responses.append((status, value))
        handler.read_payload = lambda: {"jsonrpc": "2.0", "id": "q", "method": "message/send",
            "params": {"message": {"parts": [{"kind": "data", "data": {"skill": "negotiate",
                "task_description": TASK, "terms": {"deliverables": DELIVERABLES,
                "quality_standards": QUALITY}}}]}}}
        return handler

    def test_exact_verified_envelope_is_returned_without_logging(self):
        envelope = {"request": {"task_description": TASK}, "response": {"accepted": True},
                    "provider_sig": "SYNTHETIC_VERIFIER_FIXTURE_NOT_SIGNATURE"}
        handler = self.handler(lambda _: envelope)
        output = io.StringIO()
        with contextlib.redirect_stdout(output): handler.do_POST()
        self.assertEqual(self.responses[-1][1]["result"]["parts"][0]["data"], envelope)
        self.assertEqual(output.getvalue(), "")
        self.assertTrue(handler.server.observation_slot.acquire(blocking=False))
        handler.server.observation_slot.release()

    def test_unavailable_or_busy_declines_without_signature_or_collection(self):
        def unavailable(_): raise ValueError("SECRET_DETAILS_MUST_NOT_LEAK")
        handler = self.handler(unavailable)
        handler.do_POST()
        body = self.responses[-1][1]["result"]["parts"][0]["data"]
        self.assertFalse(body["response"]["accepted"])
        self.assertNotIn("provider_sig", body)
        self.assertNotIn("SECRET", str(body))
        calls = []
        handler.server.preissued_negotiator = lambda request: calls.append(request)
        handler.server.observation_slot.acquire()
        handler.do_POST()
        self.assertEqual(calls, [])
        handler.server.observation_slot.release()

    def test_card_names_preissued_mode_without_claiming_runtime_signing(self):
        handler = self.handler(lambda _: None)
        handler.do_GET()
        skill = self.responses[-1][1]["skills"][-1]
        self.assertEqual(skill["id"], "negotiate")
        self.assertIn("No runtime signing", skill["description"])

    def test_cli_requires_complete_opt_in_and_rejects_mode_conflict(self):
        for args in [["--preissued-quote-file", "/private/offer.json"],
                     ["--quote-verifier-node", "/usr/bin/node"],
                     ["--preissued-quote-file", "/private/offer.json", "--quote-verifier-node", "/usr/bin/node",
                      "--negotiation-probe"]]:
            with patch("server.BoundedHTTPServer") as factory, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit): main(args)
                factory.assert_not_called()

    def test_node_service_profile_matches_python_terms(self):
        import json
        from pathlib import Path
        profile = json.loads((Path(__file__).parent / "marketplace/service_profile.json").read_text())
        self.assertEqual(profile, {"deliverables": DELIVERABLES, "quality_standards": QUALITY})


if __name__ == "__main__":
    unittest.main()
