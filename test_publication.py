import copy
import datetime as dt
import hashlib
import json
import unittest
from marketplace.pokter import COMMERCE, PROVIDER, CURRENCY
from marketplace.publish import prepare_publication
from marketplace.service_terms import DELIVERABLES, QUALITY, RETENTION_SECONDS
from marketplace.worker import canonical_bytes
from policy import assess
from server import fixture


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.now = 2000000000
        wallet = "0x" + "1" * 40
        task = "Assess Venus testnet wallet " + wallet
        digest, sig = "0x" + "a" * 64, "0x" + "b" * 130
        description = {"protocol": "pokter-job", "version": 1, "identity": {"chainId": 97, "tokenId": "2583"},
            "provider": PROVIDER, "category": "health-factor", "task": task,
            "quote": {"negotiationHash": digest, "providerSignature": sig}}
        # RPC is represented only by a boundary fixture; this isn't live chain evidence.
        self.observed = {"attested": True, "synthetic": False, "source_kind": "OBSERVED", "funding_verified": True,
            "agent_id": 2583, "chain_id": 97, "deployment": COMMERCE,
            "funding": {"block_timestamp": self.now, "block_number": 1},
            "job": {"id": "7", "provider": PROVIDER, "statusName": "FUNDED", "expiredAt": str(self.now+900),
                "budget": "100", "description": json.dumps(description)},
            "verified_quote": {"verified_at_funding": True, "envelope": {"negotiation_hash": digest,
                "provider_sig": sig, "chain_id": 97, "verifying_contract": COMMERCE,
                "request": {"task_description": task}, "response": {"accepted": True, "terms": {
                    "price": "100", "currency": CURRENCY, "deliverables": DELIVERABLES, "quality_standards": QUALITY}}}}}
        snapshot = fixture("hold")
        snapshot.update(source_kind="OBSERVED", rpc_url="https://bsc-testnet-dataseed.bnbchain.org", wallet_address=wallet,
            block_timestamp=self.now, checked_at=dt.datetime.fromtimestamp(self.now,dt.timezone.utc).isoformat().replace("+00:00","Z"))
        receipt = assess(snapshot, collector_attested=True)
        receipt_bytes = canonical_bytes(receipt)
        manifest = {"version":1, "chain_id":97, "job_id":7,
            "contracts":{"commerce":COMMERCE,"router":"0xd7d36d66d2f1b608a0f943f722d27e3744f66f25","policy":"0xd6a4217588f6b1f5657a92a3e94e6422ad771cea"},
            "response":{"content_type":"application/json","content":receipt},
            "metadata":{"agent_id":2583,"job_evidence_kind":"REVIEWED_LOCAL_READER","receipt_sha256":hashlib.sha256(receipt_bytes).hexdigest()}}
        blob = canonical_bytes(manifest)
        self.record = {"job_key":f"erc8183:97:{COMMERCE}:7", "manifest_bytes":blob,
            "manifest_sha256":hashlib.sha256(blob).hexdigest(),"receipt_bytes":receipt_bytes,
            "receipt_sha256":hashlib.sha256(receipt_bytes).hexdigest()}

    def test_exact_stored_bytes_and_signed_45_day_retention(self):
        result = prepare_publication(self.record,self.observed,now=self.now)
        self.assertIs(result["manifest_bytes"],self.record["manifest_bytes"])
        self.assertEqual(result["expires_at"],self.now+RETENTION_SECONDS)
        self.assertEqual(result["quote_hash"],"0x"+"a"*64)

    def test_missing_consent_and_synthetic_proof_never_export(self):
        for mutation in [lambda o:o.update(synthetic=True),lambda o:o.update(attested=False),
                         lambda o:o["verified_quote"]["envelope"]["response"]["terms"].update(quality_standards="assessment")]:
            observed=copy.deepcopy(self.observed);mutation(observed)
            with self.assertRaises(ValueError):prepare_publication(self.record,observed,now=self.now)

    def test_wrong_job_changed_bytes_and_expired_hire_stop(self):
        for record in [{**self.record,"job_key":self.record["job_key"][:-1]+"8"},
                       {**self.record,"manifest_bytes":self.record["manifest_bytes"]+b" "}]:
            with self.assertRaises(ValueError):prepare_publication(record,self.observed,now=self.now)
        with self.assertRaises(ValueError):prepare_publication(self.record,self.observed,now=self.now+900)

    def test_authenticated_rpc_url_and_extra_signed_terms_are_rejected(self):
        observed=copy.deepcopy(self.observed)
        observed["verified_quote"]["envelope"]["response"]["terms"]["success_criteria"]=["private"]
        with self.assertRaises(ValueError):prepare_publication(self.record,observed,now=self.now)
        manifest=json.loads(self.record["manifest_bytes"])
        snapshot=manifest["response"]["content"]["normalized_snapshot"]
        snapshot["rpc_url"]="https://user:placeholder@example.invalid/rpc?key=placeholder"
        receipt=assess(snapshot,collector_attested=True)
        receipt_bytes=canonical_bytes(receipt);manifest["response"]["content"]=receipt
        manifest["metadata"]["receipt_sha256"]=hashlib.sha256(receipt_bytes).hexdigest()
        blob=canonical_bytes(manifest)
        record={**self.record,"manifest_bytes":blob,"manifest_sha256":hashlib.sha256(blob).hexdigest(),
            "receipt_bytes":receipt_bytes,"receipt_sha256":hashlib.sha256(receipt_bytes).hexdigest()}
        with self.assertRaises(ValueError):prepare_publication(record,self.observed,now=self.now)

    def test_price_and_currency_remain_bound_to_funded_quote(self):
        for changed in [{"price":"101"},{"price":"01"},{"price":True},
                        {"price":str(10**18+1)},{"currency":"0x"+"1"*40}]:
            observed=copy.deepcopy(self.observed)
            observed["verified_quote"]["envelope"]["response"]["terms"].update(changed)
            with self.assertRaises(ValueError):prepare_publication(self.record,observed,now=self.now)


if __name__ == "__main__": unittest.main()
