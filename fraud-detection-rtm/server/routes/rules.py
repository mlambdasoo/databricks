from dataclasses import asdict
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..engine import engine
from ..llm import parse_rule_nl

router = APIRouter()


class NLRuleRequest(BaseModel):
    text: str


class ManualRuleRequest(BaseModel):
    name: str
    type: str
    params: dict


@router.get("/rules")
async def list_rules():
    return [asdict(r) for r in engine.rules.values()]


@router.post("/rules/parse")
async def parse_rule(req: NLRuleRequest):
    try:
        parsed = await parse_rule_nl(req.text)
        rule = engine.add_rule(
            name=parsed["name"],
            rtype=parsed["type"],
            params=parsed["params"],
            nl_text=req.text,
        )
        return asdict(rule)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse rule: {e}")


@router.post("/rules")
async def create_rule(req: ManualRuleRequest):
    rule = engine.add_rule(name=req.name, rtype=req.type, params=req.params)
    return asdict(rule)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str):
    if not engine.remove_rule(rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@router.post("/rules/{rule_id}/toggle")
async def toggle_rule(rule_id: str):
    rule = engine.toggle_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return asdict(rule)
