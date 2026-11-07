import CryptoJS from 'crypto-js';
import { getAuthToken, getStoredCredentials } from './auth';

export function md5Hash(text: string): string {
  return CryptoJS.MD5(text).toString();
}

export function getBrowserInfo(): string {
  if (typeof window === 'undefined') return 'Unknown';
  
  const userAgent = window.navigator.userAgent;
  const browserMatch = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)\/?([\d.]+)/);
  
  if (browserMatch) {
    return `${browserMatch[1]}/${browserMatch[2]}`;
  }
  
  return 'Unknown';
}

/**
 * Helper function to make API calls with automatic token refresh
 * Usage: const data = await apiCallWithAutoRefresh('/api/devices', { method: 'POST', body: ... })
 */
export async function apiCallWithAutoRefresh(
  url: string,
  options: RequestInit = {}
): Promise<any> {
  const makeRequest = async (token: string) => {
    // Update the request body with the current token
    let requestOptions = { ...options };
    
    if (requestOptions.body) {
      try {
        const bodyData = JSON.parse(requestOptions.body as string);
        bodyData.token = token;
        requestOptions.body = JSON.stringify(bodyData);
      } catch (e) {
        // Body is not JSON, skip
      }
    }
    
    const response = await fetch(url, requestOptions);
    const text = await response.text();
    const trimmed = text.trimStart();
    if (!trimmed || trimmed.startsWith('<')) {
      const timedOut = response.status === 502 || response.status === 504;
      throw new Error(
        timedOut
          ? 'The server timed out while reading the saved fuel report. Choose a shorter date range and try again.'
          : `The fuel service returned a web page (${response.status}) instead of data. Choose a shorter date range and try again.`
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('The fuel service returned an unreadable response.');
    }
  };

  let token = getAuthToken();
  
  if (!token) {
    throw new Error('No authentication token');
  }

  // First attempt
  let data = await makeRequest(token);

  // Check if token expired
  if (isTokenExpired(data)) {
    console.log('[Utils] Token expired, attempting auto-refresh...');
    
    // Attempt to refresh token
    const newToken = await refreshTokenInternal();
    
    if (newToken) {
      console.log('[Utils] Token refreshed, retrying request...');
      data = await makeRequest(newToken);
      
      // If still expired, redirect to login
      if (isTokenExpired(data)) {
        handleSessionExpired();
        throw new Error('Session expired');
      }
    } else {
      handleSessionExpired();
      throw new Error('Failed to refresh token');
    }
  }

  return data;
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
    cause.includes('global_error_not_find_token') ||
    cause.includes('not_find_token') ||
    cause === 'please login' ||
    data.status === 401
  );
}

/**
 * Attempt to refresh the token by re-logging in
 */
async function refreshTokenInternal(): Promise<string | null> {
  const credentials = getStoredCredentials();
  
  if (!credentials) {
    console.warn('[Utils] No stored credentials for auto-refresh');
    return null;
  }

  try {
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
        browser: getBrowserInfo(),
      }),
    });

    const data = await response.json();
    
    if (data.status === 0 && data.token) {
      console.log('[Utils] Token refreshed successfully');
      
      // Import dynamically to avoid circular dependency
      const { saveAuthToken } = await import('./auth');
      saveAuthToken(data.token, data);
      
      return data.token;
    } else {
      console.error('[Utils] Token refresh failed:', data.cause);
      return null;
    }
  } catch (error) {
    console.error('[Utils] Token refresh error:', error);
    return null;
  }
}

/**
 * Handle session expiration by clearing auth and redirecting to login
 */
function handleSessionExpired(): void {
  if (typeof window !== 'undefined') {
    const { clearAuth } = require('./auth');
    clearAuth();
    window.location.href = '/?error=session_expired';
  }
}

export function formatLitres(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  // Non-breaking space keeps "69.01 L" on one line in narrow table cells
  return `${value.toFixed(digits)}\u00A0L`;
}

export function formatKm(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} km`;
}

export function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
