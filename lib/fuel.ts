import { normalizeSpeedKmh } from '@/lib/mileageLocation';

/** GPS51 oil values are typically 1/100 litre. */
export function oilToLitres(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 100;
}

export function metresToKm(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 1000;
}

export interface FuelTrackPoint {
  updatetime: number;
  time: string;
  oilL: number | null;
  tank1L: number | null;
  distanceKm: number | null;
  speedKmh: number | null;
  lat: number | null;
  lon: number | null;
  statusen: string;
}

function toIso(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return '';
  }
}

export function mapTrackPoint(raw: Record<string, unknown>): FuelTrackPoint {
  const updatetime = Number(raw.updatetime || raw.devicetime || 0);
  const speedMs = Number(raw.speed);
  return {
    updatetime,
    time: toIso(updatetime),
    oilL: oilToLitres(raw.totalad ?? raw.ad0 ?? raw.totaloil ?? raw.masteroil),
    tank1L: oilToLitres(raw.ad0 ?? raw.masteroil),
    distanceKm: metresToKm(raw.totaldistance),
    // GPS51 track/oil speed is usually ×1000 km/h (e.g. 74200 → 74.2), not m/s.
    speedKmh: Number.isFinite(speedMs) ? normalizeSpeedKmh(speedMs) : null,
    lat: Number.isFinite(Number(raw.callat)) ? Number(raw.callat) : null,
    lon: Number.isFinite(Number(raw.callon)) ? Number(raw.callon) : null,
    statusen: String(raw.strstatusen || raw.strstatus || ''),
  };
}

/** Evenly downsample a large track for charts. */
export function downsamplePoints<T>(points: T[], maxPoints = 400): T[] {
  if (points.length <= maxPoints) return points;
  const result: T[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

export interface DailyFuelRow {
  statisticsday: string;
  distanceKm: number | null;
  beginOilL: number | null;
  endOilL: number | null;
  addOilL: number | null;
  leakOilL: number | null;
  idleOilL: number | null;
  usedOilL: number | null;
  oilper100km: number | null;
  oilperhour: number | null;
  avgspeed: number | null;
}

export function mapDailyRow(raw: Record<string, unknown>): DailyFuelRow {
  const begin = oilToLitres(raw.beginoil);
  const end = oilToLitres(raw.endoil);
  const add = oilToLitres(raw.addoil);
  const used =
    begin != null && end != null && add != null ? begin + add - end : oilToLitres(raw.totaloil);

  return {
    statisticsday: String(raw.statisticsday || ''),
    distanceKm: metresToKm(raw.totaldistance),
    beginOilL: begin,
    endOilL: end,
    addOilL: add,
    leakOilL: oilToLitres(raw.leakoil),
    idleOilL: oilToLitres(raw.idleoil),
    usedOilL: used,
    oilper100km: Number.isFinite(Number(raw.oilper100km)) ? Number(raw.oilper100km) : null,
    oilperhour: Number.isFinite(Number(raw.oilperhour)) ? Number(raw.oilperhour) : null,
    avgspeed: Number.isFinite(Number(raw.avgspeed)) ? Number(raw.avgspeed) : null,
  };
}

export interface FuelEventRow {
  starttime: number;
  endtime: number;
  startIso: string;
  endIso: string;
  startOilL: number | null;
  endOilL: number | null;
  deltaL: number | null;
  oilstate: number;
  oilIndex: number;
  lat: number | null;
  lon: number | null;
  kind: 'refuel' | 'leak' | 'other';
}

export function mapEventRow(raw: Record<string, unknown>): FuelEventRow {
  const starttime = Number(raw.starttime || 0);
  const endtime = Number(raw.endtime || raw['end time'] || 0);
  const startOil = oilToLitres(raw.soil ?? raw.startoil);
  const endOil = oilToLitres(raw.eoil ?? raw.endoil ?? raw.know);
  const oilstate = Number(raw.oilstate ?? 0);
  const delta =
    startOil != null && endOil != null ? Math.abs(endOil - startOil) : oilToLitres(raw.oil);

  return {
    starttime,
    endtime,
    startIso: toIso(starttime),
    endIso: toIso(endtime),
    startOilL: startOil,
    endOilL: endOil,
    deltaL: delta,
    oilstate,
    oilIndex: Number(raw.oilIndex ?? raw.oilindex ?? 0),
    lat: Number.isFinite(Number(raw.slat)) ? Number(raw.slat) : null,
    lon: Number.isFinite(Number(raw.slon ?? raw.elephant)) ? Number(raw.slon ?? raw.elephant) : null,
    kind: oilstate === 1 ? 'refuel' : oilstate === -1 ? 'leak' : 'other',
  };
}
