"""Local Atlas message/send seam. No HTTP exposure, quote signing or execution."""
import hashlib
import json
import re
import sqlite3


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", value) or int(value[2:], 16) == 0:
        raise ValueError("ADDRESS_REQUIRED")
    return value.lower()


def uint(value):
    if type(value) is int:
        number = value
    elif isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value) and len(value) <= 78:
        number = int(value)
    else:
        raise ValueError("CANONICAL_UINT_REQUIRED")
    if not 0 <= number < 2**256:
        raise ValueError("UINT256_REQUIRED")
    return number


class AtlasBridge:
    def __init__(self, *, read_verified_job, provider, deployment, store_path):
        self.reader = read_verified_job
        self.provider = address(provider)
        self.deployment = address(deployment)
        self.db = sqlite3.connect(store_path)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL)")
        self.db.commit()

    def close(self):
        self.db.close()

    def handle(self, request, *, now):
        request_id = request.get("id") if isinstance(request, dict) else None
        try:
            if type(now) is not int or not 0 <= now <= 2**63 - 1:
                raise ValueError("UTC_SECONDS_REQUIRED")
            if len(json.dumps(request, allow_nan=False)) > 32768:
                raise ValueError("REQUEST_OVERSIZE")
            if not isinstance(request, dict) or request.get("jsonrpc") != "2.0" or request.get("method") != "message/send":
                raise ValueError("MESSAGE_SEND_REQUIRED")
            message = request["params"]["message"]
            parts = message["parts"]
            if message.get("role") != "user" or len(parts) != 1 or parts[0].get("kind") != "data":
                raise ValueError("SINGLE_DATA_PART_REQUIRED")
            data = parts[0]["data"]
            if data.get("skill") == "negotiate":
                raise ValueError("QUOTE_SIGNER_AND_TERMS_NOT_CONFIGURED")
            if data.get("skill") != "notify_funded":
                raise ValueError("SKILL_NOT_ALLOWED")
            job_id = data.get("job_id")
            if type(job_id) is not int or not 0 < job_id <= 2**53 - 1:
                raise ValueError("ATLAS_SAFE_INTEGER_JOB_ID_REQUIRED")
            observed = self.reader(job_id)
            if len(json.dumps(observed, allow_nan=False).encode()) > 32768:
                raise ValueError("OVERSIZE_JOB")
            job = observed["job"]
            if observed.get("attested") is not True:
                raise ValueError("REVIEWED_CHAIN_READER_REQUIRED")
            if (type(observed.get("chain_id")) is not int or observed["chain_id"] != 97
                    or type(observed.get("agent_id")) is not int or observed["agent_id"] != 2583
                    or address(observed["deployment"]) != self.deployment
                    or address(job["provider"]) != self.provider or uint(job["id"]) != job_id):
                raise ValueError("SELLER_BINDING_STOP")
            address(job["client"])
            if (job["statusName"] != "FUNDED" or uint(job["budget"]) <= 0
                    or uint(job["expiredAt"]) <= now):
                raise ValueError("FUNDED_UNEXPIRED_JOB_REQUIRED")
            task = json.loads(job["description"])
            # Atlas may wrap a structured task string inside its quote description.
            if isinstance(task, dict) and isinstance(task.get("task"), str) and task["task"].startswith("{"):
                task = json.loads(task["task"])
            if (task.get("task") != "assess_venus_position" or task.get("chain_id") != 97
                    or not re.fullmatch(r"0x[0-9a-fA-F]{40}", task.get("wallet", ""))):
                raise ValueError("BOUND_TESTNET_TASK_REQUIRED")
            key = f"erc8183:97:{self.deployment}:{job_id}"
            canonical = json.dumps(job, sort_keys=True, separators=(",", ":"))
            fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
            with self.db:
                previous = self.db.execute("SELECT fingerprint FROM jobs WHERE key=?", (key,)).fetchone()
                if previous and previous[0] != fingerprint:
                    raise ValueError("CONFLICTING_JOB_STOP")
                if not previous:
                    self.db.execute("INSERT INTO jobs VALUES (?,?,?)", (key, fingerprint, json.dumps(observed)))
            result = {"status": "recorded", "job_id": str(job_id), "local_state": "VALIDATED_LOCAL_ONLY",
                      "execution_enabled": False, "delivery_completed": False}
            return {"jsonrpc": "2.0", "id": request_id, "result": {"kind": "message", "role": "agent",
                    "messageId": f"guard-job-{job_id}", "parts": [{"kind": "data", "data": result}]}}
        except (ValueError, KeyError, TypeError, AttributeError, IndexError, OverflowError,
                RuntimeError, TimeoutError, OSError, RecursionError, sqlite3.Error):
            return {"jsonrpc": "2.0", "id": request_id,
                    "error": {"code": -32000, "message": "BRIDGE_NOT_READY_OR_JOB_REJECTED"}}
