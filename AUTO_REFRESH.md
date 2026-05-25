# Automatic Token Refresh Implementation

## Overview

The app now automatically handles token expiration (`global_error_token_expire`) by:
1. Detecting when the API returns a token expiration error
2. Automatically re-authenticating with stored credentials
3. Retrying the failed request with the new token
4. Seamlessly continuing the user's session without interruption

## How It Works

### Client-Side (Browser)

#### 1. Login Process
When a user logs in via [app/page.tsx](app/page.tsx):
- Credentials are hashed with MD5
- Login API is called
- Upon successful login:
  - Token and user data are saved to sessionStorage
  - **Hashed credentials are saved for auto-refresh** (via `saveCredentialsForAutoRefresh`)
  - User is redirected to dashboard

#### 2. API Calls with Auto-Refresh
Components use [`apiCallWithAutoRefresh`](lib/utils.ts) from `lib/utils.ts`:

```typescript
import { apiCallWithAutoRefresh } from "@/lib/utils";

// Example usage in a component
const data = await apiCallWithAutoRefresh("/api/devices", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: userData.username,
    token: token,
  }),
});
```

**What happens:**
1. Makes API call with current token
2. If response contains `global_error_token_expire`:
   - Automatically logs in again using stored credentials
   - Gets new token
   - Retries the original request with new token
   - Returns the result seamlessly
3. If auto-refresh fails, redirects to login page with error message

#### 3. Token Expiration Detection
The system detects token expiration by checking for:
- `global_error_token_expire` in response cause
- `token_expire` in response cause
- `please login` message
- HTTP 401 status

### Server-Side (API Routes)

For server-side routes like monitoring services, use [`fetchWithAutoRefresh`](lib/serverAuth.ts) from `lib/serverAuth.ts`:

```typescript
import { fetchWithAutoRefresh } from '@/lib/serverAuth';

const devicesData = await fetchWithAutoRefresh(
  devicesUrl,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  },
  token,
  username,
  (newToken) => {
    // Callback to update token if needed
    token = newToken;
  }
);
```

## Security Considerations

### What's Stored
- **sessionStorage** (client-side):
  - Auth token
  - User data
  - **MD5-hashed password** (NOT plain text)
- **Cookie** (for middleware):
  - Auth token only

### Data Lifetime
- All data is stored in **sessionStorage** (not localStorage)
- Data is automatically cleared when:
  - Browser tab is closed
  - User explicitly logs out
  - Token refresh fails

### Why It's Safe
1. Password is already MD5-hashed before storage
2. SessionStorage is isolated per tab
3. Data is never sent to third parties
4. Only used for automatic re-authentication to GPS51 API

## Configuration

### Client-Side
No additional configuration needed. The system automatically:
- Saves credentials on login
- Detects token expiration
- Refreshes and retries

### Server-Side (Monitoring Service)

⚠️ **IMPORTANT**: For server-side auto-refresh, update your `.env.local`:

```bash
# Current setup (session token - expires)
MONITOR_TOKEN=8aa771e43859067428f8a53941126583

# For auto-refresh, this should be the MD5-hashed PASSWORD
# Generate using: md5Hash("your_password")
# or use this Node.js command:
# node -e "const crypto = require('crypto'); console.log(crypto.createHash('md5').update('your_password').digest('hex'));"
```

**To enable server-side auto-refresh:**

1. Hash your password:
```javascript
// In Node.js or browser console
const crypto = require('crypto');
const hashedPassword = crypto.createHash('md5').update('YourActualPassword').digest('hex');
console.log(hashedPassword);
```

2. Update `.env.local`:
```bash
MONITOR_USERNAME=MantracNig
MONITOR_TOKEN=your_md5_hashed_password_here
```

## Updated Components

The following components now use auto-refresh:

### ✅ [LastPosition.tsx](app/dashboard/components/LastPosition.tsx)
- Fetches devices with auto-refresh
- No interruption if token expires during operation

### 🔄 To Update
You can update other components by replacing:

**Before:**
```typescript
const response = await fetch("/api/devices", {
  method: "POST",
  body: JSON.stringify({ username, token }),
});
const data = await response.json();
```

**After:**
```typescript
import { apiCallWithAutoRefresh } from "@/lib/utils";

const data = await apiCallWithAutoRefresh("/api/devices", {
  method: "POST",
  body: JSON.stringify({ username, token }),
});
```

## Testing

### Test Token Expiration
1. Login to the dashboard
2. Wait for token to expire (or manually invalidate it)
3. Trigger an API call (e.g., fetch devices)
4. Watch browser console for auto-refresh messages:
   ```
   [Utils] Token expired, attempting auto-refresh...
   [Utils] Token refreshed, retrying request...
   ```

### Expected Behavior
- ✅ Request succeeds automatically after refresh
- ✅ User sees no interruption (no errors, no logout)
- ✅ Console shows refresh messages
- ❌ If refresh fails, user is redirected to login page

## Error Handling

### Auto-Refresh Fails
If credentials are missing or invalid:
1. Error logged to console
2. Auth cleared from sessionStorage
3. User redirected to login page with message: `"session_expired"`

### Network Errors
Network errors are handled separately and don't trigger auto-refresh:
- Connection timeouts → Show error message
- API unavailable → Show error message

## Browser Compatibility

Auto-refresh uses:
- ✅ sessionStorage (supported in all modern browsers)
- ✅ async/await (supported in all modern browsers)
- ✅ fetch API (supported in all modern browsers)

No polyfills needed for modern browsers (Chrome 67+, Firefox 57+, Safari 12+).

## Monitoring and Logs

### Client-Side Logs
Look for these in browser console:
- `[Utils] Token expired, attempting auto-refresh...`
- `[Utils] Token refreshed, retrying request...`
- `[Utils] No stored credentials for auto-refresh` (needs re-login)

### Server-Side Logs
Look for these in server logs:
- `[ServerAuth] Token expired detected, attempting auto-refresh...`
- `[ServerAuth] Token refreshed successfully`
- `[ServerAuth] Missing credentials for token refresh`

## Troubleshooting

### "No stored credentials for auto-refresh"
**Cause**: User logged in before auto-refresh was implemented.

**Solution**: Have user log out and log in again.

### Token refresh fails repeatedly
**Cause**: Invalid credentials or API issue.

**Solution**: 
1. Check if GPS51 API is accessible
2. Verify credentials are correct
3. Check if IP is whitelisted (server-side)

### Auto-refresh not triggering
**Cause**: Error message doesn't match expected patterns.

**Solution**: Check console for the actual error message and add it to `isTokenExpired()` function in [lib/utils.ts](lib/utils.ts).

## Future Enhancements

Possible improvements:
- [ ] Store encrypted credentials instead of MD5 hash
- [ ] Add background token refresh before expiration
- [ ] Show toast notification when token is refreshed
- [ ] Add retry counter to prevent infinite loops
- [ ] Support multiple authentication providers

## Related Files

- [lib/auth.ts](lib/auth.ts) - Client-side authentication functions
- [lib/utils.ts](lib/utils.ts) - Client-side auto-refresh wrapper
- [lib/serverAuth.ts](lib/serverAuth.ts) - Server-side auto-refresh wrapper
- [app/page.tsx](app/page.tsx) - Login page with credential saving
- [app/dashboard/components/LastPosition.tsx](app/dashboard/components/LastPosition.tsx) - Example usage

## Summary

✅ **Automatic token refresh is now implemented!**

When `global_error_token_expire` is detected:
1. System automatically re-authenticates
2. Retries the failed request
3. User experiences no interruption

No manual intervention needed - the app handles it seamlessly! 🎉
