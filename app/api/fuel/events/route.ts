import { NextRequest, NextResponse } from 'next/server';
import { APP_CONFIG } from '@/lib/config';
import { mapEventRow } from '@/lib/fuel';
import { gps51CachedPost } from '@/lib/gps51Client';
import { explainGps51Limit, isLimitStatus } from '@/lib/gps51Cache';
import { getDefaultDevices } from '@/lib/serverAuth';

/** Report endpoint — not trajectory/track. Cache to avoid repeat burns. */
const EVENTS_TTL_MS = 6 * 60 * 60 * 1000;

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
    const oilindex = Number(body.oilindex ?? 99);
    const oilstate = Number(body.oilstate ?? 99);
    const refreshLive = Boolean(body.refresh);

    if (!devices.length || !startday || !endday) {
      return NextResponse.json(
        { status: 1, cause: 'devices, startday, endday are required' },
        { status: 400 }
      );
    }

    const gpsBody = {
      devices,
      startday,
      endday,
      offset,
      oilindex,
      oilstate,
    };

    const fetched = await gps51CachedPost<{
      status: number;
      cause?: string;
      records?: Record<string, unknown>[];
    }>('reportoilrecord', gpsBody, {
      ttlMs: EVENTS_TTL_MS,
      cacheOnly: !refreshLive,
      bypassCache: refreshLive,
    });

    const data = fetched.data;

    if (data.status !== 0) {
      return NextResponse.json({
        status: data.status,
        cause: fetched.message || data.cause || 'failed',
        limitHit: fetched.limitHit || isLimitStatus(data.status),
        hint: isLimitStatus(data.status)
          ? explainGps51Limit(Number(data.status), data.cause)
          : null,
      });
    }

    const devicesOut = (data.records || []).map((rec) => {
      const nested = (rec.records as Record<string, unknown>[]) || [];
      const events = nested.map(mapEventRow);
      return {
        deviceid: String(rec.deviceid || ''),
        events,
        refuelCount: events.filter((e) => e.kind === 'refuel').length,
        leakCount: events.filter((e) => e.kind === 'leak').length,
      };
    });

    return NextResponse.json({
      status: 0,
      cause: data.cause || 'OK',
      fromCache: fetched.fromCache,
      cacheAgeMs: fetched.cacheAgeMs,
      limitHit: fetched.limitHit,
      message: fetched.message,
      source: 'reportoilrecord',
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
