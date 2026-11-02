import {
  explainGps51Limit,
  findBestCachedReport,
  formatCacheAge,
  isLimitStatus,
  listGps51CacheEntries,
  readGps51Cache,
  readGps51CacheStale,
  writeGps51Cache,
} from '@/lib/gps51Cache';
import { gps51AuthedPost } from '@/lib/gps51Session';

export type Gps51FetchResult<T> = {
  data: T;
  fromCache: boolean;
  cacheAgeMs: number | null;
  limitHit: boolean;
  message: string | null;
  cacheMatch?: 'exact' | 'overlap' | 'device' | 'action' | null;
  cacheBody?: Record<string, unknown> | null;
};

/**
 * Call GPS51 with disk cache.
 *
 * Default (cacheOnly / no refresh): use already-saved reports only — never hits GPS51.
 * refresh=true: may call GPS51 live (burns quota).
 */
export async function gps51CachedPost<T extends { status?: number; cause?: string | null }>(
  action: string,
  body: Record<string, unknown>,
  options?: {
    ttlMs?: number;
    /** Force a live GPS51 call (ignores cache-first). */
    bypassCache?: boolean;
    /**
     * If true (default), never call GPS51 — only disk cache / fuzzy device match.
     * Set false only when user explicitly refreshes from GPS51.
     */
    cacheOnly?: boolean;
  }
): Promise<Gps51FetchResult<T>> {
  const ttlMs = options?.ttlMs ?? 6 * 60 * 60 * 1000;
  const cacheOnly = options?.cacheOnly !== false; // default: cache only
  const wantLive = Boolean(options?.bypassCache) && !cacheOnly;

  // 1) Fresh exact cache
  if (!wantLive) {
    const hit = readGps51Cache<T>(action, body, ttlMs);
    if (hit && Number(hit.data.status) === 0) {
      return {
        data: hit.data,
        fromCache: true,
        cacheAgeMs: hit.ageMs,
        limitHit: false,
        message: `Using cached ${action} (${formatCacheAge(hit.ageMs)}). No GPS51 call.`,
        cacheMatch: 'exact',
        cacheBody: body,
      };
    }

    // 2) Any exact or best cached report for this device (stale OK) — still no live call
    const best = findBestCachedReport<T>(action, body);
    if (best) {
      const range =
        best.cacheBody.startday && best.cacheBody.endday
          ? ` (${best.cacheBody.startday} → ${best.cacheBody.endday})`
          : '';
      const matchNote =
        best.match === 'exact'
          ? 'exact cached report'
          : best.match === 'overlap'
            ? `overlapping cached report${range}`
            : `latest cached report for device${range}`;
      return {
        data: best.data,
        fromCache: true,
        cacheAgeMs: best.ageMs,
        limitHit: false,
        message: `Using ${matchNote} from ${formatCacheAge(best.ageMs)}. No GPS51 call.`,
        cacheMatch: best.match,
        cacheBody: best.cacheBody,
      };
    }

    // 3) cache-only and nothing saved
    if (cacheOnly) {
      const available = listGps51CacheEntries(action)
        .filter((e) => e.status === 0)
        .slice(0, 8)
        .map(
          (e) =>
            `${e.devices[0] || '?'} ${e.startday || '?'}→${e.endday || '?'} (${formatCacheAge(e.ageMs)})`
        );
      return {
        data: {
          status: 8905,
          cause: 'no_local_cache',
        } as T,
        fromCache: false,
        cacheAgeMs: null,
        limitHit: true,
        message:
          `No local ${action} cache for this device/range. Live GPS51 is blocked to protect quota.` +
          (available.length
            ? ` Available cached reports: ${available.join('; ')}.`
            : ' Save a report once when quota is available, then reload from cache.') +
          ' Use “Fetch live from GPS51” only when quota allows.',
        cacheMatch: null,
        cacheBody: null,
      };
    }
  }

  // Live GPS51 (explicit refresh only)
  const data = await gps51AuthedPost<T>(action, body);

  if (Number(data.status) === 0) {
    writeGps51Cache(action, body, data);
    return {
      data,
      fromCache: false,
      cacheAgeMs: 0,
      limitHit: false,
      message: null,
      cacheMatch: null,
      cacheBody: body,
    };
  }

  if (isLimitStatus(data.status)) {
    const best = findBestCachedReport<T>(action, body);
    if (best) {
      return {
        data: best.data,
        fromCache: true,
        cacheAgeMs: best.ageMs,
        limitHit: true,
        message: `${explainGps51Limit(Number(data.status), data.cause)} Showing ${best.match} cached data from ${formatCacheAge(best.ageMs)}.`,
        cacheMatch: best.match,
        cacheBody: best.cacheBody,
      };
    }
    const stale = readGps51CacheStale<T>(action, body);
    if (stale && Number(stale.data.status) === 0) {
      return {
        data: stale.data,
        fromCache: true,
        cacheAgeMs: stale.ageMs,
        limitHit: true,
        message: `${explainGps51Limit(Number(data.status), data.cause)} Showing cached data from ${formatCacheAge(stale.ageMs)}.`,
        cacheMatch: 'exact',
        cacheBody: body,
      };
    }
    return {
      data,
      fromCache: false,
      cacheAgeMs: null,
      limitHit: true,
      message: explainGps51Limit(Number(data.status), data.cause),
      cacheMatch: null,
      cacheBody: null,
    };
  }

  return {
    data,
    fromCache: false,
    cacheAgeMs: null,
    limitHit: false,
    message: data.cause || null,
    cacheMatch: null,
    cacheBody: null,
  };
}
