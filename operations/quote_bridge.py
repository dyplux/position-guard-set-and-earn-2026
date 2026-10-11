"""Loopback-only transport for the existing exact-grant Mac quote signer."""
import hmac
import json
import os
import pwd
from pathlib import Path
import stat
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

ROOT = Path(__file__).resolve().parents[1]
AUTHORITY = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".config/position-guard-quote"
MAX_BODY = 32768
READ_SECONDS = 5


def private_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
                or info.st_size > MAX_BODY):
            raise ValueError("PRIVATE_FILE_REQUIRED")
        return os.read(fd, MAX_BODY + 1)
    finally:
        os.close(fd)


def sign(draft, *, node):
    # HTTP can't create a grant. The existing signer selects the exact local grant.
    with tempfile.NamedTemporaryFile(dir=AUTHORITY / "state", suffix=".draft.json") as file:
        file.write(json.dumps(draft, allow_nan=False).encode()); file.flush()
        result = subprocess.run([node, str(ROOT / "operations/seller-quote.cjs"), file.name],
                                capture_output=True, timeout=20, check=False)
        if result.returncode or len(result.stdout) > MAX_BODY:
            raise ValueError("QUOTE_SIGNER_STOP")
        metadata = json.loads(result.stdout)
        digest = Path(metadata["quote_file"]).name.removesuffix(".quote.json")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("QUOTE_PATH_STOP")
        expected = AUTHORITY / "state" / (digest + ".quote.json")
        if str(expected) != metadata["quote_file"]:
            raise ValueError("QUOTE_PATH_STOP")
        return json.loads(private_read(expected))


def handler(token, sign_fn):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup(); self.connection.settimeout(5)
            self.read_deadline = time.monotonic() + READ_SECONDS
            self.read_timer = threading.Timer(READ_SECONDS, self.abort_read)
            self.read_timer.daemon = True
            self.read_timer.start()

        def abort_read(self):
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        def finish(self):
            self.read_timer.cancel()
            super().finish()

        def log_message(self, *_):
            pass

        def do_POST(self):
            status, response = 403, {"status": "QUOTE_BRIDGE_STOP"}
            try:
                auth = self.headers.get_all("Authorization")
                if (self.path != "/quote" or not auth or len(auth) != 1
                        or not hmac.compare_digest(auth[0], "Bearer " + token)):
                    raise ValueError("AUTH_REQUIRED")
                lengths = self.headers.get_all("Content-Length")
                if (self.headers.get("Transfer-Encoding") or not lengths or len(lengths) != 1
                        or not lengths[0].isdigit() or not 0 < int(lengths[0]) <= MAX_BODY):
                    raise ValueError("BOUNDED_BODY_REQUIRED")
                raw = self.rfile.read(int(lengths[0]))
                if len(raw) != int(lengths[0]) or time.monotonic() >= self.read_deadline:
                    raise ValueError("REQUEST_READ_DEADLINE")
                self.read_timer.cancel()
                payload = json.loads(raw)
                if not isinstance(payload, dict) or set(payload) != {"draft"} or not isinstance(payload["draft"], dict):
                    raise ValueError("DRAFT_ONLY")
                response, status = sign_fn(payload["draft"]), 200
            except Exception:
                pass
            raw = json.dumps(response, allow_nan=False).encode()
            try:
                self.send_response(status); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw))); self.send_header("Connection", "close")
                self.end_headers(); self.wfile.write(raw)
            except OSError:
                pass  # A lost response requires journal reconciliation, never another signature.
            self.close_connection = True
    return Handler


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Mac operator quote bridge; exact grants only")
    parser.add_argument("--node", required=True)
    args = parser.parse_args()
    if not Path(args.node).is_absolute():
        raise ValueError("ABSOLUTE_NODE_REQUIRED")
    for directory in (AUTHORITY, AUTHORITY / "state"):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("PRIVATE_DIRECTORY_REQUIRED")
    fields = dict(line.split("=", 1) for line in private_read(AUTHORITY / "transport.env").decode().splitlines() if line)
    token = fields["QUOTE_TRANSPORT_TOKEN"]
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("TRANSPORT_TOKEN_REQUIRED")
    HTTPServer(("127.0.0.1", 8961), handler(token, lambda draft: sign(draft, node=args.node))).serve_forever()


if __name__ == "__main__":
    main()
