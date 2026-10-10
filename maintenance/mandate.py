"""Unsigned local policy for an owner's own-position maintenance actions.

This module is an unsigned local policy check only.  It is not cryptographic
authorization and never signs, submits, or otherwise authorizes a transaction.
"""

from dataclasses import dataclass
import re


EXISTING_KINDS = (
    "SUPPLY_COLLATERAL",
    "ENTER_COLLATERAL_MARKET",
    "REPAY_BOUNDED",
    "CLOSE_REMAINING_DEBT",
    "REDEEM_AFTER_CLOSE",
)
_KIND_SET = frozenset(EXISTING_KINDS)
_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


@dataclass(frozen=True)
class Mandate:
    owner: str
    borrower: str
    chain_id: int
    allowed_kinds: tuple[str, ...]
    max_value_wei: int
    max_gas_wei: int
    reserve_wei: int
    expires_at: int


def _int(value: object, name: str) -> int:
    if type(value) is not int:
        raise ValueError(f"{name} must be a non-bool int")
    return value


def _address(value: object, name: str) -> str:
    if not isinstance(value, str) or _ADDRESS.fullmatch(value) is None:
        raise ValueError(f"{name} must be a canonical 0x40hex address")
    if value[2:].lower() == "0" * 40:
        raise ValueError(f"{name} must be nonzero")
    return value


def _check_mandate(mandate: Mandate) -> None:
    if not isinstance(mandate, Mandate):
        raise ValueError("mandate must be a Mandate")
    owner = _address(mandate.owner, "mandate.owner")
    borrower = _address(mandate.borrower, "mandate.borrower")
    if owner.lower() != borrower.lower():
        raise ValueError("mandate owner and borrower must match")
    chain_id = _int(mandate.chain_id, "mandate.chain_id")
    if chain_id not in (97, 56):
        raise ValueError("mandate.chain_id must be 97 or 56")
    if (not isinstance(mandate.allowed_kinds, tuple)
            or not mandate.allowed_kinds
            or any(type(kind) is not str for kind in mandate.allowed_kinds)
            or len(set(mandate.allowed_kinds)) != len(mandate.allowed_kinds)
            or not set(mandate.allowed_kinds).issubset(_KIND_SET)):
        raise ValueError("allowed_kinds must be a nonempty unique subset of existing kinds")
    max_value = _int(mandate.max_value_wei, "mandate.max_value_wei")
    max_gas = _int(mandate.max_gas_wei, "mandate.max_gas_wei")
    reserve = _int(mandate.reserve_wei, "mandate.reserve_wei")
    expires = _int(mandate.expires_at, "mandate.expires_at")
    if max_value <= 0 or max_gas <= 0:
        raise ValueError("max value and max gas must be positive")
    if reserve < 0:
        raise ValueError("reserve must be nonnegative")
    if expires < 0:
        raise ValueError("expires_at must be nonnegative")


def validate_mandate(
    mandate: Mandate,
    *,
    owner: str,
    borrower: str,
    chain_id: int,
    kind: str,
    value_wei: int,
    gas_wei: int,
    balance_wei: int,
    now: int,
) -> bool:
    """Evaluate unsigned local policy; this never constitutes cryptographic authorization."""
    _check_mandate(mandate)
    requested_owner = _address(owner, "owner")
    requested_borrower = _address(borrower, "borrower")
    requested_chain = _int(chain_id, "chain_id")
    requested_value = _int(value_wei, "value_wei")
    requested_gas = _int(gas_wei, "gas_wei")
    balance = _int(balance_wei, "balance_wei")
    current_time = _int(now, "now")
    if requested_chain not in (97, 56):
        raise ValueError("chain_id must be 97 or 56")
    if requested_value < 0 or requested_gas < 0 or balance < 0 or current_time < 0:
        raise ValueError("value, gas, balance, and now must be nonnegative")
    if type(kind) is not str:
        raise ValueError("kind must be a string")

    if requested_owner.lower() != requested_borrower.lower():
        return False
    if requested_owner.lower() != mandate.owner.lower():
        return False
    if requested_borrower.lower() != mandate.borrower.lower():
        return False
    if requested_chain != mandate.chain_id:
        return False
    if current_time >= mandate.expires_at:
        return False
    if kind not in mandate.allowed_kinds:
        return False
    if requested_value > mandate.max_value_wei or requested_gas > mandate.max_gas_wei:
        return False
    return balance - requested_value - requested_gas >= mandate.reserve_wei
