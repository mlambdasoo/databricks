-- models/marts/agg_hourly_demand.sql
{{ config(
    materialized='incremental',
    unique_key='pickup_date_hour', 
    incremental_strategy='merge', 
    post_hook=[
      "OPTIMIZE {{ this }} ZORDER BY (pickup_date, pickup_hour_of_day)" 
    ]
) }}

select
    -- Spark SQL의 cast/concat 함수
    cast(concat(date(pickup_date), ' ', pickup_hour_of_day) as string) as pickup_date_hour,
    pickup_date,
    pickup_hour_of_day,
    count(trip_key) as total_trips,
    avg(trip_distance) as avg_trip_distance,
    sum(fare_amount) as total_fare_amount
    
from {{ ref('stg_trips') }}

{% if is_incremental() %}
  -- Incremental 실행 시, 마지막 실행 이후 데이터만 처리하여 비용 절감
  where pickup_date > (select max(pickup_date) from {{ this }})
{% endif %}

group by 1, 2, 3