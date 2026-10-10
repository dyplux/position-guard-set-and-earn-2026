import unittest

from maintenance.mandate import EXISTING_KINDS, Mandate, validate_mandate


OWNER = "0x" + "a1" * 20
OTHER = "0x" + "b2" * 20


def mandate(**changes):
    values = {
        "owner": OWNER,
        "borrower": OWNER,
        "chain_id": 97,
        "allowed_kinds": EXISTING_KINDS,
        "max_value_wei": 100,
        "max_gas_wei": 20,
        "reserve_wei": 10,
        "expires_at": 1000,
    }
    values.update(changes)
    return Mandate(**values)


class MandateTests(unittest.TestCase):
    def valid_call(self, **changes):
        policy = changes.pop("mandate", None) or mandate()
        values = {
            "owner": OWNER,
            "borrower": OWNER,
            "chain_id": 97,
            "kind": "SUPPLY_COLLATERAL",
            "value_wei": 50,
            "gas_wei": 10,
            "balance_wei": 70,
            "now": 999,
        }
        values.update(changes)
        return validate_mandate(policy, **values)

    def test_valid_matching_mandate(self):
        self.assertTrue(self.valid_call())

    def test_owner_borrower_and_chain_mismatches(self):
        self.assertFalse(self.valid_call(owner=OTHER))
        self.assertFalse(self.valid_call(borrower=OTHER))
        self.assertFalse(self.valid_call(chain_id=56))
        self.assertFalse(self.valid_call(owner=OTHER, borrower=OTHER))

    def test_expiry_is_exclusive(self):
        self.assertFalse(self.valid_call(now=1000))
        self.assertTrue(self.valid_call(now=999))

    def test_kind_ceiling_and_reserve_are_enforced(self):
        self.assertFalse(self.valid_call(kind="NOT_AN_EXISTING_KIND"))
        self.assertFalse(self.valid_call(value_wei=101))
        self.assertFalse(self.valid_call(gas_wei=21))
        self.assertFalse(self.valid_call(balance_wei=69))
        self.assertTrue(self.valid_call(balance_wei=70))

    def test_bool_and_noninteger_values_raise(self):
        for field, value in (("chain_id", True), ("value_wei", 1.0),
                             ("gas_wei", "10"), ("balance_wei", False), ("now", 1.0)):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    self.valid_call(**{field: value})

    def test_invalid_mandate_limits_and_address_raise(self):
        with self.assertRaises(ValueError):
            self.valid_call(mandate=mandate(max_value_wei=0))
        with self.assertRaises(ValueError):
            self.valid_call(mandate=mandate(reserve_wei=-1))
        with self.assertRaises(ValueError):
            self.valid_call(mandate=mandate(owner="0x" + "0" * 40))

    def test_mandate_can_restrict_to_one_kind(self):
        policy = mandate(allowed_kinds=("REPAY_BOUNDED",))
        self.assertFalse(self.valid_call(mandate=policy))
        self.assertTrue(self.valid_call(mandate=policy,kind="REPAY_BOUNDED"))
        for kinds in [(),("REPAY_BOUNDED","REPAY_BOUNDED"),("BORROW",)]:
            with self.assertRaises(ValueError):self.valid_call(mandate=mandate(allowed_kinds=kinds))


if __name__ == "__main__":
    unittest.main()
