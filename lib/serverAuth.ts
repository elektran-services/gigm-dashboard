/**
 * Server-side authentication utilities with automatic token refresh
 * For use in API routes and server-side code
 */

import { buildGPS51LoginUrl } from './config';

interface TokenRefreshResult {
  success: boolean;
  token?: string;
  error?: string;
}

/**
 * Check if an API response indicates token expiration
 */
function isTokenExpired(data: any): boolean {
  if (!data) return false;
  
  const cause = data.cause || '';
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login' ||
    data.status === 401
  );
}

/**
 * Refresh the token using environment variables (server-side only)
 */
async function refreshToken(username?: string, existingToken?: string): Promise<TokenRefreshResult> {
  // Use provided credentials or fall back to environment variables
  const monitorUsername = username || process.env.MONITOR_USERNAME;
  const monitorToken = existingToken || process.env.MONITOR_TOKEN;

  if (!monitorUsername || !monitorToken) {
    console.error('[ServerAuth] Missing credentials for token refresh');
    return {
      success: false,
      error: 'Missing credentials for auto-refresh',
    };
  }

  try {
    console.log(`[ServerAuth] Attempting to refresh token for user: ${monitorUsername}`);
    
    // Note: The token in env is already the auth token (not a password)
    // For GPS51 API, if token expired, we need to use the login endpoint
    // But we need username and password, not the old token
    // This is a limitation - we can only refresh if we have the password stored
    
    // If MONITOR_TOKEN is actually the password (MD5 hashed), we can try this:
    const response = await fetch(buildGPS51LoginUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'DEVICE',
        from: 'web',
        username: monitorUsername,
        password: monitorToken, // This should be MD5 hashed password
        browser: 'Server',
      }),
    });

    const data = await response.json();
    
    if (data.status === 0 && data.token) {
      console.log('[ServerAuth] Token refreshed successfully');
      return {
        success: true,
        token: data.token,
      };
    } else {
      console.error('[ServerAuth] Token refresh failed:', data.cause);
      return {
        success: false,
        error: data.cause || 'Failed to refresh token',
      };
    }
  } catch (error) {
    console.error('[ServerAuth] Token refresh error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Make an API call with automatic token refresh on expiration
 * @param url The API endpoint URL
 * @param options Fetch options (method, headers, body, etc.)
 * @param token Current authentication token
 * @param username Username for token refresh
 * @param tokenUpdateCallback Callback to update token in your system
 * @returns The response data
 */
export async function fetchWithAutoRefresh(
  url: string,
  options: RequestInit,
  token: string,
  username?: string,
  tokenUpdateCallback?: (newToken: string) => void
): Promise<any> {
  // First attempt with current token
  let response = await fetch(url, options);
  let data = await response.json();

  // Check if token expired
  if (isTokenExpired(data)) {
    console.log('[ServerAuth] Token expired detected, attempting auto-refresh...');
    
    const refreshResult = await refreshToken(username, token);
    
    if (refreshResult.success && refreshResult.token) {
      const newToken = refreshResult.token;
      console.log('[ServerAuth] Token refreshed, retrying request...');
      
      // Update token in callback if provided
      if (tokenUpdateCallback) {
        tokenUpdateCallback(newToken);
      }
      
      // Retry the request with new token
      // Update URL if it contains the token parameter
      let retryUrl = url;
      if (url.includes('token=')) {
        retryUrl = url.replace(/token=[^&]+/, `token=${newToken}`);
      }
      
      // Update body if it contains the token
      let retryOptions = { ...options };
      if (retryOptions.body) {
        try {
          const bodyData = JSON.parse(retryOptions.body as string);
          if (bodyData.token) {
            bodyData.token = newToken;
            retryOptions.body = JSON.stringify(bodyData);
          }
        } catch (e) {
          // Body is not JSON, skip
        }
      }
      
      response = await fetch(retryUrl, retryOptions);
      data = await response.json();
      
      // If still expired after refresh, return the error
      if (isTokenExpired(data)) {
        console.error('[ServerAuth] Token still expired after refresh');
        throw new Error('Session expired and could not be refreshed');
      }
      
      // Return the successful response data with the new token
      return {
        ...data,
        _refreshedToken: newToken, // Include the new token in response
      };
    } else {
      console.error('[ServerAuth] Failed to refresh token:', refreshResult.error);
      throw new Error(refreshResult.error || 'Failed to refresh token');
    }
  }

  return data;
}

/**
 * Helper to extract refreshed token from response data
 */
export function getRefreshedToken(data: any): string | null {
  return data?._refreshedToken || null;
}
