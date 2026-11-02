import { NextResponse } from 'next/server';
import { formatCacheAge, listGps51CacheEntries } from '@/lib/gps51Cache';

/** List locally saved GPS51 reports (no live API calls). */
export async function GET() {
  const oiltime = listGps51CacheEntries('reportoiltime')
    .filter((e) => e.status === 0)
    .map((e) => ({
      key: e.key,
      devices: e.devices,
      startday: e.startday,
      endday: e.endday,
      age: formatCacheAge(e.ageMs),
      ageMs: e.ageMs,
      savedAt: e.savedAt,
    }));

  const oildaily = listGps51CacheEntries('reportoildaily')
    .filter((e) => e.status === 0)
    .map((e) => ({
      key: e.key,
      devices: e.devices,
      startday: e.startday,
      endday: e.endday,
      age: formatCacheAge(e.ageMs),
      ageMs: e.ageMs,
      savedAt: e.savedAt,
    }));

  const oilrecord = listGps51CacheEntries('reportoilrecord')
    .filter((e) => e.status === 0)
    .map((e) => ({
      key: e.key,
      devices: e.devices,
      startday: e.startday,
      endday: e.endday,
      age: formatCacheAge(e.ageMs),
      ageMs: e.ageMs,
      savedAt: e.savedAt,
    }));

  return NextResponse.json({
    status: 0,
    oiltime,
    oildaily,
    oilrecord,
    message:
      oiltime.length || oildaily.length || oilrecord.length
        ? 'Local cached reports available — purchases Load uses these (no GPS51 call).'
        : 'No local reports yet.',
  });
}
