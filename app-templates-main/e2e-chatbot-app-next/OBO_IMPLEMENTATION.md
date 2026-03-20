# OBO (On-Behalf-Of) Authentication Implementation

## Summary of Changes

I've successfully implemented OBO authentication for the e2e-chatbot-app-next application. This allows the app to make serving endpoint calls using the end user's credentials instead of the service principal's credentials.

## What Was Changed

### 1. Authentication Middleware (`server/src/middleware/auth.ts`)
- Extended Express Request type to include `userAccessToken` and `userEmail` fields
- Modified `authMiddleware` to extract `X-Forwarded-Access-Token` and `X-Forwarded-Email` headers
- These headers are automatically provided by Databricks Apps when OBO is enabled

### 2. Request Context Management (`packages/ai-sdk-providers/src/request-context.ts`)
- Added `AsyncLocalStorage` to store user credentials across async operations
- Created `RequestContext` interface to hold `userAccessToken` and `userEmail`
- Implemented `setRequestContext`, `getRequestContext`, and `runWithContext` functions
- This allows passing user credentials through the entire call chain without explicit parameter passing

### 3. AI SDK Provider (`packages/ai-sdk-providers/src/providers-server.ts`)
- Modified `getProviderToken()` to prioritize tokens in this order:
  1. **User's access token from request context (OBO)** - for serving endpoint calls
  2. PAT token from environment variable (legacy/local dev)
  3. Service Principal or CLI authentication (app-level operations)
- When a user's access token is available, all serving endpoint calls use the user's credentials

### 4. Chat Routes (`server/src/routes/chat.ts`)
- Added import for `setRequestContext` from AI SDK providers
- Set request context with user's access token before calling the AI model
- Applied to both chat message generation and title generation

### 5. Configuration Files
- **databricks.yml**: Set `serving_endpoint_name` default to `mas-a15329c7-endpoint`
- **.env**: Created with serving endpoint configuration
- **app.yaml**: No changes needed (OBO is automatic in Databricks Apps)

## How It Works

### Dual Authentication Pattern

The implementation follows Databricks best practices with two authentication contexts:

1. **Service Principal** (for app-level operations):
   - Database access (Lakebase)
   - Session management
   - Chat metadata storage
   - Uses credentials from `DATABRICKS_CLIENT_ID` and `DATABRICKS_CLIENT_SECRET`

2. **User's OAuth Token** (for user-specific operations):
   - Serving endpoint queries
   - AI model interactions
   - Any operation that should run with user's permissions
   - Uses token from `X-Forwarded-Access-Token` header

### Request Flow

```
1. User makes request to chat endpoint
   ↓
2. Databricks Apps injects X-Forwarded-Access-Token header
   ↓
3. authMiddleware extracts token and attaches to req.userAccessToken
   ↓
4. Chat handler sets RequestContext with user token
   ↓
5. AI provider reads RequestContext and uses user token
   ↓
6. Serving endpoint receives request with user's credentials
```

## Deployment Instructions

### Prerequisites

1. **Databricks CLI**: Ensure you have the latest version
   ```bash
   databricks --version
   # If not installed: pip install databricks-cli
   ```

2. **Authenticate with Databricks**:
   ```bash
   databricks auth login --host https://your-workspace.cloud.databricks.com
   ```

### Deploy to Databricks Apps

1. **Validate the bundle**:
   ```bash
   databricks bundle validate
   ```

2. **Deploy the application**:
   ```bash
   databricks bundle deploy
   ```

3. **Check deployment status**:
   ```bash
   databricks bundle summary
   ```

4. **Access your app**:
   - The deployment will output the app URL
   - Navigate to the URL in your browser
   - OBO authentication is automatically enabled

### Verify OBO is Working

Check the server logs for these messages:
- `[Auth] User access token received for OBO operations`
- `[OBO] Request context set for serving endpoint calls`
- `[OBO] Using user access token from request context`

## Configuration Options

### databricks.yml

The serving endpoint is configured in `databricks.yml`:
```yaml
variables:
  serving_endpoint_name:
    default: "mas-a15329c7-endpoint"
```

To use a different endpoint:
1. Edit `databricks.yml` and change the `default` value
2. Or pass it during deployment:
   ```bash
   databricks bundle deploy -v serving_endpoint_name=your-endpoint-name
   ```

### Enable Database Persistence (Optional)

By default, the app runs in ephemeral mode (chats stored in memory). To enable persistent chat history:

1. Uncomment the database sections in `databricks.yml`:
   - Lines 17-21: Database instance resource
   - Lines 39-46: Database binding

2. Deploy:
   ```bash
   databricks bundle deploy
   ```

Note: Database provisioning takes 5-10 minutes on first deployment.

## Local Development

For local development, the app still works without OBO:

1. **Configure local environment**:
   ```bash
   # Set your Databricks CLI profile
   databricks auth login --profile my-profile

   # Update .env
   DATABRICKS_CONFIG_PROFILE=my-profile
   DATABRICKS_SERVING_ENDPOINT=mas-a15329c7-endpoint
   ```

2. **Start the development server**:
   ```bash
   npm run dev
   ```

3. **Local authentication flow**:
   - No `X-Forwarded-Access-Token` header in local dev
   - Falls back to CLI authentication
   - Uses your personal Databricks credentials

## Troubleshooting

### "Provided OAuth token does not have required scopes"

This error indicates the user's token doesn't have the necessary permissions. Verify:
- The serving endpoint permissions are correctly configured in `databricks.yml`
- The app service principal has `CAN_QUERY` permission on the endpoint
- For Multi-Agent Supervisor, underlying agents are also granted access

### "No access token available"

This means OBO is not enabled or the header is missing. Check:
- App is deployed via Databricks Apps (not running locally)
- User is authenticated with Databricks
- No reverse proxy is stripping the `X-Forwarded-Access-Token` header

### Build Errors

If you encounter build errors:
```bash
# Clean and reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

## Security Considerations

1. **Token Storage**: User access tokens are NEVER persisted to disk or database
2. **Token Scope**: Tokens are scoped to the current request via AsyncLocalStorage
3. **Token Lifetime**: Tokens are short-lived OAuth tokens managed by Databricks
4. **Service Principal**: Keep `DATABRICKS_CLIENT_SECRET` secure; never commit to git

## Architecture Benefits

1. **Proper Isolation**: User operations run with user credentials, app operations with service principal
2. **Security**: Row-level security and permissions work correctly with OBO
3. **Auditability**: Actions are logged under the actual user's identity
4. **Compliance**: Meets enterprise requirements for data access governance

## Next Steps

1. Deploy the application using the instructions above
2. Test with multiple users to verify OBO is working correctly
3. Monitor logs for any authentication errors
4. Consider enabling database persistence for production use

## Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify authentication with `databricks auth describe`
3. Ensure all prerequisites are installed and configured
4. Review Databricks Apps documentation: https://docs.databricks.com/apps/

---

**Implementation Date**: 2026-02-03
**Status**: Ready for deployment
**Serving Endpoint**: mas-a15329c7-endpoint
