"""
Fraud detection simulation engine.
Generates realistic transaction stream with ramp-up, applies rules, emits alerts.
"""

import asyncio
import math
import random
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Optional

# --- Data models ---

CUSTOMERS = [
    ("CUST001", 37.7749, -122.4194, "San Francisco, CA"),
    ("CUST002", 40.7128, -74.0060, "New York, NY"),
    ("CUST003", 41.8781, -87.6298, "Chicago, IL"),
    ("CUST004", 34.0522, -118.2437, "Los Angeles, CA"),
    ("CUST005", 29.7604, -95.3698, "Houston, TX"),
    ("CUST006", 33.4484, -112.0740, "Phoenix, AZ"),
    ("CUST007", 47.6062, -122.3321, "Seattle, WA"),
    ("CUST008", 39.7392, -104.9903, "Denver, CO"),
    ("CUST009", 25.7617, -80.1918, "Miami, FL"),
    ("CUST010", 42.3601, -71.0589, "Boston, MA"),
]

CATEGORIES = ["Grocery", "Gas Station", "Restaurant", "Online Shopping",
              "ATM Withdrawal", "Electronics", "Travel", "Pharmacy", "Clothing"]
MERCHANTS = {
    "Grocery": ["Whole Foods", "Trader Joe's", "Safeway", "Kroger"],
    "Gas Station": ["Shell", "Chevron", "BP", "ExxonMobil"],
    "Restaurant": ["Chipotle", "Starbucks", "McDonald's", "Panera"],
    "Online Shopping": ["Amazon", "eBay", "Walmart.com", "Target.com"],
    "ATM Withdrawal": ["Chase ATM", "Wells Fargo ATM", "BofA ATM"],
    "Electronics": ["Best Buy", "Apple Store", "Micro Center"],
    "Travel": ["Delta Airlines", "Marriott Hotels", "Airbnb"],
    "Pharmacy": ["CVS", "Walgreens", "Rite Aid"],
    "Clothing": ["Nordstrom", "H&M", "Zara", "Nike"],
}
AMOUNT_RANGES = {
    "Grocery": (8, 250), "Gas Station": (15, 90), "Restaurant": (6, 180),
    "Online Shopping": (3, 600), "ATM Withdrawal": (20, 500),
    "Electronics": (30, 2500), "Travel": (80, 4000),
    "Pharmacy": (4, 120), "Clothing": (15, 400),
}
FRAUD_LOCATIONS = [
    (55.76, 37.62, "Moscow", "RU"), (39.90, 116.41, "Beijing", "CN"),
    (6.52, 3.38, "Lagos", "NG"), (19.43, -99.13, "Mexico City", "MX"),
    (-23.55, -46.63, "Sao Paulo", "BR"),
]
CHANNELS = ["POS", "Online", "ATM", "Mobile", "Contactless"]


@dataclass
class Transaction:
    transaction_id: str
    timestamp: str
    customer_id: str
    card_number: str
    merchant_name: str
    merchant_category: str
    amount: float
    currency: str = "USD"
    channel: str = "POS"
    latitude: float = 0.0
    longitude: float = 0.0
    city: str = ""
    country: str = "US"
    is_international: bool = False
    is_fraud: int = 0
    fraud_reason: str = ""
    _inject_time: float = 0.0


@dataclass
class FraudRule:
    id: str
    name: str
    type: str  # velocity|geo_anomaly|country_blacklist|amount_threshold|time_window
    params: dict
    enabled: bool = True
    nl_text: str = ""
    created_at: str = ""
    alert_count: int = 0


@dataclass
class Alert:
    id: str
    timestamp: str
    rule_id: str
    rule_name: str
    rule_type: str
    customer_id: str
    transaction_id: str
    details: str
    severity: str = "high"  # low|medium|high|critical
    detection_ms: float = 0.0  # time from ingestion to alert


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))


