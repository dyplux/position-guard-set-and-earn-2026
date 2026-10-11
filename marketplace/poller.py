"""Operator-only funded-event poller.

The poller is deliberately a small trust boundary: the node reader is a fixed
local program, and this module only records observed event provenance and calls
the existing read-only job runner.  It never signs, publishes, or submits.
"""
import argparse
import contextlib
import fcntl
import json
import os
import re
import sqlite3
import stat
import subprocess
import time
from pathlib import Path

from marketplace.run_job import _private_file, _run_job

CHAIN_ID = 97
COMMERCE = "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE"
PROVIDER = "0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982"
SCRIPT = Path(__file__).with_name("poll_reader.cjs")
HASH = re.compile(r"^0x[0-9a-f]{64}$")
STATES = {"DISCOVERED", "PROCESSING", "DELIVERABLE_PERSISTED",
          "RECONCILIATION_REQUIRED", "RETRY", "FAILED"}


class PollerBusy(Exception):
    pass


class ScanUnavailable(Exception):
    pass


class ReorgStop(Exception):
    pass


def _hex(value):
    return isinstance(value, str) and bool(HASH.fullmatch(value))


def _private_state(path):
    """Create a state directory once, then enforce owner-only permissions."""
    path = os.path.abspath(path)
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        os.mkdir(path, 0o700)
        info = os.lstat(path)
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("PRIVATE_STATE_DIR_REQUIRED")
    return path


