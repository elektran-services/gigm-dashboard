import { NextResponse } from 'next/server';
import { formatCacheAge, listGps51CacheEntries } from '@/lib/gps51Cache';

function mapEntry(e: ReturnType<typeof listGps51CacheEntries>[number]) {
  return {
    key: e.key,
    action: e.action,
    devices: e.devices,
    startday: e.startday,
    endday: e.endday,
    age: formatCacheAge(e.ageMs),
    ageMs: e.ageMs,
    savedAt: e.savedAt,
    sizeBytes: e.sizeBytes,
  };
}

/** List locally saved GPS51 reports (no live API calls). */
export async function GET() {
  const oiltime = listGps51CacheEntries('reportoiltime')
    .filter((e) => e.status === 0)
    .map(mapEntry);

  const oildaily = listGps51CacheEntries('reportoildaily')
    .filter((e) => e.status === 0)
    .map(mapEntry);

  const oilrecord = listGps51CacheEntries('reportoilrecord')
    .filter((e) => e.status === 0)
    .map(mapEntry);

  return NextResponse.json({
    status: 0,
    oiltime,
    oildaily,
    oilrecord,
    message:
      oiltime.length || oildaily.length || oilrecord.length
        ? 'Local cached reports available — Fuel Monitoring and Reports use these (no GPS51 call).'
        : 'No local reports yet.',
  });
}
