# Stream Overflow Fix - Response Size Limiting

## What Was Added

Added automatic response size monitoring and truncation to prevent `ERR_HTTP2_PROTOCOL_ERROR` and stream disconnections caused by very large agent responses.

## How It Works

### 1. Response Size Monitoring
The server now tracks how many characters are being streamed in real-time:

```typescript
// In server/src/routes/chat.ts
let totalCharsStreamed = 0;

// Monitors each text chunk
if (part.type === 'text') {
  totalCharsStreamed += part.text.length;
}
```

### 2. Automatic Truncation
When the response exceeds the limit (default 50,000 chars), it automatically:
1. Stops streaming further content
2. Appends a truncation message
3. Logs a warning with the size

```typescript
if (totalCharsStreamed > MAX_RESPONSE_SIZE) {
  yield {
    type: 'text',
    text: '\n\n[Response truncated - output too large. Please ask for a more concise response.]',
  };
  break; // Stop processing
}
```

### 3. Configurable Limits
Set via environment variables:

```bash
# In .env file
MAX_RESPONSE_SIZE=50000      # Characters (default: 50K = ~200K tokens)
STREAM_TIMEOUT_MS=300000     # Milliseconds (default: 5 minutes)
```

## Configuration Options

### Development (.env)
```bash
# Larger limit for development
MAX_RESPONSE_SIZE=100000
STREAM_TIMEOUT_MS=600000  # 10 minutes
```

### Production (databricks.yml)
```yaml
resources:
  databricks_chatbot:
    name: ${var.app_name}
    apps:
      - name: ${var.app_name}
        config:
          env:
            - name: MAX_RESPONSE_SIZE
              value: "30000"  # More conservative for production
            - name: STREAM_TIMEOUT_MS
              value: "180000"  # 3 minutes
```

## Testing the Fix

### 1. Restart the Server
```bash
npm run dev
```

### 2. Test with Your Problematic Query
Ask your agent the same query that was causing the stall:
```
"create a detailed comparison chart with energy levels..."
```

### 3. Check the Logs
You should see:
```
Response truncated at 50234 chars (max: 50000) to prevent stream overflow
```

### 4. Verify the Response
The user should see:
- The chart (if it was generated early in the response)
- A truncation message at the end
- No network errors

## Recommended Settings

| Scenario | MAX_RESPONSE_SIZE | Reasoning |
|----------|------------------|-----------|
| **Local Dev** | 100000 (100K) | More lenient for testing |
| **Production** | 30000 (30K) | Force concise responses |
| **Charts/Data** | 50000 (50K) | Balance (default) |

## Still Having Issues?

### If responses are still too large:

1. **Lower the limit** to force agent conciseness:
   ```bash
   MAX_RESPONSE_SIZE=20000  # More aggressive
   ```

2. **Update agent system prompt**:
   ```
   CRITICAL: Keep ALL responses under 5000 characters.
   For visualizations:
   - Return ONLY the Vega JSON spec
   - Maximum 1-2 sentences of explanation
   - NO verbose descriptions
   ```

3. **Add response templates** to your agent:
   ```
   When generating charts:
   "Here's your [chart type]:

   ```json
   {vega_spec}
   ```

   [1 sentence summary]"
   ```

### If streams still disconnect:

1. **Check your serving endpoint timeout**:
   ```bash
   # Databricks serving endpoint may have its own timeout
   databricks serving-endpoints get --name your-endpoint
   ```

2. **Enable request logging**:
   ```typescript
   // In server/src/routes/chat.ts
   console.log('Streaming response size:', totalCharsStreamed);
   ```

3. **Monitor network tab** in browser DevTools:
   - Look for request duration
   - Check response size
   - See where it fails

## Architecture Notes

### Why This Approach?

1. **Server-side protection**: Prevents overwhelming HTTP/2 connections
2. **Graceful degradation**: Users see truncation message, not errors
3. **Configurable**: Adjust limits per environment
4. **Zero frontend changes**: Fix is entirely server-side

### Alternative Approaches Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Agent-side limiting | Most efficient | Requires agent changes | Use in addition |
| Frontend chunking | Good UX | Complex | Not needed now |
| Compression | Saves bandwidth | Doesn't fix root cause | Future consideration |
| **Server monitoring** ✅ | Simple, effective | Requires tuning | **Implemented** |

## Metrics to Monitor

After deploying, track:

1. **Truncation frequency**: How often responses get truncated
   ```bash
   # Check logs for truncation warnings
   grep "Response truncated" server.log | wc -l
   ```

2. **Average response size**: Tune limits based on actual usage
   ```bash
   # Add logging to track average sizes
   console.log('Response size:', totalCharsStreamed);
   ```

3. **Stream errors**: Should decrease significantly
   ```bash
   # Monitor for ERR_HTTP2_PROTOCOL_ERROR
   grep "ERR_HTTP2_PROTOCOL_ERROR" browser_console.log
   ```

## Next Steps

1. ✅ **Deploy the fix**: Restart your server
2. ✅ **Test**: Try your problematic queries
3. ✅ **Tune**: Adjust `MAX_RESPONSE_SIZE` based on results
4. 📝 **Update agent prompt**: Make it more concise
5. 📊 **Monitor**: Track truncation frequency

## Quick Reference

```bash
# Test locally with smaller limit
MAX_RESPONSE_SIZE=20000 npm run dev

# Check current config
echo $MAX_RESPONSE_SIZE

# Tail server logs for truncation warnings
tail -f server.log | grep "truncated"
```

## Summary

- ✅ Server now automatically limits response size
- ✅ Configurable via environment variables
- ✅ Graceful degradation with user-friendly message
- ✅ Zero frontend changes required
- ⚠️ Still recommend making agent more concise for best UX
