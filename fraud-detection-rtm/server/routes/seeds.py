from fastapi import APIRouter
from pydantic import BaseModel
from ..engine import engine

router = APIRouter()

SEED_PRESETS = {
    "geo_impossible_travel": {
        "label": "Impossible Travel",
        "description": "Transaction in SF, then Moscow 5 min later",
        "seeds": [{"type": "geo_impossible_travel", "customer_id": "CUST001"}],
    },
    "rapid_fire": {
        "label": "Rapid-Fire Purchases",
        "description": "Quick burst transaction from same customer",
        "seeds": [{"type": "rapid_fire", "customer_id": "CUST003"}],
    },
    "high_amount": {
        "label": "Unusual High Amount",
        "description": "$15K+ purchase at Luxury Jewelers",
        "seeds": [{"type": "high_amount", "customer_id": "CUST005"}],
    },
    "foreign_country": {
        "label": "Foreign Country Transaction",
        "description": "Online purchase from suspicious foreign merchant",
        "seeds": [{"type": "foreign_country", "customer_id": "CUST002"}],
    },
    "midnight_atm": {
        "label": "Midnight ATM Spree",
        "description": "ATM withdrawal at 2-3 AM",
        "seeds": [{"type": "midnight_atm", "customer_id": "CUST007"}],
    },
}


@router.get("/seeds/presets")
async def get_presets():
    return {k: {"label": v["label"], "description": v["description"], "count": len(v["seeds"])} for k, v in SEED_PRESETS.items()}


class InjectRequest(BaseModel):
    preset: str


@router.post("/seeds/inject")
async def inject_seeds(req: InjectRequest):
    preset = SEED_PRESETS.get(req.preset)
    if not preset:
        return {"error": "Unknown preset"}
    engine.inject_seeds(list(preset["seeds"]))
    return {"ok": True, "injected": len(preset["seeds"]), "label": preset["label"]}
