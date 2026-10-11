"""Fixed assessment service and publication terms; no lending authority."""
import re

PAYMENT_TOKEN = "0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565"
DELIVERABLES = "A canonical JSON policy receipt for one public Venus Core testnet wallet, committed in an ERC-8183 manifest."
QUALITY = "As-of-block Venus Core chain 97 assessment. NEED_EVIDENCE accepted. Public JSON delivery retained for 45 days after the assessment. | Position Guard ERC-8004 97/2583; assess_venus_position; read-only"
RETENTION_SECONDS = 45 * 24 * 60 * 60


def publication_consent(envelope):
    terms = envelope.get("response", {}).get("terms", {})
    return (type(terms) is dict and set(terms) == {"deliverables", "quality_standards", "price", "currency"}
            and isinstance(terms.get("price"), str) and re.fullmatch(r"[1-9][0-9]{0,18}", terms["price"]) is not None
            and int(terms["price"]) <= 10**18
            and isinstance(terms.get("currency"), str) and terms["currency"].lower() == PAYMENT_TOKEN
            and envelope.get("response", {}).get("accepted") is True
            and terms.get("deliverables") == DELIVERABLES
            and terms.get("quality_standards") == QUALITY)
