# Databricks notebook source
# MAGIC %md
# MAGIC ## Bank Transactions - Auto Loader Streaming → bank_transaction_v2

# COMMAND ----------

from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType, StructField,
    StringType, DoubleType, BooleanType, IntegerType
)

SOURCE_PATH     = "/Volumes/mitchell_grewer_meijer/fraud_demo/landing_zone/input"
CHECKPOINT_PATH = "/Volumes/mitchell_grewer_meijer/fraud_demo/landing_zone/checkpoints/bank_txn_v2_final"
TARGET_TABLE    = "mitchell_grewer_meijer.fraud_demo.bank_transaction_v2"

# COMMAND ----------
# MAGIC %md ### 1. 스키마

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
# MAGIC %md ### 2. Auto Loader Streaming (availableNow)

query = (
    spark.readStream
        .format("cloudFiles")
        .option("cloudFiles.format", "json")
        .option("cloudFiles.schemaLocation", f"{CHECKPOINT_PATH}/schema")
        .option("cloudFiles.inferColumnTypes", "false")
        .option("cloudFiles.includeExistingFiles", "true")
        .schema(schema)
        .load(SOURCE_PATH)
        .withColumn("event_time", F.to_timestamp("event_time"))
        .writeStream
        .format("delta")
        .outputMode("append")
        .option("checkpointLocation", CHECKPOINT_PATH)
        .trigger(availableNow=True)
        .toTable(TARGET_TABLE)
)

print(f"Query ID: {query.id}")
query.awaitTermination()

if query.exception():
    raise Exception(str(query.exception()))

progress = query.lastProgress or {}
print(f"[완료] inputRows={progress.get('numInputRows', 0)}, batchId={progress.get('batchId','-')}")

# COMMAND ----------
# MAGIC %md ### 3. 결과 확인

count = spark.table(TARGET_TABLE).count()
print(f"bank_transaction_v2 총 건수: {count}")
display(spark.table(TARGET_TABLE).orderBy(F.col("event_time").desc()).limit(10))
