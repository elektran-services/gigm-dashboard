import { buildGPS51Url } from '@/lib/config';
import {
  buildVehicleLocation,
  fetchFleetLastPositions,
  resolveAddressMap,
  type VehicleLocationJson,
} from '@/lib/mileageLocation';
import {
  buildMaintenanceInterval,
  currentOdometerKmFromRecords,
  MILEAGE_PREVENTIVE_MAINTENANCE_KM,
  MILEAGE_SCHEDULED_MAINTENANCE_KM,
  type MaintenanceIntervalDetail,
} from '@/lib/mileageServiceMath';
import {
  purgeExpiredMileageJson,
  writeMileageJsonReport,
  type MileageJsonReport,
} from '@/lib/mileageJsonStorage';

const RATE_LIMIT_DELAY_MS = 7500;
const MILEAGE_API_TIMEOUT_MS = 45000;
const MILEAGE_LOOKBACK_DAYS = 400;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeout = 15000
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

function addDaysToYmd(ymd: string, deltaDays: number) {
  const [y, mo, da] = ymd.split('-').map(Number);
  const dt = new Date(y, mo - 1, da);
  dt.setDate(dt.getDate() + deltaDays);
  return toYmdLocal(dt);
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

export interface MileageVehicleJson {
  /** GPS51 device identifier (IMEI). */
  imei: string;
  deviceName: string;
  location: VehicleLocationJson | null;
  currentOdometerKm: number | null;
  lastStatisticsDay: string | null;
  scheduledMaintenance: MaintenanceIntervalDetail | null;
  preventiveMaintenance: MaintenanceIntervalDetail | null;
  error: string | null;
}

export interface ScanMileageFleetOptions {
  token: string;
  username: string;
  reportDate?: Date;
}

export interface ScanMileageFleetResult {
  report: MileageJsonReport;
  jsonFiles: { datedName: string; datedPath: string; latestPath: string };
}

export async function scanMileageFleet(
  options: ScanMileageFleetOptions
): Promise<ScanMileageFleetResult> {
  const { token, username } = options;
  const reportDate = options.reportDate ?? new Date();
  const asOfYmd = toYmdLocal(reportDate);
  const startday = addDaysToYmd(asOfYmd, -MILEAGE_LOOKBACK_DAYS);
  const endday = asOfYmd;

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
  const addressMap = await resolveAddressMap(positionByDevice.values());
  console.log(
    `[MileageScan] Positions loaded: ${positionByDevice.size}/${allDevices.length} (geocoded keys: ${Object.keys(addressMap).length})`
  );

  const mileageUrl = buildGPS51Url('reportmileagedetail', token);
  const vehicles: MileageVehicleJson[] = [];
  let mileageErrors = 0;
  let processed = 0;
  const jobStartMs = Date.now();

  console.log(
    `[MileageScan] asOf=${asOfYmd} devices=${allDevices.length} window=${startday}->${endday}`
  );

  for (const dev of allDevices) {
    processed++;
    if (processed > 1) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
    }

    let currentOdoKm: number | null = null;
    let lastStatsDay: string | null = null;
    let error: string | null = null;

    try {
      const res = await fetchWithRetry(
        mileageUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceid: dev.deviceid,
            startday,
            endday,
            offset: 8,
          }),
        },
        0,
        MILEAGE_API_TIMEOUT_MS
      );
      const data = await res.json();
      if (isTokenExpiredPayload(data)) {
        throw new Error(data.cause || 'Token expired');
      }
      if (data.status !== 0 || !Array.isArray(data.records)) {
        error = data.cause || `status ${data.status}`;
        mileageErrors++;
      } else {
        currentOdoKm = currentOdometerKmFromRecords(data.records);
        const latest = data.records.length > 0 ? data.records[data.records.length - 1] : null;
        lastStatsDay = latest?.statisticsday ? String(latest.statisticsday) : null;
        if (currentOdoKm == null) {
          error = 'No odometer (enddis) in records';
          mileageErrors++;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Request failed';
      mileageErrors++;
    }

    const scheduledMaintenance = buildMaintenanceInterval(
      currentOdoKm,
      MILEAGE_SCHEDULED_MAINTENANCE_KM,
      'scheduled'
    );
    const preventiveMaintenance = buildMaintenanceInterval(
      currentOdoKm,
      MILEAGE_PREVENTIVE_MAINTENANCE_KM,
      'preventive'
    );

    vehicles.push({
      imei: dev.deviceid,
      deviceName: dev.name,
      location: buildVehicleLocation(positionByDevice.get(dev.deviceid), addressMap),
      currentOdometerKm: currentOdoKm,
      lastStatisticsDay: lastStatsDay,
      scheduledMaintenance,
      preventiveMaintenance,
      error,
    });

    const elapsedSec = ((Date.now() - jobStartMs) / 1000).toFixed(1);
    console.log(
      `[MileageScan] ${processed}/${allDevices.length} device=${dev.deviceid} errors=${mileageErrors} elapsed=${elapsedSec}s`
    );
  }

  const summary = {
    atScheduledMaintenance: vehicles.filter((v) => v.scheduledMaintenance?.atThreshold).length,
    atPreventiveMaintenance: vehicles.filter((v) => v.preventiveMaintenance?.atThreshold).length,
    scheduledAlmostDue: vehicles.filter((v) => v.scheduledMaintenance?.status === 'almost').length,
    preventiveAlmostDue: vehicles.filter((v) => v.preventiveMaintenance?.status === 'almost').length,
  };

  const report: MileageJsonReport = {
    status: 0,
    cause: 'OK',
    generatedAt: new Date().toISOString(),
    asOfDate: asOfYmd,
    deviceCount: allDevices.length,
    mileageErrors,
    thresholds: {
      scheduledMaintenanceKm: MILEAGE_SCHEDULED_MAINTENANCE_KM,
      preventiveMaintenanceKm: MILEAGE_PREVENTIVE_MAINTENANCE_KM,
    },
    summary,
    vehicles,
  };

  purgeExpiredMileageJson();
  const jsonFiles = writeMileageJsonReport(asOfYmd, report);

  console.log(
    `[MileageScan] Done asOf=${asOfYmd} at5000=${summary.atScheduledMaintenance} at10000=${summary.atPreventiveMaintenance} file=${jsonFiles.datedName}`
  );

  return { report, jsonFiles };
}
