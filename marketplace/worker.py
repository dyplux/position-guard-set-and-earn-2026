"""Trusted local assessment worker for jobs recorded by AtlasBridge."""
import datetime as dt
import hashlib
import json
import time
from marketplace.atlas_bridge import address, uint


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("utf-8")


class AssessmentWorker:
    def __init__(self, *, store, collect_fn, assess_fn, verify_receipt_fn, contracts,
                 collector_attested=False, clock_fn=lambda: int(time.time())):
        self.store = store
        self.collect = collect_fn
        self.assess = assess_fn
        self.verify = verify_receipt_fn
        self.clock = clock_fn
        if type(collector_attested) is not bool:
            raise ValueError("EXPLICIT_COLLECTOR_TRUST_REQUIRED")
        self.collector_attested = collector_attested
        if set(contracts) != {"commerce", "router", "policy"}:
            raise ValueError("CONTRACT_BINDINGS_REQUIRED")
        self.contracts = {key: address(value) for key, value in contracts.items()}

    def process(self, job_key, *, now=None):
        current = self.clock()
        now = current if now is None else now
        if type(now) is not int or not 0 <= now <= 2**63-1 or type(current) is not int or abs(current-now)>5:
            raise ValueError("UTC_SECONDS_REQUIRED")
        # Bridge and worker share a local database. HTTP JSON can't insert a job.
        row = self.store.db.execute("SELECT fingerprint,payload,payload_sha FROM jobs WHERE key=?", (job_key,)).fetchone()
        if row is None:
            raise ValueError("VALIDATED_JOB_REQUIRED")
        if row[2] is None or hashlib.sha256(row[1].encode()).hexdigest() != row[2]:
            raise ValueError("JOB_PAYLOAD_CORRUPT_OR_LEGACY")
        observed = json.loads(row[1])
        job = observed["job"]
        if hashlib.sha256(canonical_bytes(job)).hexdigest() != row[0]:
            raise ValueError("JOB_STORE_CORRUPT")
        if (observed.get("attested") is not True or type(observed.get("chain_id")) is not int
                or observed["chain_id"] != 97 or observed.get("agent_id") != 2583
                or address(observed["deployment"]) != self.contracts["commerce"]):
            raise ValueError("JOB_BINDING_STOP")
        if job_key != f"erc8183:97:{self.contracts['commerce']}:{uint(job['id'])}":
            raise ValueError("JOB_KEY_BINDING_STOP")
        existing = self.store.get(job_key)
        if existing:
            return existing
        if job["statusName"] != "FUNDED" or uint(job["expiredAt"]) <= now:
            raise ValueError("FUNDED_UNEXPIRED_JOB_REQUIRED")
        task = json.loads(job["description"])
        if isinstance(task.get("task"), str) and task["task"].startswith("{"):
            task = json.loads(task["task"])
        if task.get("task") != "assess_venus_position" or task.get("chain_id") != 97:
            raise ValueError("ASSESSMENT_TASK_REQUIRED")
        wallet = address(task["wallet"])
        snapshot = self.collect(wallet)
        if not isinstance(snapshot, dict) or len(canonical_bytes(snapshot)) > 262144:
            raise ValueError("BOUNDED_SNAPSHOT_REQUIRED")
        now = self.clock()
        if type(now) is not int or not 0 <= now <= 2**63-1 or uint(job["expiredAt"]) <= now:
            raise ValueError("JOB_EXPIRED_DURING_COLLECTION")
        if (type(snapshot.get("chain_id")) is not int or snapshot["chain_id"] != 97
                or address(snapshot["wallet_address"]) != wallet):
            raise ValueError("SNAPSHOT_BINDING_STOP")
        block_time = snapshot.get("block_timestamp")
        checked_at = snapshot.get("checked_at")
        if not isinstance(checked_at, str):
            raise ValueError("UTC_SNAPSHOT_REQUIRED")
        checked = dt.datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
        if checked.tzinfo is None or checked.utcoffset() != dt.timedelta(0):
            raise ValueError("UTC_SNAPSHOT_REQUIRED")
        if (type(block_time) is not int or not -5 <= now - block_time <= 60
                or not -5 <= now - checked.timestamp() <= 60):
            raise ValueError("STALE_SNAPSHOT_STOP")
        receipt = self.assess(snapshot, collector_attested=self.collector_attested)
        finish = self.clock()
        if type(finish) is not int or finish < now or uint(job["expiredAt"]) <= finish:
            raise ValueError("JOB_EXPIRED_DURING_ASSESSMENT")
        assessed_at = finish
        if (not isinstance(receipt, dict) or self.verify(receipt) is not True
                or receipt.get("authority") != "NONE" or receipt.get("execution_enabled") is not False
                or receipt.get("policy_version") != "0.2.0"
                or canonical_bytes(receipt.get("normalized_snapshot")) != canonical_bytes(snapshot)):
            raise ValueError("READ_ONLY_RECEIPT_REQUIRED")
        receipt_bytes = canonical_bytes(receipt)
        manifest = {"version": 1, "job_id": uint(job["id"]), "chain_id": 97,
                    "contracts": self.contracts,
                    "response": {"content": receipt, "content_type": "application/json"},
                    "metadata": {"agent_id": 2583,
                                 "job_evidence_kind": "SYNTHETIC" if observed.get("synthetic") is True else "REVIEWED_LOCAL_READER",
                                 "receipt_sha256": hashlib.sha256(receipt_bytes).hexdigest()}}
        # NEED_EVIDENCE stays NEED_EVIDENCE; persistence isn't service completion.
        manifest_bytes = canonical_bytes(manifest)
        finish = self.clock()
        if (type(finish) is not int or finish < assessed_at or uint(job["expiredAt"]) <= finish
                or not -5 <= finish-block_time <= 60 or not -5 <= finish-checked.timestamp() <= 60):
            raise ValueError("DELIVERY_EXPIRED_OR_STALE")
        return self.store.persist(job_key, receipt_bytes, manifest_bytes)


def main():
    import argparse
    from collector import collect
    from policy import assess, verify_receipt
    from marketplace.store import DeliveryStore
    parser = argparse.ArgumentParser(description="Process one locally validated chain97 assessment job; no submission")
    parser.add_argument("--store", required=True)
    parser.add_argument("--job-key", required=True)
    args = parser.parse_args()
    store = DeliveryStore(args.store)
    try:
        worker = AssessmentWorker(store=store,collect_fn=collect,assess_fn=assess,verify_receipt_fn=verify_receipt,
                                  contracts={"commerce":"0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
                                             "router":"0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
                                             "policy":"0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA"})
        record = worker.process(args.job_key)
        print(json.dumps({key:value for key,value in record.items() if not key.endswith("_bytes")}))
    except Exception:
        print(json.dumps({"status":"WORKER_STOP","execution_enabled":False}))
        return 1
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
