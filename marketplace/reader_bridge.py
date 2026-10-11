"""Bounded private Python/Node IPC. Client JSON cannot supply RPC URLs or attestations."""
import json
import subprocess
from pathlib import Path


class FundingReader:
    def __init__(self, *, quote_store, node="node", runner=subprocess.run):
        self.quotes=quote_store
        self.node=node
        self.runner=runner
        self.script=Path(__file__).with_name("funding_reader.cjs")

    def call(self, payload):
        raw=json.dumps(payload,ensure_ascii=True,allow_nan=False)
        if len(raw.encode())>32768:
            raise ValueError("READER_REQUEST_LIMIT")
        result=self.runner([self.node,"--max-old-space-size=64",str(self.script)],input=raw,
                           capture_output=True,text=True,timeout=90,check=False)
        if result.returncode!=0 or len(result.stdout.encode())>65536:
            raise ValueError("FUNDING_READER_UNAVAILABLE")
        try:
            decoded=json.loads(result.stdout)
        except (ValueError,TypeError):
            raise ValueError("FUNDING_READER_INVALID_RESPONSE") from None
        if not isinstance(decoded,dict):
            raise ValueError("FUNDING_READER_INVALID_RESPONSE")
        return decoded

    def read(self, job_id):
        if type(job_id) is not int or not 0<job_id<=2**53-1:
            raise ValueError("JOB_ID_STOP")
        description=self.call({"mode":"describe","job_id":str(job_id)})
        envelope=self.quotes.get(description["quote_hash"])
        if envelope is None:
            raise ValueError("ISSUED_QUOTE_NOT_FOUND")
        # Crypto and onchain proof are re-derived for this funding block; never trust a cached bool.
        return self.call({"mode":"verify","job_id":str(job_id),"envelope":envelope})
