"""Operator-only execution of one publicly funded marketplace job."""

import argparse
import contextlib
import fcntl
import json
import os
import stat
import sys
import time
from pathlib import Path

from marketplace.ingress import PokterIngress
from marketplace.quote_store import QuoteStore
from marketplace.reader_bridge import FundingReader
from marketplace.store import DeliveryStore
from marketplace.worker import AssessmentWorker


class WorkerBusy(Exception):
    pass


def _private_dir(path):
    if not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("PRIVATE_STATE_DIR_REQUIRED")
    try:
        info = os.lstat(path)
    except OSError as exc:
        raise ValueError("PRIVATE_STATE_DIR_REQUIRED") from exc
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("PRIVATE_STATE_DIR_REQUIRED")
    return path


def _private_file(path):
    """Create or validate a private, regular, single-link file."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        os.close(fd)
        info = os.lstat(path)
    except OSError as exc:
        raise ValueError("PRIVATE_STATE_FILE_REQUIRED") from exc
    if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid != os.getuid() or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600):
        raise ValueError("PRIVATE_STATE_FILE_REQUIRED")
    return path


@contextlib.contextmanager
def _worker_lock(path):
    fd = os.open(_private_file(path), os.O_RDWR | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError("PRIVATE_LOCK_REQUIRED")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise WorkerBusy from exc
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _public_reader(reader):
    def read(job_id):
        observed = reader.read(job_id)
        if (not isinstance(observed, dict) or observed.get("attested") is not True
                or observed.get("synthetic") is True
                or observed.get("source_kind") != "OBSERVED"):
            raise ValueError("PUBLIC_PROOF_REQUIRED")
        return observed
    return read


def _run_job(job_id, state_dir, node, *, quote_store_cls=QuoteStore,
             reader_cls=FundingReader, ingress_cls=PokterIngress,
             delivery_store_cls=DeliveryStore, worker_cls=AssessmentWorker,
             collector_fn=None, assess_fn=None, verify_receipt_fn=None,
             clock_fn=None):
    """Internal seam for tests; the command supplies only production defaults."""
    if type(job_id) is not int or not 0 < job_id <= 2**53 - 1:
        raise ValueError("JOB_ID_STOP")
    if not isinstance(node, str) or not os.path.isabs(node):
        raise ValueError("ABSOLUTE_NODE_REQUIRED")
    state_dir = _private_dir(state_dir)
    quote_path = os.path.join(state_dir, "quotes.sqlite")
    jobs_path = os.path.join(state_dir, "jobs.sqlite")
    lock_path = os.path.join(state_dir, "worker.lock")

    old_umask = os.umask(0o077)
    try:
        _private_file(quote_path)
        _private_file(jobs_path)
        with contextlib.ExitStack() as stack:
            stack.enter_context(_worker_lock(lock_path))
            quotes = stack.enter_context(_closeable(quote_store_cls(quote_path)))
            reader = reader_cls(quote_store=quotes, node=node)
            observed = _public_reader(reader)(job_id)
            ingress = stack.enter_context(_closeable(ingress_cls(
                store_path=jobs_path, read_verified_job=lambda _: observed,
                allow_synthetic=False)))
            delivery = stack.enter_context(_closeable(delivery_store_cls(jobs_path)))

            if collector_fn is None:
                from server import bounded_observation
                collector_fn = lambda wallet: bounded_observation(wallet, 30)
            if assess_fn is None or verify_receipt_fn is None:
                from policy import assess, verify_receipt
                assess_fn = assess if assess_fn is None else assess_fn
                verify_receipt_fn = verify_receipt if verify_receipt_fn is None else verify_receipt_fn
            worker_kwargs = {
                "store": delivery, "collect_fn": collector_fn,
                "assess_fn": assess_fn, "verify_receipt_fn": verify_receipt_fn,
                "contracts": {
                    "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
                    "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
                    "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
                }, "collector_attested": True, "allow_synthetic": False,
            }
            if clock_fn is not None:
                worker_kwargs["clock_fn"] = clock_fn
            worker = worker_cls(**worker_kwargs)
            now = int(time.time()) if clock_fn is None else clock_fn()
            ingress_result = ingress.ingest(job_id, now=now)
            if ingress_result.get("state") == "RECONCILIATION_REQUIRED":
                return {"job_key": ingress_result["job_key"],
                        "state": "RECONCILIATION_REQUIRED",
                        "execution_enabled": False, "completed_onchain": False}
            return worker.process(ingress_result["job_key"])
    finally:
        os.umask(old_umask)


@contextlib.contextmanager
def _closeable(value):
    try:
        yield value
    finally:
        value.close()


def _safe_output(record):
    allowed = {"status", "job_key", "receipt_sha256", "manifest_sha256",
               "execution_enabled", "completed_onchain"}
    output = {
        "status": record.get("state", "RUN_JOB_STOP"),
        "job_key": record.get("job_key"),
        "execution_enabled": False,
        "completed_onchain": False,
    }
    for key in ("receipt_sha256", "manifest_sha256"):
        if isinstance(record.get(key), str):
            output[key] = record[key]
    return {key: value for key, value in output.items() if key in allowed and value is not None}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True, type=int)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--node", required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(_safe_output(_run_job(args.job_id, args.state_dir, args.node)),
                         sort_keys=True, separators=(",", ":")))
        return 0
    except WorkerBusy:
        print(json.dumps({"status": "WORKER_BUSY", "execution_enabled": False,
                          "completed_onchain": False}, separators=(",", ":")))
        return 2
    except Exception:
        print(json.dumps({"status": "RUN_JOB_STOP", "execution_enabled": False,
                          "completed_onchain": False}, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
