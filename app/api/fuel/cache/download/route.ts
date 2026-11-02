import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { readGps51CacheByKey } from '@/lib/gps51Cache';
import { normalizeSpeedKmh } from '@/lib/mileageLocation';

const KEY_RE = /^(reportoiltime|reportoildaily|reportoilrecord)_[a-f0-9]{24}$/;

function toIso(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toISOString();
  } catch {
    return '';
  }
}

function oilL(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n / 100).toFixed(2));
}

function km(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n / 1000).toFixed(2));
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE31D00' },
  };
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
}

/**
 * GET /api/fuel/cache/download?key=reportoiltime_…&format=xlsx|json
 * Downloads a saved report from disk only — never calls GPS51.
 */
export async function GET(request: NextRequest) {
  try {
    const key = String(request.nextUrl.searchParams.get('key') || '');
    const format = String(request.nextUrl.searchParams.get('format') || 'xlsx').toLowerCase();

    if (!KEY_RE.test(key)) {
      return NextResponse.json({ status: 1, cause: 'Invalid cache key' }, { status: 400 });
    }

    const loaded = readGps51CacheByKey<{
      status?: number;
      cause?: string;
      records?: Record<string, unknown>[];
    }>(key);
    if (!loaded || Number(loaded.data.status) !== 0) {
      return NextResponse.json({ status: 1, cause: 'Saved report not found' }, { status: 404 });
    }

    const action = loaded.action || key.split('_')[0];
    const devices = Array.isArray(loaded.body.devices)
      ? loaded.body.devices.map(String)
      : [];
    const startday = String(loaded.body.startday || 'unknown');
    const endday = String(loaded.body.endday || startday);
    const deviceLabel = devices[0] || 'device';

    if (format === 'json') {
      const filename = `${action}_${deviceLabel}_${startday}_to_${endday}.json`;
      return new NextResponse(JSON.stringify(loaded.data, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'GIGMotors Fuel Reports';
    wb.created = new Date();

    if (action === 'reportoiltime') {
      const ws = wb.addWorksheet('Fuel Graph');
      ws.columns = [
        { header: 'Index', key: 'index', width: 8 },
        { header: 'Device ID', key: 'deviceid', width: 18 },
        { header: 'Update Time', key: 'updatetime', width: 22 },
        { header: 'Arrived Time', key: 'arrivedtime', width: 22 },
        { header: 'Speed(km/h)', key: 'speed', width: 12 },
        { header: 'Total Mileage(km)', key: 'mileage', width: 16 },
        { header: 'Total Fuel', key: 'fuel', width: 12 },
        { header: 'Lat', key: 'lat', width: 12 },
        { header: 'Lon', key: 'lon', width: 12 },
        { header: 'Status', key: 'status', width: 36 },
      ];
      styleHeader(ws.getRow(1));

      let index = 0;
      for (const rec of loaded.data.records || []) {
        const deviceid = String(rec.deviceid || deviceLabel);
        const points = ((rec.records as Record<string, unknown>[]) || []).slice().reverse();
        for (const p of points) {
          index += 1;
          const speedRaw = Number(p.speed);
          const speedKmh = Number.isFinite(speedRaw) ? normalizeSpeedKmh(speedRaw) ?? 0 : 0;
          ws.addRow({
            index,
            deviceid,
            updatetime: toIso(p.updatetime).replace('T', ' ').slice(0, 19),
            arrivedtime: toIso(p.arrivedtime).replace('T', ' ').slice(0, 19),
            speed: speedKmh,
            mileage: km(p.totaldistance),
            fuel: oilL(p.totalad),
            lat: p.callat,
            lon: p.callon,
            status: p.strstatusen || p.strstatus || '',
          });
        }
      }
    } else if (action === 'reportoildaily') {
      const ws = wb.addWorksheet('Daily Fuel Raw');
      ws.columns = [
        { header: 'deviceid', key: 'deviceid', width: 16 },
        { header: 'statisticsday', key: 'statisticsday', width: 14 },
        { header: 'totaldistance_km', key: 'totaldistance_km', width: 16 },
        { header: 'beginoil_L', key: 'beginoil_L', width: 12 },
        { header: 'endoil_L', key: 'endoil_L', width: 12 },
        { header: 'addoil_L', key: 'addoil_L', width: 12 },
        { header: 'leakoil_L', key: 'leakoil_L', width: 12 },
        { header: 'idleoil_L', key: 'idleoil_L', width: 12 },
        { header: 'oilper100km', key: 'oilper100km', width: 12 },
        { header: 'avgspeed', key: 'avgspeed', width: 12 },
      ];
      styleHeader(ws.getRow(1));
      for (const rec of loaded.data.records || []) {
        for (const d of (rec.records as Record<string, unknown>[]) || []) {
          ws.addRow({
            deviceid: rec.deviceid,
            statisticsday: d.statisticsday,
            totaldistance_km: km(d.totaldistance),
            beginoil_L: oilL(d.beginoil),
            endoil_L: oilL(d.endoil),
            addoil_L: oilL(d.addoil),
            leakoil_L: oilL(d.leakoil),
            idleoil_L: oilL(d.idleoil),
            oilper100km: d.oilper100km,
            avgspeed: d.avgspeed,
          });
        }
      }
    } else {
      const ws = wb.addWorksheet('Refuel Leak Raw');
      ws.columns = [
        { header: 'deviceid', key: 'deviceid', width: 16 },
        { header: 'kind', key: 'kind', width: 10 },
        { header: 'starttime', key: 'starttime', width: 22 },
        { header: 'endtime', key: 'endtime', width: 22 },
        { header: 'start_oil_L', key: 'start_oil_L', width: 12 },
        { header: 'end_oil_L', key: 'end_oil_L', width: 12 },
        { header: 'slat', key: 'slat', width: 12 },
        { header: 'slon', key: 'slon', width: 12 },
      ];
      styleHeader(ws.getRow(1));
      for (const rec of loaded.data.records || []) {
        for (const e of (rec.records as Record<string, unknown>[]) || []) {
          const oilstate = Number(e.oilstate ?? 0);
          ws.addRow({
            deviceid: rec.deviceid,
            kind: oilstate === 1 ? 'refuel' : oilstate === -1 ? 'leak' : 'other',
            starttime: toIso(e.starttime).replace('T', ' ').slice(0, 19),
            endtime: toIso(e.endtime ?? e['end time']).replace('T', ' ').slice(0, 19),
            start_oil_L: oilL(e.soil ?? e.startoil),
            end_oil_L: oilL(e.eoil ?? e.endoil ?? e.know),
            slat: e.slat,
            slon: e.slon ?? e.elephant,
          });
        }
      }
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `${action}_${deviceLabel}_${startday}_to_${endday}.xlsx`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 1,
        cause: error instanceof Error ? error.message : 'Download failed',
      },
      { status: 500 }
    );
  }
}
