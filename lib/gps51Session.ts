import { createHash } from 'node:crypto';
import { buildGPS51LoginUrl, buildGPS51Url } from '@/lib/config';

interface SessionState {
  token: string;
  username: string;
  fetchedAt: number;
}

let session: SessionState | null = null;

const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // refresh before 24h expiry

function md5(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

function isExpiredCause(cause?: string | null): boolean {
  if (!cause) return false;
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause.includes('global_error_not_find_token') ||
    cause === 'please login'
  );
}

/**
 * Server-side GPS51 session for fuel APIs (cache refresh / live pulls).
 * Uses GIGM MONITOR_* credentials:
 * - MONITOR_PASSWORD is already MD5-hashed (do not hash again)
 * - Falls back to MONITOR_TOKEN as a static session token
 * - Also accepts GPS51_* vars for fuel_monitor parity
 */
export async function loginGps51(): Promise<SessionState> {
  const username =
    process.env.MONITOR_USERNAME || process.env.GPS51_USERNAME || '';
  const hashedPassword =
    process.env.MONITOR_PASSWORD ||
    (process.env.GPS51_PASSWORD ? md5(process.env.GPS51_PASSWORD) : '');
  const staticToken = process.env.MONITOR_TOKEN || process.env.GPS51_TOKEN || '';

  if (!username) {
    throw new Error('MONITOR_USERNAME (or GPS51_USERNAME) is not configured');
  }

  if (!hashedPassword && staticToken) {
    session = { token: staticToken, username, fetchedAt: Date.now() };
    return session;
  }

  if (!hashedPassword) {
    throw new Error('MONITOR_PASSWORD (or GPS51_PASSWORD) is not configured');
  }

  const response = await fetch(buildGPS51LoginUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'DEVICE',
      from: 'web',
      username,
      password: hashedPassword,
      browser: 'GIGM-Fuel/1.0',
    }),
  });

  const data = await response.json();
  if (data.status !== 0 || !data.token) {
    throw new Error(data.cause || 'GPS51 login failed');
  }

  session = {
    token: String(data.token),
    username: String(data.username || username),
    fetchedAt: Date.now(),
  };
  return session;
}

export async function ensureGps51Session(force = false): Promise<SessionState> {
  if (!force && session && Date.now() - session.fetchedAt < TOKEN_TTL_MS) {
    return session;
  }
  return loginGps51();
}

export async function gps51AuthedPost<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>
): Promise<T> {
  let current = await ensureGps51Session();
  const doFetch = async (token: string) => {
    const res = await fetch(buildGPS51Url(action, token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GPS51 HTTP ${res.status} for action=${action}`);
    return res.json();
  };

  let data = await doFetch(current.token);
  if (isExpiredCause(data?.cause) || data?.status === 9903) {
    current = await ensureGps51Session(true);
    data = await doFetch(current.token);
  }
  return data as T;
}

export function getCachedUsername(): string {
  return (
    session?.username ||
    process.env.MONITOR_USERNAME ||
    process.env.GPS51_USERNAME ||
    'GIGMobility'
  );
}
