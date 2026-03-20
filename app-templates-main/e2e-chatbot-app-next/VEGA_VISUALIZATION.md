# Vega-Lite Visualization Support

This chatbot now supports rendering interactive **Vega-Lite visualizations** directly in the chat interface.

## How It Works

When your Multi-Agent System (MAS) returns a Vega-Lite specification in its response, the frontend will automatically detect and render it as an interactive chart.

## Architecture

```
User: "Show me sales by region as a bar chart"
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│ Express Backend: POST /api/chat                         │
│   → Calls MAS endpoint                                  │
│   → MAS calls UC function (vegalite_chart)              │
│   → UC function generates Vega-Lite spec                │
└─────────────────────────┬───────────────────────────────┘
                          │ returns spec in response
                          ▼
┌─────────────────────────────────────────────────────────┐
│ React Frontend                                          │
│   → Detects Vega-Lite spec in message text              │
│   → Extracts spec and renders VegaChart component       │
│   → vega-embed creates interactive visualization        │
└─────────────────────────────────────────────────────────┘
```

## Setup Requirements

### 1. Create a Unity Catalog Function

You need to create a UC function that generates Vega-Lite specifications. This function should:

- Accept parameters like chart type, data, and labels
- Return a valid Vega-Lite v5+ JSON specification
- Handle different chart types (bar, line, scatter, pie, etc.)

**Example UC Function:**

```sql
CREATE OR REPLACE FUNCTION catalog.schema.vegalite_chart(
  chart_type STRING,
  data_json STRING,
  x_field STRING,
  y_field STRING,
  title STRING
)
RETURNS STRING
LANGUAGE PYTHON
AS $$
import json

def generate_vegalite(chart_type, data_json, x_field, y_field, title):
    data = json.loads(data_json)

    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "data": {"values": data},
        "mark": chart_type,
        "encoding": {
            "x": {"field": x_field, "type": "nominal"},
            "y": {"field": y_field, "type": "quantitative"}
        }
    }

    return json.dumps(spec)

return generate_vegalite(chart_type, data_json, x_field, y_field, title)
$$;
```

### 2. Add Function to MAS as MCP Tool

Configure your Multi-Agent System to use this UC function via MCP:

```yaml
# In your agent configuration
tools:
  - name: vegalite_chart
    type: uc_function
    function_name: catalog.schema.vegalite_chart
    description: "Generate Vega-Lite visualization specifications"
```

### 3. Agent Response Format

The agent should return the Vega-Lite spec in one of these formats:

**Format 1: JSON Code Block** (Recommended)
```
Here's a visualization of your data:

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "mark": "bar",
  "encoding": {...},
  "data": {...}
}
```
```

**Format 2: Inline JSON**
```
Here's the chart: {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", ...}
```

**Format 3: JSON After Colon**
```
Here's your visualization:
{"$schema": "https://vega.github.io/schema/vega-lite/v5.json", ...}
```

## Supported Chart Types

The Vega-Lite spec supports various chart types:

- **Bar charts**: `"mark": "bar"`
- **Line charts**: `"mark": "line"`
- **Scatter plots**: `"mark": "point"`
- **Area charts**: `"mark": "area"`
- **Pie charts**: Use `"mark": "arc"` with theta encoding
- **Stacked/Grouped charts**: Add `"stack"` property to encoding
- **Multi-series**: Use `"color"` encoding for categories

## Example Agent Prompt

Add this to your agent's system prompt:

```
When the user asks for data visualization:
1. Call the vegalite_chart UC function with appropriate parameters
2. Return the resulting Vega-Lite spec in a JSON code block
3. Add a brief description before the visualization

Example response format:
"Here's a bar chart showing sales by region:

```json
{JSON_SPEC_HERE}
```
"
```

## Features

- **Interactive**: Charts support zoom, pan, and tooltips
- **Export**: Users can export charts as PNG or SVG
- **Responsive**: Charts adapt to container width
- **Dark mode**: Support for light/dark theme switching (customize in component)

## Troubleshooting

### Chart Not Rendering

1. **Check Console**: Open browser DevTools → Console for errors
2. **Validate Spec**: Ensure the JSON is valid Vega-Lite v5+ format
3. **Check Schema**: Spec must include `$schema` or have `mark`/`encoding`/`data` fields

### Invalid Specification Error

The spec detector looks for:
- `"$schema"` field containing "vega-lite"
- OR presence of `"mark"`, `"layer"`, or `"spec"` fields
- AND `"data"` or `"encoding"` fields

### Performance Issues

For large datasets (>1000 rows):
- Use `"renderer": "canvas"` instead of SVG
- Consider data aggregation in the UC function
- Use Vega transforms for client-side aggregation

## Customization

### Theming

Update `VegaChart` component to support dark mode:

```tsx
// client/src/components/vega-chart.tsx
const theme = useTheme(); // from your theme provider

await embed(containerRef.current!, spec, {
  theme: theme === 'dark' ? 'dark' : 'light',
  // ...
});
```

### Styling

Customize chart container in `vega-chart.tsx`:

```tsx
className={cn(
  'vega-chart-container my-4 overflow-auto rounded-lg border p-4',
  'bg-white dark:bg-gray-800', // Add dark mode styles
  className,
)}
```

## Resources

- [Vega-Lite Documentation](https://vega.github.io/vega-lite/)
- [Vega-Lite Examples](https://vega.github.io/vega-lite/examples/)
- [Vega-Embed API](https://github.com/vega/vega-embed)
- [Databricks UC Functions](https://docs.databricks.com/sql/language-manual/sql-ref-functions.html)

## Technical Details

### Dependencies

- `vega`: Core visualization grammar
- `vega-lite`: High-level visualization grammar
- `vega-embed`: Embedding Vega specs in web pages

### Files Added/Modified

- `client/src/components/vega-chart.tsx` - Chart rendering component
- `client/src/lib/vega-utils.ts` - Spec detection and extraction
- `client/src/components/message.tsx` - Integration with message rendering

### How Detection Works

1. For each assistant message text part
2. Run `extractVegaSpec()` to find JSON specs
3. If valid Vega-Lite spec found:
   - Remove spec from text
   - Render text normally
   - Render VegaChart component with spec

This approach keeps text and visualizations separate while maintaining streaming support.
