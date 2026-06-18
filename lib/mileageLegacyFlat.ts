import type { MileageJsonReport } from '@/lib/mileageJsonStorage';

type MileageVehicleRow = MileageJsonReport['vehicles'][number] & {
  deviceName?: string;
  location?: {
    longitude?: number;
    latitude?: number;
    speedKmh?: number | null;
    positionUpdatedAt?: string | null;
  } | null;
  currentOdometerKm?: number | null;
};

/** Safetrack-style flat fields (legacy consumers). */
export interface MileageLegacyFlat {
  longitude: number | null;
  latitude: number | null;
  speed: string;
  imei: string;
  device: string;
  time: string;
  cumulativeDistance: string;
  status: string;
  msg: string;
}

export function formatMileageLegacyTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function buildMileageLegacyFlat(
  vehicle: MileageVehicleRow | undefined,
  imei: string,
  found: boolean
): MileageLegacyFlat {
  if (!found || !vehicle) {
    return {
      longitude: null,
      latitude: null,
      speed: '0.00',
      imei,
      device: '',
      time: '',
      cumulativeDistance: '0.00',
      status: 'error',
      msg: 'No mileage data for this device',
    };
  }

  const loc = vehicle.location;
  const odometer = vehicle.currentOdometerKm;

  return {
    longitude: loc?.longitude ?? null,
    latitude: loc?.latitude ?? null,
    speed: (loc?.speedKmh ?? 0).toFixed(2),
    imei: vehicle.imei,
    device: vehicle.deviceName ?? '',
    time: formatMileageLegacyTime(loc?.positionUpdatedAt),
    cumulativeDistance:
      odometer != null && Number.isFinite(odometer) ? String(odometer) : '0.00',
    status: 'ok',
    msg: 'Data returned successfully',
  };
}

/** Legacy flat fields first, then GIGM report (`apiStatus` = numeric report status). */
export function buildMileageImeiResponse(
  report: MileageJsonReport,
  vehicles: MileageJsonReport['vehicles'],
  imei: string
) {
  const legacy = buildMileageLegacyFlat(vehicles[0], imei, vehicles.length > 0);
  const { status: apiStatus, ...reportBody } = {
    ...report,
    deviceCount: vehicles.length,
    vehicles,
    filteredByImei: imei,
  };

  return {
    ...legacy,
    ...reportBody,
    apiStatus,
  };
}
