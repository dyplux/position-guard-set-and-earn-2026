"""Prepare a bounded local fulfilment export; never publish or sign."""

import contextlib
import hashlib
import json
import os
import re
import stat
import time

from marketplace.publish import prepare_publication
from marketplace.pokter import COMMERCE
from marketplace.quote_store import QuoteStore
from marketplace.reader_bridge import FundingReader
from marketplace.run_job import (_closeable, _private_dir, _private_file,
                                 _public_reader, _run_job)
from marketplace.store import DeliveryStore

MAX_PLAN_BYTES = 4096
SHA = re.compile(r"[0-9a-f]{64}\Z")
QUOTE = re.compile(r"0x[0-9a-f]{64}\Z")


def _job_id(value):
    if type(value) is not int or not 0 < value <= 2**53 - 1:
        raise ValueError("JOB_ID_STOP")
    return value


def _clock(value):
    if type(value) is not int or value <= 0:
        raise ValueError("UTC_SECONDS_REQUIRED")
    return value


def _existing_archive(path):
    if not os.path.lexists(path):
        raise ValueError("PRIVATE_STATE_FILE_REQUIRED")
    return _private_file(path)


def _plans_dir(state_dir):
    path = os.path.join(state_dir, "export-plans")
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        os.mkdir(path, 0o700)
        info = os.lstat(path)
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("PRIVATE_EXPORT_PLANS_REQUIRED")
    return path


def _persist(path, blob):
    if os.path.lexists(path):
        _private_file(path)
        with open(path, "rb") as stream:
            if stream.read(MAX_PLAN_BYTES + 1) == blob:
                return
        raise ValueError("CONFLICTING_EXPORT_PLAN")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError:
        _private_file(path)
        with open(path, "rb") as stream:
            if stream.read(MAX_PLAN_BYTES + 1) == blob:
                return
        raise ValueError("CONFLICTING_EXPORT_PLAN")
    try:
        view = memoryview(blob)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("EXPORT_PLAN_WRITE_STOP")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    _private_file(path)
    directory = os.open(os.path.dirname(path), os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def _safe_state(record):
    if type(record) is not dict:
        raise ValueError("RUN_JOB_STOP")
    if record.get("state") not in {"DELIVERABLE_PERSISTED", "RECONCILIATION_REQUIRED"}:
        raise ValueError("UNKNOWN_WORKER_STATE")
    if record.get("execution_enabled") is not False or record.get("completed_onchain") is not False:
        raise ValueError("EXECUTION_STATE_STOP")
    result = {"state": record["state"], "execution_enabled": False,
              "completed_onchain": False}
    for key in ("job_key", "manifest_sha256", "receipt_sha256"):
        if isinstance(record.get(key), str):
            result[key] = record[key]
    return result


def prepare_fulfilment(job_id, state_dir, node, *, run_job_fn=_run_job,
                       quote_store_cls=QuoteStore, reader_cls=FundingReader,
                       delivery_store_cls=DeliveryStore, clock_fn=None):
    job_id = _job_id(job_id)
    if not isinstance(node, str) or not os.path.isabs(node):
        raise ValueError("ABSOLUTE_NODE_REQUIRED")
    state_dir = _private_dir(state_dir)
    worker = _safe_state(run_job_fn(job_id, state_dir, node))
    if worker["state"] == "RECONCILIATION_REQUIRED":
        return worker
    expected = f"erc8183:97:{COMMERCE.lower()}:{job_id}"
    if worker.get("job_key") != expected:
        raise ValueError("JOB_KEY_BINDING_STOP")
    now = _clock(int(time.time()) if clock_fn is None else clock_fn())
    quotes_path = os.path.join(state_dir, "quotes.sqlite")
    jobs_path = os.path.join(state_dir, "jobs.sqlite")
    _existing_archive(quotes_path)
    _existing_archive(jobs_path)
    with contextlib.ExitStack() as stack:
        quotes = stack.enter_context(_closeable(quote_store_cls(quotes_path)))
        observed = _public_reader(reader_cls(quote_store=quotes, node=node))(job_id)
        delivery = stack.enter_context(_closeable(delivery_store_cls(jobs_path)))
        record = delivery.get(expected)
        prepared = prepare_publication(record, observed, now=now)
        if (prepared.get("job_key") != expected
                or prepared.get("manifest_bytes") != record["manifest_bytes"]
                or worker.get("manifest_sha256") != record["manifest_sha256"]
                or worker.get("receipt_sha256") != record["receipt_sha256"]
                or hashlib.sha256(record["manifest_bytes"]).hexdigest() != worker["manifest_sha256"]):
            raise ValueError("WORKER_EXPORT_BINDING_STOP")
    metadata = {"job_key": expected, "manifest_sha256": worker.get("manifest_sha256"),
                "receipt_sha256": worker.get("receipt_sha256"),
                "quote_hash": prepared.get("quote_hash"), "expires_at": prepared.get("expires_at"),
                "deliverable_url": f"https://positionguard.dyplux.com/deliverables/{expected}/{worker.get('manifest_sha256')}.json",
                "publication_enabled": False, "signing_ready": False}
    if (not all(isinstance(metadata[key], str) and SHA.fullmatch(metadata[key])
                for key in ("manifest_sha256", "receipt_sha256"))
            or not isinstance(metadata["quote_hash"], str) or not QUOTE.fullmatch(metadata["quote_hash"])
            or type(metadata["expires_at"]) is not int or not now < metadata["expires_at"] <= 2**53 - 1):
        raise ValueError("INVALID_PUBLICATION_PREPARATION")
    blob = (json.dumps(metadata, sort_keys=True, ensure_ascii=True,
                       separators=(",", ":")) + "\n").encode("ascii")
    if len(blob) > MAX_PLAN_BYTES:
        raise ValueError("EXPORT_PLAN_SIZE_STOP")
    _persist(os.path.join(_plans_dir(state_dir), f"{job_id}.json"), blob)
    worker.update({"export_prepared": True, "publication_enabled": False,
                   "signing_ready": False})
    return worker
