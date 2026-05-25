/**
 * Odometer segment math for scheduled (5000 km) and preventive (10000 km) maintenance.
 */

export const MILEAGE_SCHEDULED_MAINTENANCE_KM = 5000;
export const MILEAGE_PREVENTIVE_MAINTENANCE_KM = 10000;

/** Minimum km in-segment to treat as "at" interval (GPS noise margin). */
export const MILEAGE_SEGMENT_COMPLETION_MARGIN_KM = 1;

export const MILEAGE_ALMOST_DUE_BUFFER_KM = 500;

export interface SegmentProgressKm {
  currentOdometerKm: number;
  lastServiceReferenceKm: number;
  distanceSinceReferenceKm: number;
  remainingKm: number;
  percentage: number;
}

export type MaintenanceIntervalStatus = 'good' | 'almost' | 'due' | 'at_threshold';

export type MaintenanceType = 'scheduled' | 'preventive';

export interface MaintenanceIntervalDetail {
  type: MaintenanceType;
  intervalKm: number;
  label: string;
  referenceOdometerKm: number;
  distanceSinceReferenceKm: number;
  remainingKm: number;
  percentInSegment: number;
  status: MaintenanceIntervalStatus;
  /** True when the vehicle has reached/completed this interval segment (e.g. at 5000 km or 10000 km mark). */
  atThreshold: boolean;
}

export function computeSegmentProgressKm(
  currentOdometerKm: number,
  intervalKm: number
): SegmentProgressKm {
  const currentOdo = Number.isFinite(currentOdometerKm) ? currentOdometerKm : 0;
  const lastServiceReferenceKm = Math.floor(currentOdo / intervalKm) * intervalKm;
  const distanceSinceReferenceKm = currentOdo - lastServiceReferenceKm;
  const remainingKm = intervalKm - distanceSinceReferenceKm;
  const percentage = intervalKm > 0 ? (distanceSinceReferenceKm / intervalKm) * 100 : 0;
  return {
    currentOdometerKm: currentOdo,
    lastServiceReferenceKm,
    distanceSinceReferenceKm,
    remainingKm,
    percentage,
  };
}

export function isAtSegmentCompletion(currentOdometerKm: number, intervalKm: number): boolean {
  const p = computeSegmentProgressKm(currentOdometerKm, intervalKm);
  return p.distanceSinceReferenceKm >= intervalKm - MILEAGE_SEGMENT_COMPLETION_MARGIN_KM;
}

export function buildMaintenanceInterval(
  currentOdometerKm: number | null,
  intervalKm: number,
  type: MaintenanceType
): MaintenanceIntervalDetail | null {
  if (currentOdometerKm == null || !Number.isFinite(currentOdometerKm)) {
    return null;
  }

  const progress = computeSegmentProgressKm(currentOdometerKm, intervalKm);
  const atThreshold = isAtSegmentCompletion(currentOdometerKm, intervalKm);

  let status: MaintenanceIntervalStatus = 'good';
  if (atThreshold) {
    status = 'at_threshold';
  } else if (progress.remainingKm <= 0) {
    status = 'due';
  } else if (progress.remainingKm <= MILEAGE_ALMOST_DUE_BUFFER_KM) {
    status = 'almost';
  }

  const label =
    type === 'scheduled'
      ? 'Scheduled maintenance (5000 km)'
      : 'Preventive maintenance (10000 km)';

  return {
    type,
    intervalKm,
    label,
    referenceOdometerKm: progress.lastServiceReferenceKm,
    distanceSinceReferenceKm: Math.round(progress.distanceSinceReferenceKm * 100) / 100,
    remainingKm: Math.round(progress.remainingKm * 100) / 100,
    percentInSegment: Math.round(progress.percentage * 100) / 100,
    status,
    atThreshold,
  };
}

/** Latest end odometer (km) from reportmileagedetail records (meters). */
export function currentOdometerKmFromRecords(
  records: { enddis?: number }[] | undefined
): number | null {
  if (!records || records.length === 0) return null;
  const latest = records[records.length - 1];
  const end = Number(latest?.enddis);
  if (!Number.isFinite(end)) return null;
  return end / 1000;
}

/** @deprecated Use MILEAGE_SCHEDULED_MAINTENANCE_KM */
export const MILEAGE_SCHEDULED_DAILY_SEGMENT_KM = MILEAGE_SCHEDULED_MAINTENANCE_KM;

/** @deprecated Use isAtSegmentCompletion */
export function isAt4000KmSegmentCompletion(currentOdometerKm: number): boolean {
  return isAtSegmentCompletion(currentOdometerKm, MILEAGE_SCHEDULED_MAINTENANCE_KM);
}

/** @deprecated */
export const MILEAGE_OIL_INTERVAL_KM = 5000;
export function computeOilChangeProgressKm(
  currentOdometerKm: number,
  intervalKm = MILEAGE_OIL_INTERVAL_KM
): SegmentProgressKm {
  return computeSegmentProgressKm(currentOdometerKm, intervalKm);
}

export function qualifiesDailyMileageAlert(progress: SegmentProgressKm): boolean {
  return progress.distanceSinceReferenceKm >= MILEAGE_SCHEDULED_MAINTENANCE_KM - MILEAGE_SEGMENT_COMPLETION_MARGIN_KM;
}

export function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getDate() === 1;
}
