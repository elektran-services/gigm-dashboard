import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import path from 'path';
import { buildGPS51Url } from '@/lib/config';
import {
  TRIPS_REPORTS_DIR,
  ensureTripsReportsDir,
  purgeExpiredTripReports,
} from '@/lib/tripsReportStorage';

const RATE_LIMIT_DELAY_MS = 7500;
const QUERY_TRIPS_TIMEOUT_MS = 60000;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  timeout = 10000,
  silent = false
) {
  const maxAttempts = retries + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      const isLastAttempt = i === maxAttempts - 1;
      if (isLastAttempt) throw error;
      const waitTime = Math.pow(2, i) * 1000;
      if (!silent) {
        console.log(`[TripsDaily] Fetch failed (attempt ${i + 1}/${maxAttempts}), retrying in ${waitTime}ms...`);
      }
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
  throw new Error('All retry attempts failed');
}

function toEpochMs(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value < 1e12 ? value * 1000 : value;
}

function coordKey(lat: unknown, lon: unknown): string | null {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return `${la.toFixed(5)}_${lo.toFixed(5)}`;
}

function isTokenExpiredPayload(data: { cause?: string } | null) {
  if (!data) return false;
  const cause = data.cause || '';
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login'
  );
}

/**
 * POST /api/trips-daily
 * Body: { token, username, reportDate? } — one Excel per calendar day, all devices, no email.
 */
