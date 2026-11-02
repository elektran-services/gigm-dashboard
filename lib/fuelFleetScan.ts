import { APP_CONFIG, buildGPS51Url } from '@/lib/config';
import { listGps51CacheEntries, readGps51Cache, writeGps51Cache } from '@/lib/gps51Cache';

/**
 * Daily fuel download.
 *
 * One reportoiltime call per vehicle for one finished day, then disk cache.
 * Call budget: 1 querymonitorlist + 1 reportoiltime per vehicle that is not
 * already saved. Up to 2 retries (3 attempts) on timeout, network error, or
 * 8902. 8905 stops the run. Spacing is 7.5s after each live call (~8/min).
 */

const RATE_LIMIT_DELAY_MS = 7500;
const RATE_LIMIT_WAIT_MS = 60_000;
const TRANSIENT_WAIT_MS = 5000;
const ATTEMPT_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;

type GpsStatus = { status?: number; cause?: string; groups?: unknown; records?: unknown };

export type FuelScanDeviceResult = {
  deviceid: string;
  name: string;
  result: 'skipped' | 'saved' | 'failed';
  attempts: number;
  cause?: string;
};

export type FuelScanResult = {
  status: number;
  cause?: string;
  reportDate: string;
  liveCalls: number;
  summary: {
    devices: number;
    skipped: number;
    saved: number;
    failed: number;
    stoppedForQuota: boolean;
  };
  results: FuelScanDeviceResult[];
};

function localYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function yesterdayLocalYmd(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return localYmd(d);
}

function isTokenExpired(data: GpsStatus | null | undefined): boolean {
  const cause = data?.cause || '';
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause.includes('global_error_not_find_token') ||
    cause === 'please login' ||
    data?.status === 9903
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gps51Post(action: string, token: string, body: Record<string, unknown>): Promise<GpsStatus> {
  const response = await fetch(buildGPS51Url(action, token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GPS51 HTTP ${response.status} for action=${action}`);
  }
  return response.json() as Promise<GpsStatus>;
}

function oiltimeBody(deviceid: string, day: string, offset: number) {
  return { devices: [deviceid], startday: day, endday: day, offset };
}

function dayAlreadySaved(
  deviceid: string,
  day: string,
  offset: number,
  savedDays: Array<{ devices: string[]; startday?: string; endday?: string; status: number }>
): boolean {
  const exact = readGps51Cache<GpsStatus>(
    'reportoiltime',
    oiltimeBody(deviceid, day, offset),
    Number.MAX_SAFE_INTEGER
  );
  if (exact && Number(exact.data.status) === 0) return true;
  return savedDays.some(
    (entry) =>
      entry.status === 0 &&
      entry.devices.includes(deviceid) &&
      !!entry.startday &&
      !!entry.endday &&
      entry.startday <= day &&
      entry.endday >= day
  );
}

export async function scanFuelFleet(options: {
  token: string;
  username: string;
  reportDate?: string;
}): Promise<FuelScanResult> {
  const reportDate = options.reportDate || yesterdayLocalYmd();
  const offset = APP_CONFIG.DEFAULT_OFFSET;
  const allow = new Set(
    String(process.env.GPS51_DEVICES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const list = await gps51Post('querymonitorlist', options.token, { username: options.username });
  if (isTokenExpired(list)) {
    throw new Error(list.cause || 'Token expired');
  }
  if (Number(list.status) !== 0 || !Array.isArray(list.groups)) {
    throw new Error(list.cause || 'Failed to load devices');
  }

  const devices: { deviceid: string; name: string }[] = [];
  for (const group of list.groups as Array<{ devices?: Array<{ deviceid?: string; devicename?: string }> }>) {
    for (const device of group.devices || []) {
      const deviceid = String(device.deviceid || '');
      if (!deviceid) continue;
      if (allow.size && !allow.has(deviceid)) continue;
      devices.push({ deviceid, name: device.devicename || deviceid });
    }
  }

  const savedDays = listGps51CacheEntries('reportoiltime');
  const results: FuelScanDeviceResult[] = [];
  let liveCalls = 1;
  let stoppedForQuota = false;
  let gapBeforeNextLiveCall = false;

  for (const device of devices) {
    const body = oiltimeBody(device.deviceid, reportDate, offset);
    if (dayAlreadySaved(device.deviceid, reportDate, offset, savedDays)) {
      results.push({ deviceid: device.deviceid, name: device.name, result: 'skipped', attempts: 0 });
      continue;
    }

    if (gapBeforeNextLiveCall) await sleep(RATE_LIMIT_DELAY_MS);
    gapBeforeNextLiveCall = true;

    let saved = false;
    let attempts = 0;
    let cause = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attempts = attempt;
      try {
        const data = await gps51Post('reportoiltime', options.token, body);
        liveCalls += 1;
        if (isTokenExpired(data)) {
          throw new Error(data.cause || 'Token expired');
        }
        if (Number(data.status) === 0) {
          writeGps51Cache('reportoiltime', body, data);
          saved = true;
          break;
        }
        cause = data.cause || `GPS51 status ${data.status}`;
        if (Number(data.status) === 8905) {
          stoppedForQuota = true;
          break;
        }
        if (Number(data.status) === 8902 && attempt < MAX_ATTEMPTS) {
          await sleep(RATE_LIMIT_WAIT_MS);
          continue;
        }
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Network error';
        if (message.toLowerCase().includes('token')) {
          throw error;
        }
        cause = message;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(TRANSIENT_WAIT_MS);
          continue;
        }
      }
    }

    results.push({
      deviceid: device.deviceid,
      name: device.name,
      result: saved ? 'saved' : 'failed',
      attempts,
      cause: saved ? undefined : cause,
    });

    if (stoppedForQuota) break;
  }

  const saved = results.filter((r) => r.result === 'saved').length;
  const skipped = results.filter((r) => r.result === 'skipped').length;
  const failed = results.filter((r) => r.result === 'failed').length;

  return {
    status: stoppedForQuota ? 8905 : 0,
    cause: stoppedForQuota ? 'GPS51 daily quota exhausted (8905). Stopped remaining vehicles.' : undefined,
    reportDate,
    liveCalls,
    summary: {
      devices: devices.length,
      skipped,
      saved,
      failed,
      stoppedForQuota,
    },
    results,
  };
}
