"""Bounded, immutable public deliverables; this store does not attest settlement."""
import contextlib
import hashlib
import os
import re
import sqlite3
from pathlib import Path


MAX_BYTES = 262144
MAX_SAFE_INT = 2**53 - 1
COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de"
JOB_RE = re.compile(r"erc8183:97:" + re.escape(COMMERCE) + r":([1-9][0-9]{0,15})\Z")
HASH_RE = re.compile(r"[0-9a-f]{64}\Z")
QUOTE_RE = re.compile(r"0x[0-9a-f]{64}\Z")


def _parent_and_path(path, *, reader=False):
    path = Path(path).absolute()
    parent = path.parent
    pstat = os.lstat(parent)
    if (not os.path.isdir(parent) or os.path.islink(parent) or pstat.st_uid not in ({os.getuid(), 0} if reader else {os.getuid()})
            or pstat.st_mode & 0o022):
        raise ValueError("UNSAFE_DELIVERY_STORE_PATH")
    return path


def _check_file(path, expected=None, *, reader=False):
    stat = os.lstat(path)
    if (not os.path.isfile(path) or os.path.islink(path) or stat.st_nlink != 1
            or stat.st_uid not in ({os.getuid(), 0} if reader else {os.getuid()}) or stat.st_mode & 0o777 not in (0o600, 0o640)):
        raise ValueError("UNSAFE_DELIVERY_STORE_PATH")
    if expected is not None and (stat.st_dev, stat.st_ino) != expected:
        raise ValueError("UNSAFE_DELIVERY_STORE_PATH")
    return stat.st_dev, stat.st_ino


@contextlib.contextmanager
def _private_journals():
    old = os.umask(0o077)
    try:
        yield
    finally:
        os.umask(old)


def _validate_job(job_key):
    if not isinstance(job_key, str) or not JOB_RE.fullmatch(job_key):
        raise ValueError("INVALID_PUBLIC_JOB_KEY")
    if int(job_key.rsplit(":", 1)[1]) > MAX_SAFE_INT:
        raise ValueError("INVALID_PUBLIC_JOB_KEY")


def _validate_publish(job_key, manifest, expires_at, quote_hash):
    _validate_job(job_key)
    if type(manifest) is not bytes or not 0 < len(manifest) <= MAX_BYTES:
        raise ValueError("INVALID_PUBLIC_MANIFEST")
    if type(expires_at) is not int or not 0 < expires_at <= MAX_SAFE_INT:
        raise ValueError("INVALID_PUBLIC_EXPIRY")
    if not isinstance(quote_hash, str) or not QUOTE_RE.fullmatch(quote_hash):
        raise ValueError("INVALID_PUBLIC_QUOTE_HASH")


def validate_store_path(path, *, reader=False):
    """Validate the operator-controlled database path without opening it."""
    path = _parent_and_path(path, reader=reader)
    _check_file(path, reader=reader)
    return path