export async function POST(request: NextRequest) {
  try {
    let body: { token?: string; username?: string; reportDate?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { status: -1, cause: 'Invalid request body - must be valid JSON', error: 'INVALID_REQUEST_BODY' },
        { status: 400 }
      );
    }

    const { token, username } = body;
    if (!token || !username) {
      return NextResponse.json(
        { status: -1, cause: 'Token and username are required', error: 'MISSING_CREDENTIALS' },
        { status: 401 }
      );
    }

    const reportDate = body.reportDate ? new Date(body.reportDate) : new Date();
    const startOfDay = new Date(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate(), 0, 0, 0);
    const endOfDay = new Date(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate(), 23, 59, 59);
    const now = new Date();

    const formatDateForAPI = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const begintime = formatDateForAPI(startOfDay);
    const endtime = formatDateForAPI(endOfDay);
    const dateStr = begintime.split(' ')[0];

    const checkType = body.reportDate ? `catch-up for ${dateStr}` : `today (${dateStr})`;
    console.log(`[TripsDaily] Export ${checkType}: ${begintime} to ${endtime}`);

    const devicesUrl = buildGPS51Url('querymonitorlist', token);
    let devicesResponse: Response;
    try {
      devicesResponse = await fetchWithRetry(
        devicesUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        },
        3,
        15000
      );
    } catch (error) {
      console.error('[TripsDaily] Failed to connect to GPS51:', error);
      return NextResponse.json(
        {
          status: -1,
          cause: 'Failed to connect to GPS51 API. Please check your internet connection.',
          error: 'NETWORK_ERROR',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 503 }
      );
    }

    const devicesData = await devicesResponse.json();
    if (isTokenExpiredPayload(devicesData)) {
      return NextResponse.json(
        { status: -1, cause: devicesData.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
        { status: 401 }
      );
    }

    if (devicesData.status !== 0) {
      const errorCause = devicesData.cause || 'Unknown error';
      if (devicesData.status === 8904 || String(errorCause).includes('ip not in white list')) {
        const ipMatch = String(errorCause).match(/::(\d+\.\d+\.\d+\.\d+)/);
        const ipAddress = ipMatch ? ipMatch[1] : 'your IP';
        return NextResponse.json(
          {
            status: -1,
            cause: `IP address ${ipAddress} is not whitelisted. Please contact GPS51 support to whitelist your IP.`,
            error: 'IP_NOT_WHITELISTED',
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { status: -1, cause: `Failed to fetch devices: ${errorCause}`, error: 'DEVICE_FETCH_ERROR' },
        { status: 400 }
      );
    }

    if (!devicesData.groups) {
      return NextResponse.json(
        { status: -1, cause: 'No device groups found', error: 'NO_GROUPS' },
        { status: 400 }
      );
    }

    const allDevices = devicesData.groups.flatMap((group: { devices?: { deviceid: string; devicename?: string }[] }) =>
      (group.devices || []).map((device: { deviceid: string; devicename?: string }) => ({
        deviceid: device.deviceid,
        name: device.devicename || device.deviceid,
      }))
    );

    console.log(`[TripsDaily] ${allDevices.length} devices — querying trips (no HERE enrichment)`);

    type TripRow = {
      deviceid: string;
      devicename: string;
      starttime: string;
      endtime: string;
      maxspeed: string;
      avgspeed: string;
      distance: string;
      triptimeMin: string;
      parktimeSec: string;
      slat: string;
      slon: string;
      elat: string;
      elon: string;
      startaddr: string;
      endaddr: string;
    };

    const rows: TripRow[] = [];
    let processedCount = 0;
    let deviceErrors = 0;

    for (const device of allDevices) {
      processedCount++;
      if (processedCount % 50 === 0 || processedCount === allDevices.length) {
        console.log(`[TripsDaily] Progress: ${processedCount}/${allDevices.length} devices, ${rows.length} trip rows`);
      }

      try {
        if (processedCount > 1) {
          await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
        }

        const tripsUrl = buildGPS51Url('querytrips', token);
        const tripsResponse = await fetchWithRetry(
          tripsUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceid: device.deviceid,
              starttime: begintime,
              endtime: endtime,
              timezone: 8,
            }),
          },
          0,
          QUERY_TRIPS_TIMEOUT_MS,
          true
        );

        const tripsData = await tripsResponse.json();
        if (isTokenExpiredPayload(tripsData)) {
          return NextResponse.json(
            { status: -1, cause: tripsData.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
            { status: 401 }
          );
        }

        if (tripsData.status !== 0 || !tripsData.totaltrips) {
          continue;
        }

        const addressmap: Record<string, string> = tripsData.addressmap || {};

        for (const trip of tripsData.totaltrips as Record<string, unknown>[]) {
          const tripStartMs = toEpochMs(Number(trip.starttime));
          const tripEndMs = toEpochMs(Number(trip.endtime));
          const tripStartDate = new Date(tripStartMs);
          if (tripStartDate < startOfDay || tripStartDate > endOfDay) {
            continue;
          }

          const maxSpeedKmh = trip.maxspeed ? Number(trip.maxspeed) / 1000 : 0;
          const avgSpeedKmh = trip.averagespeed ? Number(trip.averagespeed) / 1000 : 0;
          const tripTimeRaw = Number(trip.triptime);
          const tripDurationMs =
            Number.isFinite(tripTimeRaw) && tripTimeRaw > 0 ? tripTimeRaw : Math.max(0, tripEndMs - tripStartMs);
          const tripMinutes = (tripDurationMs / 60000).toFixed(2);

          const distKm = trip.tripdistance ? Number(trip.tripdistance) / 1000 : 0;
          const parkRaw = Number(trip.parktime);
          const parkSec = Number.isFinite(parkRaw) ? Math.round(parkRaw) : 0;

          const sk = coordKey(trip.slat, trip.slon);
          const ek = coordKey(trip.elat, trip.elon);
          const startaddr = sk && addressmap[sk] ? String(addressmap[sk]) : '';
          const endaddr = ek && addressmap[ek] ? String(addressmap[ek]) : '';

          const slatN = Number(trip.slat);
          const slonN = Number(trip.slon);
          const elatN = Number(trip.elat);
          const elonN = Number(trip.elon);

          rows.push({
            deviceid: String(device.deviceid),
            devicename: String(device.name),
            starttime: new Date(tripStartMs).toLocaleString(),
            endtime: new Date(tripEndMs).toLocaleString(),
            maxspeed: maxSpeedKmh.toFixed(1),
            avgspeed: avgSpeedKmh.toFixed(1),
            distance: distKm.toFixed(2),
            triptimeMin: tripMinutes,
            parktimeSec: String(parkSec),
            slat: Number.isFinite(slatN) ? slatN.toFixed(6) : '',
            slon: Number.isFinite(slonN) ? slonN.toFixed(6) : '',
            elat: Number.isFinite(elatN) ? elatN.toFixed(6) : '',
            elon: Number.isFinite(elonN) ? elonN.toFixed(6) : '',
            startaddr,
            endaddr,
          });
        }
      } catch {
        deviceErrors++;
      }
    }

    ensureTripsReportsDir();
    purgeExpiredTripReports();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Daily Trips');
    const lastCol = 'O';

    worksheet.mergeCells(`A1:${lastCol}1`);
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Daily Trips Export — ${dateStr}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1565C0' },
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 25;

    worksheet.mergeCells(`A2:${lastCol}2`);
    const summaryCell = worksheet.getCell('A2');
    summaryCell.value = `Devices: ${allDevices.length} | Trip rows: ${rows.length} | Device query errors: ${deviceErrors} | Generated: ${now.toISOString()}`;
    summaryCell.font = { italic: true, size: 10 };
    summaryCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE3F2FD' },
    };
    summaryCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 20;

    worksheet.columns = [
      { key: 'deviceid', width: 18 },
      { key: 'devicename', width: 22 },
      { key: 'starttime', width: 20 },
      { key: 'endtime', width: 20 },
      { key: 'maxspeed', width: 14 },
      { key: 'avgspeed', width: 14 },
      { key: 'distance', width: 12 },
      { key: 'triptimeMin', width: 14 },
      { key: 'parktimeSec', width: 12 },
      { key: 'slat', width: 12 },
      { key: 'slon', width: 12 },
      { key: 'elat', width: 12 },
      { key: 'elon', width: 12 },
      { key: 'startaddr', width: 36 },
      { key: 'endaddr', width: 36 },
    ];

    const headerLabels = [
      'Device ID',
      'Device Name',
      'Start Time',
      'End Time',
      'Max Speed (km/h)',
      'Avg Speed (km/h)',
      'Distance (km)',
      'Trip Time (min)',
      'Park Time (s)',
      'Start Lat',
      'Start Lon',
      'End Lat',
      'End Lon',
      'Start Address',
      'End Address',
    ];
    const headerRow = worksheet.getRow(3);
    headerLabels.forEach((label, i) => {
      headerRow.getCell(i + 1).value = label;
    });
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC107' },
    };

    rows.forEach((r) => worksheet.addRow(r));

    const excelFilename = `trips_daily_report_${dateStr}.xlsx`;
    const excelPath = path.join(TRIPS_REPORTS_DIR, excelFilename);
    await workbook.xlsx.writeFile(excelPath);
    console.log(`[TripsDaily] Saved ${excelPath} (${rows.length} rows)`);

    return NextResponse.json({
      status: 0,
      cause: 'OK',
      message: 'Daily trips export written',
      reportFile: excelFilename,
      reportPath: excelPath,
      reportDate: dateStr,
      deviceCount: allDevices.length,
      tripRows: rows.length,
      deviceErrors,
    });
  } catch (error) {
    console.error('[TripsDaily] Error:', error);
    return NextResponse.json(
      {
        status: -1,
        cause: error instanceof Error ? error.message : 'Internal server error',
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      },
      { status: 500 }
    );
  }
}
