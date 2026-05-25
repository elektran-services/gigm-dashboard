import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import path from 'path';
import { buildGPS51Url, buildHereReverseGeocodeUrl } from '@/lib/config';
import {
  PARKING_REPORTS_DIR,
  ensureParkingReportsDir,
  purgeExpiredParkingReports,
} from '@/lib/parkingReportStorage';

type DeviceRow = { deviceid: string; name: string };

type ParkingApiRecord = {
  starttime?: number;
  endtime?: number;
  updatetime?: number;
  callat?: number;
  callon?: number;
  silent?: number;
  address?: string;
  validpoistiontime?: number;
  validpositiontime?: number;
  altitude?: number;
  radius?: number;
  durationidle?: number;
  speed?: number;
  course?: number;
  totaldistance?: number;
  startdistance?: number;
  enddistance?: number;
  alarm?: number;
  stralarm?: string;
  stralarmen?: string;
};

type ParkingExcelRow = {
  deviceName: string;
  deviceId: string;
  startTime: string;
  endTime: string;
  longitude: number | string;
  latitude: number | string;
  updateTime: string;
  address: string;
  validPositionTime: string;
  altitude: number | string;
  radius: number | string;
  idleDurationMin: number | string;
  speed: number | string;
  course: number | string;
  totalDistanceKm: number | string;
  startDistanceKm: number | string;
  endDistanceKm: number | string;
  alarm: number | string;
  alarmDescription: string;
};

const RATE_LIMIT_DELAY_MS = 150;
const HERE_DELAY_MS = 100;
const MIN_STAY_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MIN = 5;
const DEFAULT_TIMEZONE = 8;
const MAX_GEOCODE_KEYS = 250;

async function fetchWithRetry(url: string, options: RequestInit, retries = 2, timeout = 30000) {
  const maxAttempts = retries + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(tid);
      return response;
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  throw new Error('fetchWithRetry failed');
}

function toYmdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveReportYmd(bodyReportDate?: string): string {
  if (bodyReportDate?.trim()) {
    const d = new Date(bodyReportDate.trim());
    if (!Number.isNaN(d.getTime())) return toYmdLocal(d);
  }
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return toYmdLocal(y);
}

function isTokenExpiredPayload(data: { cause?: string } | null) {
  if (!data) return false;
  const cause = data.cause || '';
  return cause.includes('token_expire') || cause.includes('global_error_token_expire') || cause === 'please login';
}

function formatDateTimeMs(ts: number) {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function coordKey(lat: number, lon: number) {
  return `${lat.toFixed(5)}_${lon.toFixed(5)}`;
}

function getLatLon(rec: ParkingApiRecord): { lat: number; lon: number } | null {
  const lat = Number.isFinite(rec.callat) ? Number(rec.callat) : Number(rec.silent);
  const lon = Number(rec.callon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function getValidPositionTime(rec: ParkingApiRecord): number | undefined {
  const a = rec.validpoistiontime;
  const b = rec.validpositiontime;
  if (Number.isFinite(a)) return Number(a);
  if (Number.isFinite(b)) return Number(b);
  return undefined;
}

function recordMeetsMinStay(rec: ParkingApiRecord): boolean {
  const s = Number(rec.starttime);
  const e = Number(rec.endtime);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return e - s >= MIN_STAY_MS;
}

/** API `durationidle` is milliseconds → minutes (2 decimal places). */
function idleMsToMinutes(ms: number): number | '' {
  if (!Number.isFinite(ms)) return '';
  return Math.round((ms / 60000) * 100) / 100;
}

/** API distances are meters → kilometers (3 decimal places). */
function metersToKm(m: number): number | '' {
  if (!Number.isFinite(m)) return '';
  return Math.round((m / 1000) * 1000) / 1000;
}

function distanceFieldToKm(v: unknown): number | '' {
  if (v === undefined || v === null) return '';
  const n = Number(v);
  return metersToKm(n);
}

async function buildAddressMap(keys: string[]) {
  const addressmap: Record<string, string> = {};
  let n = 0;
  for (const key of keys) {
    if (n >= MAX_GEOCODE_KEYS) break;
    if (addressmap[key]) continue;
    const [latS, lonS] = key.split('_');
    try {
      const geoRes = await fetch(buildHereReverseGeocodeUrl(latS, lonS));
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData?.items?.[0]?.address?.label) {
          addressmap[key] = geoData.items[0].address.label;
        }
      }
    } catch {
      /* ignore */
    }
    n += 1;
    await new Promise((r) => setTimeout(r, HERE_DELAY_MS));
  }
  return addressmap;
}

function applySheetStyling(ws: ExcelJS.Worksheet, title: string, summary: string, data: ParkingExcelRow[]) {
  const colCount = 19;
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + colCount - 1);
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 25;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell('A2');
  s.value = summary;
  s.font = { italic: true, size: 10 };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  s.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 20;

  ws.columns = [
    { key: 'deviceName', width: 22 },
    { key: 'deviceId', width: 18 },
    { key: 'startTime', width: 22 },
    { key: 'endTime', width: 22 },
    { key: 'longitude', width: 14 },
    { key: 'latitude', width: 14 },
    { key: 'updateTime', width: 22 },
    { key: 'address', width: 40 },
    { key: 'validPositionTime', width: 22 },
    { key: 'altitude', width: 12 },
    { key: 'radius', width: 10 },
    { key: 'idleDurationMin', width: 14 },
    { key: 'speed', width: 10 },
    { key: 'course', width: 8 },
    { key: 'totalDistanceKm', width: 14 },
    { key: 'startDistanceKm', width: 14 },
    { key: 'endDistanceKm', width: 14 },
    { key: 'alarm', width: 10 },
    { key: 'alarmDescription', width: 28 },
  ] as ExcelJS.Column[];

  const headers = [
    'Device name',
    'Device ID',
    'Start time',
    'End time',
    'Longitude',
    'Latitude',
    'Update time',
    'Address',
    'Valid position time',
    'Altitude (m)',
    'Radius (m)',
    'Idle duration (min)',
    'Speed',
    'Course',
    'Total distance (km)',
    'Start distance (km)',
    'End distance (km)',
    'Alarm',
    'Alarm description',
  ];
  const hr = ws.getRow(3);
  headers.forEach((label, i) => {
    hr.getCell(i + 1).value = label;
  });
  hr.font = { bold: true };
  hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC107' } };

  data.forEach((row) => ws.addRow(row));
}

