import { listGps51CacheEntries, readGps51CacheByKey } from '@/lib/gps51Cache';

type OilPayload = {
  status?: number;
  records?: Array<{ deviceid?: string; records?: Record<string, unknown>[] }>;
};

function ymdInOffset(ms: number, offsetHours: number): string {
  return new Date(ms + offsetHours * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Stitch saved reportoiltime files for one vehicle into the requested dates.
 * Nightly files are one day each. Older multi-day files are included too.
 * No GPS51 call.
 */
export function loadCachedOiltimeRecords(
  deviceid: string,
  startday: string,
  endday: string,
  offsetHours: number
): { records: Record<string, unknown>[]; days: string[] } | null {
  const entries = listGps51CacheEntries('reportoiltime').filter((entry) => {
    if (entry.status !== 0 || !entry.devices.includes(deviceid)) return false;
    if (!entry.startday || !entry.endday) return false;
    return entry.startday <= endday && entry.endday >= startday;
  });
  if (!entries.length) return null;

  const byTime = new Map<number, Record<string, unknown>>();
  for (const entry of entries) {
    const loaded = readGps51CacheByKey<OilPayload>(entry.key);
    if (!loaded || Number(loaded.data.status) !== 0) continue;
    const rec =
      (loaded.data.records || []).find((row) => String(row.deviceid) === deviceid) ||
      loaded.data.records?.[0];
    for (const point of rec?.records || []) {
      const ms = Number(point.updatetime || point.devicetime || 0);
      if (!ms) continue;
      const day = ymdInOffset(ms, offsetHours);
      if (day < startday || day > endday) continue;
      if (!byTime.has(ms)) byTime.set(ms, point);
    }
  }

  if (!byTime.size) return null;
  const records = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, point]) => point);
  const days = [...new Set(records.map((point) => ymdInOffset(Number(point.updatetime || point.devicetime), offsetHours)))];
  return { records, days };
}
