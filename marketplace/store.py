"""Durable immutable local deliverables. No seller submission or settlement."""
import hashlib
import re
import sqlite3


class DeliveryStore:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=5)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS deliveries (job_key TEXT PRIMARY KEY, receipt BLOB NOT NULL CHECK(typeof(receipt)='blob' AND length(receipt) BETWEEN 1 AND 262144), manifest BLOB NOT NULL CHECK(typeof(manifest)='blob' AND length(manifest) BETWEEN 1 AND 262144), receipt_sha TEXT NOT NULL CHECK(length(receipt_sha)=64), manifest_sha TEXT NOT NULL CHECK(length(manifest_sha)=64))")
        self.db.execute("CREATE TRIGGER IF NOT EXISTS delivery_no_update BEFORE UPDATE ON deliveries BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_DELIVERY'); END")
        self.db.execute("CREATE TRIGGER IF NOT EXISTS delivery_no_delete BEFORE DELETE ON deliveries BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_DELIVERY'); END")
        self.db.execute("CREATE TRIGGER IF NOT EXISTS delivery_no_replace BEFORE INSERT ON deliveries WHEN EXISTS(SELECT 1 FROM deliveries WHERE job_key=NEW.job_key) BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_DELIVERY'); END")
        self.db.commit()

    def close(self):
        self.db.close()

    def get(self, job_key):
        row = self.db.execute("SELECT receipt,manifest,receipt_sha,manifest_sha FROM deliveries WHERE job_key=?", (job_key,)).fetchone()
        if row is None:
            return None
        receipt, manifest, receipt_sha, manifest_sha = row
        if (type(receipt) is not bytes or type(manifest) is not bytes
                or hashlib.sha256(receipt).hexdigest() != receipt_sha
                or hashlib.sha256(manifest).hexdigest() != manifest_sha):
            raise ValueError("STORED_DELIVERY_CORRUPT")
        return {"job_key": job_key, "receipt_bytes": receipt, "manifest_bytes": manifest,
                "receipt_sha256": receipt_sha, "manifest_sha256": manifest_sha,
                "manifest_keccak256": None, "state": "DELIVERABLE_PERSISTED",
                "execution_enabled": False, "completed_onchain": False}

    def persist(self, job_key, receipt, manifest):
        if not isinstance(job_key, str) or not 1 <= len(job_key) <= 256:
            raise ValueError("INVALID_JOB_KEY")
        for data in (receipt, manifest):
            if type(data) is not bytes or not 0 < len(data) <= 262144:
                raise ValueError("INVALID_DELIVERY_BYTES")
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            previous = self.get(job_key)
            if previous:
                if previous["receipt_bytes"] != receipt or previous["manifest_bytes"] != manifest:
                    raise ValueError("CONFLICTING_DELIVERY")
                return previous
            self.db.execute("INSERT INTO deliveries VALUES (?,?,?,?,?)", (job_key, receipt, manifest,
                            hashlib.sha256(receipt).hexdigest(), hashlib.sha256(manifest).hexdigest()))
        return self.get(job_key)

    def serve_bytes(self, job_key, manifest_sha256):
        if not isinstance(manifest_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", manifest_sha256):
            raise ValueError("INVALID_CONTENT_HASH")
        record = self.get(job_key)
        if record is None or record["manifest_sha256"] != manifest_sha256:
            raise ValueError("DELIVERY_NOT_FOUND")
        return record["manifest_bytes"]
