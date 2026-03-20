# Next Steps - Vega-Lite Visualization Setup

You're now on the `feature/vega-visualization` branch with all the frontend changes ready!

## Quick Summary

✅ **What's Done:**
- Installed Vega-Lite rendering packages (vega, vega-lite, vega-embed)
- Created VegaChart component to render interactive visualizations
- Added automatic detection of Vega-Lite specs in agent responses
- Updated message rendering to display charts alongside text
- Added comprehensive documentation

## What You Need to Do Next

### 1. Test the Frontend Locally (Optional but Recommended)

```bash
# Start the development server
npm run dev
```

Visit http://localhost:3000 and test by:
- Pasting the example spec from `examples/vega-lite-test.json` into chat
- Wrapping it in a JSON code block:
  ```
  Here's a test chart:
  ```json
  {paste spec here}
  ```
  ```

The chart should render automatically!

### 2. Create Unity Catalog Function in Databricks

You need to create a UC function that generates Vega-Lite specs. Here's a recommended approach:

**Option A: Use the Company's Notebook**
```bash
# If your company provides a notebook (like create_vegalite_uc_function_simple.py)
# Run it in your Databricks workspace
```

**Option B: Create Your Own Function**

See `VEGA_VISUALIZATION.md` for a complete example, or use this minimal version:

```sql
CREATE OR REPLACE FUNCTION catalog.schema.generate_vegalite(
  chart_type STRING COMMENT 'Chart type: bar, line, point, area, arc',
  data_json STRING COMMENT 'JSON array of data objects',
  x_field STRING COMMENT 'Field name for x-axis',
  y_field STRING COMMENT 'Field name for y-axis',
  title STRING COMMENT 'Chart title'
)
RETURNS STRING
COMMENT 'Generates Vega-Lite v5 specification for visualization'
LANGUAGE PYTHON
AS $$
import json

def create_spec(chart_type, data_json, x_field, y_field, title):
    data = json.loads(data_json)

    # Determine field types based on data
    x_type = "nominal" if isinstance(data[0].get(x_field), str) else "quantitative"
    y_type = "quantitative"

    spec = {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": title,
        "data": {"values": data},
        "mark": chart_type,
        "encoding": {
            "x": {"field": x_field, "type": x_type},
            "y": {"field": y_field, "type": y_type}
        }
    }

    return json.dumps(spec)

return create_spec(chart_type, data_json, x_field, y_field, title)
$$;
```

### 3. Add Function to Your Multi-Agent System

Configure your MAS agent to use the UC function:

**If using Agent Framework YAML:**
```yaml
# In your agent configuration (agent.yaml or similar)
tools:
  - type: uc_function
    function_name: catalog.schema.generate_vegalite
    description: "Generate interactive visualizations for data analysis"
```

**If using Python SDK:**
```python
from databricks.agents import Agent

agent = Agent(
    name="visualization_agent",
    tools=[
        {
            "type": "uc_function",
            "function_name": "catalog.schema.generate_vegalite"
        }
    ]
)
```

### 4. Update Agent System Prompt

Add visualization instructions to your agent's system prompt:

```
When users request data visualization or charts:
1. Prepare the data as a JSON array of objects
2. Call the generate_vegalite function with:
   - chart_type: "bar", "line", "point", etc.
   - data_json: JSON string of data
   - x_field: name of field for x-axis
   - y_field: name of field for y-axis
   - title: descriptive title

3. Return the Vega-Lite spec in a JSON code block:

Example response:
"Here's your sales analysis:

```json
{VEGA_SPEC_FROM_FUNCTION}
```

The chart shows..."
```

### 5. Grant Permissions (If Using Databricks Apps)

Update `databricks.yml` to grant your app permission to execute the UC function:

```yaml
resources:
  - name: vegalite_function
    uc_function:
      function_name: catalog.schema.generate_vegalite
      permission: EXECUTE
```

Then redeploy:
```bash
databricks bundle deploy
```

### 6. Test End-to-End

Once everything is set up:

1. **Start local dev server**: `npm run dev`
2. **Ask your agent**: "Show me a bar chart of sales by region"
3. **Verify**: The agent should:
   - Call your UC function
   - Return a Vega-Lite spec
   - The frontend should render an interactive chart

### 7. Deploy to Production

When ready:

```bash
# Build the application
npm run build

# Deploy to Databricks Apps
databricks bundle deploy -t prod

# Start the app
databricks bundle run databricks_chatbot -t prod
```

## Troubleshooting

### Chart Not Appearing?

1. **Check browser console** for JavaScript errors
2. **Verify spec format**: Must be valid JSON with Vega-Lite schema
3. **Check agent response**: Ensure spec is in correct format (see VEGA_VISUALIZATION.md)

### Function Not Found?

1. Verify UC function name matches exactly
2. Check catalog/schema permissions
3. Ensure function is in correct catalog/schema

### Permission Errors?

1. Update `databricks.yml` with UC function resource
2. Redeploy bundle: `databricks bundle deploy`
3. Check service principal has EXECUTE permission on function

## Additional Resources

- **Full Documentation**: See `VEGA_VISUALIZATION.md`
- **Vega-Lite Examples**: https://vega.github.io/vega-lite/examples/
- **Databricks UC Functions**: https://docs.databricks.com/en/sql/language-manual/sql-ref-functions-udf-pyspark.html
- **Agent Framework Docs**: https://docs.databricks.com/en/generative-ai/agent-framework/

## Questions?

If you encounter issues:
1. Check the example spec in `examples/vega-lite-test.json`
2. Review `VEGA_VISUALIZATION.md` for detailed troubleshooting
3. Verify your UC function returns valid Vega-Lite v5 JSON

---

**Current Branch**: `feature/vega-visualization`

**To merge**: Once tested, merge this branch into your main branch:
```bash
git checkout main
git merge feature/vega-visualization
```
