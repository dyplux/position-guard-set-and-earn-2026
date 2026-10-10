"""Read exact local manifest bytes by key/hash; no filesystem paths from HTTP."""
import hashlib
import re
import sqlite3
from pathlib import Path


def read_manifest_bytes(store_path, job_key, content_hash):
    if (not re.fullmatch(r"erc8183:97:0x[0-9a-f]{40}:[1-9][0-9]{0,15}",job_key)
            or not re.fullmatch(r"[0-9a-f]{64}",content_hash)):
        raise ValueError("INVALID_DELIVERABLE_REFERENCE")
    parts=job_key.split(":")
    if parts[2]!="0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de" or int(parts[3])>2**53-1:
        raise ValueError("DELIVERABLE_NAMESPACE_STOP")
    # Only the operator-configured database path enters the URI.
    try:
        db=sqlite3.connect(Path(store_path).resolve().as_uri()+"?mode=ro",uri=True)
        try:
            row=db.execute("SELECT manifest,manifest_sha FROM deliveries WHERE job_key=?",(job_key,)).fetchone()
        finally:
            db.close()
    except sqlite3.Error:
        raise ValueError("DELIVERY_STORE_UNAVAILABLE") from None
    if (row is None or type(row[0]) is not bytes or not 0<len(row[0])<=262144
            or row[1]!=content_hash or hashlib.sha256(row[0]).hexdigest()!=content_hash):
        raise ValueError("DELIVERABLE_NOT_FOUND_OR_CORRUPT")
    return row[0]