class FraudEngine:
    def __init__(self):
        self.rules: dict[str, FraudRule] = {}
        self.alerts: deque[Alert] = deque(maxlen=500)
        self._running = False
        self._subscribers: list[asyncio.Queue] = []
        # State for rule evaluation
        self._txn_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=200))
        # Metrics
        self._start_time: Optional[float] = None
        self._txn_count = 0
        self._current_rate = 0
        self._target_rate = 1_000_000
        self._ramp_seconds = 30  # ramp to target in 30s
        self._alert_count = 0
        self._fraud_seeds_pending: list[dict] = []

    # --- Rule management ---

    def add_rule(self, name: str, rtype: str, params: dict, nl_text: str = "") -> FraudRule:
        rule = FraudRule(
            id=str(uuid.uuid4())[:8],
            name=name, type=rtype, params=params,
            nl_text=nl_text,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.rules[rule.id] = rule
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        return self.rules.pop(rule_id, None) is not None

    def toggle_rule(self, rule_id: str) -> Optional[FraudRule]:
        rule = self.rules.get(rule_id)
        if rule:
            rule.enabled = not rule.enabled
        return rule

    # --- Subscription ---

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers = [s for s in self._subscribers if s is not q]

    async def _broadcast(self, msg: dict):
        dead = []
        for q in self._subscribers:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.remove(q)

    # --- Transaction generation ---

    def _gen_normal(self) -> Transaction:
        cid, lat, lon, city = random.choice(CUSTOMERS)
        cat = random.choice(CATEGORIES)
        lo, hi = AMOUNT_RANGES[cat]
        merch = random.choice(MERCHANTS[cat])
        ch = "ATM" if cat == "ATM Withdrawal" else ("Online" if cat == "Online Shopping" else random.choice(CHANNELS))
        return Transaction(
            transaction_id=uuid.uuid4().hex[:12],
            timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            customer_id=cid, card_number=f"****-****-****-{random.randint(1000,9999)}",
            merchant_name=merch, merchant_category=cat,
            amount=round(random.uniform(lo, hi), 2),
            channel=ch,
            latitude=round(lat + random.uniform(-0.05, 0.05), 6),
            longitude=round(lon + random.uniform(-0.05, 0.05), 6),
            city=city, country="US",
        )

    def _gen_fraud(self, seed: dict) -> Transaction:
        """Generate a fraud transaction from a seed config."""
        cid, lat, lon, city = random.choice(CUSTOMERS)
        fraud_type = seed.get("type", "geo_impossible_travel")
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        inject_time = seed.get("_inject_time", 0.0)

        if fraud_type == "geo_impossible_travel":
            fl = random.choice(FRAUD_LOCATIONS)
            return Transaction(
                transaction_id=uuid.uuid4().hex[:12], timestamp=now_str,
                customer_id=seed.get("customer_id", cid),
                card_number=f"****-****-****-{random.randint(1000,9999)}",
                merchant_name="Unknown Merchant", merchant_category="Electronics",
                amount=round(random.uniform(500, 3000), 2),
                channel="POS", latitude=fl[0], longitude=fl[1],
                city=fl[2], country=fl[3], is_international=True,
                is_fraud=1, fraud_reason="geo_impossible_travel", _inject_time=inject_time,
            )
        elif fraud_type == "rapid_fire":
            return Transaction(
                transaction_id=uuid.uuid4().hex[:12], timestamp=now_str,
                customer_id=seed.get("customer_id", cid),
                card_number=f"****-****-****-{random.randint(1000,9999)}",
                merchant_name="QuickMart Express", merchant_category="Clothing",
                amount=round(random.uniform(200, 999), 2),
                channel="POS", latitude=lat, longitude=lon,
                city=city, country="US", is_fraud=1, fraud_reason="rapid_fire", _inject_time=inject_time,
            )
        elif fraud_type == "high_amount":
            return Transaction(
                transaction_id=uuid.uuid4().hex[:12], timestamp=now_str,
                customer_id=seed.get("customer_id", cid),
                card_number=f"****-****-****-{random.randint(1000,9999)}",
                merchant_name="Luxury Jewelers Intl", merchant_category="Electronics",
                amount=round(random.uniform(8000, 25000), 2),
                channel="POS", latitude=lat + 3, longitude=lon + 3,
                city="Unknown", country="US", is_fraud=1, fraud_reason="unusual_high_amount", _inject_time=inject_time,
            )
        elif fraud_type == "foreign_country":
            fl = random.choice(FRAUD_LOCATIONS)
            return Transaction(
                transaction_id=uuid.uuid4().hex[:12], timestamp=now_str,
                customer_id=seed.get("customer_id", cid),
                card_number=f"****-****-****-{random.randint(1000,9999)}",
                merchant_name=random.choice(["ShadyDeals.ru", "CheapElectronics.cn", "BargainGifts.ng"]),
                merchant_category="Online Shopping",
                amount=round(random.uniform(100, 2000), 2),
                channel="Online", latitude=fl[0], longitude=fl[1],
                city=fl[2], country=fl[3], is_international=True,
                is_fraud=1, fraud_reason="card_not_present_foreign", _inject_time=inject_time,
            )
        elif fraud_type == "midnight_atm":
            return Transaction(
                transaction_id=uuid.uuid4().hex[:12], timestamp=now_str,
                customer_id=seed.get("customer_id", cid),
                card_number=f"****-****-****-{random.randint(1000,9999)}",
                merchant_name="Unknown ATM", merchant_category="ATM Withdrawal",
                amount=float(random.choice([200, 300, 400, 500])),
                channel="ATM", latitude=lat, longitude=lon,
                city=city, country="US", is_fraud=1, fraud_reason="midnight_atm_spree", _inject_time=inject_time,
            )
        # Fallback
        return self._gen_normal()

    # --- Rule evaluation ---

    def _evaluate_rules(self, txn: Transaction) -> list[Alert]:
        alerts = []
        history = self._txn_history[txn.customer_id]
        history.append(txn)

        for rule in self.rules.values():
            if not rule.enabled:
                continue
            alert = self._check_rule(rule, txn, history)
            if alert:
                rule.alert_count += 1
                alerts.append(alert)
        return alerts

    def _check_rule(self, rule: FraudRule, txn: Transaction, history: deque) -> Optional[Alert]:
        p = rule.params
        now_ts = time.time()

        if rule.type == "velocity":
            window = p.get("window_minutes", 10) * 60
            count_threshold = p.get("count", 3)
            recent = [t for t in history if (now_ts - self._parse_ts(t.timestamp)) < window]
            if len(recent) >= count_threshold:
                return self._make_alert(rule, txn, f"{len(recent)} transactions in {p.get('window_minutes')}min for {txn.customer_id}", "high")

        elif rule.type == "geo_anomaly":
            window = p.get("window_minutes", 30) * 60
            max_dist = p.get("max_distance_km", 500)
            # Only check the immediately previous transaction for this customer
            recent = [t for t in history if (now_ts - self._parse_ts(t.timestamp)) < window and t.transaction_id != txn.transaction_id]
            if recent:
                prev = recent[-1]  # compare only to last txn
                dist = _haversine_km(prev.latitude, prev.longitude, txn.latitude, txn.longitude)
                if dist > max_dist and txn._inject_time > 0:
                    return self._make_alert(rule, txn, f"Impossible travel: {int(dist)}km in <{p.get('window_minutes')}min ({prev.city} → {txn.city})", "critical")

        elif rule.type == "country_blacklist":
            blocked = [c.upper() for c in p.get("countries", [])]
            if txn.country.upper() in blocked and txn.is_international:
                return self._make_alert(rule, txn, f"Transaction from blocked country: {txn.country} ({txn.city})", "critical")

        elif rule.type == "amount_threshold":
            min_amt = p.get("min_amount", 0)
            max_amt = p.get("max_amount")
            if txn.amount >= min_amt and (max_amt is None or txn.amount <= max_amt):
                return self._make_alert(rule, txn, f"Amount ${txn.amount:,.2f} exceeds threshold ${min_amt:,.2f}", "high")

        elif rule.type == "time_window":
            hour = datetime.fromisoformat(txn.timestamp.replace("Z", "+00:00")).hour
            start_h = p.get("start_hour", 1)
            end_h = p.get("end_hour", 4)
            cat = p.get("category", "any")
            if start_h <= hour <= end_h and (cat == "any" or txn.merchant_category == cat):
                return self._make_alert(rule, txn, f"{txn.merchant_category} at {hour}:00 (rule: {start_h}-{end_h}h)", "medium")

        return None

    def _parse_ts(self, ts: str) -> float:
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
        except Exception:
            return time.time()

    def _make_alert(self, rule: FraudRule, txn: Transaction, details: str, severity: str) -> Alert:
        now = time.time()
        detection_ms = round((now - txn._inject_time) * 1000, 1) if txn._inject_time > 0 else 0.0
        return Alert(
            id=uuid.uuid4().hex[:8],
            timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            rule_id=rule.id, rule_name=rule.name, rule_type=rule.type,
            customer_id=txn.customer_id, transaction_id=txn.transaction_id,
            details=details, severity=severity, detection_ms=detection_ms,
        )

    # --- Seed injection ---

    def inject_seeds(self, seeds: list[dict]):
        inject_time = time.time()
        for s in seeds:
            s["_inject_time"] = inject_time
        self._fraud_seeds_pending.extend(seeds)

    # --- Main loop ---

    async def start(self):
        if self._running:
            return
        self._running = True
        self._start_time = time.time()
        self._txn_count = 0
        asyncio.create_task(self._run_loop())

    async def stop(self):
        self._running = False

    async def _run_loop(self):
        """Emit transactions and metrics at ~20 ticks/sec for smooth UI updates."""
        tick_interval = 0.05  # 50ms
        sample_rate = 200  # generate this many sample txns per tick for rule evaluation

        while self._running:
            elapsed = time.time() - self._start_time
            # Ramp up: 0 -> target over ramp_seconds using ease-out curve
            ramp_frac = min(1.0, elapsed / self._ramp_seconds)
            eased = 1 - (1 - ramp_frac) ** 3  # cubic ease-out
            base = self._target_rate * eased
            # Add realistic jitter: +/- 5% noise + occasional micro-spikes
            jitter = random.gauss(0, 0.03) * base
            spike = random.uniform(-0.02, 0.05) * base if random.random() < 0.15 else 0
            self._current_rate = max(0, int(base + jitter + spike))
            self._txn_count += int(self._current_rate * tick_interval)

            # Process sample transactions for rule evaluation
            new_alerts = []
            for _ in range(sample_rate):
                # Check for pending fraud seeds
                if self._fraud_seeds_pending:
                    seed = self._fraud_seeds_pending.pop(0)
                    txn = self._gen_fraud(seed)
                else:
                    txn = self._gen_normal()
                alerts = self._evaluate_rules(txn)
                new_alerts.extend(alerts)

            # Store alerts
            for a in new_alerts:
                self.alerts.appendleft(a)
                self._alert_count += 1

            # Broadcast metrics
            await self._broadcast({
                "type": "metrics",
                "data": {
                    "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                    "rate": self._current_rate,
                    "total": self._txn_count,
                    "elapsed": round(elapsed, 1),
                    "alert_count": self._alert_count,
                    "ramp_pct": round(eased * 100, 1),
                }
            })

            # Broadcast new alerts
            for a in new_alerts:
                await self._broadcast({
                    "type": "alert",
                    "data": asdict(a),
                })

            await asyncio.sleep(tick_interval)


# Singleton
engine = FraudEngine()
