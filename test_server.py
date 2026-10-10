import subprocess
import tempfile
import threading
from pathlib import Path
import unittest
from email.message import Message
from types import SimpleNamespace
from unittest import mock

import server


class PublicConfigTests(unittest.TestCase):
    def test_accepts_exact_https_origin(self):
        self.assertEqual(server.validate_public_origin("https://guard.example"), "https://guard.example")

    def test_rejects_non_exact_origins(self):
        bad = ["http://guard.example", "https://guard.example/", "https://guard.example/path",
               "https://user@guard.example", "https://guard.example:8443", "https://guard.example?q=1",
               "https://guard.example#x", "https://guard.example?", "https://guard.example#",
               "https://GUARD.example"]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(ValueError):
                server.validate_public_origin(value)


class HostSecurityTests(unittest.TestCase):
    def handler(self, host, origin=None, forwarded=None):
        headers = Message()
        headers["Host"] = host
        if origin is not None:
            headers["Origin"] = origin
        if forwarded is not None:
            headers["X-Forwarded-Host"] = forwarded
            headers["X-Forwarded-Proto"] = "https"
        handler = object.__new__(server.Handler)
        handler.headers = headers
        handler.server = SimpleNamespace(public_origin="https://guard.example",
                                         public_hostname="guard.example")
        return handler

    def test_public_host_and_origin_are_exact(self):
        self.assertTrue(self.handler("guard.example").allowed())
        self.assertTrue(self.handler("guard.example", "https://guard.example").allowed())
        self.assertFalse(self.handler("guard.example:443", "https://guard.example").allowed())
        self.assertFalse(self.handler("evil.example", "https://guard.example").allowed())
        self.assertFalse(self.handler("guard.example", "https://evil.example").allowed())
        duplicate = self.handler("guard.example")
        duplicate.headers["Host"] = "guard.example"
        self.assertFalse(duplicate.allowed())

    def test_forwarded_headers_cannot_grant_access(self):
        self.assertFalse(self.handler("127.0.0.1:8951", forwarded="guard.example").allowed())

    def test_local_policy_is_unchanged(self):
        handler = self.handler("localhost:8951", "http://localhost:8951")
        handler.server = SimpleNamespace(public_origin=None, server_port=8951)
        self.assertTrue(handler.allowed())


class RequestSecurityTests(unittest.TestCase):
    def request_handler(self, pairs):
        handler = object.__new__(server.Handler)
        headers = Message()
        for key, value in pairs:
            headers[key] = value
        handler.headers = headers
        return handler

    def test_rejects_transfer_encoding_and_body_conflict(self):
        handler = self.request_handler([("Content-Length", "2"), ("Transfer-Encoding", "chunked")])
        with self.assertRaises(ValueError):
            handler.read_payload()
        duplicate = self.request_handler([("Content-Length", "2"), ("Content-Length", "2")])
        with self.assertRaises(ValueError):
            duplicate.read_payload()

    def test_rejects_oversize_body_before_read(self):
        handler = self.request_handler([("Content-Length", str(server.MAX_BODY + 1))])
        with self.assertRaises(ValueError):
            handler.read_payload()

    def test_public_error_is_sanitized(self):
        handler = object.__new__(server.Handler)
        handler.server = SimpleNamespace(public_origin="https://guard.example")
        captured = {}
        handler.send_json = lambda status, value: captured.update(status=status, value=value)
        handler.fail(OSError("/private/path at http://127.0.0.1:9999"))
        self.assertEqual(captured["value"]["error"], "OBSERVATION_UNAVAILABLE")
        self.assertNotIn("127.0.0.1", str(captured))

    def test_rate_limiter_has_fixed_client_memory(self):
        limiter = server.FixedWindowLimiter(limit=1, clients=2)
        self.assertTrue(limiter.allow("one", now=1))
        self.assertFalse(limiter.allow("one", now=2))
        limiter.allow("two", now=2)
        limiter.allow("three", now=2)
        self.assertLessEqual(len(limiter.entries), 2)

    def test_public_observation_uses_bounded_subprocess(self):
        handler = object.__new__(server.Handler)
        handler.server = SimpleNamespace(public_origin="https://guard.example", endpoint_timeout=17,
                                         observation_slot=threading.BoundedSemaphore(1))
        with mock.patch("server.bounded_observation", return_value={"source_kind": "OBSERVED"}) as run:
            self.assertEqual(handler.observe("0x" + "1" * 40)["source_kind"], "OBSERVED")
        self.assertEqual(run.call_args.args[1], 17)

    def test_busy_observation_cannot_start_another_child(self):
        handler = object.__new__(server.Handler)
        slot = threading.BoundedSemaphore(1)
        slot.acquire()
        handler.server = SimpleNamespace(public_origin="https://guard.example", observation_slot=slot)
        with mock.patch("server.bounded_observation") as run:
            with self.assertRaises(server.ObservationBusy):
                handler.observe("0x" + "1" * 40)
            run.assert_not_called()

    def collector_script(self, code, timeout=2):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "collector.py").write_text(code)
            with mock.patch("server.ROOT", root):
                return server.bounded_observation("0x" + "1" * 40, timeout)

    def test_bounded_output_success(self):
        self.assertEqual(self.collector_script('print("{}")'), {})

    def test_bounded_output_rejects_large_stdout(self):
        with self.assertRaisesRegex(ValueError, "COLLECTOR_OUTPUT_LIMIT"):
            self.collector_script('print("x" * 300000)')

    def test_bounded_output_kills_timeout(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            self.collector_script('import time; time.sleep(5)', timeout=0.1)

    def test_main_always_binds_loopback(self):
        instance = mock.Mock()
        with mock.patch("server.BoundedHTTPServer", return_value=instance) as server_class:
            server.main(["--port", "8951", "--public-origin", "https://guard.example"])
        self.assertEqual(server_class.call_args.args[0], ("127.0.0.1", 8951))
        instance.serve_forever.assert_called_once_with()

    def test_public_card_uses_origin_and_candidate_name(self):
        handler = object.__new__(server.Handler)
        handler.path = "/.well-known/agent-card.json"
        handler.server = SimpleNamespace(public_origin="https://guard.example", server_port=8951)
        handler.authorize = lambda: True
        captured = {}
        handler.send_json = lambda status, value: captured.update(status=status, value=value)
        handler.do_GET()
        self.assertEqual(captured["value"]["url"], "https://guard.example/a2a")
        self.assertNotIn("local prototype", captured["value"]["name"].lower())
        self.assertIn("read-only", captured["value"]["description"].lower())


if __name__ == "__main__":
    unittest.main()
