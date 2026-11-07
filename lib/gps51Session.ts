import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildGPS51LoginUrl, buildGPS51Url } from '@/lib/config';

interface SessionState {
  token: string;
  username: string;
  fetchedAt: number;
}

let session: SessionState | null = null;

/** GPS51: token valid 24h — refresh about once every 23h; do not login often. */
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
const FORCE_LOGIN_COOLDOWN_MS = 10 * 60 * 1000;
const SESSION_FILE = path.join(process.cwd(), '.cache', 'monitor_gps51_session.json');

let lastForceLoginAt = 0;

function md5(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

function normalizePassword(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^[a-f0-9]{32}$/i.test(value)) return value.toLowerCase();
  return md5(value);
}

function isExpiredCause(cause?: string | null): boolean {
  if (!cause) return false;
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause.includes('global_error_not_find_token') ||
    cause.includes('not_find_token') ||
    cause === 'please login'
  );
}

function loadSessionFile(): SessionState | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const raw = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as {
      token?: string;
      username?: string;
      loggedAt?: number;
      fetchedAt?: number;
    };
    const fetchedAt = Number(raw.loggedAt || raw.fetchedAt || 0);
    if (!raw.token || !fetchedAt) return null;
    return {
      token: String(raw.token),
      username: String(raw.username || ''),
      fetchedAt,
    };
  } catch {
    return null;
  }
}

function saveSessionFile(state: SessionState): void {
  try {
    mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    writeFileSync(
      SESSION_FILE,
      JSON.stringify(
        {
          token: state.token,
          username: state.username,
          loggedAt: state.fetchedAt,
        },
        null,
        2
      )
    );
  } catch {
    /* ignore disk errors */
  }
}

function isFresh(state: SessionState | null): boolean {
  return Boolean(state && Date.now() - state.fetchedAt < TOKEN_TTL_MS);
}

/**
 * Server-side GPS51 session for fuel APIs.
 * Shares `.cache/monitor_gps51_session.json` with monitoringService.js.
 * Login rules: action=login at most ~once per 23 hours unless token is rejected.
 */
export async function loginGps51(force = false): Promise<SessionState> {
  if (!force && isFresh(session)) return session as SessionState;

  if (!force) {
    const disk = loadSessionFile();
    if (isFresh(disk)) {
      session = disk;
      return session as SessionState;
    }
  }

  if (force && Date.now() - lastForceLoginAt < FORCE_LOGIN_COOLDOWN_MS) {
    if (session?.token) return session;
    const disk = loadSessionFile();
    if (disk?.token) {
      session = disk;
      return session;
    }
  }

  const username =
    process.env.MONITOR_USERNAME || process.env.GPS51_USERNAME || '';
  const hashedPassword = normalizePassword(
    process.env.MONITOR_PASSWORD || process.env.GPS51_PASSWORD || ''
  );
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

  if (force) lastForceLoginAt = Date.now();

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
  saveSessionFile(session);
  return session;
}

export async function ensureGps51Session(force = false): Promise<SessionState> {
  if (!force && isFresh(session)) {
    return session as SessionState;
  }
  if (!force) {
    const disk = loadSessionFile();
    if (isFresh(disk)) {
      session = disk;
      return session as SessionState;
    }
  }
  return loginGps51(force);
}

export async function gps51AuthedPost<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>
): Promise<T> {
  let current = await ensureGps51Session(false);
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
