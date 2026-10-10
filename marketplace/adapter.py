"""Offline contract prototype. Fake fixtures never prove marketplace payment."""
from dataclasses import dataclass
from typing import Protocol
import hashlib


@dataclass(frozen=True)
class JobEnvelope:
    job_id: str
    wallet: str
    chain_id: int = 97
    task: str = "assess_venus_position"
    synthetic: bool = True


class Adapter(Protocol):
    def read_job(self, job_id: str) -> JobEnvelope: ...
    def prepare_submission(self, job_id: str, canonical_bytes: bytes) -> dict: ...
    def read_completion(self, job_id: str) -> bool: ...


class FakeAdapter:
    """In-memory fixture only; no durable store, transport, funding or signer."""

    def __init__(self):
        self._jobs = {}
        self._deliveries = {}

    def add_job(self, job: JobEnvelope) -> None:
        if (job.synthetic is not True or type(job.chain_id) is not int
                or job.chain_id != 97 or job.task != "assess_venus_position"):
            raise ValueError("SYNTHETIC_TESTNET_ASSESSMENT_ONLY")
        if not isinstance(job.job_id, str) or not job.job_id or len(job.job_id) > 128:
            raise ValueError("INVALID_JOB_ID")
        if (not isinstance(job.wallet, str) or len(job.wallet) != 42
                or not job.wallet.startswith("0x")
                or any(c not in "0123456789abcdefABCDEF" for c in job.wallet[2:])):
            raise ValueError("INVALID_WALLET")
        existing = self._jobs.get(job.job_id)
        if existing is not None and existing != job:
            raise ValueError("CONFLICTING_JOB")
        self._jobs[job.job_id] = job

    def read_job(self, job_id: str) -> JobEnvelope:
        return self._jobs[job_id]

    def prepare_submission(self, job_id: str, canonical_bytes: bytes) -> dict:
        self.read_job(job_id)
        if type(canonical_bytes) is not bytes or not 0 < len(canonical_bytes) <= 32768:
            raise ValueError("INVALID_DELIVERY_BYTES")
        existing = self._deliveries.get(job_id)
        if existing is not None and existing != canonical_bytes:
            raise ValueError("CONFLICTING_DELIVERY")
        self._deliveries[job_id] = canonical_bytes
        return {"job_id": job_id, "synthetic": True,
                "status": "SUBMISSION_PREPARED", "execution_enabled": False,
                "authority": "NONE", "receipt_sha256": hashlib.sha256(canonical_bytes).hexdigest(),
                "onchain_manifest_hash": None}

    def read_completion(self, job_id: str) -> bool:
        self.read_job(job_id)
        return False
