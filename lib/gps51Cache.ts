import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), '.cache', 'gps51');

/**
 * Map GPS51 status codes to plain messages.
 * Same codes as Mantrac/GIGM API_USAGE.md — do not invent extra meanings.
 * 8905 = account daily call quota exhausted (NOT automatically "trajectory 5/device").
 * Trajectory 5/device/day applies to track-style actions like querytracks.
 */
export function explainGps51Limit(status: number, cause?: string | null): string {
  switch (status) {
    case 8902:
      return 'GPS51 IP frequency limit (max ~10 requests/minute). Wait about a minute, then try again.';
    case 8905:
      return 'GPS51 account daily call quota exhausted (status 8905 / out of limit). Quota is shared across all apps using this account. Wait for reset; avoid repeated Load clicks.';
    case 8903:
      return 'GPS51 account access restricted (8903).';
    case 8904:
      return 'This server IP is not on the GPS51 whitelist (8904).';
    case 8906:
      return 'This GPS51 action is prohibited for the account (8906).';
    default:
      return cause || `GPS51 error status ${status}`;
  }
}

export function isLimitStatus(status: unknown): boolean {
  const n = Number(status);
  return n === 8902 || n === 8905 || n === 8903 || n === 8906;
}

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function cacheKey(action: string, body: Record<string, unknown>): string {
  const normalized = JSON.stringify(body, Object.keys(body).sort());
  const hash = createHash('sha256').update(`${action}:${normalized}`).digest('hex').slice(0, 24);
  return `${action}_${hash}`;
}

export type Gps51CacheEntryMeta = {
  key: string;
  path: string;
  action: string;
  body: Record<string, unknown>;
  savedAt: number;
  ageMs: number;
  status: number;
  devices: string[];
  startday?: string;
  endday?: string;
};

function devicesFromBody(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.devices)) return body.devices.map(String);
  if (Array.isArray(body.deviceids)) return body.deviceids.map(String);
  if (body.deviceid != null) return [String(body.deviceid)];
  return [];
}

/** List cached GPS51 reports (metadata only — still parses file; payload kept out of return). */
export function listGps51CacheEntries(action?: string): Gps51CacheEntryMeta[] {
  ensureDir();
  if (!existsSync(CACHE_DIR)) return [];

  const out: Gps51CacheEntryMeta[] = [];
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue;
    if (action && !file.startsWith(`${action}_`)) continue;
    const path = join(CACHE_DIR, file);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        savedAt?: number;
        action?: string;
        body?: Record<string, unknown>;
        payload?: { status?: number };
      };
      const body = raw.body || {};
      const savedAt = raw.savedAt || statSync(path).mtimeMs;
      out.push({
        key: file.replace(/\.json$/, ''),
        path,
        action: String(raw.action || action || ''),
        body,
        savedAt,
        ageMs: Date.now() - savedAt,
        status: Number(raw.payload?.status ?? -1),
        devices: devicesFromBody(body),
        startday: body.startday != null ? String(body.startday) : undefined,
        endday: body.endday != null ? String(body.endday) : undefined,
      });
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function readGps51CacheByKey<T = Record<string, unknown>>(
  key: string
): { data: T; ageMs: number; body: Record<string, unknown>; action: string } | null {
  try {
    ensureDir();
    const path = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      savedAt?: number;
      action?: string;
      body?: Record<string, unknown>;
      payload: T;
    };
    const ageMs = Date.now() - (raw.savedAt || statSync(path).mtimeMs);
    return {
      data: raw.payload,
      ageMs,
      body: raw.body || {},
      action: String(raw.action || ''),
    };
  } catch {
    return null;
  }
}

/**
 * Find best cached report without calling GPS51.
 * - Exact body match (any age)
 * - For device reports: overlapping dates, then newest for device
 * - For list actions (e.g. querymonitorlist): match username, else newest OK cache
 */
