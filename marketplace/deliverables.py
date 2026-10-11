"""Read exact local manifest bytes by key/hash; no filesystem paths from HTTP."""
from marketplace.public_store import read_public_manifest


def read_manifest_bytes(store_path, job_key, content_hash, now=None):
    if now is None:
        import time
        now = int(time.time())
    if type(now) is not int or now < 0:
        raise ValueError("INVALID_DELIVERABLE_TIME")
    return read_public_manifest(store_path, job_key, content_hash, now)
