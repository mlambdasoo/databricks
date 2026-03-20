-- Enhanced Vega-Lite v5 Generator UC Function
-- Drop-in replacement with backward compatibility + new features

CREATE OR REPLACE FUNCTION catalog.schema.generate_vegalite_enhanced(
  chart_description STRING COMMENT 'Natural language description of desired chart (e.g., "bar chart of sales by month")',
  data_sample STRING COMMENT 'JSON array of data objects. If empty, uses sample data',
  x_field STRING COMMENT 'Field name for x-axis. Leave NULL for auto-detection',
  y_field STRING COMMENT 'Field name for y-axis. Leave NULL for auto-detection',
  color_field STRING COMMENT 'Field name for color encoding (optional, for multi-series)',
  width INT COMMENT 'Chart width in pixels (default: 500)',
  height INT COMMENT 'Chart height in pixels (default: 300)'
)
RETURNS STRING
COMMENT 'Enhanced Vega-Lite v5 generator with intelligent field detection, multi-series support, and 8+ chart types'
LANGUAGE PYTHON
AS $$
import json

def infer_field_type(values):
    """Infer Vega-Lite field type from sample values."""
    if not values:
        return "nominal"

    # Check for numeric values
    numeric_count = sum(1 for v in values if isinstance(v, (int, float)) and not isinstance(v, bool))
    if numeric_count == len(values):
        return "quantitative"

    # Check for temporal patterns
    if isinstance(values[0], str):
        temporal_patterns = any("-" in str(v) or "/" in str(v) or (len(str(v)) == 4 and str(v).isdigit()) for v in values)
        if temporal_patterns:
            return "temporal"

    return "nominal"


def parse_and_validate_data(data_sample):
    """Parse and validate input data with fallback."""
    data_values = []

    if data_sample and data_sample.strip():
        try:
            parsed = json.loads(data_sample)
            if isinstance(parsed, list) and len(parsed) > 0:
                if all(isinstance(item, dict) for item in parsed):
                    data_values = parsed
        except (json.JSONDecodeError, TypeError):
            pass

    # Default sample data
    if not data_values:
        data_values = [
            {"category": "A", "value": 28, "group": "X"},
            {"category": "B", "value": 55, "group": "Y"},
            {"category": "C", "value": 43, "group": "X"}
        ]

    return data_values


def transform_to_long_format(data_values, x_field, value_fields, type_field_name="series", value_field_name="value"):
    """Transform wide format data to long format for multi-series charts."""
    long_data = []

    for row in data_values:
        x_value = row.get(x_field)
        for field in value_fields:
            if field in row:
                long_row = {
                    x_field: x_value,
                    type_field_name: field.replace("_", " ").title(),
                    value_field_name: row[field]
                }
                # Include any other non-value fields
                for k, v in row.items():
                    if k != x_field and k not in value_fields:
                        long_row[k] = v
                long_data.append(long_row)

    return long_data, type_field_name, value_field_name


def detect_fields(data_values, provided_x, provided_y, provided_color):
    """Auto-detect appropriate fields if not provided."""
    if not data_values or not isinstance(data_values[0], dict):
        return "category", "value", None

    fields = list(data_values[0].keys())

    if len(fields) < 2:
        return "category", "value", None

    # Categorize fields by type
    numeric_fields = []
    non_numeric_fields = []

    for field in fields:
        sample_val = data_values[0].get(field)
        if isinstance(sample_val, (int, float)) and not isinstance(sample_val, bool):
            numeric_fields.append(field)
        else:
            non_numeric_fields.append(field)

    # Use provided fields if available, with validation
    if provided_x and provided_x in fields:
        x_field = provided_x
    else:
        # Prefer non-numeric for x-axis (categories, time)
        x_field = non_numeric_fields[0] if non_numeric_fields else fields[0]

    if provided_y and provided_y in fields:
        y_field = provided_y
    else:
        # Prefer numeric for y-axis
        y_field = numeric_fields[0] if numeric_fields else (fields[1] if len(fields) > 1 else "value")

    # Auto-detect color field if not provided
    color_field_auto = None
    if not provided_color:
        # Look for common grouping field names
        group_keywords = ['type', 'category', 'group', 'series', 'name', 'region', 'class']
        for field in fields:
            if field.lower() in group_keywords and field != x_field and field != y_field:
                color_field_auto = field
                break

        # Otherwise use a non-numeric field that's not x
        if not color_field_auto:
            for field in non_numeric_fields:
                if field != x_field:
                    color_field_auto = field
                    break

    return x_field, y_field, color_field_auto


# Validation
if not chart_description or not chart_description.strip():
    return json.dumps({
        "error": "chart_description cannot be empty",
        "status": "failed"
    })

# Parse and validate data
data_values = parse_and_validate_data(data_sample)

# Get description in lowercase for keyword matching
description_lower = chart_description.lower()

# Auto-detect fields
x_field_final, y_field_final, color_field_auto = detect_fields(data_values, x_field, y_field, color_field)
color_field_final = color_field or color_field_auto

