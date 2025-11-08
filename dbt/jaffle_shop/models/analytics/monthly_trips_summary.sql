{{ config(
    materialized='materialized_view',
    partition_by='trip_month',
    description='운행 데이터(trips)를 기반으로 월별 평균 운행 거리와 평균 요금을 집계하는 구체화된 뷰입니다.',
    tblproperties={
        'data_quality_level': 'high'
    },
    schedule = {
        'cron': '0 0 * ? * * *'
    }
) }}

SELECT
    DATE_TRUNC('month', tpep_pickup_datetime) AS trip_month,
    COUNT(*) AS total_trips,
    AVG(trip_distance) AS avg_trip_distance_miles,
    AVG(fare_amount) AS avg_fare_amount
FROM {{ ref('long_distance_trips') }}
GROUP BY 1
