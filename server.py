"""HTTP/A2A surface for the read-only Position Guard candidate."""
import argparse
import datetime as dt
import json
import re
import os
import selectors
import subprocess
import sys
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlsplit

from collector import collect
from policy import assess, verify_receipt

ROOT = Path(__file__).resolve().parent
MAX_BODY = 12_000
MAX_HEADERS = 32
MAX_HEADER_BYTES = 8_192


class ObservationBusy(Exception):
    pass


def bounded_observation(wallet, timeout):
    if not isinstance(wallet, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", wallet):
        raise ValueError("PUBLIC_WALLET_REQUIRED")
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "collector.py"), "--wallet", wallet],
        cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    outputs = {"stdout": bytearray(), "stderr": bytearray()}
    limits = {"stdout": 262_144, "stderr": 8_192}
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, "stdout")
            selector.register(process.stderr, selectors.EVENT_READ, "stderr")
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired("collector", timeout)
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    elif len(outputs[key.data]) + len(chunk) > limits[key.data]:
                        raise ValueError("COLLECTOR_OUTPUT_LIMIT")
                    else:
                        outputs[key.data].extend(chunk)
            return_code = process.wait(timeout=max(0.01, deadline - time.monotonic()))
            if return_code:
                raise subprocess.CalledProcessError(return_code, "collector")
        return parse_json(outputs["stdout"].decode("utf-8"))
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
        process.stderr.close()


def validate_public_origin(value):
    if value is None:
        return None
    parsed = urlsplit(value)
    hostname = parsed.hostname
    if (parsed.scheme != "https" or not hostname or value != "https://"+hostname or
            parsed.path or parsed.query or parsed.fragment or parsed.port is not None or
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", hostname) or
            ".." in hostname):
        raise ValueError("public origin must be an exact HTTPS origin with no port or path")
    return value


