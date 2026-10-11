"""Real verifier subprocess, dummy signature only; never creates a signature."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

from marketplace.preissued import PreissuedNegotiator, _json_bytes


class RealVerifierTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node") and
                         (Path(__file__).parent / "read_only/node_modules/viem").is_dir(),
                         "Node verifier dependencies unavailable")
    def test_production_verifier_rejects_shape_valid_dummy_signature(self):
        root = Path(__file__).parent
        node = shutil.which("node")
        script = """
const {prepareQuote,BINDINGS}=require('./marketplace/negotiation.cjs');
const terms=require('./marketplace/service_profile.json');
const task='Assess Venus Core testnet position for wallet '+BINDINGS.provider+'. I consent to public JSON delivery retained for 45 days.';
const d=prepareQuote({task,terms,priceWei:100000000000000000n,now:Math.floor(Date.now()/1000),ttlSeconds:900});
process.stdout.write(JSON.stringify({...d.envelope,provider_sig:'0x'+'a'.repeat(130)}));
"""
        made = subprocess.run([node, "-e", script], cwd=root, capture_output=True, timeout=5, check=True)
        envelope = json.loads(made.stdout)
        record = {"schema_version": 1, "scope": "PREISSUED_QUOTE_RELEASE", "state": "AUTHORIZED",
                  "provider": "0xF9Ad22cAA6C179Eee86806FA10176e845ea8e982", "agent_id": 2583,
                  "chain_id": 97, "authorized_until": int(time.time()) + 60,
                  "envelope_sha256": hashlib.sha256(_json_bytes(envelope)).hexdigest(), "envelope": envelope}
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            path = Path(directory) / "offer.json"
            path.write_text(json.dumps(record)); path.chmod(0o600)
            negotiator = PreissuedNegotiator(path, node)
            with self.assertRaisesRegex(ValueError, "PREISSUED_QUOTE_UNAVAILABLE"):
                negotiator({"skill": "negotiate", "task_description": envelope["request"]["task_description"],
                            "terms": {k: envelope["response"]["terms"][k] for k in
                                      ("deliverables", "quality_standards")}})


if __name__ == "__main__": unittest.main()