function toExcelRow(
  deviceName: string,
  deviceId: string,
  rec: ParkingApiRecord,
  addressmap: Record<string, string>
): ParkingExcelRow {
  const ll = getLatLon(rec);
  const key = ll ? coordKey(ll.lat, ll.lon) : '';
  const addr =
    (typeof rec.address === 'string' && rec.address.trim() ? rec.address.trim() : '') ||
    (key ? addressmap[key] || '' : '');

  const vpt = getValidPositionTime(rec);
  const idleMs = Number(rec.durationidle);

  return {
    deviceName,
    deviceId,
    startTime: formatDateTimeMs(Number(rec.starttime)),
    endTime: formatDateTimeMs(Number(rec.endtime)),
    longitude: ll?.lon ?? '',
    latitude: ll?.lat ?? '',
    updateTime: formatDateTimeMs(Number(rec.updatetime)),
    address: addr,
    validPositionTime: vpt !== undefined ? formatDateTimeMs(vpt) : '',
    altitude: rec.altitude ?? '',
    radius: rec.radius ?? '',
    idleDurationMin: Number.isFinite(idleMs) ? idleMsToMinutes(idleMs) : '',
    speed: rec.speed ?? '',
    course: rec.course ?? '',
    totalDistanceKm: distanceFieldToKm(rec.totaldistance),
    startDistanceKm: distanceFieldToKm(rec.startdistance),
    endDistanceKm: distanceFieldToKm(rec.enddistance),
    alarm: rec.alarm ?? '',
    alarmDescription: (rec.stralarmen || rec.stralarm || '').trim(),
  };
}

/**
 * POST /api/parking-scheduled
 * Body: { token, username, reportDate?, timezone?, interval? }
 * Default report day: previous calendar day (local server). Min stay 5 min (API interval + row filter).
 */
