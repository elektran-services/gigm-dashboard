import { NextRequest, NextResponse } from 'next/server';
import { APP_CONFIG } from '@/lib/config';
import { downsamplePoints, mapEventRow, mapTrackPoint } from '@/lib/fuel';
import { detectAdditionsFromTimeline, mapsLink } from '@/lib/fuelAdditions';
import { findBestCachedReport, formatCacheAge, listGps51CacheEntries } from '@/lib/gps51Cache';
import { loadCachedOiltimeRecords } from '@/lib/fuelOiltimeCache';
import { getDefaultDevices } from '@/lib/serverAuth';

/** Interpret YYYY-MM-DD + HH:mm as wall clock in GPS51 offset, return UTC ms. */
function wallClockToUtcMs(ymd: string, hm: string, offsetHours: number): number | null {
  const dateParts = ymd.split('-').map(Number);
  const timeParts = String(hm || '00:00').split(':').map(Number);
  if (dateParts.length < 3 || timeParts.length < 2) return null;
  const [y, mo, d] = dateParts;
  const [h, mi, s = 0] = timeParts;
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null;
  return Date.UTC(y, mo - 1, d, h, mi, Number.isFinite(s) ? s : 0, 0) - offsetHours * 3600 * 1000;
}

function rangeEndUtcMs(ymd: string, hm: string, offsetHours: number): number | null {
  const parts = String(hm || '23:59').split(':');
  // HTML time is HH:mm — treat as inclusive through that minute.
  const withSeconds = parts.length >= 3 ? hm : `${parts[0]}:${parts[1] || '59'}:59`;
  return wallClockToUtcMs(ymd, withSeconds, offsetHours);
}

export type PurchaseOut = {
  index: number;
  whenIso: string;
  whenEndIso: string;
  starttime: number;
  endtime: number;
  litres: number;
  startOilL: number | null;
  endOilL: number | null;
  lat: number | null;
  lon: number | null;
  mapsUrl: string | null;
  kind: 'refuel';
  source: 'reportoilrecord' | 'cached_oiltime_detected';
  label: string;
  startKm?: number | null;
  endKm?: number | null;
};

