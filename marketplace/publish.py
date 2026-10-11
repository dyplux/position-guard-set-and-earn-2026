"""Export one consented real assessment to a separate public manifest database."""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
import time
from pathlib import Path

from marketplace.pokter import COMMERCE, bind_pokter_job
from marketplace.quote_store import QuoteStore
from marketplace.reader_bridge import FundingReader
from marketplace.service_terms import publication_consent, RETENTION_SECONDS
from marketplace.store import DeliveryStore
from marketplace.worker import canonical_bytes
from policy import assess, verify_receipt


def prepare_publication(record, observed, *, now):
    if type(now) is not int or now <= 0 or observed.get("attested") is not True or observed.get("synthetic") is True:
        raise ValueError("REAL_PUBLICATION_PROOF_REQUIRED")
    if observed.get("source_kind") != "OBSERVED" or observed.get("funding_verified") is not True:
        raise ValueError("REAL_PUBLICATION_PROOF_REQUIRED")
    proof = observed["verified_quote"]
    if not publication_consent(proof["envelope"]):
        raise ValueError("SIGNED_PUBLICATION_CONSENT_REQUIRED")
    task = bind_pokter_job(observed, quote_lookup=lambda digest: proof if proof["envelope"]["negotiation_hash"] == digest else None)
    job = observed["job"]
    key = f"erc8183:97:{COMMERCE}:{job['id']}"
    if record is None or record["job_key"] != key or int(job["expiredAt"]) <= now:
        raise ValueError("ACTIVE_JOB_DELIVERY_REQUIRED")
    blob = record["manifest_bytes"]
    manifest = json.loads(blob)
    receipt = manifest["response"]["content"]
    snapshot = receipt.get("normalized_snapshot", {})
    if (canonical_bytes(manifest) != blob or record["manifest_sha256"] != hashlib.sha256(blob).hexdigest()
            or type(manifest.get("version")) is not int or manifest["version"] != 1
            or manifest.get("chain_id") != 97 or str(manifest.get("job_id")) != str(job["id"])
            or manifest.get("contracts") != {"commerce": COMMERCE,
                "router": "0xd7d36d66d2f1b608a0f943f722d27e3744f66f25",
                "policy": "0xd6a4217588f6b1f5657a92a3e94e6422ad771cea"}
            or manifest.get("metadata", {}).get("agent_id") != 2583
            or manifest["metadata"].get("job_evidence_kind") != "REVIEWED_LOCAL_READER"
            or manifest.get("response", {}).get("content_type") != "application/json"
            or receipt.get("evidence_kind") != "OBSERVED" or snapshot.get("source_kind") != "OBSERVED"
            or snapshot.get("rpc_url") not in {"https://bsc-testnet-dataseed.bnbchain.org", "https://bsc-testnet-rpc.publicnode.com"}
            or snapshot.get("chain_id") != 97 or snapshot.get("wallet_address", "").lower() != task["wallet"]
            or not verify_receipt(receipt) or assess(snapshot, collector_attested=True) != receipt
            or record["receipt_bytes"] != canonical_bytes(receipt)
            or manifest["metadata"].get("receipt_sha256") != record["receipt_sha256"]):
        raise ValueError("OBSERVED_DELIVERY_BINDING_REQUIRED")
    checked = dt.datetime.fromisoformat(snapshot["checked_at"].replace("Z", "+00:00"))
    if checked.tzinfo is None or checked.utcoffset() != dt.timedelta(0):
        raise ValueError("UTC_ASSESSMENT_REQUIRED")
    stamp = int(checked.timestamp())
    if (stamp < observed["funding"]["block_timestamp"] - 5 or stamp > now + 5
            or snapshot["block_number"] < observed["funding"]["block_number"]
            or stamp + RETENTION_SECONDS <= now):
        raise ValueError("PUBLICATION_TIME_SCOPE_STOP")
    return {"job_key": key, "manifest_bytes": blob, "expires_at": stamp + RETENTION_SECONDS,
            "quote_hash": proof["envelope"]["negotiation_hash"]}


def main():
    from marketplace.public_store import PublicDeliveryStore
    from marketplace.run_job import _private_dir, _private_file
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--public-store", type=Path, required=True)
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--node", required=True)
    args = parser.parse_args()
    try:
        _private_dir(str(args.state_dir))
        _private_file(str(args.state_dir / "jobs.sqlite"))
        if not os.path.isabs(args.node) or not 0 < args.job_id <= 2**53-1:
            raise ValueError("OPERATOR_INPUT_REQUIRED")
        with contextlib.ExitStack() as stack:
            quotes = QuoteStore(args.state_dir / "quotes.sqlite"); stack.callback(quotes.close)
            observed = FundingReader(quote_store=quotes, node=args.node).read(args.job_id)
            private = DeliveryStore(args.state_dir / "jobs.sqlite"); stack.callback(private.close)
            key = f"erc8183:97:{COMMERCE}:{args.job_id}"
            prepared = prepare_publication(private.get(key), observed, now=int(time.time()))
            public = PublicDeliveryStore(args.public_store); stack.callback(public.close)
            print(json.dumps(public.publish(**prepared)))
        return 0
    except Exception:
        print(json.dumps({"status": "PUBLICATION_STOP", "execution_enabled": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
