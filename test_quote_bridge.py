import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import socket
import time
import unittest
from unittest.mock import patch
from http.client import HTTPConnection
from http.server import HTTPServer

spec = importlib.util.spec_from_file_location("quote_bridge", Path(__file__).parent / "operations/quote_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class QuoteBridgeTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def signer(draft):
            self.calls.append(draft)
            if draft.get("grant"):
                raise ValueError("NO_LOCAL_GRANT")
            return {"negotiation_hash": "0x" + "a" * 64}
        self.server = HTTPServer(("127.0.0.1", 0), bridge.handler("a" * 64, signer))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, payload, token="a" * 64):
        connection = HTTPConnection(*self.server.server_address, timeout=2)
        connection.request("POST", "/quote", json.dumps(payload), {"Authorization": "Bearer " + token})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_auth_and_request_cannot_supply_grants_or_wallet_sources(self):
        for payload, token in [({"draft": {}}, "b" * 64), ({"draft": {}, "grant": {}}, "a" * 64),
                               ({"draft": [], "wallet_env": "/tmp/key"}, "a" * 64)]:
            self.assertEqual(self.request(payload, token)[0], 403)
        self.assertEqual(self.calls, [])

    def test_transport_returns_only_signer_result_and_sanitizes_failure(self):
        self.assertEqual(self.request({"draft": {}})[0], 200)
        self.assertEqual(self.request({"draft": {"grant": True}}), (403, {"status": "QUOTE_BRIDGE_STOP"}))

    def test_private_file_rejects_symlink_and_readable_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "transport.env"
            file.write_bytes(b"dummy"); file.chmod(0o600)
            self.assertEqual(bridge.private_read(file), b"dummy")
            link = Path(directory) / "alias"; link.symlink_to(file)
            with self.assertRaises(OSError): bridge.private_read(link)
            file.chmod(0o644)
            with self.assertRaises(ValueError): bridge.private_read(file)

    def test_slow_body_is_cut_off_at_absolute_deadline(self):
        with patch.object(bridge, 'READ_SECONDS', 0.15):
            connection = socket.create_connection(self.server.server_address, timeout=1)
            connection.sendall(b'POST /quote HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer '
                + b'a'*64 + b'\r\nContent-Length: 100\r\n\r\n{')
            started = time.monotonic()
            # Frequent progress mustn't extend the total read deadline.
            for _ in range(5):
                time.sleep(0.04)
                try: connection.sendall(b' ')
                except OSError: break
            try:
                try: self.assertEqual(connection.recv(1), b'')
                except ConnectionResetError: pass
                self.assertLess(time.monotonic()-started, 0.5)
            finally:
                connection.close()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