/**
 * Real fuel purchases — LOCAL CACHE ONLY.
 * Never calls GPS51 (avoids 8905 / history limits).
 *
 * 1) reportoilrecord cache → platform refill events (when / where / litres)
 * 2) else already-saved reportoiltime on disk → detect real fills (no live call)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const devices =
      Array.isArray(body.devices) && body.devices.length
        ? (body.devices as string[])
        : getDefaultDevices();
    const startday = String(body.startday || '');
    const endday = String(body.endday || '');
    const starttimeOfDay = String(body.starttime || '00:00');
    const endtimeOfDay = String(body.endtime || '23:59');
    const offset = Number(body.offset ?? APP_CONFIG.DEFAULT_OFFSET);
    // Tiny noise floor only — do not enforce a minimum purchase size
    const minJumpL = Number(body.minJumpL ?? 1.5);

    if (!devices.length || !startday || !endday) {
      return NextResponse.json(
        { status: 1, cause: 'devices, startday, endday are required' },
        { status: 400 }
      );
    }

    const rangeStartMs = wallClockToUtcMs(startday, starttimeOfDay, offset);
    const rangeEndMs = rangeEndUtcMs(endday, endtimeOfDay, offset);
    if (rangeStartMs == null || rangeEndMs == null || rangeEndMs < rangeStartMs) {
      return NextResponse.json(
        { status: 1, cause: 'Invalid From / To date-time range' },
        { status: 400 }
      );
    }

    const deviceid = devices[0];
    const gpsBody = {
      devices,
      startday,
      endday,
      offset,
      oilindex: 99,
      oilstate: 99,
    };

    // --- 1) Local oilrecord events ---
    const oilrecord = findBestCachedReport<{
      status?: number;
      records?: Record<string, unknown>[];
    }>('reportoilrecord', gpsBody);

    if (oilrecord && Number(oilrecord.data.status) === 0) {
      const rec = (oilrecord.data.records || []).find(
        (r) => String(r.deviceid) === deviceid
      ) || oilrecord.data.records?.[0];
      const nested = ((rec?.records as Record<string, unknown>[]) || []);
      const all = nested.map(mapEventRow);
      const inRange = all.filter((e) => {
        const t = e.starttime || e.endtime;
        return t >= rangeStartMs && t <= rangeEndMs;
      });
      const refuels = inRange.filter((e) => e.kind === 'refuel');
      const other = inRange.filter((e) => e.kind !== 'refuel');

      if (refuels.length > 0) {
        const purchases: PurchaseOut[] = refuels.map((e, i) => ({
          index: i + 1,
          whenIso: e.startIso,
          whenEndIso: e.endIso,
          starttime: e.starttime,
          endtime: e.endtime,
          litres: Number((e.deltaL ?? 0).toFixed(2)),
          startOilL: e.startOilL,
          endOilL: e.endOilL,
          lat: e.lat,
          lon: e.lon,
          mapsUrl: mapsLink(e.lat, e.lon),
          kind: 'refuel',
          source: 'reportoilrecord',
          label: 'Real fuel bought (GPS event record)',
        }));

        return NextResponse.json({
          status: 0,
          fromCache: true,
          liveCall: false,
          source: 'reportoilrecord',
          cacheAgeMs: oilrecord.ageMs,
          message: `Real purchases from saved reportoilrecord (${formatCacheAge(oilrecord.ageMs)}). No GPS51 call.`,
          cacheBody: oilrecord.cacheBody,
          purchases,
          ignored: other.map((e, i) => ({
            index: i + 1,
            whenIso: e.startIso,
            kind: e.kind,
            litres: e.deltaL,
            note: e.kind === 'leak' ? 'Leak / drop event (not a purchase)' : 'Other oil event',
          })),
          availableCaches: listPurchaseCaches(),
        });
      }
    }

    // --- 2) Local oiltime only (already on disk) — detect real fills ---
    const mergedOiltime = loadCachedOiltimeRecords(deviceid, startday, endday, offset);
    const oiltime = mergedOiltime
      ? null
      : findBestCachedReport<{
          status?: number;
          records?: Record<string, unknown>[];
        }>('reportoiltime', { devices, startday, endday, offset });

    const oilRecords = mergedOiltime
      ? mergedOiltime.records
      : ((
          (oiltime?.data.records || []).find((r) => String(r.deviceid) === deviceid) ||
          oiltime?.data.records?.[0]
        )?.records as Record<string, unknown>[] | undefined) || [];

    if ((mergedOiltime && oilRecords.length) || (oiltime && Number(oiltime.data.status) === 0)) {
      const rawPoints = oilRecords
        .map(mapTrackPoint)
        .filter((p) => p.updatetime >= rangeStartMs && p.updatetime <= rangeEndMs);
      const detected = detectAdditionsFromTimeline(rawPoints, {
        minJumpL,
        gapMs: 20 * 60 * 1000,
        maxFillMs: 90 * 60 * 1000,
        mergeVisitMs: 45 * 60 * 1000,
        minDistanceKm: 5,
      });
      const chartPts = downsamplePoints(
        rawPoints.filter((p) => p.oilL != null && p.updatetime > 0),
        900
      );

      /**
       * Continuous tank series — X axis is Absolute Total Mileage (km),
       * same as downloaded Fuel Graph "Total Mileage(km)" (e.g. starts ~1459.30, not 0).
       */
      const tankSeries: Array<{
        t: number;
        km: number;
        label: string;
        whenIso: string;
        tankL: number | null;
        buyL: number | null;
        buyIndex: number | null;
      }> = [];
      let kmCursor: number | null = null;
      let prevLat: number | null = null;
      let prevLon: number | null = null;

      for (const p of chartPts) {
        let kmAbs: number;
        if (p.distanceKm != null && Number.isFinite(p.distanceKm)) {
          // GPS51 totaldistance → Absolute Total Mileage(km), matches report export
          kmAbs = Number(p.distanceKm.toFixed(2));
          kmCursor = kmAbs;
        } else if (
          kmCursor != null &&
          p.lat != null &&
          p.lon != null &&
          prevLat != null &&
          prevLon != null
        ) {
          const dLat = ((p.lat - prevLat) * Math.PI) / 180;
          const dLon = ((p.lon - prevLon) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((prevLat * Math.PI) / 180) *
              Math.cos((p.lat * Math.PI) / 180) *
              Math.sin(dLon / 2) ** 2;
          kmCursor += 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          kmAbs = Number(kmCursor.toFixed(2));
        } else if (kmCursor != null) {
          kmAbs = Number(kmCursor.toFixed(2));
        } else {
          continue;
        }
        if (p.lat != null && p.lon != null) {
          prevLat = p.lat;
          prevLon = p.lon;
        }
        tankSeries.push({
          t: p.updatetime,
          km: kmAbs,
          label: `${kmAbs.toFixed(1)} km`,
          whenIso: p.time || '',
          tankL: p.oilL != null ? Number(p.oilL.toFixed(2)) : null,
          buyL: null,
          buyIndex: null,
        });
      }

      const purchases: PurchaseOut[] = detected.refuels.map((a) => ({
        index: a.index,
        whenIso: a.startIso,
        whenEndIso: a.endIso,
        starttime: a.starttime,
        endtime: a.endtime,
        litres: a.addedL,
        startOilL: a.startOilL,
        endOilL: a.endOilL,
        lat: a.endLat ?? a.startLat,
        lon: a.endLon ?? a.startLon,
        mapsUrl: mapsLink(a.endLat ?? a.startLat, a.endLon ?? a.startLon),
        kind: 'refuel',
        source: 'cached_oiltime_detected',
        label: a.confidenceNote || 'Real station fill (calibrated gauge analysis)',
        startKm: a.startKm,
        endKm: a.endKm,
      }));

      // Mark purchase peaks on the nearest tank sample so the line graph is not “empty”
      for (const a of purchases) {
        const target = a.endtime || a.starttime;
        if (!tankSeries.length || !target) continue;
        let best = 0;
        let bestDiff = Math.abs(tankSeries[0].t - target);
        for (let i = 1; i < tankSeries.length; i++) {
          const d = Math.abs(tankSeries[i].t - target);
          if (d < bestDiff) {
            best = i;
            bestDiff = d;
          }
        }
        tankSeries[best] = {
          ...tankSeries[best],
          buyL: a.endOilL ?? a.litres,
          buyIndex: a.index,
          tankL: tankSeries[best].tankL ?? a.endOilL,
        };
      }

      return NextResponse.json({
        status: 0,
        fromCache: true,
        liveCall: false,
        source: 'cached_oiltime_detected',
        cacheAgeMs: oiltime?.ageMs ?? null,
        message: mergedOiltime
          ? `Tank line + ${purchases.length} real station fill(s) from saved days ${mergedOiltime.days.join(', ')}. No GPS51 call.`
          : `Tank line + ${purchases.length} real station fill(s) from saved calibrated-gauge track (${formatCacheAge(oiltime?.ageMs || 0)}). No GPS51 call. Rise candidates ${detected.candidates} → after stop/plateau/location checks and merging nearby visits: ${purchases.length} real.`,
        cacheBody: oiltime?.cacheBody ?? { devices, startday, endday, offset },
        purchases,
        tankSeries,
        pointCount: rawPoints.length,
        ignored: detected.rejected.slice(0, 40).map((r, i) => ({
          index: i + 1,
          whenIso: r.startIso,
          kind: 'filtered',
          litres: r.addedL,
          note: r.plainReason,
        })),
        filterExplained: {
          steps: [
            'Prefer ignition/ACC off + stopped at the pump',
            'Litres = sustained after-plateau − before-plateau (ignores left/right slosh and spike tops)',
            'Reject rises that do not hold a thick full-tank band afterward',
            'Confirm tank still high after moving off; ignore driving bounce',
            'No minimum purchase size — small real fills kept',
            'Merge visits within 45 minutes and closer than 5 km',
          ],
          candidates: detected.candidates,
          real: purchases.length,
          filteredOut: detected.rejected.length,
        },
        sloshRejected: detected.sloshRejected,
        candidates: detected.candidates,
        availableCaches: listPurchaseCaches(),
      });
    }

    return NextResponse.json({
      status: 1,
      cause: 'no_local_purchase_data',
      liveCall: false,
      message:
        'No local purchase data for this vehicle. There is no saved reportoilrecord, and no saved tank track on disk. Live GPS51 is disabled here to protect quota. Pick a vehicle that has a saved report in the list below, or wait until quota resets and save one report once.',
      purchases: [],
      ignored: [],
      availableCaches: listPurchaseCaches(),
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

function listPurchaseCaches() {
  const oilrecord = listGps51CacheEntries('reportoilrecord')
    .filter((e) => e.status === 0)
    .map((e) => ({
      kind: 'reportoilrecord' as const,
      devices: e.devices,
      startday: e.startday,
      endday: e.endday,
      age: formatCacheAge(e.ageMs),
    }));
  const oiltime = listGps51CacheEntries('reportoiltime')
    .filter((e) => e.status === 0)
    .map((e) => ({
      kind: 'reportoiltime_disk' as const,
      devices: e.devices,
      startday: e.startday,
      endday: e.endday,
      age: formatCacheAge(e.ageMs),
    }));
  return [...oilrecord, ...oiltime];
}
