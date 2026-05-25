import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import path from 'path';
import { buildGPS51Url, buildHereReverseGeocodeUrl } from '@/lib/config';
import {
  OFFLINE_REPORTS_DIR,
  ensureOfflineReportsDir,
  purgeExpiredOfflineReports,
} from '@/lib/offlineReportStorage';

type DeviceRow = { deviceid: string; name: string };

type OfflineRecord = {
  deviceid: string;
  devicename: string;
  simnum: string;
  groupid: number;
  updatetime: number;
  callat: number;
  callon: number;
  strstatus?: string;
  strstatusen?: string;
};

type OfflineExcelRow = {
  deviceName: string;
  imei: string;
  simNumber: string;
  lastUpdate: string;
  offlineDuration: string;
  lastLocation: string;
  status: string;
};

const RATE_LIMIT_DELAY_MS = 150;
const HERE_DELAY_MS = 100;
const OFFLINE_API_TIMEOUT_MS = 30000;

async function fetchWithRetry(url: string, options: RequestInit, retries = 2, timeout = 15000) {
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

function isTokenExpiredPayload(data: { cause?: string } | null) {
  if (!data) return false;
  const cause = data.cause || '';
  return cause.includes('token_expire') || cause.includes('global_error_token_expire') || cause === 'please login';
}

function formatDateTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOfflineDuration(updatetime: number, nowMs: number) {
  if (!Number.isFinite(updatetime)) return '';
  const diff = Math.max(0, nowMs - updatetime);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

async function resolveAddressMap(records: OfflineRecord[]) {
  const addressmap: Record<string, string> = {};
  const keys = new Set<string>();
  for (const d of records) {
    if (Number.isFinite(d.callat) && Number.isFinite(d.callon)) {
      keys.add(`${d.callat.toFixed(5)}_${d.callon.toFixed(5)}`);
    }
  }

  for (const key of keys) {
    try {
      const [lat, lon] = key.split('_');
      const geoRes = await fetch(buildHereReverseGeocodeUrl(lat, lon));
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData?.items?.[0]?.address?.label) {
          addressmap[key] = geoData.items[0].address.label;
        }
      }
    } catch {
      /* ignore geocode failures */
    }
    await new Promise((r) => setTimeout(r, HERE_DELAY_MS));
  }

  return addressmap;
}

function applySheetStyling(ws: ExcelJS.Worksheet, title: string, summary: string, data: OfflineExcelRow[]) {
  ws.mergeCells('A1:G1');
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 25;

  ws.mergeCells('A2:G2');
  const s = ws.getCell('A2');
  s.value = summary;
  s.font = { italic: true, size: 10 };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  s.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 20;

  ws.columns = [
    { key: 'deviceName', width: 24 },
    { key: 'imei', width: 20 },
    { key: 'simNumber', width: 18 },
    { key: 'lastUpdate', width: 22 },
    { key: 'offlineDuration', width: 18 },
    { key: 'lastLocation', width: 42 },
    { key: 'status', width: 16 },
  ] as ExcelJS.Column[];

  const headers = ['Device Name', 'IMEI', 'SIM Number', 'Last Update', 'Offline Duration', 'Last Location', 'Status'];
  const hr = ws.getRow(3);
  headers.forEach((label, i) => {
    hr.getCell(i + 1).value = label;
  });
  hr.font = { bold: true };
  hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC107' } };

  data.forEach((row) => ws.addRow(row));
}

/**
 * POST /api/offline-scheduled
 * Body: { token, username, reportDate?, offlinehours? }
 */
export async function POST(request: NextRequest) {
  try {
    let body: { token?: string; username?: string; reportDate?: string; offlinehours?: number };
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

    const reportDate = body.reportDate ? new Date(body.reportDate) : new Date();
    const reportYmd = toYmdLocal(reportDate);
    const offlinehours = Number.isFinite(body.offlinehours) ? Number(body.offlinehours) : 0;

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
    const deviceids = allDevices.map((d) => d.deviceid);
    if (deviceids.length === 0) {
      return NextResponse.json({ status: 0, cause: 'OK', message: 'No devices found', deviceCount: 0 });
    }

    const offlineUrl = buildGPS51Url('reportoffline', token);
    const offlineRes = await fetchWithRetry(
      offlineUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceids, offlinehours }),
      },
      1,
      OFFLINE_API_TIMEOUT_MS
    );
    const offlineData = await offlineRes.json();
    if (isTokenExpiredPayload(offlineData)) {
      return NextResponse.json(
        { status: -1, cause: offlineData.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
        { status: 401 }
      );
    }
    if (offlineData.status !== 0 || !Array.isArray(offlineData.records)) {
      return NextResponse.json(
        { status: -1, cause: offlineData.cause || 'Failed to fetch offline report', error: 'OFFLINE_FETCH_ERROR' },
        { status: 400 }
      );
    }

    const records: OfflineRecord[] = offlineData.records;
    const nowMs = Date.now();
    const addressmap = await resolveAddressMap(records);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));

    const rows: OfflineExcelRow[] = records.map((d) => {
      const key = `${Number(d.callat).toFixed(5)}_${Number(d.callon).toFixed(5)}`;
      const fallbackCoords =
        Number.isFinite(d.callat) && Number.isFinite(d.callon)
          ? `${Number(d.callat).toFixed(6)}, ${Number(d.callon).toFixed(6)}`
          : '';
      return {
        deviceName: d.devicename || d.deviceid,
        imei: d.deviceid || '',
        simNumber: d.simnum || '',
        lastUpdate: formatDateTime(Number(d.updatetime)),
        offlineDuration: formatOfflineDuration(Number(d.updatetime), nowMs),
        lastLocation: addressmap[key] || fallbackCoords,
        status: d.strstatusen || d.strstatus || '',
      };
    });

    ensureOfflineReportsDir();
    purgeExpiredOfflineReports();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Offline devices');
    const title = `Offline devices snapshot — ${reportYmd}`;
    const summary = `Offline devices: ${rows.length} | Fleet devices: ${allDevices.length} | Threshold: ${offlinehours}h | Generated ${new Date().toISOString()}`;
    applySheetStyling(ws, title, summary, rows);

    const filename = `offline_daily_report_${reportYmd}.xlsx`;
    const excelPath = path.join(OFFLINE_REPORTS_DIR, filename);
    await wb.xlsx.writeFile(excelPath);

    return NextResponse.json({
      status: 0,
      cause: 'OK',
      reportFile: filename,
      reportPath: excelPath,
      reportDate: reportYmd,
      deviceCount: allDevices.length,
      offlineCount: rows.length,
      offlinehours,
    });
  } catch (error) {
    console.error('[OfflineScheduled]', error);
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
