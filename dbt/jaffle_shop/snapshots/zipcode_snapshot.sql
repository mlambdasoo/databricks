-- snapshots/zipcode_snapshot.sql 
{% snapshot dim_zipcode_snapshot %}

{{ config(
    tblproperties={
      'delta.autoOptimize.optimizeWrite' : 'true',
      'delta.autoOptimize.autoCompact' : 'true'
    }
 ) }}

{{
    config(
        target_database='sudong',
        target_schema='dbt_snapshot',
        unique_key='zipcode_id',       
        strategy='check',             
        check_cols=['city', 'borough'],
        file_format='delta'
    )
}}

select * from {{ source('nyc_raw', 'zipcodes') }}

{% endsnapshot %}