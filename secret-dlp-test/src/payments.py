"""Payment processing module (ordinary source code — should be ALLOWED)."""
from dataclasses import dataclass


@dataclass
class Charge:
    amount_cents: int
    currency: str = "USD"


def total(charges: list[Charge]) -> int:
    return sum(c.amount_cents for c in charges)


def format_amount(cents: int, currency: str = "USD") -> str:
    return f"{cents / 100:.2f} {currency}"
