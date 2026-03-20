select
    {{ dbt_utils.generate_surrogate_key(['tpep_pickup_datetime', 'tpep_dropoff_datetime', 'trip_distance']) }} as trip_key,
    
    tpep_pickup_datetime as pickup_at,
    
    date(tpep_pickup_datetime) as pickup_date,
    cast(date_format(tpep_pickup_datetime, 'HH') as int) as pickup_hour_of_day,
    trip_distance,
    fare_amount
    
from {{ source('nyc_raw', 'trips') }}

where datediff(minute, tpep_pickup_datetime, tpep_dropoff_datetime) >= 1
  and trip_distance > 0