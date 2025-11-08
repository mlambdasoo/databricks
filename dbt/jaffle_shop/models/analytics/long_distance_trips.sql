{{ config(
    materialized='streaming_table',
    partition_by='pickup_zip',
    description='실시간 운행 데이터에서 1마일 이상의 장거리 운행만 필터링하여 지속적으로 처리하는 스트리밍 테이블입니다.'
) }}

SELECT
    tpep_pickup_datetime,
    tpep_dropoff_datetime,
    trip_distance,
    fare_amount,
    pickup_zip,
    dropoff_zip
FROM STREAM ({{ (source('nyc_raw', 'trips')) }})
WHERE
    trip_distance >= 1.0
