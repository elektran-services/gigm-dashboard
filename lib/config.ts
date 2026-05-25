/**
 * API Configuration
 * Centralized configuration for external API endpoints
 */

export const API_CONFIG = {
  GPS51: {
    BASE_URL: process.env.NEXT_PUBLIC_GPS51_API_URL || 'https://api.gps51.com/openapi',
    SERVER_ID: process.env.NEXT_PUBLIC_GPS51_SERVER_ID || '2',
  },
  HERE: {
    API_KEY: process.env.NEXT_PUBLIC_HERE_API_KEY || '',
    REVGEOCODE_URL: 'https://revgeocode.search.hereapi.com/v1/revgeocode',
  },
} as const;

export const APP_CONFIG = {
  NAME: process.env.NEXT_PUBLIC_APP_NAME || 'GIGMotors Dashboard',
  VERSION: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT || '3600000', 10),
} as const;

export const MONITORING_CONFIG = {
  OVERSPEED_LIMIT_KMH: 120, // Speed limit in km/h for automated monitoring
  OVERSPEED_DURATION_THRESHOLD_MS: 60000, // 60 seconds minimum duration
  CHECK_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
} as const;

/**
 * Build GPS51 API URL with action and token
 */
export function buildGPS51Url(action: string, token: string, additionalParams?: Record<string, string>): string {
  const params = new URLSearchParams({
    action,
    token,
    serverid: API_CONFIG.GPS51.SERVER_ID,
    ...additionalParams,
  });
  
  return `${API_CONFIG.GPS51.BASE_URL}?${params.toString()}`;
}

/**
 * Build GPS51 login URL
 */
export function buildGPS51LoginUrl(): string {
  return `${API_CONFIG.GPS51.BASE_URL}?action=login`;
}

/**
 * Build HERE Maps reverse geocoding URL
 */
export function buildHereReverseGeocodeUrl(lat: number | string, lon: number | string): string {
  return `${API_CONFIG.HERE.REVGEOCODE_URL}?at=${lat},${lon}&apiKey=${API_CONFIG.HERE.API_KEY}`;
}
