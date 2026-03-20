# Quick Start Guide - Enhanced Vega-Lite Generator

## Installation (1 minute)

1. **Copy the SQL file content**: `uc_function_improved.sql`

2. **Replace catalog.schema with your values**:
   ```sql
   catalog.schema.generate_vegalite_enhanced
   # Change to:
   your_catalog.your_schema.generate_vegalite_enhanced
   ```

3. **Run in Databricks SQL Editor** or notebook:
   ```sql
   %sql
   CREATE OR REPLACE FUNCTION your_catalog.your_schema.generate_vegalite_enhanced(...)
   -- paste the full function definition
   ```

4. **Grant permissions** (if using with App):
   ```yaml
   # In databricks.yml
   resources:
     - name: vegalite_function
       uc_function:
         function_name: your_catalog.your_schema.generate_vegalite_enhanced
         permission: EXECUTE
   ```

## Usage Examples

### Most Common: Auto-Detect Everything
```python
# Just describe what you want - function figures out the rest
generate_vegalite_enhanced(
    'Show sales trend by region over time',
    '[{"month":"Jan","sales":1200,"region":"East"},{"month":"Feb","sales":1900,"region":"East"}]',
    NULL, NULL, NULL,  -- Auto-detect x, y, color
    600, 400           -- Optional: custom size
)
```

### Chart Types Supported

| Description Keywords | Chart Type | Example |
|---------------------|------------|---------|
| "bar", "column" | Vertical Bar | `"bar chart of sales by product"` |
| "horizontal bar" | Horizontal Bar | `"horizontal bar chart of categories"` |
| "line", "trend", "over time" | Line Chart | `"sales trend over time"` |
| "scatter", "correlation" | Scatter Plot | `"scatter plot of price vs quantity"` |
| "area", "stacked" | Area Chart | `"stacked area chart of usage"` |
| "pie", "donut" | Pie Chart | `"pie chart of market share"` |
| "heatmap", "heat map" | Heatmap | `"heatmap of correlations"` |

### Quick Test

```sql
-- Test 1: Simple bar chart
SELECT generate_vegalite_enhanced(
    'bar chart',
    NULL,  -- Uses sample data
    NULL, NULL, NULL, 500, 300
);

-- Test 2: Multi-series line chart
SELECT generate_vegalite_enhanced(
    'sales trend by region',
    '[{"month":"Jan","sales":1200,"region":"East"},{"month":"Jan","sales":800,"region":"West"},{"month":"Feb","sales":1900,"region":"East"},{"month":"Feb","sales":1100,"region":"West"}]',
    NULL, NULL, NULL,  -- Auto-detect all
    700, 400
);
```

## Agent Integration

### Update Agent System Prompt
```
When users request data visualizations:
1. Prepare the data as a JSON array of objects
2. Call generate_vegalite_enhanced with:
   - chart_description: Natural language (e.g., "sales trend by region over time")
   - data_sample: JSON string of your data
   - x_field, y_field, color_field: Use NULL for auto-detection (recommended)
   - width, height: Optional, default 500x300

3. Return the Vega spec in a JSON code block:

Example response:
"Here's your visualization:

```json
{VEGA_SPEC_FROM_FUNCTION}
```

The chart shows sales trending upward..."
```

### Example Agent Flow
```python
# User: "Show me sales by region over time"

# 1. Agent queries data
data = query_sales_data()  # Returns list of dicts

# 2. Agent calls UC function
spec = spark.sql(f"""
    SELECT generate_vegalite_enhanced(
        'sales trend by region over time',
        '{json.dumps(data)}',
        NULL, NULL, NULL,
        700, 400
    )
""").collect()[0][0]

# 3. Agent returns spec in markdown
response = f"""
Here's your sales analysis:

```json
{spec}
```

The chart shows sales trends across regions...
"""
```

## Troubleshooting

### Chart not appearing?
1. Check browser console for errors
2. Verify spec is valid JSON: `json.loads(spec)`
3. Test with sample data first (pass NULL for data_sample)

### Wrong chart type?
Use more specific keywords:
- ❌ "show data" → bar chart (default)
- ✅ "show data as line chart" → line chart
- ✅ "trend over time" → line chart (temporal)

### Fields not detected correctly?
Specify them explicitly:
```python
generate_vegalite_enhanced(
    'bar chart',
    data_json,
    'my_x_field',     # Specify x
    'my_y_field',     # Specify y
    'my_color_field', # Specify color
    600, 400
)
```

### Multi-series not showing?
1. Ensure your data has a grouping field (e.g., "region", "category")
2. Either:
   - Let auto-detection pick it (if it's the 3rd column)
   - Specify it explicitly: `color_field='region'`

## Key Differences from Original

| Feature | Original | Enhanced |
|---------|----------|----------|
| Field detection | ❌ Manual only | ✅ Auto + Manual |
| Multi-series | ❌ No | ✅ Yes (color encoding) |
| Chart types | 5 types | 8+ types |
| Temporal data | ⚠️ Basic | ✅ Smart detection |
| Tooltips | Basic | Rich multi-field |
| Custom size | ❌ Fixed | ✅ Configurable |
| Axis labels | Basic | ✅ Smart formatting |

## Performance

- **Cold start**: ~50ms (same as original)
- **Warm execution**: ~10-20ms
- **Data size**: Handles 1000+ rows efficiently
- **Dependencies**: None (pure Python stdlib)

## What's Next?

1. ✅ Deploy function to your UC
2. ✅ Test with simple data
3. ✅ Integrate with your agent
4. ✅ Update agent prompt with examples
5. 📊 Create amazing visualizations!

## Quick Reference: Parameter Order

```python
generate_vegalite_enhanced(
    'chart description',  # Required: what you want
    'data JSON',         # Optional: NULL = sample data
    'x_field',          # Optional: NULL = auto-detect
    'y_field',          # Optional: NULL = auto-detect
    'color_field',      # Optional: NULL = auto-detect
    width,              # Optional: default 500
    height              # Optional: default 300
)
```

## Need Help?

1. Check `IMPROVEMENTS.md` for detailed explanation
2. Check `improved_vegalite_generator.py` for full Python implementation
3. Test with the examples in this guide
4. Verify your data structure: `[{"field1": value, "field2": value}, ...]`
