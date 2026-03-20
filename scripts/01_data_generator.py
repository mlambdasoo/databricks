# Databricks notebook source
# MAGIC %md
# MAGIC ## Bank Transactions - 합성 데이터 Generator
# MAGIC Volume 소스 경로에 JSON 파일을 주기적으로 생성합니다.

# COMMAND ----------

import json
import random
import time
from datetime import datetime, timezone

SOURCE_PATH = "/Volumes/mitchell_grewer_meijer/fraud_demo/landing_zone/input"
BATCH_SIZE  = 20     # 파일 당 레코드 수
INTERVAL_SEC = 5     # 파일 생성 간격 (초)
NUM_BATCHES  = 10    # 총 생성 횟수 (None = 무한)

# COMMAND ----------

BANKS          = ["KB국민은행", "신한은행", "하나은행", "우리은행", "농협은행", "IBK기업은행"]
TRANSFER_TYPES = ["일반이체", "즉시이체", "예약이체", "자동이체"]
CHANNELS       = ["모바일앱", "인터넷뱅킹", "ATM", "영업점"]
DEVICE_OS      = ["iOS", "Android", "Windows", "macOS"]
CITIES         = ["서울", "부산", "인천", "대구", "대전", "광주", "수원"]
REGIONS        = ["서울특별시", "부산광역시", "경기도", "인천광역시", "대구광역시"]
COUNTRIES      = ["KR", "US", "JP", "CN", "DE"]
SURNAMES       = ["김", "이", "박", "최", "정", "강", "조", "윤"]
NAMES          = ["민준", "서연", "지호", "수빈", "예준", "지은", "현우", "나연"]


def random_account_id():
    return f"ACC{random.randint(10000000, 99999999)}"

def random_name():
    return random.choice(SURNAMES) + random.choice(NAMES)

def make_record(seq_id):
    now_iso = datetime.now(timezone.utc).isoformat()
    is_intl = random.random() < 0.1
    return {
        "transaction_id":             f"TXN{seq_id:010d}{random.randint(1000,9999)}",
        "sender_account_id":          random_account_id(),
        "sender_name":                random_name(),
        "sender_bank":                random.choice(BANKS),
        "receiver_account_id":        random_account_id(),
        "receiver_name":              random_name(),
        "receiver_bank":              random.choice(BANKS),
        "transfer_type":              random.choice(TRANSFER_TYPES),
        "amount":                     round(random.uniform(1000, 5_000_000), 2),
        "currency":                   "KRW" if not is_intl else random.choice(["USD","EUR","JPY"]),
        "channel":                    random.choice(CHANNELS),
        "memo":                       f"이체 #{seq_id}",
        "is_international":           is_intl,
        "sender_account_age_days":    random.randint(30, 3650),
        "sender_avg_daily_amount":    round(random.uniform(100_000, 2_000_000), 2),
        "sender_transaction_count_24h": random.randint(1, 20),
        "sender_ip_address":          f"192.168.{random.randint(0,255)}.{random.randint(1,254)}",
        "sender_latitude":            round(random.uniform(33.0, 38.5), 6),
        "sender_longitude":           round(random.uniform(125.5, 129.5), 6),
        "sender_city":                random.choice(CITIES),
        "sender_country":             "KR",
        "sender_region":              random.choice(REGIONS),
        "receiver_latitude":          round(random.uniform(33.0, 38.5), 6),
        "receiver_longitude":         round(random.uniform(125.5, 129.5), 6),
        "receiver_city":              random.choice(CITIES),
        "receiver_country":           "KR" if not is_intl else random.choice(COUNTRIES),
        "receiver_region":            random.choice(REGIONS),
        "distance_km":                round(random.uniform(0, 500), 2),
        "sender_device_id":           f"DEV{random.randint(100000, 999999)}",
        "sender_device_os":           random.choice(DEVICE_OS),
        "event_time":                 now_iso,
    }

# COMMAND ----------

dbutils.fs.mkdirs(SOURCE_PATH)
print(f"소스 경로 준비 완료: {SOURCE_PATH}")

seq = 0
batch = 0
while NUM_BATCHES is None or batch < NUM_BATCHES:
    records = [make_record(seq + i) for i in range(BATCH_SIZE)]
    seq += BATCH_SIZE

    filename = f"{SOURCE_PATH}/batch_{batch:05d}_{int(time.time())}.json"
    json_lines = "\n".join(json.dumps(r, ensure_ascii=False) for r in records)

    dbutils.fs.put(filename, json_lines, overwrite=True)
    print(f"[batch {batch+1:3d}] {filename.split('/')[-1]} → {BATCH_SIZE}건 생성 (누적 {seq}건)")

    batch += 1
    if NUM_BATCHES is None or batch < NUM_BATCHES:
        time.sleep(INTERVAL_SEC)

print(f"\n완료: 총 {seq}건 생성")
