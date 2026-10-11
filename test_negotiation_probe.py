import contextlib
import hashlib
import io
import unittest
from types import SimpleNamespace
from server import Handler


class NegotiationProbeTests(unittest.TestCase):
    def handler(self, enabled=False):
        handler = object.__new__(Handler)
        handler.authorize = lambda: True
        handler.server = SimpleNamespace(negotiation_probe=enabled, public_origin="https://guard.example")
        self.responses = []
        handler.send_json = lambda status, value: self.responses.append((status, value))
        return handler

    def test_skill_default_hidden_and_probe_explicitly_unavailable(self):
        for enabled in [False, True]:
            handler = self.handler(enabled); handler.path = "/a2a"
            handler.do_GET()
            skills = self.responses[-1][1]["skills"]
            self.assertEqual(any(s["id"] == "negotiate" for s in skills), enabled)
            if enabled: self.assertIn("Paid quotes are disabled", skills[-1]["description"])

    def test_marketplace_style_request_declines_without_collector_or_signature(self):
        handler = self.handler(True); handler.path = "/a2a"
        task = "Integration check for Venus wallet 0x" + "1" * 40
        handler.read_payload = lambda: {"jsonrpc": "2.0", "id": "marketplace-probe", "method": "message/send",
            "params": {"message": {"role": "user", "parts": [{"kind": "data", "data": {
                "skill": "negotiate", "task_description": task, "terms": {"deliverables": "assessment"}}}]}}}
        handler.observe = lambda _: self.fail("a declined quote mustn't collect")
        output = io.StringIO()
        with contextlib.redirect_stdout(output): handler.do_POST()
        response = self.responses[-1][1]["result"]["parts"][0]["data"]
        self.assertFalse(response["response"]["accepted"])
        self.assertEqual(response["response"]["reason"], "PAID_SERVICE_NOT_READY")
        self.assertNotIn("provider_sig", response)
        self.assertIn(hashlib.sha256(task.encode()).hexdigest(), output.getvalue())
        self.assertNotIn(task, output.getvalue())


if __name__ == "__main__": unittest.main()
