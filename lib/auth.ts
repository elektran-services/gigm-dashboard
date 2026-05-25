interface LoginResponse {
  status: number;
  cause: string | null;
  username: string;
  token: string;
  usertype: number;
  nickname: string;
  [key: string]: any;
}

export const AUTH_TOKEN_KEY = 'mantrac_auth_token';
export const AUTH_USER_KEY = 'mantrac_user_data';
export const AUTH_CREDENTIALS_KEY = 'mantrac_auth_creds'; // For auto-refresh

export function saveAuthToken(token: string, userData: LoginResponse): void {
  if (typeof window !== 'undefined') {
    // Use sessionStorage for tab-isolated sessions (prevents cross-tab interference)
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(userData));
    
    // Also set cookie for middleware
    document.cookie = `mantrac_auth_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}`; // 7 days
  }
}

export function saveCredentialsForAutoRefresh(username: string, hashedPassword: string): void {
  if (typeof window !== 'undefined') {
    // Store credentials for automatic token refresh
    // Note: Password is already MD5 hashed at this point
    sessionStorage.setItem(AUTH_CREDENTIALS_KEY, JSON.stringify({ username, hashedPassword }));
  }
}

export function getAuthToken(): string | null {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  }
  return null;
}

export function getUserData(): LoginResponse | null {
  if (typeof window !== 'undefined') {
    const data = sessionStorage.getItem(AUTH_USER_KEY);
    return data ? JSON.parse(data) : null;
  }
  return null;
}

export function getStoredCredentials(): { username: string; hashedPassword: string } | null {
  if (typeof window !== 'undefined') {
    const creds = sessionStorage.getItem(AUTH_CREDENTIALS_KEY);
    return creds ? JSON.parse(creds) : null;
  }
  return null;
}

export function clearAuth(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_CREDENTIALS_KEY);
    
    // Clear cookie
    document.cookie = 'mantrac_auth_token=; path=/; max-age=0';
  }
}

export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/**
 * Attempt to refresh the authentication token by re-logging in
 * @returns The new token or null if refresh failed
 */
async function refreshToken(): Promise<string | null> {
  const credentials = getStoredCredentials();
  
  if (!credentials) {
    console.warn('[Auth] No stored credentials for auto-refresh');
    return null;
  }

  try {
    console.log('[Auth] Attempting to refresh token...');
    
    const response = await fetch('https://api.gps51.com/openapi?action=login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'DEVICE',
        from: 'web',
        username: credentials.username,
        password: credentials.hashedPassword,
        browser: typeof window !== 'undefined' ? navigator.userAgent : 'Unknown',
      }),
    });

    const data = await response.json();
    
    if (data.status === 0 && data.token) {
      console.log('[Auth] Token refreshed successfully');
      saveAuthToken(data.token, data);
      return data.token;
    } else {
      console.error('[Auth] Token refresh failed:', data.cause);
      return null;
    }
  } catch (error) {
    console.error('[Auth] Token refresh error:', error);
    return null;
  }
}

/**
 * Check if an error response indicates token expiration
 */
function isTokenExpiredError(data: any): boolean {
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
 * Wrapper for API calls that automatically handles token expiration
 * If token expired, it attempts to refresh and retry the request once
 */
export async function fetchWithAutoRefresh(
  url: string, 
  options: RequestInit = {},
  maxRetries: number = 1
): Promise<Response> {
  const token = getAuthToken();
  
  if (!token) {
    // Redirect to login if no token
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
    throw new Error('No authentication token');
  }

  // Make the initial request
  let response = await fetch(url, options);
  let data = await response.json();

  // Check if token expired
  if (isTokenExpiredError(data) && maxRetries > 0) {
    console.log('[Auth] Token expired detected, attempting auto-refresh...');
    
    const newToken = await refreshToken();
    
    if (newToken) {
      // Retry the request with the new token
      // Update the URL or body with the new token
      let retryUrl = url;
      let retryOptions = { ...options };
      
      // If it's a URL with token parameter
      if (url.includes('token=')) {
        retryUrl = url.replace(/token=[^&]+/, `token=${newToken}`);
      }
      
      // If it's a POST request with token in body
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
      
      console.log('[Auth] Retrying request with new token...');
      response = await fetch(retryUrl, retryOptions);
      data = await response.json();
      
      // If still expired after retry, give up
      if (isTokenExpiredError(data)) {
        console.error('[Auth] Token still expired after refresh, redirecting to login');
        clearAuth();
        if (typeof window !== 'undefined') {
          window.location.href = '/?error=session_expired';
        }
        throw new Error('Session expired');
      }
    } else {
      // Failed to refresh token, redirect to login
      clearAuth();
      if (typeof window !== 'undefined') {
        window.location.href = '/?error=session_expired';
      }
      throw new Error('Session expired');
    }
  }

  // Return a new Response with the data
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Function to handle API requests with token and auto-redirect on expiration
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  
  if (!token) {
    // Redirect to login if no token
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
    throw new Error('No authentication token');
  }

  // Add token to headers
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Check if token expired (typically 401 or 403)
  if (response.status === 401 || response.status === 403) {
    clearAuth();
    if (typeof window !== 'undefined') {
      window.location.href = '/?error=session_expired';
    }
    throw new Error('Session expired');
  }

  return response;
}
