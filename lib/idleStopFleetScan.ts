import { buildGPS51Url } from '@/lib/config';
import { coordKey, resolveCoordAddressMap } from '@/lib/idleStopGeocode';
import { purgeExpiredIdleStopJson, writeIdleStopJsonReport } from '@/lib/idleStopJsonStorage';
import type {
  IdleStopDailyRollup,
  IdleStopEvent,
  IdleStopFilters,
  IdleStopJsonReport,
  IdleStopLiveSnapshot,
  IdleStopSummary,
  IdleStopVehicleJson,
} from '@/lib/idleStopTypes';
import {
  buildVehicleLocation,
  fetchFleetLastPositions,
  normalizeSpeedKmh,
  type GpsLastPositionRecord,
} from '@/lib/mileageLocation';

const RATE_LIMIT_DELAY_MS = Number(process.env.IDLE_STOP_RATE_LIMIT_MS) || 5500;
const PARK_API_TIMEOUT_MS = 45000;
const ACC_API_TIMEOUT_MS = 45000;
const MILEAGE_API_TIMEOUT_MS = 45000;

type ParkingApiRecord = {
  starttime?: number;
  endtime?: number;
  callat?: number;
  callon?: number;
  silent?: number;
  address?: string;
  durationidle?: number;
  speed?: number;
  strstatusen?: string;
  strstatus?: string;
};

type AccSegment = {
  accstate?: number;
  begintime?: number;
  endtime?: number;
  slat?: number;
  slon?: number;
  elat?: number;
  elon?: number;
};

type MileageDayRecord = {
  statisticsday?: string;
  totalacc?: number;
  totalidle?: number;
};

type LastPositionExtended = GpsLastPositionRecord & {
  parkduration?: number;
  accduration?: number;
};

function readConfig(): IdleStopFilters & { timezone: number; parkIntervalMin: number } {
  return {
    timezone: Number(process.env.IDLE_STOP_TIMEZONE) || 8,
    parkIntervalMin: Number(process.env.IDLE_STOP_PARK_INTERVAL_MINUTES) || 5,
    minStopDurationMinutes: Number(process.env.IDLE_STOP_MIN_STOP_MINUTES) || 5,
    minIdleDurationMinutes: Number(process.env.IDLE_STOP_MIN_IDLE_MINUTES) || 1,
    accStateEngineOn: Number(process.env.IDLE_STOP_ACC_STATE_ENGINE_ON) || 3,
    accStateEngineOff: Number(process.env.IDLE_STOP_ACC_STATE_ENGINE_OFF) || 2,
    idleMaxMovementMeters: Number(process.env.IDLE_STOP_IDLE_MAX_METERS) || 500,
    idleMaxAvgSpeedKmh: Number(process.env.IDLE_STOP_IDLE_MAX_AVG_SPEED_KMH) || 15,
  };
}

function isAccOnStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  if (/ACC\s*OFF|ACC关/.test(s)) return false;
  return /ACC\s*ON|ACC开/.test(s);
}

function isAccOffStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return /ACC\s*OFF|ACC关/i.test(status);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeout = 20000
) {
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

export function resolveIdleStopReportYmd(bodyReportDate?: string): string {
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
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login'
  );
}

function msToIso(ts: number): string {
  return new Date(ts).toISOString();
}

function msToMinutes(ms: number | null | undefined): number {
  if (ms == null || !Number.isFinite(ms)) return 0;
  return Math.round((ms / 60000) * 100) / 100;
}

