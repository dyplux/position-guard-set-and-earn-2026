"""Read-only responder for an operator-issued, already-authorized quote."""

import hashlib
import json
import os
import stat
import subprocess
import time

from marketplace.service_terms import DELIVERABLES, QUALITY


ERROR = "PREISSUED_QUOTE_UNAVAILABLE"
TASK_PREFIX = "Assess Venus Core testnet position for wallet 0x"
TASK_SUFFIX = ". I consent to public JSON delivery retained for 45 days."
MAX_BYTES = 32768
PROVIDER = "0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982"
POKTER_TERMS = {"deliverables": "A JSON assessment with assumptions and data sources.",
                "quality_standards": "Read-only analysis only. Execute no transaction and move no funds."}


def _fail():
    raise ValueError(ERROR)


def _reject_constant(_value):
    raise ValueError("nonfinite")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate")
        result[key] = value
    return result


def _json_bytes(value):
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return encoded.encode("ascii")


def _load_json(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError("oversize")
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    if not isinstance(raw, str):
        raise ValueError("response")
    return json.loads(raw, object_pairs_hook=_pairs, parse_constant=_reject_constant)


def _valid_task(task):
    return (isinstance(task, str) and len(task) == len(TASK_PREFIX) + 40 + len(TASK_SUFFIX)
            and task.startswith(TASK_PREFIX) and task.endswith(TASK_SUFFIX)
            and all(c in "0123456789abcdefABCDEF" for c in task[len(TASK_PREFIX):len(TASK_PREFIX) + 40]))


def _valid_terms(terms):
    if type(terms) is not dict or set(terms) != {"deliverables", "quality_standards"}:
        return False
    if not all(type(terms[name]) is str for name in terms):
        return False
    return (terms == POKTER_TERMS
            or terms == {"deliverables": DELIVERABLES, "quality_standards": QUALITY})


def _request_data(data):
    """Validate optional Pokter settlement hints, then preserve the original request."""
    base = {"skill", "task_description", "terms"}
    hints = {"chain_id", "escrow_chains"}
    if type(data) is not dict or set(data) not in (base, base | hints):
        raise ValueError("request")
    if set(data) == base | hints:
        chains = data["escrow_chains"]
        if (type(data["chain_id"]) is not int or data["chain_id"] != 97
                or type(chains) is not list or not 1 <= len(chains) <= 2
                or any(type(chain) is not int for chain in chains)
                or len(set(chains)) != len(chains) or not set(chains) <= {56, 97}
                or 97 not in chains):
            raise ValueError("settlement hint")
        return {key: data[key] for key in ("skill", "task_description", "terms")}
    return data


def _read_release(path):
    if not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("path")
    parent = os.path.dirname(path)
    parent_stat = os.lstat(parent)
    if not stat.S_ISDIR(parent_stat.st_mode) or parent_stat.st_uid not in {os.getuid(), 0}:
        raise ValueError("parent")
    if parent_stat.st_mode & 0o022:
        raise ValueError("parent mode")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                or info.st_uid not in {os.getuid(), 0}
                or stat.S_IMODE(info.st_mode) not in {0o600, 0o640}
                or info.st_size < 1 or info.st_size > MAX_BYTES):
            raise ValueError("release")
        raw = b""
        while len(raw) <= MAX_BYTES:
            chunk = os.read(fd, MAX_BYTES + 1 - len(raw))
            if not chunk:
                break
            raw += chunk
        if len(raw) > MAX_BYTES:
            raise ValueError("oversize")
    finally:
        os.close(fd)
    return _load_json(raw)


class PreissuedNegotiator:
    def __init__(self, release_file, node, *, runner=subprocess.run, clock=None):
        if not isinstance(node, str) or not os.path.isabs(node):
            raise ValueError(ERROR)
        if clock is not None and not callable(clock):
            raise ValueError(ERROR)
        try:
            self.release_file = os.fspath(release_file)
        except TypeError:
            raise ValueError(ERROR) from None
        if not isinstance(self.release_file, str) or not os.path.isabs(self.release_file):
            raise ValueError(ERROR)
        self.node = node
        self.runner = runner
        self.clock = clock or (lambda: int(time.time()))

    def __call__(self, data):
        try:
            data = _request_data(data)
            if data["skill"] != "negotiate" or not _valid_task(data["task_description"]):
                raise ValueError("request")
            if not _valid_terms(data["terms"]):
                raise ValueError("terms")
            now = self.clock()
            if type(now) is not int or now <= 0:
                raise ValueError("clock")
            release = _read_release(self.release_file)
            if type(release) is not dict or set(release) != {"schema_version", "scope", "state", "provider", "agent_id", "chain_id", "authorized_until", "envelope_sha256", "envelope"}:
                raise ValueError("release")
            if (type(release["schema_version"]) is not int or release["schema_version"] != 1
                    or type(release["agent_id"]) is not int or type(release["chain_id"]) is not int
                    or release["scope"] != "PREISSUED_QUOTE_RELEASE"
                    or release["state"] != "AUTHORIZED" or release["provider"] != PROVIDER
                    or release["agent_id"] != 2583 or release["chain_id"] != 97):
                raise ValueError("grant")
            until = release["authorized_until"]
            if type(until) is not int or not now < until <= now + 900:
                raise ValueError("expiry")
            envelope = release["envelope"]
            if (type(envelope) is not dict
                    or envelope.get("request", {}).get("task_description") != data["task_description"]):
                raise ValueError("envelope")
            expires = envelope.get("quote_expires_at")
            if type(expires) is not int or until > expires:
                raise ValueError("expiry")
            digest = hashlib.sha256(_json_bytes(envelope)).hexdigest()
            if release["envelope_sha256"] != digest or len(digest) != 64:
                raise ValueError("hash")
            verifier_input = _json_bytes({"envelope": envelope, "task": data["task_description"], "now": now})
            if len(verifier_input) > MAX_BYTES:
                raise ValueError("input")
            result = self.runner([self.node, "--max-old-space-size=64",
                                  os.path.join(os.path.dirname(__file__), "offer_verifier.cjs")],
                                 input=verifier_input, capture_output=True, timeout=5, check=False)
            if result.returncode != 0 or len(result.stdout) > MAX_BYTES:
                raise ValueError("verifier")
            response = _load_json(result.stdout)
            if (type(response) is not dict or set(response) != {"status", "envelope", "envelope_sha256"}
                    or response["status"] != "VERIFIED_PREISSUED_QUOTE"
                    or response["envelope"] != envelope or response["envelope_sha256"] != digest):
                raise ValueError("verifier")
            fresh = self.clock()
            if type(fresh) is not int or fresh < now or not fresh < until or fresh >= expires:
                raise ValueError("expired")
            return envelope
        except Exception as exc:
            if isinstance(exc, ValueError) and str(exc) == ERROR:
                raise
            raise ValueError(ERROR) from None
