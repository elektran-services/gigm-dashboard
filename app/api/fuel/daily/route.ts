import { NextRequest, NextResponse } from 'next/server';
import { APP_CONFIG } from '@/lib/config';
import { oilToLitres, metresToKm } from '@/lib/fuel';
import { gps51CachedPost } from '@/lib/gps51Client';
import { explainGps51Limit, isLimitStatus } from '@/lib/gps51Cache';
import { getDefaultDevices } from '@/lib/serverAuth';

const DAILY_TTL_MS = 6 * 60 * 60 * 1000;

function toIso(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toISOString();
  } catch {
    return '';
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const devices =
      Array.isArray(body.devices) && body.devices.length
        ? body.devices
        : getDefaultDevices();
    const startday = body.startday as string | undefined;
    const endday = body.endday as string | undefined;
    const offset = Number(body.offset ?? APP_CONFIG.DEFAULT_OFFSET);
    const refreshLive = Boolean(body.refresh);

    if (!devices.length || !startday || !endday) {
      return NextResponse.json(
        { status: 1, cause: 'devices, startday, endday are required' },
        { status: 400 }
      );
    }

    const gpsBody = { devices, startday, endday, offset };
    const fetched = await gps51CachedPost<{
      status: number;
      cause?: string;
      records?: Record<string, unknown>[];
    }>('reportoildaily', gpsBody, {
      ttlMs: DAILY_TTL_MS,
      cacheOnly: !refreshLive,
      bypassCache: refreshLive,
    });

    const data = fetched.data;

    if (data.status !== 0) {
      return NextResponse.json({
        status: data.status,
        cause: fetched.message || data.cause || 'failed',
        limitHit: fetched.limitHit || isLimitStatus(data.status),
        hint:
          fetched.message ||
          (isLimitStatus(data.status)
            ? explainGps51Limit(Number(data.status), data.cause)
            : null),
        fromCache: fetched.fromCache,
        cacheMatch: fetched.cacheMatch,
        cacheBody: fetched.cacheBody,
      });
    }

    const devicesOut = (data.records || []).map((rec) => {
      const days = ((rec.records as Record<string, unknown>[]) || []).map((raw) => ({
        deviceid: String(raw.deviceid || rec.deviceid || ''),
        statisticsday: String(raw.statisticsday || ''),
        timezoneoffset: Number(raw.timezoneoffset ?? offset),
        dailydetailreportid: raw.dailydetailreportid ?? null,
        starttime_ms: Number(raw.starttime || 0),
        starttime_iso: toIso(raw.starttime),
        endtime_ms: Number(raw.endtime || 0),
        endtime_iso: toIso(raw.endtime),
        begindis_m: Number(raw.begindis ?? 0),
        enddis_m: Number(raw.enddis ?? 0),
        totaldistance_m: Number(raw.totaldistance ?? 0),
        distanceKm: metresToKm(raw.totaldistance),
        beginoil_raw: Number(raw.beginoil ?? 0),
        beginoil_L: oilToLitres(raw.beginoil),
        endoil_raw: Number(raw.endoil ?? 0),
        endoil_L: oilToLitres(raw.endoil),
        addoil_raw: Number(raw.addoil ?? 0),
        addoil_L: oilToLitres(raw.addoil),
        leakoil_raw: Number(raw.leakoil ?? 0),
        leakoil_L: oilToLitres(raw.leakoil),
        idleoil_raw: Number(raw.idleoil ?? 0),
        idleoil_L: oilToLitres(raw.idleoil),
        totaloil_raw: Number(raw.totaloil ?? 0),
        totaloil_L: oilToLitres(raw.totaloil),
        beginnotrunningad_raw: Number(raw.beginnotrunningad ?? 0),
        endnotrunningad_raw: Number(raw.endnotrunningad ?? 0),
        addnotrunningad_raw: Number(raw.addnotrunningad ?? 0),
        totalacc_ms: Number(raw.totalacc ?? 0),
        totalidle_ms: Number(raw.totalidle ?? 0),
        oilper100km: Number.isFinite(Number(raw.oilper100km)) ? Number(raw.oilper100km) : null,
        runoilper100km: Number.isFinite(Number(raw.runoilper100km))
          ? Number(raw.runoilper100km)
          : null,
        oilperhour: Number.isFinite(Number(raw.oilperhour)) ? Number(raw.oilperhour) : null,
        avgspeed: Number.isFinite(Number(raw.avgspeed)) ? Number(raw.avgspeed) : null,
        onlinestatus: Number(raw.onlinestatus ?? 0),
      }));

      return {
        deviceid: String(rec.deviceid || ''),
        avgoilper100km: Number(rec.avgoilper100km) || null,
        avgoilperhour: Number(rec.avgoilperhour) || null,
        currenttotaloilL: oilToLitres(rec.currenttotaloil),
        days,
      };
    });

    return NextResponse.json({
      status: 0,
      cause: data.cause || 'OK',
      fromCache: fetched.fromCache,
      cacheAgeMs: fetched.cacheAgeMs,
      limitHit: fetched.limitHit,
      message: fetched.message,
      cacheMatch: fetched.cacheMatch,
      cacheBody: fetched.cacheBody,
      devices: devicesOut,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 1,
        cause: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