# Check if we need to transform data for multi-series (comparing, vs, versus keywords)
needs_transformation = False
compare_keywords = ["comparing", "compare", " vs ", " versus ", "both"]
if any(keyword in description_lower for keyword in compare_keywords):
    # Find all numeric fields (excluding the detected y_field if we want to compare others)
    numeric_fields = []
    for field in data_values[0].keys():
        if field != x_field_final:
            sample_val = data_values[0].get(field)
            if isinstance(sample_val, (int, float)) and not isinstance(sample_val, bool):
                numeric_fields.append(field)

    # If we have 2+ numeric fields and no explicit color field, transform to long format
    if len(numeric_fields) >= 2 and not color_field:
        data_values, color_field_final, y_field_final = transform_to_long_format(
            data_values, x_field_final, numeric_fields
        )
        needs_transformation = True

# Get field types
x_values = [item.get(x_field_final) for item in data_values if x_field_final in item]
y_values = [item.get(y_field_final) for item in data_values if y_field_final in item]

x_type = infer_field_type(x_values)
y_type = infer_field_type(y_values)

# Base configuration
base_spec = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "description": chart_description,
    "data": {"values": data_values},
    "width": width or 500,
    "height": height or 300
}

# Chart type detection (enhanced)
if any(word in description_lower for word in ["pie", "donut"]):
    # Pie chart
    encoding = {
        "theta": {"field": y_field_final, "type": "quantitative"},
        "color": {
            "field": x_field_final,
            "type": "nominal",
            "legend": {"title": x_field_final.replace("_", " ").title()}
        },
        "tooltip": [
            {"field": x_field_final, "type": "nominal"},
            {"field": y_field_final, "type": "quantitative"}
        ]
    }
    mark_config = {"type": "arc", "tooltip": True}

elif any(word in description_lower for word in ["heatmap", "heat map"]):
    # Heatmap
    encoding = {
        "x": {"field": x_field_final, "type": x_type},
        "y": {"field": y_field_final, "type": "nominal"},
        "color": {
            "field": color_field_final or y_field_final,
            "type": "quantitative",
            "scale": {"scheme": "viridis"}
        },
        "tooltip": [
            {"field": x_field_final, "type": x_type},
            {"field": y_field_final, "type": "nominal"},
            {"field": color_field_final or y_field_final, "type": "quantitative"}
        ]
    }
    mark_config = {"type": "rect", "tooltip": True}

elif any(word in description_lower for word in ["scatter", "point", "correlation"]):
    # Scatter plot
    mark_config = {"type": "point", "tooltip": True, "size": 60}
    x_type_adj = "quantitative"
    y_type_adj = "quantitative"

elif any(word in description_lower for word in ["line", "trend", "time series", "over time"]):
    # Line chart
    mark_config = {"type": "line", "point": True, "tooltip": True}
    x_type_adj = "temporal" if x_type == "temporal" else "ordinal"
    y_type_adj = "quantitative"

elif any(word in description_lower for word in ["area", "stacked"]):
    # Area chart
    mark_config = {"type": "area", "tooltip": True}
    x_type_adj = "temporal" if x_type == "temporal" else "ordinal"
    y_type_adj = "quantitative"

elif any(word in description_lower for word in ["horizontal bar", "bar horizontal"]):
    # Horizontal bar
    mark_config = {"type": "bar", "tooltip": True}
    # Swap axes for horizontal
    x_type_adj = "quantitative"
    y_type_adj = "nominal"
    x_field_final, y_field_final = y_field_final, x_field_final

else:
    # Default: vertical bar chart
    mark_config = {"type": "bar", "tooltip": True}
    x_type_adj = "nominal"
    y_type_adj = "quantitative"

# Build encoding for standard charts (if not pie/heatmap)
if "encoding" not in locals():
    encoding = {
        "x": {
            "field": x_field_final,
            "type": x_type_adj,
            "title": x_field_final.replace("_", " ").title(),
            "axis": {"labelAngle": -45} if x_type_adj == "nominal" else {}
        },
        "y": {
            "field": y_field_final,
            "type": y_type_adj,
            "title": y_field_final.replace("_", " ").title()
        },
        "tooltip": [
            {"field": x_field_final, "type": x_type_adj},
            {"field": y_field_final, "type": y_type_adj}
        ]
    }

    # Add color encoding for multi-series
    if color_field_final:
        encoding["color"] = {
            "field": color_field_final,
            "type": "nominal",
            "legend": {"title": color_field_final.replace("_", " ").title()}
        }
        encoding["tooltip"].append({"field": color_field_final, "type": "nominal"})

# Build final spec
spec = {
    **base_spec,
    "mark": mark_config,
    "encoding": encoding,
    "config": {
        "view": {"stroke": None},
        "axis": {"labelFontSize": 11, "titleFontSize": 12}
    }
}

return json.dumps(spec)
$$;

-- Example usage:
-- SELECT generate_vegalite_enhanced(
--   'Show sales trend over time',
--   '[{"month":"Jan","sales":1200,"region":"East"},{"month":"Feb","sales":1900,"region":"East"}]',
--   NULL,  -- auto-detect x
--   NULL,  -- auto-detect y
--   'region',  -- use region for color
--   600,   -- width
--   400    -- height
-- );
