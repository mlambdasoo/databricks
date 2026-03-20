# Test Cases for Enhanced UC Function

## Test 1: Multi-Series Comparison (Your Use Case)

### Input Data
```json
[
  {"time": "6 AM", "perceived_energy": 20, "actual_energy": 30, "coffee_cups": 0},
  {"time": "7 AM", "perceived_energy": 40, "actual_energy": 35, "coffee_cups": 1},
  {"time": "8 AM", "perceived_energy": 70, "actual_energy": 55, "coffee_cups": 1}
]
```

### Call
```sql
SELECT generate_vegalite_enhanced(
  'Line chart comparing perceived energy vs actual energy',
  '[{"time":"6 AM","perceived_energy":20,"actual_energy":30},{"time":"7 AM","perceived_energy":40,"actual_energy":35}]',
  NULL,  -- x auto-detected as "time"
  NULL,  -- y auto-detected (will be transformed)
  NULL,  -- color auto-created as "series"
  700,
  400
);
```

### What Happens
1. Function detects keywords: "comparing", "vs"
2. Finds multiple numeric fields: `perceived_energy`, `actual_energy`, `coffee_cups`
3. Transforms data to long format:
```json
[
  {"time": "6 AM", "series": "Perceived Energy", "value": 20},
  {"time": "6 AM", "series": "Actual Energy", "value": 30},
  {"time": "7 AM", "series": "Perceived Energy", "value": 40},
  {"time": "7 AM", "series": "Actual Energy", "value": 35}
]
```
4. Creates multi-series line chart with:
   - x: time
   - y: value
   - color: series (Perceived Energy vs Actual Energy)

## Test 2: Simple Single-Series Line Chart

### Input
```json
[{"month": "Jan", "sales": 1200}, {"month": "Feb", "sales": 1900}]
```

### Call
```sql
SELECT generate_vegalite_enhanced(
  'Show sales trend over time',
  '[{"month":"Jan","sales":1200},{"month":"Feb","sales":1900}]',
  NULL, NULL, NULL, 600, 300
);
```

### Result
Single line chart (no transformation needed)
- x: month
- y: sales

## Test 3: Multi-Series with Explicit Grouping

### Input (Already in Long Format)
```json
[
  {"month": "Jan", "revenue": 1200, "region": "East"},
  {"month": "Jan", "revenue": 800, "region": "West"},
  {"month": "Feb", "revenue": 1900, "region": "East"}
]
```

### Call
```sql
SELECT generate_vegalite_enhanced(
  'Revenue by region over time',
  '...',
  NULL, NULL, 'region',  -- Explicit color field
  700, 400
);
```

### Result
Multi-series line chart (no transformation - data already has grouping field)
- x: month
- y: revenue
- color: region

## Deployment Steps

1. **Copy the updated SQL file**
2. **Replace catalog.schema** with your values
3. **Deploy** to Databricks:
   ```sql
   CREATE OR REPLACE FUNCTION your_catalog.your_schema.generate_vegalite_enhanced(...) ...
   ```

4. **Test with your data**:
   ```sql
   SELECT generate_vegalite_enhanced(
     'Line chart comparing perceived energy vs actual energy throughout the workday',
     '{"your": "data"}',
     NULL, NULL, NULL, 700, 400
   );
   ```

5. **Verify** the output is now a valid spec with correct fields

## Troubleshooting

### If chart still doesn't render:

1. **Check the spec fields match data**:
   - Copy the returned JSON
   - Check `encoding.x.field` exists in `data.values[0]`
   - Check `encoding.y.field` exists in `data.values[0]`
   - Check `encoding.color.field` exists in `data.values[0]`

2. **Test the spec in Vega Editor**:
   - Go to https://vega.github.io/editor/
   - Paste the spec
   - See if it renders

3. **Check browser console** for JavaScript errors

4. **Verify extraction** is working:
   - The frontend `extractVegaFromToolOutput` should extract the spec from:
     `{"columns":["output"],"rows":[["{...spec...}"]]}`

## Keywords for Auto-Transformation

The function triggers multi-series transformation when it detects:
- "comparing"
- "compare"
- " vs "
- " versus "
- "both"

AND the data has 2+ numeric fields.

Examples:
- ✅ "comparing sales vs profit" → transforms
- ✅ "show both revenue and costs" → transforms
- ✅ "compare A vs B over time" → transforms
- ❌ "show sales by region" → no transformation (uses region for color)
- ❌ "line chart of revenue" → no transformation (single metric)
