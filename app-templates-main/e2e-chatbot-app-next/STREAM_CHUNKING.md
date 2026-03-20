# Automatic Response Chunking - Multi-Message Splitting

## What This Does

Instead of truncating large responses, the server **automatically splits them into multiple assistant messages**. This prevents stream overflow while preserving all content.

## How It Works

### Before (Truncated Response)
```
Agent: [Very long response...] [Response truncated - output too large]
```

### After (Chunked Response)
```
Agent Message 1: [First 50K chars...] [Continuing in next message...]
Agent Message 2: [Continued from previous message (2/5)] [Next 50K chars...] [Continuing in next message...]
Agent Message 3: [Continued from previous message (3/5)] [Final content]
```

## Configuration

Set via environment variables in `.env`:

```bash
# Size per message before splitting (chars)
MAX_RESPONSE_SIZE=50000        # Default: 50K chars (~200K tokens)

# Maximum number of message chunks
MAX_MESSAGE_CHUNKS=5           # Default: 5 messages max

# Overall stream timeout
STREAM_TIMEOUT_MS=300000       # Default: 5 minutes
```

## Examples

### Example 1: Small Response (No Splitting)
```
Response: 10K chars
Result: Single message ✓
```

### Example 2: Large Response (Split Once)
```
Response: 75K chars
Result:
- Message 1: 50K chars + "[Continuing in next message...]"
- Message 2: 25K chars ✓
```

### Example 3: Very Large Response (Multiple Splits)
```
Response: 200K chars
Result:
- Message 1: 50K chars
- Message 2: 50K chars
- Message 3: 50K chars
- Message 4: 50K chars
- Message 5: "[...truncated to prevent overload]" (max reached)
```

## Production Configuration

### For Concise Responses (Recommended)
```bash
# .env or databricks.yml
MAX_RESPONSE_SIZE=30000        # Force smaller messages
MAX_MESSAGE_CHUNKS=3           # Limit to 3 messages total
```

This encourages agents to be more concise.

### For Development (More Lenient)
```bash
MAX_RESPONSE_SIZE=100000       # Allow larger messages
MAX_MESSAGE_CHUNKS=10          # Allow more splits
```

### For Data-Heavy Apps (Charts, Tables)
```bash
MAX_RESPONSE_SIZE=50000        # Default - good for Vega specs
MAX_MESSAGE_CHUNKS=5           # Reasonable limit
```

## Deploy to Databricks

Add to your `databricks.yml`:

```yaml
resources:
  databricks_chatbot:
    name: ${var.app_name}
    apps:
      - name: ${var.app_name}
        config:
          env:
            - name: MAX_RESPONSE_SIZE
              value: "30000"
            - name: MAX_MESSAGE_CHUNKS
              value: "3"
            - name: STREAM_TIMEOUT_MS
              value: "180000"
```

## Testing

### 1. Start Server
```bash
npm run dev
```

### 2. Test with Large Response
Ask your agent for something verbose:
```
"Explain quantum physics in detail with examples and code"
```

### 3. Expected Behavior
You should see:
- Multiple assistant messages appearing sequentially
- Each with a continuation indicator
- Final message with complete content
- No network errors!

### 4. Check Logs
```bash
# Server logs should show:
Response size exceeded 50000 chars. Splitting into message chunk 2
Response size exceeded 50000 chars. Splitting into message chunk 3
Response was split into 3 total messages
```

## Monitoring

### Log Examples

**Successful chunking:**
```
Response size exceeded 50000 chars. Splitting into message chunk 2
Response was split into 3 total messages
```

**Hit max chunks:**
```
Response split into 5 messages (max: 5 reached). Truncating further content.
```

### Metrics to Track

1. **Chunk frequency**: How often responses get split
2. **Average chunks per response**: Tune MAX_RESPONSE_SIZE
3. **Truncation rate**: If hitting max chunks often, reduce agent verbosity

## User Experience

### What Users See

**Message 1:**
```markdown
Here's your analysis:

[Content...]

_[Continuing in next message...]_
```

**Message 2:**
```markdown
_[Continued from previous message (2/5)]_

[More content...]

_[Continuing in next message...]_
```

**Message 3:**
```markdown
_[Continued from previous message (3/5)]_

[Final content...]
```

### Benefits

✅ No content lost (up to max chunks)
✅ No connection errors
✅ Clear continuation indicators
✅ Smooth user experience
✅ Each message is still scrollable/copyable

## Troubleshooting

### Issue: Still getting network errors

**Solution 1: Reduce message size**
```bash
MAX_RESPONSE_SIZE=20000  # Smaller chunks
```

**Solution 2: Reduce max chunks**
```bash
MAX_MESSAGE_CHUNKS=3     # Stop sooner
```

**Solution 3: Agent prompt**
```
Keep responses under 10,000 characters total.
```

### Issue: Too many split messages

This means your agent is too verbose!

**Fix agent prompt:**
```
CRITICAL: Be extremely concise.
- Maximum 5000 characters per response
- For visualizations: JSON spec + 1 sentence only
- No verbose explanations
```

**Or reduce MAX_MESSAGE_CHUNKS:**
```bash
MAX_MESSAGE_CHUNKS=2  # Force conciseness
```

### Issue: Content getting truncated

You're hitting the max chunks limit. Either:

1. **Increase limit** (not recommended):
   ```bash
   MAX_MESSAGE_CHUNKS=10
   ```

2. **Reduce agent verbosity** (recommended):
   - Update agent system prompt
   - Use more specific queries
   - Ask for summaries instead of full details

## Architecture

### How Splitting Works

```typescript
// Pseudo-code
let charsInCurrentMessage = 0;

for each text_chunk from agent:
  charsInCurrentMessage += chunk.length

  if charsInCurrentMessage > MAX_RESPONSE_SIZE:
    yield "[Continuing in next message...]"
    yield { type: 'finish' }  // Close current message

    charsInCurrentMessage = 0  // Reset counter
    yield "[Continued from previous message]"

  yield text_chunk
```

### Message Boundaries

The AI SDK's `createUIMessageStream` handles message boundaries:
- `{ type: 'finish' }` closes the current message
- Next text parts start a new message
- Frontend renders them as separate assistant messages

## Comparison: Truncate vs Split

| Approach | Pros | Cons | Best For |
|----------|------|------|----------|
| **Truncate** | Simple, forces conciseness | Loses content | Production |
| **Split** ✅ | Preserves content, smooth UX | May encourage verbosity | Development/Data apps |

## Recommendations

### For Production
```bash
MAX_RESPONSE_SIZE=20000      # Small chunks
MAX_MESSAGE_CHUNKS=2         # Few splits
# + Update agent to be concise
```

### For Development
```bash
MAX_RESPONSE_SIZE=50000      # Medium chunks
MAX_MESSAGE_CHUNKS=5         # More splits
# More lenient for testing
```

### For Data/Viz Apps
```bash
MAX_RESPONSE_SIZE=50000      # Handle Vega specs
MAX_MESSAGE_CHUNKS=3         # Limit verbosity
# Balance between data and text
```

## Quick Start

1. **Default config works for most cases** - no changes needed
2. **Test with your agent** - see if responses get split
3. **Tune if needed** - adjust based on frequency
4. **Update agent prompt** - make it concise for best UX

## Summary

✅ Automatic multi-message splitting
✅ Configurable size and chunk limits
✅ Preserves all content (up to limit)
✅ Clear continuation indicators
✅ Prevents network errors
✅ Zero frontend changes needed

**The best solution is still a concise agent!** Use this as a safety net, not a primary strategy.