export function findBestCachedReport<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>
): {
  data: T;
  ageMs: number;
  key: string;
  match: 'exact' | 'overlap' | 'device' | 'action';
  cacheBody: Record<string, unknown>;
} | null {
  const devices = devicesFromBody(body);
  const deviceid = devices[0];
  const wantUser =
    body.username != null ? String(body.username).toLowerCase() : '';

  const wantStart = body.startday != null ? String(body.startday) : '';
  const wantEnd = body.endday != null ? String(body.endday) : '';

  // Exact key first (any age)
  const exactKey = cacheKey(action, body);
  const exact = readGps51CacheByKey<T>(exactKey);
  if (exact && Number((exact.data as { status?: number }).status) === 0) {
    return {
      data: exact.data,
      ageMs: exact.ageMs,
      key: exactKey,
      match: 'exact',
      cacheBody: exact.body,
    };
  }

  const allOk = listGps51CacheEntries(action).filter((e) => e.status === 0);

  // Device-scoped oil/report caches
  if (deviceid) {
    const entries = allOk.filter((e) => e.devices.includes(deviceid));
    if (entries.length) {
      const overlap = entries.find((e) => {
        if (!wantStart || !wantEnd || !e.startday || !e.endday) return false;
        return e.startday <= wantEnd && e.endday >= wantStart;
      });
      const pick = overlap || entries[0];
      const loaded = readGps51CacheByKey<T>(pick.key);
      if (loaded && Number((loaded.data as { status?: number }).status) === 0) {
        return {
          data: loaded.data,
          ageMs: loaded.ageMs,
          key: pick.key,
          match: overlap ? 'overlap' : 'device',
          cacheBody: loaded.body,
        };
      }
    }
  }

  // Account list caches (querymonitorlist, etc.) — no deviceid in request body
  if (allOk.length) {
    const byUser = wantUser
      ? allOk.find(
          (e) => String(e.body.username || '').toLowerCase() === wantUser
        )
      : null;
    const pick = byUser || allOk[0];
    const loaded = readGps51CacheByKey<T>(pick.key);
    if (loaded && Number((loaded.data as { status?: number }).status) === 0) {
      return {
        data: loaded.data,
        ageMs: loaded.ageMs,
        key: pick.key,
        match: 'action',
        cacheBody: loaded.body,
      };
    }
  }

  return null;
}

export function readGps51Cache<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>,
  maxAgeMs: number
): { data: T; ageMs: number; key: string } | null {
  try {
    ensureDir();
    const key = cacheKey(action, body);
    const path = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(path)) return null;
    const ageMs = Date.now() - statSync(path).mtimeMs;
    if (ageMs > maxAgeMs) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { savedAt: number; payload: T };
    return { data: raw.payload, ageMs: Date.now() - (raw.savedAt || statSync(path).mtimeMs), key };
  } catch {
    return null;
  }
}

/** Read even if older than TTL — for fallback when API is out of limit. */
export function readGps51CacheStale<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown>
): { data: T; ageMs: number; key: string } | null {
  try {
    ensureDir();
    const key = cacheKey(action, body);
    const path = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { savedAt: number; payload: T };
    const ageMs = Date.now() - (raw.savedAt || statSync(path).mtimeMs);
    return { data: raw.payload, ageMs, key };
  } catch {
    return null;
  }
}

export function writeGps51Cache(
  action: string,
  body: Record<string, unknown>,
  payload: unknown
): void {
  try {
    ensureDir();
    const key = cacheKey(action, body);
    const path = join(CACHE_DIR, `${key}.json`);
    writeFileSync(
      path,
      JSON.stringify({ savedAt: Date.now(), action, body, payload }),
      'utf8'
    );
  } catch {
    // ignore cache write failures
  }
}

export function formatCacheAge(ageMs: number): string {
  const mins = Math.round(ageMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function listCacheStats(): { files: number; dir: string } {
  ensureDir();
  const files = existsSync(CACHE_DIR)
    ? readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json')).length
    : 0;
  return { files, dir: CACHE_DIR };
}