function msToMinutesNullable(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round((ms / 60000) * 100) / 100;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getParkLatLon(rec: ParkingApiRecord): { lat: number; lon: number } | null {
  const lat = Number.isFinite(rec.callat) ? Number(rec.callat) : Number(rec.silent);
  const lon = Number(rec.callon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function recordMeetsMinStay(rec: ParkingApiRecord, minMs: number): boolean {
  const s = Number(rec.starttime);
  const e = Number(rec.endtime);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  return e - s >= minMs;
}

function buildLiveSnapshot(
  position: LastPositionExtended | undefined,
  addressMap: Record<string, string>
): IdleStopLiveSnapshot | null {
  const base = buildVehicleLocation(position, addressMap);
  if (!base) return null;

  const parkDurationMs =
    position?.parkduration != null && Number.isFinite(position.parkduration)
      ? Number(position.parkduration)
      : null;
  const accDurationMs =
    position?.accduration != null && Number.isFinite(position.accduration)
      ? Number(position.accduration)
      : null;

  return {
    latitude: base.latitude,
    longitude: base.longitude,
    address: base.address,
    status: base.status,
    parkDurationMs,
    parkDurationMinutes: msToMinutesNullable(parkDurationMs),
    accDurationMs,
    accDurationMinutes: msToMinutesNullable(accDurationMs),
    moving: base.moving,
    speedKmh: base.speedKmh,
    positionUpdatedAt: base.positionUpdatedAt,
  };
}

function mapParkingRecords(
  records: ParkingApiRecord[],
  minStayMs: number,
  minIdleMs: number,
  addressMap: Record<string, string>
): { stopEvents: IdleStopEvent[]; idleEvents: IdleStopEvent[] } {
  const stopEvents: IdleStopEvent[] = [];
  const idleEvents: IdleStopEvent[] = [];

  for (const rec of records) {
    const ll = getParkLatLon(rec);
    if (!ll) continue;

    const start = Number(rec.starttime);
    const end = Number(rec.endtime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const windowMs = end - start;
    const status = rec.strstatusen || rec.strstatus || null;
    const idleMs = Number(rec.durationidle);
    const hasIdleMs = Number.isFinite(idleMs) && idleMs > 0;
    const key = coordKey(ll.lat, ll.lon);
    const addr =
      (typeof rec.address === 'string' && rec.address.trim() ? rec.address.trim() : null) ||
      addressMap[key] ||
      null;
    const speedRaw = Number(rec.speed);
    const speedKmh = Number.isFinite(speedRaw) ? normalizeSpeedKmh(speedRaw) : null;

    const base = {
      source: 'reportparkdetailbytime' as const,
      startTime: msToIso(start),
      endTime: msToIso(end),
      latitude: ll.lat,
      longitude: ll.lon,
      address: addr,
      status,
      speedKmh,
    };

    // GPS51 idle while engine on: ACC ON in status and/or durationidle > 0 (see Reports.md samples)
    const engineOnIdle = isAccOnStatus(status) || hasIdleMs;
    if (engineOnIdle) {
      const idleDurationMs = hasIdleMs ? idleMs : windowMs;
      if (idleDurationMs >= minIdleMs) {
        idleEvents.push({
          ...base,
          type: 'idle',
          durationMs: idleDurationMs,
          durationMinutes: msToMinutes(idleDurationMs),
          idleWithinStopMs: hasIdleMs ? idleMs : undefined,
          idleWithinStopMinutes: hasIdleMs ? msToMinutes(idleMs) : undefined,
        });
      }
    }

    // Engine off / parked: ACC OFF (typical stop) — min stay filter
    if (isAccOffStatus(status) || (!engineOnIdle && windowMs >= minStayMs)) {
      if (recordMeetsMinStay(rec, minStayMs)) {
        stopEvents.push({
          ...base,
          type: 'stop',
          durationMs: windowMs,
          durationMinutes: msToMinutes(windowMs),
          idleWithinStopMs: hasIdleMs ? idleMs : undefined,
          idleWithinStopMinutes: hasIdleMs ? msToMinutes(idleMs) : undefined,
        });
      }
    }
  }

  return { stopEvents, idleEvents };
}

function mapAccSegments(
  segments: AccSegment[],
  filters: IdleStopFilters,
  addressMap: Record<string, string>
): { idleEvents: IdleStopEvent[]; accOffEvents: IdleStopEvent[] } {
  const idleEvents: IdleStopEvent[] = [];
  const accOffEvents: IdleStopEvent[] = [];

  for (const seg of segments) {
    const start = Number(seg.begintime);
    const end = Number(seg.endtime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const slat = Number(seg.slat);
    const slon = Number(seg.slon);
    const elat = Number(seg.elat);
    const elon = Number(seg.elon);
    if (!Number.isFinite(slat) || !Number.isFinite(slon)) continue;

    const durationMs = end - start;
    const movementMeters =
      Number.isFinite(elat) && Number.isFinite(elon)
        ? haversineMeters(slat, slon, elat, elon)
        : 0;

    const key = coordKey(slat, slon);
    const address = addressMap[key] || null;
    const accState = Number(seg.accstate);

    const base = {
      source: 'reportaccsbytime' as const,
      startTime: msToIso(start),
      endTime: msToIso(end),
      durationMs,
      durationMinutes: msToMinutes(durationMs),
      latitude: slat,
      longitude: slon,
      endLatitude: Number.isFinite(elat) ? elat : undefined,
      endLongitude: Number.isFinite(elon) ? elon : undefined,
      address,
      status: null,
      speedKmh: null,
      accState,
      movementMeters: Math.round(movementMeters),
    };

    if (accState === filters.accStateEngineOff) {
      accOffEvents.push({ ...base, type: 'acc_off' });
      continue;
    }

    if (accState === filters.accStateEngineOn) {
      const durationHours = durationMs / 3_600_000;
      const avgSpeedKmh =
        durationHours > 0 ? movementMeters / 1000 / durationHours : 0;
      const lowMovement = movementMeters <= filters.idleMaxMovementMeters;
      const lowAvgSpeed = avgSpeedKmh <= filters.idleMaxAvgSpeedKmh;
      if (lowMovement || lowAvgSpeed) {
        idleEvents.push({
          ...base,
          type: 'idle',
          speedKmh: Math.round(avgSpeedKmh * 10) / 10,
        });
      }
    }
  }

  return { idleEvents, accOffEvents };
}

function buildIdleNote(
  idleEvents: IdleStopEvent[],
  dailyRollup: IdleStopDailyRollup | null,
  parkRecordCount: number
): string | null {
  if (idleEvents.length > 0) return null;
  if (dailyRollup && dailyRollup.idleMs > 0) {
    return `GPS51 daily idle total is ${Math.round(dailyRollup.idleMs / 60000)} min but no segment breakdown was returned for this day.`;
  }
  if (dailyRollup && dailyRollup.engineOnMs === 0) {
    return 'No engine-on time for this day (reportmileagedetail totalacc=0); all parking segments were ACC OFF.';
  }
  if (parkRecordCount > 0) {
    return 'Parking segments were ACC OFF with durationidle=0; no ACC ON idle segments from GPS51 for this day.';
  }
  return 'No parking or idle data from GPS51 for this day.';
}

function appendDailyRollupIdle(
  idleEvents: IdleStopEvent[],
  dailyRollup: IdleStopDailyRollup | null,
  liveSnapshot: IdleStopLiveSnapshot | null,
  reportYmd: string
): IdleStopEvent[] {
  if (!dailyRollup || dailyRollup.idleMs <= 0 || idleEvents.length > 0) {
    return idleEvents;
  }

  const lat = liveSnapshot?.latitude;
  const lon = liveSnapshot?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return idleEvents;
  }

  return [
    ...idleEvents,
    {
      type: 'idle',
      source: 'reportmileagedetail',
      startTime: `${reportYmd}T00:00:00.000Z`,
      endTime: `${reportYmd}T23:59:59.000Z`,
      durationMs: dailyRollup.idleMs,
      durationMinutes: msToMinutes(dailyRollup.idleMs),
      latitude: lat!,
      longitude: lon!,
      address: liveSnapshot?.address ?? null,
      status: `Daily idle total (${dailyRollup.statisticsDay})`,
      speedKmh: null,
    },
  ];
}

function mapDailyRollup(records: MileageDayRecord[], reportYmd: string): IdleStopDailyRollup | null {
  const row =
    records.find((r) => String(r.statisticsday) === reportYmd) ||
    (records.length > 0 ? records[records.length - 1] : null);
  if (!row) return null;

  const engineOnMs = Number(row.totalacc) || 0;
  const idleMs = Number(row.totalidle) || 0;
  const idlePercent = engineOnMs > 0 ? Math.round((idleMs / engineOnMs) * 1000) / 10 : null;

  return {
    statisticsDay: String(row.statisticsday || reportYmd),
    engineOnMs,
    engineOnMinutes: msToMinutes(engineOnMs),
    idleMs,
    idleMinutes: msToMinutes(idleMs),
    idlePercent,
  };
}

function collectGeocodeKeys(vehicles: IdleStopVehicleJson[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  const add = (lat?: number, lon?: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const k = coordKey(lat!, lon!);
    if (seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };

  for (const v of vehicles) {
    for (const e of [...v.stopEvents, ...v.idleEvents, ...v.accOffEvents]) {
      if (!e.address) {
        add(e.latitude, e.longitude);
        add(e.endLatitude, e.endLongitude);
      }
    }
  }

  return keys;
}

function applyAddresses(vehicles: IdleStopVehicleJson[], addressMap: Record<string, string>) {
  for (const v of vehicles) {
    for (const list of [v.stopEvents, v.idleEvents, v.accOffEvents]) {
      for (const e of list) {
        if (!e.address) {
          e.address = addressMap[coordKey(e.latitude, e.longitude)] || e.address;
        }
      }
    }
  }
}

function buildSummary(vehicles: IdleStopVehicleJson[]): IdleStopSummary {
  let totalStopEvents = 0;
  let totalIdleEvents = 0;
  let totalAccOffEvents = 0;
  let totalStopDurationMs = 0;
  let totalIdleDurationMs = 0;
  let totalAccOffDurationMs = 0;
  let vehiclesWithData = 0;

  for (const v of vehicles) {
    const hasData =
      v.stopEvents.length > 0 ||
      v.idleEvents.length > 0 ||
      v.accOffEvents.length > 0 ||
      v.dailyRollup != null;
    if (hasData) vehiclesWithData += 1;

    for (const e of v.stopEvents) {
      totalStopEvents += 1;
      totalStopDurationMs += e.durationMs;
    }
    for (const e of v.idleEvents) {
      totalIdleEvents += 1;
      totalIdleDurationMs += e.durationMs;
    }
    for (const e of v.accOffEvents) {
      totalAccOffEvents += 1;
      totalAccOffDurationMs += e.durationMs;
    }
  }

  return {
    totalStopEvents,
    totalIdleEvents,
    totalAccOffEvents,
    totalStopDurationMs,
    totalStopDurationMinutes: msToMinutes(totalStopDurationMs),
    totalIdleDurationMs,
    totalIdleDurationMinutes: msToMinutes(totalIdleDurationMs),
    totalAccOffDurationMs,
    totalAccOffDurationMinutes: msToMinutes(totalAccOffDurationMs),
    vehiclesWithData,
  };
}

export interface ScanIdleStopFleetOptions {
  token: string;
  username: string;
  reportDate?: string;
}

export interface ScanIdleStopFleetResult {
  report: IdleStopJsonReport;
  jsonFiles: { datedName: string; datedPath: string; latestPath: string };
}

export async function scanIdleStopFleet(
  options: ScanIdleStopFleetOptions
): Promise<ScanIdleStopFleetResult> {
  const { token, username } = options;
  const cfg = readConfig();
  const reportYmd = resolveIdleStopReportYmd(options.reportDate);
  const begintime = `${reportYmd} 00:00:00`;
  const endtime = `${reportYmd} 23:59:59`;
  const minStayMs = cfg.minStopDurationMinutes * 60 * 1000;
  const minIdleMs = cfg.minIdleDurationMinutes * 60 * 1000;

  const filters: IdleStopFilters = {
    minStopDurationMinutes: cfg.minStopDurationMinutes,
    minIdleDurationMinutes: cfg.minIdleDurationMinutes,
    accStateEngineOn: cfg.accStateEngineOn,
    accStateEngineOff: cfg.accStateEngineOff,
    idleMaxMovementMeters: cfg.idleMaxMovementMeters,
    idleMaxAvgSpeedKmh: cfg.idleMaxAvgSpeedKmh,
  };

  const devicesUrl = buildGPS51Url('querymonitorlist', token);
  const devicesResponse = await fetchWithRetry(
    devicesUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    },
    3,
    20000
  );

  const devicesData = await devicesResponse.json();
  if (isTokenExpiredPayload(devicesData)) {
    throw new Error(devicesData.cause || 'Token expired');
  }
  if (devicesData.status !== 0 || !devicesData.groups) {
    throw new Error(devicesData.cause || 'Failed to load devices');
  }

  const allDevices: { deviceid: string; name: string }[] = devicesData.groups.flatMap(
    (group: { devices?: { deviceid: string; devicename?: string }[] }) =>
      (group.devices || []).map((d) => ({
        deviceid: d.deviceid,
        name: d.devicename || d.deviceid,
      }))
  );

  const lastPositionUrl = buildGPS51Url('lastposition', token);
  const positionByDevice = await fetchFleetLastPositions(lastPositionUrl, username);
  const liveAddressMap = await resolveCoordAddressMap(
    [...positionByDevice.values()]
      .filter((p) => Number.isFinite(p.callat) && Number.isFinite(p.callon))
      .map((p) => coordKey(p.callat, p.callon))
  );

  const parkingUrl = buildGPS51Url('reportparkdetailbytime', token);
  const accUrl = buildGPS51Url('reportaccsbytime', token);
  const mileageUrl = buildGPS51Url('reportmileagedetail', token);

  const vehicles: IdleStopVehicleJson[] = [];
  let scanErrors = 0;
  let processed = 0;
  const jobStartMs = Date.now();

  console.log(
    `[IdleStopScan] reportDate=${reportYmd} devices=${allDevices.length} window=${begintime}->${endtime}`
  );

  for (const dev of allDevices) {
    processed++;
    if (processed > 1) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }

    let error: string | null = null;
    let stopEvents: IdleStopEvent[] = [];
    let idleEvents: IdleStopEvent[] = [];
    let accOffEvents: IdleStopEvent[] = [];
    let dailyRollup: IdleStopDailyRollup | null = null;
    let parkRecordCount = 0;

    const pos = positionByDevice.get(dev.deviceid) as LastPositionExtended | undefined;
    const liveSnapshot = buildLiveSnapshot(pos, liveAddressMap);

    try {
      const parkRes = await fetchWithRetry(
        parkingUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceid: dev.deviceid,
            begintime,
            endtime,
            timezone: cfg.timezone,
            interval: cfg.parkIntervalMin,
          }),
        },
        1,
        PARK_API_TIMEOUT_MS
      );
      const parkData = await parkRes.json();
      if (isTokenExpiredPayload(parkData)) {
        throw new Error(parkData.cause || 'Token expired');
      }
      if (parkData.status === 0 && Array.isArray(parkData.records)) {
        parkRecordCount = parkData.records.length;
        const parked = mapParkingRecords(parkData.records, minStayMs, minIdleMs, {});
        stopEvents = parked.stopEvents;
        idleEvents = [...idleEvents, ...parked.idleEvents];
      } else if (parkData.status !== 0) {
        error = parkData.cause || `parking status ${parkData.status}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Parking request failed';
    }

    try {
      const accRes = await fetchWithRetry(
        accUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceids: [dev.deviceid],
            starttime: begintime,
            endtime: endtime,
            offset: cfg.timezone,
          }),
        },
        1,
        ACC_API_TIMEOUT_MS
      );
      const accData = await accRes.json();
      if (isTokenExpiredPayload(accData)) {
        throw new Error(accData.cause || 'Token expired');
      }
      if (accData.status === 0 && Array.isArray(accData.records)) {
        const deviceBlock = accData.records.find(
          (r: { deviceid?: string }) => r.deviceid === dev.deviceid
        );
        const segments: AccSegment[] = deviceBlock?.records || accData.records[0]?.records || [];
        const mapped = mapAccSegments(segments, filters, {});
        idleEvents = [...idleEvents, ...mapped.idleEvents];
        accOffEvents = mapped.accOffEvents;
      } else if (accData.status !== 0 && !error) {
        error = accData.cause || `acc status ${accData.status}`;
      }
    } catch (e) {
      if (!error) error = e instanceof Error ? e.message : 'ACC request failed';
    }

    try {
      const mileRes = await fetchWithRetry(
        mileageUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceid: dev.deviceid,
            startday: reportYmd,
            endday: reportYmd,
            offset: cfg.timezone,
          }),
        },
        0,
        MILEAGE_API_TIMEOUT_MS
      );
      const mileData = await mileRes.json();
      if (isTokenExpiredPayload(mileData)) {
        throw new Error(mileData.cause || 'Token expired');
      }
      if (mileData.status === 0 && Array.isArray(mileData.records)) {
        dailyRollup = mapDailyRollup(mileData.records, reportYmd);
      } else if (mileData.status !== 0 && !error) {
        error = mileData.cause || `mileage status ${mileData.status}`;
      }
    } catch (e) {
      if (!error) error = e instanceof Error ? e.message : 'Mileage request failed';
    }

    if (error && !stopEvents.length && !idleEvents.length && !accOffEvents.length && !dailyRollup) {
      scanErrors += 1;
    }

    idleEvents = appendDailyRollupIdle(idleEvents, dailyRollup, liveSnapshot, reportYmd);

    vehicles.push({
      imei: dev.deviceid,
      deviceName: dev.name,
      dailyRollup,
      liveSnapshot,
      stopEvents,
      idleEvents,
      accOffEvents,
      idleNote: buildIdleNote(idleEvents, dailyRollup, parkRecordCount),
      error,
    });

    const elapsedSec = ((Date.now() - jobStartMs) / 1000).toFixed(1);
    console.log(
      `[IdleStopScan] ${processed}/${allDevices.length} device=${dev.deviceid} stops=${stopEvents.length} idle=${idleEvents.length} accOff=${accOffEvents.length} elapsed=${elapsedSec}s`
    );
  }

  const geocodeKeys = collectGeocodeKeys(vehicles);
  console.log(`[IdleStopScan] Geocoding ${geocodeKeys.length} coordinates…`);
  const eventAddressMap = await resolveCoordAddressMap(geocodeKeys);
  applyAddresses(vehicles, eventAddressMap);

  const summary = buildSummary(vehicles);

  const report: IdleStopJsonReport = {
    status: 0,
    cause: 'OK',
    generatedAt: new Date().toISOString(),
    reportDate: reportYmd,
    timezone: cfg.timezone,
    deviceCount: allDevices.length,
    scanErrors,
    filters,
    summary,
    vehicles,
  };

  purgeExpiredIdleStopJson();
  const jsonFiles = writeIdleStopJsonReport(reportYmd, report);

  console.log(
    `[IdleStopScan] Done reportDate=${reportYmd} stops=${summary.totalStopEvents} idle=${summary.totalIdleEvents} file=${jsonFiles.datedName}`
  );

  return { report, jsonFiles };
}
