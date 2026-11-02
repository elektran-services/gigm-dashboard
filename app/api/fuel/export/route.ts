import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { APP_CONFIG } from '@/lib/config';
import { gps51AuthedPost } from '@/lib/gps51Session';
import { getDefaultDevices } from '@/lib/serverAuth';

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

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF59E0B' },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const devices =
      Array.isArray(body.devices) && body.devices.length
        ? (body.devices as string[])
        : getDefaultDevices();
    const startday = String(body.startday || '');
    const endday = String(body.endday || '');
    const offset = Number(body.offset ?? APP_CONFIG.DEFAULT_OFFSET);
    /** Opt-in only — reportoiltime burns history/track quota. */
    const includeTrack = Boolean(body.includeTrack);

    if (!devices.length || !startday || !endday) {
      return NextResponse.json(
        { status: 1, cause: 'devices, startday, endday are required' },
        { status: 400 }
      );
    }

    // Default: report records only (daily + oilrecord). No live/track oiltime.
    const [dailyData, eventData] = await Promise.all([
      gps51AuthedPost<{ status: number; cause?: string; records?: Record<string, unknown>[] }>(
        'reportoildaily',
        { devices, startday, endday, offset }
      ),
      gps51AuthedPost<{ status: number; cause?: string; records?: Record<string, unknown>[] }>(
        'reportoilrecord',
        { devices, startday, endday, offset, oilindex: 99, oilstate: 99 }
      ),
    ]);

    for (const [name, data] of [
      ['reportoildaily', dailyData],
      ['reportoilrecord', eventData],
    ] as const) {
      if (data.status !== 0) {
        return NextResponse.json(
          { status: data.status, cause: `${name}: ${data.cause || 'failed'}` },
          { status: 200 }
        );
      }
    }

    let timeData: { status: number; cause?: string; records?: Record<string, unknown>[] } | null =
      null;
    if (includeTrack) {
      const fetchedTime = await gps51AuthedPost<{
        status: number;
        cause?: string;
        records?: Record<string, unknown>[];
      }>('reportoiltime', {
        devices,
        startday,
        endday,
        offset,
      });
      if (fetchedTime.status !== 0) {
        return NextResponse.json(
          {
            status: fetchedTime.status,
            cause: `reportoiltime: ${fetchedTime.cause || 'failed'}`,
          },
          { status: 200 }
        );
      }
      timeData = fetchedTime;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SafeTrack Fuel Monitor';
    wb.created = new Date();

    if (includeTrack && timeData) {
      const wsTime = wb.addWorksheet('Oil Timeline Raw');
      wsTime.columns = [
        { header: 'deviceid', key: 'deviceid', width: 16 },
        { header: 'updatetime_ms', key: 'updatetime_ms', width: 16 },
        { header: 'updatetime_iso', key: 'updatetime_iso', width: 24 },
        { header: 'arrivedtime_ms', key: 'arrivedtime_ms', width: 16 },
        { header: 'arrivedtime_iso', key: 'arrivedtime_iso', width: 24 },
        { header: 'lat', key: 'lat', width: 12 },
        { header: 'lon', key: 'lon', width: 12 },
        { header: 'altitude', key: 'altitude', width: 10 },
        { header: 'course', key: 'course', width: 8 },
        { header: 'speed_raw', key: 'speed_raw', width: 12 },
        { header: 'totaldistance_m', key: 'totaldistance_m', width: 16 },
        { header: 'totalad_raw', key: 'totalad_raw', width: 12 },
        { header: 'totalad_L', key: 'totalad_L', width: 12 },
        { header: 'ad0_raw', key: 'ad0_raw', width: 10 },
        { header: 'ad0_L', key: 'ad0_L', width: 10 },
        { header: 'ad1_raw', key: 'ad1_raw', width: 10 },
        { header: 'ad2_raw', key: 'ad2_raw', width: 10 },
        { header: 'ad3_raw', key: 'ad3_raw', width: 10 },
        { header: 'srcad0', key: 'srcad0', width: 10 },
        { header: 'totalnotrunningad_raw', key: 'totalnotrunningad_raw', width: 18 },
        { header: 'voltage_raw', key: 'voltage_raw', width: 12 },
        { header: 'status', key: 'status', width: 12 },
        { header: 'strstatusen', key: 'strstatusen', width: 36 },
        { header: 'reissue', key: 'reissue', width: 8 },
        { header: 'trackid', key: 'trackid', width: 10 },
      ];
      styleHeader(wsTime.getRow(1));

      for (const rec of timeData.records || []) {
        for (const p of (rec.records as Record<string, unknown>[]) || []) {
          wsTime.addRow({
            deviceid: rec.deviceid,
            updatetime_ms: p.updatetime,
            updatetime_iso: toIso(p.updatetime),
            arrivedtime_ms: p.arrivedtime,
            arrivedtime_iso: toIso(p.arrivedtime),
            lat: p.callat,
            lon: p.callon,
            altitude: p.altitude,
            course: p.course,
            speed_raw: p.speed,
            totaldistance_m: p.totaldistance,
            totalad_raw: p.totalad,
            totalad_L: oilL(p.totalad),
            ad0_raw: p.ad0,
            ad0_L: oilL(p.ad0),
            ad1_raw: p.ad1,
            ad2_raw: p.ad2,
            ad3_raw: p.ad3,
            srcad0: p.srcad0,
            totalnotrunningad_raw: p.totalnotrunningad,
            voltage_raw: p.voltage,
            status: p.status,
            strstatusen: p.strstatusen,
            reissue: p.reissue,
            trackid: p.trackid,
          });
        }
      }
    }

    const wsDaily = wb.addWorksheet('Daily Fuel Raw');
    wsDaily.columns = [
      { header: 'deviceid', key: 'deviceid', width: 16 },
      { header: 'statisticsday', key: 'statisticsday', width: 14 },
      { header: 'timezoneoffset', key: 'timezoneoffset', width: 14 },
      { header: 'starttime_iso', key: 'starttime_iso', width: 24 },
      { header: 'endtime_iso', key: 'endtime_iso', width: 24 },
      { header: 'begindis_m', key: 'begindis_m', width: 12 },
      { header: 'enddis_m', key: 'enddis_m', width: 12 },
      { header: 'totaldistance_m', key: 'totaldistance_m', width: 16 },
      { header: 'beginoil_raw', key: 'beginoil_raw', width: 12 },
      { header: 'beginoil_L', key: 'beginoil_L', width: 12 },
      { header: 'endoil_raw', key: 'endoil_raw', width: 12 },
      { header: 'endoil_L', key: 'endoil_L', width: 12 },
      { header: 'addoil_raw', key: 'addoil_raw', width: 12 },
      { header: 'addoil_L', key: 'addoil_L', width: 12 },
      { header: 'leakoil_raw', key: 'leakoil_raw', width: 12 },
      { header: 'leakoil_L', key: 'leakoil_L', width: 12 },
      { header: 'idleoil_raw', key: 'idleoil_raw', width: 12 },
      { header: 'idleoil_L', key: 'idleoil_L', width: 12 },
      { header: 'totaloil_raw', key: 'totaloil_raw', width: 12 },
      { header: 'totaloil_L', key: 'totaloil_L', width: 12 },
      { header: 'totalacc_ms', key: 'totalacc_ms', width: 14 },
      { header: 'totalidle_ms', key: 'totalidle_ms', width: 14 },
      { header: 'oilper100km', key: 'oilper100km', width: 12 },
      { header: 'runoilper100km', key: 'runoilper100km', width: 14 },
      { header: 'oilperhour', key: 'oilperhour', width: 12 },
      { header: 'avgspeed', key: 'avgspeed', width: 12 },
      { header: 'onlinestatus', key: 'onlinestatus', width: 12 },
      { header: 'dailydetailreportid', key: 'dailydetailreportid', width: 18 },
    ];
    styleHeader(wsDaily.getRow(1));

    for (const rec of dailyData.records || []) {
      for (const d of (rec.records as Record<string, unknown>[]) || []) {
        wsDaily.addRow({
          deviceid: rec.deviceid,
          statisticsday: d.statisticsday,
          timezoneoffset: d.timezoneoffset,
          starttime_iso: toIso(d.starttime),
          endtime_iso: toIso(d.endtime),
          begindis_m: d.begindis,
          enddis_m: d.enddis,
          totaldistance_m: d.totaldistance,
          beginoil_raw: d.beginoil,
          beginoil_L: oilL(d.beginoil),
          endoil_raw: d.endoil,
          endoil_L: oilL(d.endoil),
          addoil_raw: d.addoil,
          addoil_L: oilL(d.addoil),
          leakoil_raw: d.leakoil,
          leakoil_L: oilL(d.leakoil),
          idleoil_raw: d.idleoil,
          idleoil_L: oilL(d.idleoil),
          totaloil_raw: d.totaloil,
          totaloil_L: oilL(d.totaloil),
          totalacc_ms: d.totalacc,
          totalidle_ms: d.totalidle,
          oilper100km: d.oilper100km,
          runoilper100km: d.runoilper100km,
          oilperhour: d.oilperhour,
          avgspeed: d.avgspeed,
          onlinestatus: d.onlinestatus,
          dailydetailreportid: d.dailydetailreportid,
        });
      }
    }

    const wsEvents = wb.addWorksheet('Refuel Leak Raw');
    wsEvents.columns = [
      { header: 'deviceid', key: 'deviceid', width: 16 },
      { header: 'oilstate', key: 'oilstate', width: 10 },
      { header: 'kind', key: 'kind', width: 10 },
      { header: 'oilIndex', key: 'oilIndex', width: 10 },
      { header: 'starttime_iso', key: 'starttime_iso', width: 24 },
      { header: 'endtime_iso', key: 'endtime_iso', width: 24 },
      { header: 'start_oil_raw', key: 'start_oil_raw', width: 14 },
      { header: 'start_oil_L', key: 'start_oil_L', width: 12 },
      { header: 'end_oil_raw', key: 'end_oil_raw', width: 14 },
      { header: 'end_oil_L', key: 'end_oil_L', width: 12 },
      { header: 'slat', key: 'slat', width: 12 },
      { header: 'slon', key: 'slon', width: 12 },
      { header: 'elat', key: 'elat', width: 12 },
      { header: 'elon', key: 'elon', width: 12 },
      { header: 'maunedit', key: 'maunedit', width: 10 },
    ];
    styleHeader(wsEvents.getRow(1));

    for (const rec of eventData.records || []) {
      for (const e of (rec.records as Record<string, unknown>[]) || []) {
        const oilstate = Number(e.oilstate ?? 0);
        wsEvents.addRow({
          deviceid: rec.deviceid,
          oilstate,
          kind: oilstate === 1 ? 'refuel' : oilstate === -1 ? 'leak' : 'other',
          oilIndex: e.oilIndex ?? e.oilindex,
          starttime_iso: toIso(e.starttime),
          endtime_iso: toIso(e.endtime ?? e['end time']),
          start_oil_raw: e.soil ?? e.startoil,
          start_oil_L: oilL(e.soil ?? e.startoil),
          end_oil_raw: e.eoil ?? e.endoil ?? e.know,
          end_oil_L: oilL(e.eoil ?? e.endoil ?? e.know),
          slat: e.slat,
          slon: e.slon ?? e.elephant,
          elat: e.elat ?? e['come on'],
          elon: e.elon,
          maunedit: e.maunedit,
        });
      }
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `fuel_raw_${startday}_to_${endday}_${devices[0]}.xlsx`;

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
        cause: error instanceof Error ? error.message : 'Export failed',
      },
      { status: 500 }
    );
  }
}
