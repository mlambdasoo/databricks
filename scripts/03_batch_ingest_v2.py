# Databricks notebook source

from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField,
    StringType, DoubleType, BooleanType, IntegerType
)

SOURCE_PATH  = "/Volumes/mitchell_grewer_meijer/fraud_demo/landing_zone/input"
TARGET_TABLE = "mitchell_grewer_meijer.fraud_demo.bank_transaction_v2"

# COMMAND ----------

schema = StructType([
    StructField("transaction_id",               StringType(),  True),
    StructField("sender_account_id",            StringType(),  True),
    StructField("sender_name",                  StringType(),  True),
    StructField("sender_bank",                  StringType(),  True),
    StructField("receiver_account_id",          StringType(),  True),
    StructField("receiver_name",                StringType(),  True),
    StructField("receiver_bank",                StringType(),  True),
    StructField("transfer_type",                StringType(),  True),
    StructField("amount",                       DoubleType(),  True),
    StructField("currency",                     StringType(),  True),
    StructField("channel",                      StringType(),  True),
    StructField("memo",                         StringType(),  True),
    StructField("is_international",             BooleanType(), True),
    StructField("sender_account_age_days",      IntegerType(), True),
    StructField("sender_avg_daily_amount",      DoubleType(),  True),
    StructField("sender_transaction_count_24h", IntegerType(), True),
    StructField("sender_ip_address",            StringType(),  True),
    StructField("sender_latitude",              DoubleType(),  True),
    StructField("sender_longitude",             DoubleType(),  True),
    StructField("sender_city",                  StringType(),  True),
    StructField("sender_country",               StringType(),  True),
    StructField("sender_region",                StringType(),  True),
    StructField("receiver_latitude",            DoubleType(),  True),
    StructField("receiver_longitude",           DoubleType(),  True),
    StructField("receiver_city",                StringType(),  True),
    StructField("receiver_country",             StringType(),  True),
    StructField("receiver_region",              StringType(),  True),
    StructField("distance_km",                  DoubleType(),  True),
    StructField("sender_device_id",             StringType(),  True),
    StructField("sender_device_os",             StringType(),  True),
    StructField("event_time",                   StringType(),  True),
])

# COMMAND ----------
# JSON 파일 목록 확인
files = dbutils.fs.ls(SOURCE_PATH)
print(f"소스 파일 수: {len(files)}")

# 배치 읽기
df = (
    spark.read
        .format("json")
        .schema(schema)
        .load(SOURCE_PATH)
        .withColumn("event_time", F.to_timestamp("event_time"))
)

row_count = df.count()
print(f"읽은 행 수: {row_count}")

# Delta 테이블에 append
df.write \
    .format("delta") \
    .mode("append") \
    .saveAsTable(TARGET_TABLE)

print(f"[완료] {row_count}건 → {TARGET_TABLE}")

# COMMAND ----------
# 결과 확인
total = spark.table(TARGET_TABLE).count()
print(f"bank_transaction_v2 총 건수: {total}")
display(spark.table(TARGET_TABLE).orderBy(F.col("event_time").desc()).limit(10))