def fixture(name):
    stamp = int(dt.datetime.now(dt.timezone.utc).timestamp())
    collateral, adjusted, debt = {"review": ("1000", "750", "600"), "hold": ("1000", "750", "300"),
                                  "risk": ("1000", "750", "800"), "missing": ("1000", "750", "600")}[name]
    return {"chain_id": 97, "block_number": 1, "block_timestamp": stamp,
            "checked_at": dt.datetime.fromtimestamp(stamp, dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "wallet_address": "0x0000000000000000000000000000000000000001", "protocol": "venus-core",
            "collateral_value_usd": collateral, "debt_value_usd": debt,
            "liquidation_adjusted_collateral_usd": adjusted, "markets_complete": name != "missing",
            "rpc_url": "SYNTHETIC_FIXTURE_NOT_RPC", "source_kind": "SYNTHETIC"}


def parse_json(raw):
    def pairs(items):
        obj = {}
        for key, value in items:
            if key in obj:
                raise ValueError("DUPLICATE_JSON_KEY")
            obj[key] = value
        return obj
    def constant(value):
        raise ValueError("NONFINITE_JSON")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


class FixedWindowLimiter:
    """A fixed-memory, direct-peer rate limiter."""
    def __init__(self, limit, clients=1024, window=60):
        self.limit = limit
        self.clients = clients
        self.window = window
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, peer, now=None):
        now = time.monotonic() if now is None else now
        bucket = int(now // self.window)
        with self.lock:
            previous = self.entries.pop(peer, None)
            count = previous[1] + 1 if previous and previous[0] == bucket else 1
            self.entries[peer] = (bucket, count)
            while len(self.entries) > self.clients:
                self.entries.popitem(last=False)
            return count <= self.limit


class BoundedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def __init__(self, address, handler, public_origin=None, max_inflight=8,
                 request_timeout=5, endpoint_timeout=30, rate_limit=60):
        self.public_origin = public_origin
        self.public_hostname = urlsplit(public_origin).hostname if public_origin else None
        self.request_timeout = request_timeout
        self.endpoint_timeout = endpoint_timeout
        self.inflight = threading.BoundedSemaphore(max_inflight)
        self.observation_slot = threading.BoundedSemaphore(1)
        self.rate_limiter = FixedWindowLimiter(rate_limit)
        super().__init__(address, handler)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(self.request_timeout)
        return request, address

    def process_request(self, request, client_address):
        if not self.inflight.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.inflight.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.inflight.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, status, value):
        payload = json.dumps(value, ensure_ascii=True, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.wfile.write(payload)

    def send_error(self, code, message=None, explain=None):
        self.send_json(code, {"error": "REQUEST_REJECTED"})

    def parse_request(self):
        if not super().parse_request():
            return False
        values = list(self.headers.items())
        if len(values) > MAX_HEADERS or sum(len(k) + len(v) for k, v in values) > MAX_HEADER_BYTES:
            self.send_json(431, {"error": "REQUEST_REJECTED"})
            return False
        return True

    def allowed(self):
        host_values = self.headers.get_all("Host", [])
        origin_values = self.headers.get_all("Origin", [])
        if len(host_values) != 1 or len(origin_values) > 1:
            return False
        host = host_values[0]
        origin = origin_values[0] if origin_values else None
        if self.server.public_origin:
            return host == self.server.public_hostname and (origin is None or origin == self.server.public_origin)
        expected = {"127.0.0.1:"+str(self.server.server_port), "localhost:"+str(self.server.server_port)}
        return host in expected and (not origin or origin in {"http://"+item for item in expected})

    def authorize(self):
        if self.server.public_origin and not self.server.rate_limiter.allow(self.client_address[0]):
            self.send_json(429, {"error": "RATE_LIMITED"})
            return False
        if not self.allowed():
            error = "PUBLIC_ORIGIN_REQUIRED" if self.server.public_origin else "LOCAL_ORIGIN_REQUIRED"
            self.send_json(403, {"error": error})
            return False
        return True

    def read_payload(self):
        lengths = self.headers.get_all("Content-Length", [])
        encodings = self.headers.get_all("Transfer-Encoding", [])
        if encodings or len(lengths) != 1 or not lengths[0].isdigit():
            raise ValueError("REQUEST_SIZE_INVALID")
        length = int(lengths[0])
        if length <= 0 or length > MAX_BODY:
            raise ValueError("REQUEST_SIZE_INVALID")
        payload = parse_json(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("OBJECT_REQUIRED")
        return payload

    def observe(self, wallet):
        if not self.server.public_origin:
            return collect(wallet)
        if not self.server.observation_slot.acquire(blocking=False):
            raise ObservationBusy()
        try:
            return bounded_observation(wallet, self.server.endpoint_timeout)
        finally:
            self.server.observation_slot.release()

    def fail(self, error):
        detail = "OBSERVATION_UNAVAILABLE" if self.server.public_origin else str(error)[:160]
        return self.send_json(422, {"decision": "NEED_EVIDENCE", "authority": "NONE",
                                    "execution_enabled": False, "error": detail})

    def do_GET(self):
        if not self.authorize():
            return
        parsed = urlsplit(self.path)
        if parsed.path == "/":
            payload = (ROOT / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            return self.wfile.write(payload)
        if parsed.path == "/health":
            return self.send_json(200, {"status": "ready", "chain_id": 97, "execution_enabled": False})
        if parsed.path == "/.well-known/agent-card.json":
            public = self.server.public_origin
            return self.send_json(200, {"name": "Position Guard by Dyplux" if public else "Position Guard by Dyplux (local prototype)",
                "description": "Read-only Venus Core testnet position assessment candidate. No signer or automatic repayment.",
                "url": (public or "http://127.0.0.1:"+str(self.server.server_port))+"/a2a", "version": "0.2.0",
                "protocolVersion": "0.3.0", "defaultInputModes": ["text"], "defaultOutputModes": ["text", "application/json"],
                "capabilities": {"streaming": False}, "skills": [{"id": "assess_venus_position", "name": "Assess a Venus position",
                    "description": "Provide a public wallet address on chain 97; returns read-only evidence and a receipt.",
                    "tags": ["health-factor", "testnet", "read-only"], "examples": ["Assess wallet 0x..."]}]})
        if parsed.path == "/api/case":
            name = parse_qs(parsed.query).get("name", [""])[0]
            if name not in {"review", "hold", "risk", "missing"}:
                return self.send_json(400, {"error": "UNKNOWN_CASE"})
            return self.send_json(200, assess(fixture(name)))
        return self.send_json(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        if not self.authorize():
            return
        try:
            payload = self.read_payload()
            if self.path == "/api/verify":
                return self.send_json(200, {"integrity_match": verify_receipt(payload), "authenticity_proven": False})
            if self.path == "/api/observe":
                return self.send_json(200, assess(self.observe(payload.get("wallet")), collector_attested=True))
            if self.path == "/a2a":
                if payload.get("method") != "message/send":
                    return self.send_json(400, {"jsonrpc": "2.0", "id": payload.get("id"), "error": {"code": -32601, "message": "Unsupported method"}})
                parts = payload.get("params", {}).get("message", {}).get("parts", [])
                text = " ".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("kind") == "text")
                match = re.search(r"0x[0-9a-fA-F]{40}\b", text)
                if not match:
                    raise ValueError("PUBLIC_WALLET_REQUIRED")
                result = assess(self.observe(match.group()), collector_attested=True)
                return self.send_json(200, {"jsonrpc": "2.0", "id": payload.get("id"), "result": {
                    "kind": "message", "messageId": result["receipt_sha256"][:24], "role": "agent",
                    "parts": [{"kind": "text", "text": json.dumps(result, ensure_ascii=True)}]}})
            return self.send_json(404, {"error": "NOT_FOUND"})
        except ObservationBusy:
            return self.send_json(503, {"error": "OBSERVATION_BUSY"})
        except (ValueError, TypeError, KeyError, OSError, RecursionError, AttributeError,
                subprocess.SubprocessError) as error:
            return self.fail(error)


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8951)
    parser.add_argument("--public-origin", type=validate_public_origin)
    parser.add_argument("--max-inflight", type=int, default=8)
    parser.add_argument("--request-timeout", type=int, default=5)
    parser.add_argument("--endpoint-timeout", type=int, default=30)
    parser.add_argument("--rate-limit", type=int, default=60, help="requests per direct peer per minute")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("port outside local range")
    if not 1 <= args.max_inflight <= 64 or not 1 <= args.request_timeout <= 30:
        parser.error("server limit outside allowed range")
    if not 1 <= args.endpoint_timeout <= 120 or not 1 <= args.rate_limit <= 10_000:
        parser.error("public limit outside allowed range")
    label = args.public_origin or "http://127.0.0.1:"+str(args.port)
    print("Position Guard: "+label, flush=True)
    server = BoundedHTTPServer(("127.0.0.1", args.port), Handler, args.public_origin,
                               args.max_inflight, args.request_timeout,
                               args.endpoint_timeout, args.rate_limit)
    server.serve_forever()


if __name__ == "__main__":
    main()