class PublicDeliveryStore:
    def __init__(self, path):
        path = _parent_and_path(path)
        try:
            os.lstat(path)
        except FileNotFoundError:
            with _private_journals():
                fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            os.close(fd)
        before = _check_file(path)
        try:
            with _private_journals():
                self.db = sqlite3.connect(str(path), timeout=5)
                self.db.execute("PRAGMA synchronous=FULL")
                self.db.execute("""CREATE TABLE IF NOT EXISTS public_deliveries (
                    job_key TEXT PRIMARY KEY,
                    manifest BLOB NOT NULL CHECK(typeof(manifest)='blob' AND length(manifest) BETWEEN 1 AND 262144),
                    manifest_sha TEXT NOT NULL CHECK(length(manifest_sha)=64 AND manifest_sha NOT GLOB '*[^0-9a-f]*'),
                    expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at BETWEEN 1 AND 9007199254740991),
                    quote_hash TEXT NOT NULL CHECK(length(quote_hash)=66 AND substr(quote_hash,1,2)='0x' AND substr(quote_hash,3) NOT GLOB '*[^0-9a-f]*')
                )""")
                self.db.execute("CREATE TRIGGER IF NOT EXISTS public_delivery_no_update BEFORE UPDATE ON public_deliveries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLIC_DELIVERY'); END")
                self.db.execute("CREATE TRIGGER IF NOT EXISTS public_delivery_no_delete BEFORE DELETE ON public_deliveries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLIC_DELIVERY'); END")
                self.db.execute("CREATE TRIGGER IF NOT EXISTS public_delivery_no_replace BEFORE INSERT ON public_deliveries WHEN EXISTS(SELECT 1 FROM public_deliveries WHERE job_key=NEW.job_key) BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLIC_DELIVERY'); END")
                self.db.commit()
        except Exception:
            if hasattr(self, "db"):
                self.db.close()
            raise
        try:
            _check_file(path, before)
        except Exception:
            self.db.close()
            raise
        self.path = path

    def close(self):
        self.db.close()

    @staticmethod
    def _metadata(row):
        return {"job_key": row[0], "manifest_sha": row[1], "expires_at": row[2], "quote_hash": row[3]}

    def publish(self, job_key, manifest_bytes, *, expires_at, quote_hash):
        _validate_publish(job_key, manifest_bytes, expires_at, quote_hash)
        digest = hashlib.sha256(manifest_bytes).hexdigest()
        with _private_journals(), self.db:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute(
                "SELECT job_key,manifest,manifest_sha,expires_at,quote_hash FROM public_deliveries WHERE job_key=?",
                (job_key,)).fetchone()
            if row is not None:
                if (type(row[1]) is not bytes or row[1] != manifest_bytes or row[2] != digest
                        or row[3] != expires_at or row[4] != quote_hash):
                    raise ValueError("CONFLICTING_PUBLIC_DELIVERY")
                return self._metadata((row[0], row[2], row[3], row[4]))
            self.db.execute(
                "INSERT INTO public_deliveries(job_key,manifest,manifest_sha,expires_at,quote_hash) VALUES(?,?,?,?,?)",
                (job_key, manifest_bytes, digest, expires_at, quote_hash))
        return {"job_key": job_key, "manifest_sha": digest, "expires_at": expires_at, "quote_hash": quote_hash}


def _open_readonly(path):
    try:
        path = validate_store_path(path, reader=True)
        before = _check_file(path, reader=True)
        db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        _check_file(path, before, reader=True)
        return db
    except (OSError, sqlite3.Error, ValueError):
        try:
            db.close()
        except (UnboundLocalError, AttributeError):
            pass
        raise ValueError("DELIVERY_STORE_UNAVAILABLE") from None


def read_public_manifest(path, job_key, content_hash, now):
    _validate_job(job_key)
    if not isinstance(content_hash, str) or not HASH_RE.fullmatch(content_hash):
        raise ValueError("INVALID_DELIVERABLE_REFERENCE")
    db = _open_readonly(path)
    try:
        row = db.execute(
            "SELECT manifest_sha,expires_at,quote_hash,length(manifest) FROM public_deliveries WHERE job_key=?",
            (job_key,)).fetchone()
        if (row is None or type(row[1]) is not int or row[1] <= now or row[3] is None
                or not 0 < row[3] <= MAX_BYTES or row[0] != content_hash):
            raise ValueError("DELIVERABLE_NOT_FOUND_OR_CORRUPT")
        manifest = db.execute("SELECT manifest FROM public_deliveries WHERE job_key=? AND length(manifest) BETWEEN 1 AND ?",
                              (job_key, MAX_BYTES)).fetchone()
        if (manifest is None or type(manifest[0]) is not bytes
                or hashlib.sha256(manifest[0]).hexdigest() != content_hash):
            raise ValueError("DELIVERABLE_NOT_FOUND_OR_CORRUPT")
        return manifest[0]
    except sqlite3.Error:
        raise ValueError("DELIVERY_STORE_UNAVAILABLE") from None
    finally:
        db.close()
