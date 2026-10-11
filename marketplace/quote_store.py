"""Private, immutable archive for already signed seller quote envelopes."""

import hashlib
import json
import os
import re
import sqlite3
import stat as stat_module


_HASH = re.compile(r"0x[0-9a-f]{64}\Z")
_SIGNATURE = re.compile(r"0x[0-9a-fA-F]{130}\Z")
_PRICE = re.compile(r"[1-9][0-9]*\Z")
_COMMERCE = "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE"
_CURRENCY = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"


def _private_database(path):
    path = os.fspath(path)
    parent=os.path.dirname(os.path.abspath(path))
    parent_stat=os.lstat(parent)
    if (not stat_module.S_ISDIR(parent_stat.st_mode) or stat_module.S_ISLNK(parent_stat.st_mode)
            or parent_stat.st_uid!=os.getuid() or parent_stat.st_mode&0o077):
        raise ValueError("PRIVATE_QUOTE_STORE_PARENT_REQUIRED")
    try:
        stat = os.lstat(path)
    except FileNotFoundError:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(path, flags, 0o600)
        os.close(fd)
    else:
        if not os.path.isfile(path) or os.path.islink(path):
            raise ValueError("INVALID_QUOTE_STORE_PATH")
        if stat.st_mode & 0o777 != 0o600:
            raise ValueError("QUOTE_STORE_NOT_PRIVATE")
    actual=os.lstat(path)
    if actual.st_uid!=os.getuid() or actual.st_nlink!=1:
        raise ValueError("PRIVATE_SINGLE_LINK_DATABASE_REQUIRED")
    return path,(actual.st_dev,actual.st_ino)


def _canonical(envelope):
    try:
        blob = json.dumps(envelope, ensure_ascii=True, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("ascii")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ValueError("INVALID_QUOTE_ENVELOPE") from exc
    if len(blob) > 32768:
        raise ValueError("QUOTE_ENVELOPE_TOO_LARGE")
    return blob


def _validate(envelope):
    if type(envelope) is not dict:
        raise ValueError("INVALID_QUOTE_ENVELOPE")
    if not isinstance(envelope.get("negotiation_hash"), str) or not _HASH.fullmatch(envelope["negotiation_hash"]):
        raise ValueError("INVALID_NEGOTIATION_HASH")
    if not isinstance(envelope.get("provider_sig"), str) or not _SIGNATURE.fullmatch(envelope["provider_sig"]):
        raise ValueError("INVALID_PROVIDER_SIGNATURE")
    if type(envelope.get("chain_id")) is not int or envelope["chain_id"] != 97:
        raise ValueError("INVALID_CHAIN_ID")
    if envelope.get("verifying_contract") != _COMMERCE:
        raise ValueError("INVALID_COMMERCE")
    if type(envelope.get("negotiated_at")) is not int or type(envelope.get("quote_expires_at")) is not int:
        raise ValueError("INVALID_QUOTE_TIMES")
    if not 0 < envelope["negotiated_at"] < envelope["quote_expires_at"] <= 2**53-1:
        raise ValueError("INVALID_QUOTE_TIMES")
    if not 0 < envelope["quote_expires_at"] - envelope["negotiated_at"] <= 900:
        raise ValueError("INVALID_QUOTE_TTL")
    request = envelope.get("request")
    if not isinstance(request, dict) or not isinstance(request.get("task_description"), str) or not request["task_description"]:
        raise ValueError("INVALID_TASK_DESCRIPTION")
    response = envelope.get("response")
    if not isinstance(response, dict) or response.get("accepted") is not True:
        raise ValueError("QUOTE_NOT_ACCEPTED")
    terms = response.get("terms")
    if not isinstance(terms, dict) or terms.get("currency") != _CURRENCY:
        raise ValueError("INVALID_QUOTE_CURRENCY")
    if (not isinstance(terms.get("price"), str) or len(terms["price"])>78
            or not _PRICE.fullmatch(terms["price"]) or int(terms["price"])>=2**256):
        raise ValueError("INVALID_QUOTE_PRICE")
    return _canonical(envelope)


class QuoteStore:
    def __init__(self, path):
        path,identity = _private_database(path)
        self.db = sqlite3.connect(path, timeout=5)
        actual=os.lstat(path)
        if (actual.st_dev,actual.st_ino)!=identity or os.path.islink(path):
            self.db.close()
            raise ValueError("QUOTE_STORE_PATH_CHANGED")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS quote_archive ("
            "negotiation_hash TEXT PRIMARY KEY CHECK(typeof(negotiation_hash)='text'), "
            "envelope BLOB NOT NULL CHECK(typeof(envelope)='blob' AND length(envelope) BETWEEN 1 AND 32768), "
            "envelope_sha256 TEXT NOT NULL CHECK(length(envelope_sha256)=64))"
        )
        self.db.execute("CREATE TRIGGER IF NOT EXISTS quote_archive_no_update BEFORE UPDATE ON quote_archive BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUOTE'); END")
        self.db.execute("CREATE TRIGGER IF NOT EXISTS quote_archive_no_delete BEFORE DELETE ON quote_archive BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUOTE'); END")
        self.db.execute("CREATE TRIGGER IF NOT EXISTS quote_archive_no_replace BEFORE INSERT ON quote_archive WHEN EXISTS(SELECT 1 FROM quote_archive WHERE negotiation_hash=NEW.negotiation_hash) BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUOTE'); END")
        self.db.commit()

    def close(self):
        self.db.close()

    @staticmethod
    def _read_row(row, key):
        if row is None:
            return None
        blob, digest = row
        if type(blob) is not bytes or type(digest) is not str or hashlib.sha256(blob).hexdigest() != digest:
            raise ValueError("CORRUPT_QUOTE_ARCHIVE")
        try:
            envelope = json.loads(blob.decode("ascii"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("CORRUPT_QUOTE_ARCHIVE") from exc
        if type(envelope) is not dict or _validate(envelope) != blob or envelope.get("negotiation_hash") != key:
            raise ValueError("CORRUPT_QUOTE_ARCHIVE")
        return envelope

    def get(self, negotiation_hash):
        if not isinstance(negotiation_hash,str) or not _HASH.fullmatch(negotiation_hash):
            raise ValueError("INVALID_NEGOTIATION_HASH")
        row = self.db.execute("SELECT envelope,envelope_sha256 FROM quote_archive WHERE negotiation_hash=?", (negotiation_hash,)).fetchone()
        return self._read_row(row, negotiation_hash)

    def archive(self, envelope):
        blob = _validate(envelope)
        key = envelope["negotiation_hash"]
        digest = hashlib.sha256(blob).hexdigest()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute("SELECT envelope,envelope_sha256 FROM quote_archive WHERE negotiation_hash=?", (key,)).fetchone()
            if row is not None:
                existing = self._read_row(row, key)
                if row[0] != blob:
                    raise ValueError("CONFLICTING_QUOTE")
                return existing
            self.db.execute("INSERT INTO quote_archive VALUES (?,?,?)", (key, blob, digest))
        return self.get(key)
