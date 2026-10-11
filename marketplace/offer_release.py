"""Operator-only release of an already signed quote, after private archival."""
import argparse
import contextlib
import hashlib
import json
import os
import tempfile
import time

from marketplace.preissued import PreissuedNegotiator, _read_release, _json_bytes, PROVIDER
from marketplace.quote_store import QuoteStore
from marketplace.run_job import _private_dir
from marketplace.service_terms import DELIVERABLES, QUALITY


def release_preissued(envelope_file, grant_file, state_dir, offer_file, node, *,
                      clock=None, negotiator_cls=PreissuedNegotiator, store_cls=QuoteStore):
    """Filesystem grant is operator-provisioned, never accepted through HTTP."""
    now = int(time.time()) if clock is None else clock()
    if type(now) is not int or now <= 0:
        raise ValueError("RELEASE_CLOCK_REQUIRED")
    state_dir = _private_dir(os.fspath(state_dir))
    envelope = _read_release(os.fspath(envelope_file))
    grant = _read_release(os.fspath(grant_file))
    keys = {"state", "scope", "chain_id", "agent_id", "provider", "quote_hash",
            "envelope_sha256", "expires_at", "max_releases", "offer_file"}
    blob = _json_bytes(envelope)
    digest = hashlib.sha256(blob).hexdigest()
    if (type(grant) is not dict or set(grant) != keys or grant["state"] != "AUTHORIZED"
            or grant["scope"] != "PREISSUED_QUOTE_RELEASE" or grant["provider"] != PROVIDER
            or type(grant["chain_id"]) is not int or grant["chain_id"] != 97
            or type(grant["agent_id"]) is not int or grant["agent_id"] != 2583
            or type(grant["max_releases"]) is not int or grant["max_releases"] != 1
            or grant["quote_hash"] != envelope.get("negotiation_hash")
            or grant["envelope_sha256"] != digest or type(grant["expires_at"]) is not int
            or not now < grant["expires_at"] <= now + 900
            or grant["expires_at"] > envelope.get("quote_expires_at", 0)):
        raise ValueError("EXACT_RELEASE_GRANT_REQUIRED")
    offer_file = os.path.abspath(os.fspath(offer_file))
    if type(grant["offer_file"]) is not str or grant["offer_file"] != offer_file:
        raise ValueError("EXACT_OFFER_PATH_REQUIRED")
    parent = os.path.dirname(offer_file)
    info = os.lstat(parent)
    if not os.path.isdir(parent) or os.path.islink(parent) or info.st_uid not in {0, os.getuid()} or info.st_mode & 0o022:
        raise ValueError("OPERATOR_OFFER_DIRECTORY_REQUIRED")
    release = {"schema_version": 1, "scope": "PREISSUED_QUOTE_RELEASE", "state": "AUTHORIZED",
        "provider": PROVIDER, "agent_id": 2583, "chain_id": 97,
        "authorized_until": grant["expires_at"], "envelope_sha256": digest, "envelope": envelope}
    release_bytes = _json_bytes(release)
    if len(release_bytes) > 32768:
        raise ValueError("RELEASE_SIZE_STOP")
    with tempfile.NamedTemporaryFile(dir=state_dir, suffix=".release.json") as temp:
        temp.write(release_bytes); temp.flush(); os.fsync(temp.fileno())
        negotiator = negotiator_cls(temp.name, node, clock=clock)
        verified = negotiator({"skill": "negotiate",
            "task_description": envelope["request"]["task_description"],
            "terms": {"deliverables": DELIVERABLES, "quality_standards": QUALITY}})
    if _json_bytes(verified) != blob:
        raise ValueError("RELEASE_VERIFIER_CONFLICT")
    with contextlib.closing(store_cls(os.path.join(state_dir, "quotes.sqlite"))) as quotes:
        if _json_bytes(quotes.archive(envelope)) != blob:
            raise ValueError("ARCHIVE_CONFLICT")
    fresh = int(time.time()) if clock is None else clock()
    if type(fresh) is not int or fresh < now or fresh >= grant["expires_at"]:
        raise ValueError("RELEASE_EXPIRED")
    # Existing releases are immutable: never replace another offer or repair a partial file.
    try:
        fd = os.open(offer_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)
    except FileExistsError:
        existing = _read_release(offer_file)
        if _json_bytes(existing) != release_bytes:
            raise ValueError("EXISTING_RELEASE_CONFLICT")
        return {"status": "RELEASE_REPLAYED", "quote_hash": grant["quote_hash"], "signatures": 0, "dispatches": 0}
    try:
        os.fchmod(fd, 0o640)
        view = memoryview(release_bytes)
        while view:
            written = os.write(fd, view)
            if written <= 0: raise OSError("RELEASE_WRITE_STOP")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(parent, os.O_RDONLY)
    try: os.fsync(directory)
    finally: os.close(directory)
    return {"status": "PREISSUED_RELEASE_PREPARED", "quote_hash": grant["quote_hash"], "signatures": 0, "dispatches": 0}


def main():
    parser = argparse.ArgumentParser()
    for name in ("envelope", "grant", "state-dir", "offer-file", "node"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    try:
        result = release_preissued(args.envelope, args.grant, args.state_dir, args.offer_file, args.node)
        print(json.dumps(result)); return 0
    except Exception:
        print('{"status":"PREISSUED_RELEASE_STOP","signatures":0,"dispatches":0}'); return 1


if __name__ == "__main__":
    raise SystemExit(main())