@contextlib.contextmanager
def _poller_lock(path):
    fd = os.open(_private_file(path), os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PollerBusy from exc
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode()


def _event(event):
    if not isinstance(event, dict):
        raise ValueError("EVENT_TYPE_STOP")
    ints = ("job_id", "log_index", "block_number")
    if any(type(event.get(k)) is not int or not 0 <= event[k] <= 2**53-1 for k in ints):
        raise ValueError("EVENT_INTEGER_STOP")
    if event["job_id"] <= 0 or event["job_id"] > 2**53 - 1:
        raise ValueError("JOB_ID_STOP")
    if not all(_hex(event.get(k)) for k in ("tx_hash", "block_hash")):
        raise ValueError("EVENT_HASH_STOP")
    return {k: event[k] for k in ("job_id", "tx_hash", "log_index", "block_number", "block_hash")}


def _validate_scan(result, from_block, previous_hash):
    if not isinstance(result, dict):
        raise ScanUnavailable("SCAN_INVALID")
    status = result.get("status")
    if status == "WAIT_CONFIRMATIONS":
        if (result.get("attested") is not True or result.get("synthetic") is not False
                or result.get("chain_id") != CHAIN_ID or result.get("deployment") != COMMERCE
                or result.get("provider") != PROVIDER
                or type(result.get("from_block")) is not int or result.get("from_block") != from_block
                or not _hex(result.get("previous_hash"))
                or (previous_hash is not None and result.get("previous_hash") != previous_hash)
                or result.get("events") != []):
            raise ScanUnavailable("SCAN_BINDING_STOP")
        return result
    if status == "REORG_STOP":
        raise ReorgStop("REORG_STOP")
    if status != "SCANNED":
        raise ScanUnavailable("SCAN_UNAVAILABLE")
    if (result.get("attested") is not True or result.get("synthetic") is not False
            or result.get("chain_id") != CHAIN_ID or result.get("deployment") != COMMERCE
            or result.get("provider") != PROVIDER or type(result.get("from_block")) is not int or result.get("from_block") != from_block
            or not type(result.get("to_block")) is int
            or not from_block <= result["to_block"] <= 2**53-1
            or result["to_block"] - from_block + 1 > 128
            or not _hex(result.get("previous_hash"))
            or (previous_hash is not None and result["previous_hash"] != previous_hash)
            or not _hex(result.get("to_hash"))
            or not isinstance(result.get("events"), list)
            or len(result["events"]) > 64):
        raise ScanUnavailable("SCAN_BINDING_STOP")
    events = [_event(item) for item in result["events"]]
    if any(e["block_number"] < from_block or e["block_number"] > result["to_block"] for e in events):
        raise ScanUnavailable("EVENT_RANGE_STOP")
    result = dict(result)
    result["events"] = events
    return result


class PollDB:
    def __init__(self, path):
        self.path = path
        self.db = sqlite3.connect(path, timeout=0, isolation_level=None)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA journal_mode=DELETE")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK(id=1), next_block INTEGER NOT NULL, previous_hash TEXT);
          CREATE TABLE IF NOT EXISTS queue (
            job_id INTEGER PRIMARY KEY, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
            block_number INTEGER NOT NULL, block_hash TEXT NOT NULL, state TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0, next_retry INTEGER NOT NULL DEFAULT 0,
            payload TEXT NOT NULL, updated INTEGER NOT NULL
          );
        """)

    def close(self):
        self.db.close()

    def initialize(self, start_block):
        if type(start_block) is not int or not 1 <= start_block <= 2**53-1:
            raise ValueError("START_BLOCK_REQUIRED")
        old = self.db.execute("SELECT value FROM meta WHERE key='start_block'").fetchone()
        if old and int(old[0]) != start_block:
            raise ValueError("START_BLOCK_MISMATCH")
        if not old:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                self.db.execute("INSERT INTO meta VALUES ('start_block',?)", (str(start_block),))
                self.db.execute("INSERT INTO cursor VALUES (1,?,NULL)", (start_block,))
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise

    def pause(self):
        self.db.execute("INSERT INTO meta(key,value) VALUES('paused','REORG_STOP') ON CONFLICT(key) DO UPDATE SET value='REORG_STOP'")

    def paused(self):
        return self.db.execute("SELECT 1 FROM meta WHERE key='paused' AND value='REORG_STOP'").fetchone() is not None

    def checkpoint(self):
        return self.db.execute("SELECT next_block,previous_hash FROM cursor WHERE id=1").fetchone()

    def scan_commit(self, result, now):
        events = result["events"]
        active=self.db.execute("SELECT count(*) FROM queue WHERE state IN ('DISCOVERED','PROCESSING','RETRY')").fetchone()[0]
        new_ids={e["job_id"] for e in events if not self.db.execute("SELECT 1 FROM queue WHERE job_id=?",(e["job_id"],)).fetchone()}
        if active + len(new_ids) > 256:
            raise ScanUnavailable("QUEUE_BACKPRESSURE")
        self.db.execute("BEGIN IMMEDIATE")
        try:
            seen = {}
            for event in events:
                old = self.db.execute("SELECT tx_hash,log_index,block_hash,block_number FROM queue WHERE job_id=?",
                                      (event["job_id"],)).fetchone()
                provenance = (event["tx_hash"], event["log_index"], event["block_hash"], event["block_number"])
                if (event["job_id"] in seen and seen[event["job_id"]] != provenance) or (old and tuple(old) != provenance):
                    raise ReorgStop("REORG_STOP")
                seen[event["job_id"]] = provenance
                if not old:
                    if self.db.execute("SELECT 1 FROM queue WHERE job_id=?", (event["job_id"],)).fetchone():
                        continue
                    self.db.execute("INSERT INTO queue(job_id,tx_hash,log_index,block_number,block_hash,state,payload,updated) VALUES (?,?,?,?,?,?,?,?)",
                                    (event["job_id"], event["tx_hash"], event["log_index"], event["block_number"],
                                     event["block_hash"], "DISCOVERED", json.dumps(event, sort_keys=True), now))
            self.db.execute("UPDATE cursor SET next_block=?,previous_hash=? WHERE id=1",
                            (result["to_block"] + 1, result["to_hash"]))
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def next_job(self, now):
        return self.db.execute("SELECT * FROM queue WHERE state IN ('DISCOVERED','PROCESSING','RETRY') AND next_retry<=? ORDER BY job_id LIMIT 1", (now,)).fetchone()


class Poller:
    def __init__(self, state_dir, node, *, runner=subprocess.run, run_job=_run_job,
                 clock=time.time, script=SCRIPT):
        self.state_dir = _private_state(state_dir)
        if not isinstance(node, str) or not os.path.isabs(node):
            raise ValueError("ABSOLUTE_NODE_REQUIRED")
        self.node, self.runner, self.run_job, self.clock, self.script = node, runner, run_job, clock, script
        db_path = os.path.join(self.state_dir, "poll.sqlite")
        _private_file(db_path)
        self.db = PollDB(db_path)
        self.lock_path = os.path.join(self.state_dir, "poller.lock")

    def close(self):
        self.db.close()

    def _scan(self, from_block, previous_hash):
        payload = {"from_block": from_block, "previous_hash": previous_hash}
        raw = _json_bytes(payload)
        if len(raw) > 1024:
            raise ScanUnavailable("SCAN_REQUEST_LIMIT")
        try:
            result = self.runner([self.node, str(self.script)], input=raw.decode(),
                                 capture_output=True, text=True, timeout=90, check=False)
        except Exception as exc:
            raise ScanUnavailable("SCAN_UNAVAILABLE") from exc
        if len(result.stdout.encode()) > 65536:
            raise ScanUnavailable("SCAN_UNAVAILABLE")
        try:
            decoded = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise ScanUnavailable("SCAN_INVALID") from None
        if isinstance(decoded, dict) and decoded.get("status") == "REORG_STOP":
            raise ReorgStop("REORG_STOP")
        if getattr(result, "returncode", 1) != 0:
            raise ScanUnavailable("SCAN_UNAVAILABLE")
        return _validate_scan(decoded, from_block, previous_hash)

    def once(self, *, process=True):
        if type(process) is not bool:
            raise ValueError("EXPLICIT_PROCESS_MODE_REQUIRED")
        with _poller_lock(self.lock_path):
            if self.db.paused():
                raise ReorgStop("REORG_STOP")
            row = self.db.checkpoint()
            try:
                result = self._scan(*row)
            except ReorgStop:
                self.db.pause()
                raise
            now = int(self.clock())
            if result["status"] == "SCANNED":
                try:
                    self.db.scan_commit(result, now)
                except ReorgStop:
                    self.db.pause()
                    raise
            job = self.db.next_job(now)
            processed = None
            if job and process:
                job_id = job[0]
                self.db.db.execute("UPDATE queue SET state='PROCESSING',updated=? WHERE job_id=?", (int(self.clock()), job_id))
                try:
                    outcome = self.run_job(job_id, self.state_dir, self.node)
                    state = outcome.get("state") if isinstance(outcome, dict) else None
                    if state not in {"DELIVERABLE_PERSISTED", "RECONCILIATION_REQUIRED"}:
                        raise ValueError("VERIFIED_WORKER_RESULT_REQUIRED")
                    if outcome.get("execution_enabled") is not False or outcome.get("completed_onchain") is not False:
                        raise ValueError("READ_ONLY_WORKER_REQUIRED")
                    final = state
                    self.db.db.execute("UPDATE queue SET state=?,updated=? WHERE job_id=?", (final, int(self.clock()), job_id))
                    processed = final
                except Exception:
                    attempts = job[6] + 1
                    state = "FAILED" if attempts >= 3 else "RETRY"
                    retry = int(self.clock()) + min(300, 2 ** attempts)
                    self.db.db.execute("UPDATE queue SET state=?,attempts=?,next_retry=?,updated=? WHERE job_id=?", (state, attempts, retry, int(self.clock()), job_id))
                    processed = state
            next_block, previous = self.db.checkpoint()
            return {"status": result["status"], "queued": len(result.get("events", [])),
                    "processed": processed, "next_block": next_block, "previous_hash": previous}


def _safe(record):
    return {key: record[key] for key in ("status", "queued", "processed", "next_block", "previous_hash") if key in record}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--start-block", required=True, type=int)
    parser.add_argument("--once", action="store_true")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--scan-only", action="store_true", help="Record funded events without collecting positions")
    modes.add_argument("--prepare-delivery", action="store_true",
                       help="Prepare private delivery export metadata; never publish or submit")
    args = parser.parse_args(argv)
    poller = None
    try:
        if args.prepare_delivery:
            from marketplace.fulfilment import prepare_fulfilment
            poller = Poller(args.state_dir, args.node, run_job=prepare_fulfilment)
        else:
            poller = Poller(args.state_dir, args.node)
        poller.db.initialize(args.start_block)
        print(json.dumps(_safe(poller.once(process=not args.scan_only)), sort_keys=True, separators=(",", ":")))
        return 0
    except PollerBusy:
        print('{"status":"POLLER_BUSY"}')
        return 2
    except ReorgStop:
        print('{"status":"REORG_STOP"}')
        return 1
    except Exception:
        print('{"status":"SCAN_UNAVAILABLE"}')
        return 1
    finally:
        if poller:
            poller.close()


if __name__ == "__main__":
    raise SystemExit(main())
