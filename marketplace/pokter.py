"""Bind Pokter's onchain job envelope to a locally verified seller quote."""
import json
import re
from marketplace.atlas_bridge import address, uint

PROVIDER = "0xf9ad22caa6c179eee86806fa10176e845ea8e982"
COMMERCE = "0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de"
CURRENCY = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565"


def _bind_pokter_job(observed, *, quote_lookup):
    """No HTTP-provided attestation: both readers are controlled local dependencies."""
    if (observed.get("attested") is not True or type(observed.get("chain_id")) is not int
            or observed["chain_id"] != 97 or address(observed["deployment"]) != COMMERCE):
        raise ValueError("REVIEWED_JOB_READER_REQUIRED")
    job = observed["job"]
    if job["statusName"] != "FUNDED" or address(job["provider"]) != PROVIDER:
        raise ValueError("FUNDED_PROVIDER_JOB_REQUIRED")
    raw = job["description"]
    if not isinstance(raw, str) or len(raw.encode()) > 4096:
        raise ValueError("BOUNDED_DESCRIPTION_REQUIRED")
    envelope = json.loads(raw)
    identity = envelope["identity"]
    quote = envelope["quote"]
    if (envelope.get("protocol") != "pokter-job" or type(envelope.get("version")) is not int
            or envelope["version"] != 1 or type(identity.get("chainId")) is not int
            or identity["chainId"] != 97 or identity.get("tokenId") != "2583"
            or address(envelope["provider"]) != PROVIDER
            or envelope.get("category") not in {"health-factor", "health_factor"}):
        raise ValueError("POKTER_IDENTITY_BINDING_STOP")
    digest = quote["negotiationHash"]
    if not isinstance(digest,str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}",digest):
        raise ValueError("QUOTE_HASH_REQUIRED")
    stored = quote_lookup(digest.lower())
    if stored is None or stored.get("verified_at_funding") is not True:
        raise ValueError("VERIFIED_QUOTE_AT_FUNDED_BLOCK_REQUIRED")
    original = stored["envelope"]
    if (original["negotiation_hash"].lower() != digest.lower()
            or original["provider_sig"].lower() != quote["providerSignature"].lower()
            or original["request"]["task_description"] != envelope["task"]
            or type(original["chain_id"]) is not int or original["chain_id"] != 97 or address(original["verifying_contract"]) != COMMERCE
            or address(original["response"]["terms"]["currency"]) != CURRENCY
            or uint(original["response"]["terms"]["price"]) != uint(job["budget"])):
        raise ValueError("QUOTE_JOB_BINDING_STOP")
    # A generic price enquiry doesn't authorize a job lacking an analysed wallet.
    wallets = set(re.findall(r"0x[0-9a-fA-F]{40}\b",envelope["task"]))
    if len(wallets) != 1 or "venus" not in envelope["task"].lower():
        raise ValueError("SINGLE_VENUS_WALLET_REQUIRED")
    return {"task":"assess_venus_position","chain_id":97,"wallet":address(wallets.pop()),
            "agent_id":2583,"quote_hash":digest.lower(),"marketplace":"pokter",
            "execution_enabled":False}


def bind_pokter_job(observed, *, quote_lookup):
    """Local envelope binding only; doesn't authorize processing or submission."""
    try:
        return _bind_pokter_job(observed,quote_lookup=quote_lookup)
    except (KeyError,TypeError,AttributeError,ValueError,OverflowError,RecursionError):
        raise ValueError("POKTER_JOB_BINDING_STOP") from None
