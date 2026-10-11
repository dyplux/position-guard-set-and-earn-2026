"""Pokter funded-job ingress. Reader/quote proof are local dependencies, not HTTP claims."""
import hashlib
import json
import sqlite3
from marketplace.atlas_bridge import uint, address
from marketplace.pokter import bind_pokter_job, COMMERCE, PROVIDER


class PokterIngress:
    def __init__(self, *, store_path, read_verified_job, allow_synthetic=False):
        if type(allow_synthetic) is not bool:
            raise ValueError("EXPLICIT_SYNTHETIC_MODE_REQUIRED")
        self.reader=read_verified_job
        self.allow_synthetic=allow_synthetic
        self.db=sqlite3.connect(store_path,timeout=5)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,payload_sha TEXT)")
        self.db.commit()

    def close(self):
        self.db.close()

    def ingest(self, job_id, *, now):
        if type(job_id) is not int or not 0<job_id<=2**53-1 or type(now) is not int or now<0:
            raise ValueError("JOB_INPUT_STOP")
        observed=self.reader(job_id)
        # A fork is usable only in an explicitly configured local test harness.
        synthetic=observed.get("synthetic") is True and observed.get("source_kind")=="SYNTHETIC"
        if observed.get("attested") is not True and not (self.allow_synthetic and synthetic):
            raise ValueError("VERIFIED_PUBLIC_JOB_REQUIRED")
        if (observed.get("funding_verified") is not True or type(observed.get("agent_id")) is not int or observed["agent_id"]!=2583
                or type(observed.get("chain_id")) is not int or observed["chain_id"]!=97 or address(observed["deployment"])!=COMMERCE
                or uint(observed["job"]["id"])!=job_id
                or address(observed["job"]["provider"])!=PROVIDER):
            raise ValueError("JOB_PROOF_BINDING_STOP")
        key=f"erc8183:97:{COMMERCE}:{job_id}"
        previous=self.db.execute("SELECT fingerprint,payload,payload_sha FROM jobs WHERE key=?",(key,)).fetchone()
        if observed["job"]["statusName"] in {"SUBMITTED","COMPLETED"} and previous:
            if hashlib.sha256(previous[1].encode()).hexdigest()!=previous[2]:
                raise ValueError("JOB_STORE_CORRUPT")
            old=json.loads(previous[1])
            # Immutable job fields must still match; status/submission fields may advance.
            for field in ["id","client","provider","evaluator","description","budget","expiredAt","hook"]:
                if old["job"].get(field)!=observed["job"].get(field):
                    raise ValueError("ADVANCED_JOB_BINDING_STOP")
            if old.get("funding")!=observed.get("funding"):
                raise ValueError("ADVANCED_JOB_PROVENANCE_STOP")
            return {"job_key":key,"state":"RECONCILIATION_REQUIRED","synthetic":synthetic,
                    "execution_enabled":False,"completed_onchain":False}
        if observed["job"]["statusName"]!="FUNDED" or uint(observed["job"]["expiredAt"])<=now:
            raise ValueError("FUNDED_UNEXPIRED_JOB_REQUIRED")
        funding=observed["funding"]
        if (funding.get("chain_id")!=97 or address(funding["deployment"])!=COMMERCE
                or type(funding.get("block_timestamp")) is not int or funding["block_timestamp"]>now+5):
            raise ValueError("FUNDING_PROVENANCE_STOP")
        proof=observed["verified_quote"]
        task=bind_pokter_job(observed,quote_lookup=lambda digest:proof if proof["envelope"]["negotiation_hash"].lower()==digest else None,allow_synthetic=self.allow_synthetic)
        payload={**observed,"marketplace":"pokter","assessment_task":task}
        serialized=json.dumps(payload,sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False)
        if len(serialized.encode())>32768:
            raise ValueError("JOB_PAYLOAD_TOO_LARGE")
        job=observed["job"]
        fingerprint=hashlib.sha256(json.dumps(job,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            previous=self.db.execute("SELECT fingerprint,payload,payload_sha FROM jobs WHERE key=?",(key,)).fetchone()
            if previous:
                if previous[0]!=fingerprint or hashlib.sha256(previous[1].encode()).hexdigest()!=previous[2]:
                    raise ValueError("JOB_REPLAY_CONFLICT_OR_CORRUPTION")
                old=json.loads(previous[1])
                if old.get("assessment_task")!=task or old.get("funding")!=funding:
                    raise ValueError("JOB_PROOF_REPLAY_CONFLICT")
            else:
                self.db.execute("INSERT INTO jobs VALUES (?,?,?,?)",(key,fingerprint,serialized,hashlib.sha256(serialized.encode()).hexdigest()))
        return {"job_key":key,"state":"VALIDATED_LOCAL_ONLY","synthetic":synthetic,
                "execution_enabled":False,"completed_onchain":False}
