import os
import json
from openai import AsyncOpenAI
from .config import get_oauth_token, get_workspace_host, IS_DATABRICKS_APP

RULE_PARSE_SYSTEM = """You are a fraud detection rule parser. Convert natural language rules into structured JSON.

Output ONLY valid JSON with this schema:
{
  "name": "short descriptive name",
  "type": "velocity|geo_anomaly|country_blacklist|amount_threshold|time_window",
  "params": { ...type-specific parameters... }
}

Type-specific params:
- velocity: {"count": int, "window_minutes": int, "group_by": "customer_id"|"card_number"|"merchant_name"}
- geo_anomaly: {"max_distance_km": int, "window_minutes": int}
- country_blacklist: {"countries": ["XX", "YY"]}
- amount_threshold: {"min_amount": float, "max_amount": float|null}
- time_window: {"start_hour": int, "end_hour": int, "category": "ATM Withdrawal"|"any"}

Examples:
"alert 3 similar transactions in 10 min" -> {"name":"Rapid transactions","type":"velocity","params":{"count":3,"window_minutes":10,"group_by":"customer_id"}}
"transactions from China or Russia" -> {"name":"Blocked countries","type":"country_blacklist","params":{"countries":["CN","RU"]}}
"different locations in 30 minutes" -> {"name":"Impossible travel","type":"geo_anomaly","params":{"max_distance_km":500,"window_minutes":30}}
"transactions over $5000" -> {"name":"High amount","type":"amount_threshold","params":{"min_amount":5000,"max_amount":null}}
"ATM withdrawals between 1-4 AM" -> {"name":"Late night ATM","type":"time_window","params":{"start_hour":1,"end_hour":4,"category":"ATM Withdrawal"}}
"""


def get_llm_client() -> AsyncOpenAI:
    host = get_workspace_host()
    if IS_DATABRICKS_APP:
        token = os.environ.get("DATABRICKS_TOKEN") or get_oauth_token()
    else:
        token = get_oauth_token()
    return AsyncOpenAI(api_key=token, base_url=f"{host}/serving-endpoints")


async def parse_rule_nl(text: str) -> dict:
    model = os.environ.get("SERVING_ENDPOINT", "databricks-claude-sonnet-4-5")
    client = get_llm_client()
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": RULE_PARSE_SYSTEM},
            {"role": "user", "content": text},
        ],
        max_tokens=512,
        temperature=0,
    )
    raw = response.choices[0].message.content.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(raw)