export async function POST(request: NextRequest) {
  try {
    let body: {
      token?: string;
      username?: string;
      reportDate?: string;
      timezone?: number;
      interval?: number;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ status: -1, cause: 'Invalid JSON body', error: 'INVALID_BODY' }, { status: 400 });
    }

    const { token, username } = body;
    if (!token || !username) {
      return NextResponse.json(
        { status: -1, cause: 'Token and username are required', error: 'MISSING_CREDENTIALS' },
        { status: 401 }
      );
    }

    const reportYmd = resolveReportYmd(body.reportDate);
    const timezone = Number.isFinite(body.timezone) ? Number(body.timezone) : DEFAULT_TIMEZONE;
    const interval = Number.isFinite(body.interval) ? Number(body.interval) : DEFAULT_INTERVAL_MIN;

    const begintime = `${reportYmd} 00:00:00`;
    const endtime = `${reportYmd} 23:59:59`;

    const devicesUrl = buildGPS51Url('querymonitorlist', token);
    const devicesRes = await fetchWithRetry(
      devicesUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      },
      3,
      20000
    );
    const devicesData = await devicesRes.json();
    if (isTokenExpiredPayload(devicesData)) {
      return NextResponse.json(
        { status: -1, cause: devicesData.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
        { status: 401 }
      );
    }
    if (devicesData.status !== 0 || !devicesData.groups) {
      return NextResponse.json(
        { status: -1, cause: devicesData.cause || 'Failed to load devices', error: 'DEVICE_FETCH_ERROR' },
        { status: 400 }
      );
    }

    const allDevices: DeviceRow[] = devicesData.groups.flatMap(
      (group: { devices?: { deviceid: string; devicename?: string }[] }) =>
        (group.devices || []).map((d) => ({ deviceid: d.deviceid, name: d.devicename || d.deviceid }))
    );

    if (allDevices.length === 0) {
      return NextResponse.json({ status: 0, cause: 'OK', message: 'No devices found', deviceCount: 0, rowCount: 0 });
    }

    const parkingUrl = buildGPS51Url('reportparkdetailbytime', token);
    type RawItem = { deviceName: string; deviceId: string; rec: ParkingApiRecord };
    const rawItems: RawItem[] = [];

    for (let i = 0; i < allDevices.length; i++) {
      const dev = allDevices[i];
      console.log(
        `[ParkingScheduled] Progress ${i + 1}/${allDevices.length} device=${dev.deviceid} (${dev.name})`
      );

      let parkRes: Response;
      try {
        parkRes = await fetchWithRetry(
          parkingUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceid: dev.deviceid,
              begintime,
              endtime,
              timezone,
              interval,
            }),
          },
          2,
          30000
        );
      } catch (e) {
        console.warn(`[ParkingScheduled] Fetch failed device=${dev.deviceid}:`, e);
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        continue;
      }

      let parkData: { status?: number; cause?: string; records?: ParkingApiRecord[] };
      try {
        parkData = await parkRes.json();
      } catch {
        console.warn(`[ParkingScheduled] Non-JSON device=${dev.deviceid}`);
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        continue;
      }

      if (isTokenExpiredPayload(parkData)) {
        return NextResponse.json(
          { status: -1, cause: parkData.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
          { status: 401 }
        );
      }

      if (parkData.status !== 0 || !Array.isArray(parkData.records)) {
        console.warn(`[ParkingScheduled] Skip device=${dev.deviceid}: ${parkData.cause || 'no records'}`);
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        continue;
      }

      for (const rec of parkData.records) {
        if (!recordMeetsMinStay(rec)) continue;
        rawItems.push({ deviceName: dev.name, deviceId: dev.deviceid, rec });
      }

      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }

    const keysToGeocode: string[] = [];
    const seen = new Set<string>();
    for (const { rec } of rawItems) {
      if (typeof rec.address === 'string' && rec.address.trim()) continue;
      const ll = getLatLon(rec);
      if (!ll) continue;
      const k = coordKey(ll.lat, ll.lon);
      if (seen.has(k)) continue;
      seen.add(k);
      keysToGeocode.push(k);
    }

    const addressmap = await buildAddressMap(keysToGeocode);

    const excelRows: ParkingExcelRow[] = rawItems.map((item) =>
      toExcelRow(item.deviceName, item.deviceId, item.rec, addressmap)
    );

    ensureParkingReportsDir();
    purgeExpiredParkingReports();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Parking');
    const title = `Parking report — ${reportYmd}`;
    const summary = `Parking events (≥ ${interval} min): ${excelRows.length} | Devices scanned: ${allDevices.length} | Day ${begintime} → ${endtime} | TZ ${timezone} | Generated ${new Date().toISOString()}`;
    applySheetStyling(ws, title, summary, excelRows);

    const filename = `parking_daily_report_${reportYmd}.xlsx`;
    const excelPath = path.join(PARKING_REPORTS_DIR, filename);
    await wb.xlsx.writeFile(excelPath);

    return NextResponse.json({
      status: 0,
      cause: 'OK',
      reportFile: filename,
      reportPath: excelPath,
      reportDate: reportYmd,
      deviceCount: allDevices.length,
      rowCount: excelRows.length,
      intervalMinutes: interval,
      timezone,
    });
  } catch (error) {
    console.error('[ParkingScheduled]', error);
    return NextResponse.json(
      {
        status: -1,
        cause: error instanceof Error ? error.message : 'Internal server error',
        error: 'UNKNOWN_ERROR',
      },
      { status: 500 }
    );
  }
}
