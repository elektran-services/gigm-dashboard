import { NextRequest, NextResponse } from 'next/server';
import { APP_CONFIG } from '@/lib/config';
import { downsamplePoints, mapTrackPoint } from '@/lib/fuel';
import { detectAdditionsFromTimeline } from '@/lib/fuelAdditions';
import { gps51CachedPost } from '@/lib/gps51Client';
import { explainGps51Limit, isLimitStatus } from '@/lib/gps51Cache';
import { getDefaultDevices } from '@/lib/serverAuth';

/** Cache oiltime responses so Load / refresh does not burn account daily quota. */
const OILTIME_TTL_MS = 12 * 60 * 60 * 1000;

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
    const maxPoints = Number(body.maxPoints ?? 800);
    const minJumpL = Number(body.minJumpL ?? 10);
    const retainFraction = Number(body.retainFraction ?? 0.6);
    /** Default: use local cached report only. Live GPS51 only when refresh=true. */
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
    }>('reportoiltime', gpsBody, {
      ttlMs: OILTIME_TTL_MS,
      cacheOnly: !refreshLive,
      bypassCache: refreshLive,
    });

    const timeData = fetched.data;

    if (timeData.status !== 0) {
      return NextResponse.json({
        status: timeData.status,
        cause: fetched.message || timeData.cause || 'failed',
        limitHit: fetched.limitHit || isLimitStatus(timeData.status),
        hint: fetched.message ||
          (isLimitStatus(timeData.status)
            ? explainGps51Limit(Number(timeData.status), timeData.cause)
            : null),
        fromCache: fetched.fromCache,
        cacheMatch: fetched.cacheMatch,
        cacheBody: fetched.cacheBody,
      });
    }

    const devicesOut = (timeData.records || []).map((rec) => {
      const deviceid = String(rec.deviceid || '');
      const rawPoints = ((rec.records as Record<string, unknown>[]) || []).map(mapTrackPoint);
      const chartPoints = downsamplePoints(
        rawPoints,
        Math.min(Math.max(maxPoints || 800, 50), 3000)
      );

      const detected = detectAdditionsFromTimeline(rawPoints, {
        minJumpL,
        retainFraction,
      });

      return {
        deviceid,
        combinestatus: Number(rec.combinestatus ?? 0),
        pointCount: rawPoints.length,
        sampledCount: chartPoints.length,
        additions: detected.refuels,
        additionsSource: 'reportoiltime_detected',
        platformEventCount: 0,
        sloshRejected: detected.sloshRejected,
        candidates: detected.candidates,
        minJumpL,
        retainFraction,
        points: chartPoints,
        allPoints: rawPoints.length <= 5000 ? rawPoints : downsamplePoints(rawPoints, 5000),
      };
    });

    return NextResponse.json({
      status: 0,
      cause: timeData.cause || 'OK',
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
