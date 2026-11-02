import type { FuelTrackPoint } from '@/lib/fuel';

export interface FuelAddition {
  index: number;
  starttime: number;
  endtime: number;
  startIso: string;
  endIso: string;
  startOilL: number;
  endOilL: number;
  addedL: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startKm: number | null;
  endKm: number | null;
  pointCount: number;
  durationSec: number;
  retainedOilL: number | null;
  source: 'oiltime_jump' | 'oilrecord';
  kind: 'refuel';
  confidenceNote?: string;
}

export type RejectedRise = {
  startIso: string;
  endIso: string;
  startOilL: number;
  endOilL: number;
  addedL: number;
  reason: string;
  plainReason: string;
};

export interface AdditionDetectionResult {
  refuels: FuelAddition[];
  rejected: RejectedRise[];
  sloshRejected: number;
  candidates: number;
}

export interface DetectOptions {
  /** Tiny noise floor only — not a minimum purchase size (default 1.5 L). */
  minJumpL?: number;
  gapMs?: number;
  maxFillMs?: number;
  retainFraction?: number;
  settleStartMs?: number;
  settleEndMs?: number;
  smoothWindow?: number;
  mergeVisitMs?: number;
  /** Minimum odometer gap between separate purchases (default 5 km). */
  minDistanceKm?: number;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Trimmed mean — average of the middle band between left/right slosh. */
function plateauAverage(nums: number[]): number | null {
  if (!nums.length) return null;
  if (nums.length < 4) return median(nums);
  const s = [...nums].sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(s.length * 0.15));
  const core = s.slice(trim, s.length - trim);
  return mean(core.length ? core : s);
}

/**
 * Sustained plateau: densest ~12 L band at/above minLevel (post-fill tank).
 * Brief absurd spikes (130 L) lose to a long ~70 L hold.
 * Pre-fill lows are ignored when minLevel is the pre-fill baseline + margin.
 */
function sustainedPlateau(
  nums: number[],
  bandL = 12,
  minLevel: number | null = null
): number | null {
  if (!nums.length) return null;
  if (nums.length < 4) return median(nums);
  const s = [...nums].sort((a, b) => a - b);
  type Band = { i: number; count: number; mid: number };
  const bands: Band[] = [];
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    while (j < s.length && s[j] - s[i] <= bandL) j++;
    const count = j - i;
    const mid = mean(s.slice(i, j)) ?? 0;
    bands.push({ i, count, mid });
  }
  const floor = minLevel == null ? -Infinity : minLevel;
  const eligible = bands.filter((b) => b.mid >= floor);
  const pool = eligible.length ? eligible : bands;
  // Score: density first, then higher tank level (post-fill over pre-fill)
  pool.sort((a, b) => b.count - a.count || b.mid - a.mid);
  const densest = pool[0];
  const higher = pool.find(
    (b) => b.mid >= densest.mid + 8 && b.count >= densest.count * 0.4
  );
  const pick = higher ?? densest;
  return mean(s.slice(pick.i, pick.i + pick.count));
}

function toIso(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return '';
  }
}

function isAccOff(status: string): boolean {
  const s = status || '';
  return s.includes('ACC Off') || s.includes('ACC关') || s.includes('ACC off');
}

function isAccOn(status: string): boolean {
  const s = status || '';
  return s.includes('ACC On') || s.includes('ACC开') || s.includes('ACC on');
}

function saneSpeedKmh(p: FuelTrackPoint): number | null {
  const s = p.speedKmh;
  if (s == null || !Number.isFinite(s) || s > 140) return null;
  return s;
}

function isStopped(p: FuelTrackPoint): boolean {
  const s = saneSpeedKmh(p);
  return s == null ? false : s < 8;
}

function haversineKm(
  lat1: number | null,
  lon1: number | null,
  lat2: number | null,
  lon2: number | null
): number | null {
  if (
    lat1 == null ||
    lon1 == null ||
    lat2 == null ||
    lon2 == null ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return null;
  }
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type FillCand = {
  stepAt: number;
  stepEnd: number;
  beforePlateau: number;
  afterPlateau: number;
  boughtL: number;
  start: FuelTrackPoint;
  end: FuelTrackPoint;
  fracAccOff: number;
  fracStopped: number;
  pointCount: number;
};

/**
 * Detect real station refuels from a calibrated fuel-gauge track.
 *
 * Critical rules (validated on GIGM device …71537):
 * 1) Drivers cut ignition at the pump → prefer ACC Off + stopped
 * 2) A real buy is a sharp tank STEP that then HOLDS (no quick drop-back)
 * 3) Litres = after plateau − before plateau (average between slosh)
 * 4) Confirm tank still high after moving off
 * 5) Separate purchases must be ≥ ~5 km apart
 * 6) No minimum purchase size (only a tiny noise floor)
 */
export function detectAdditionsFromTimeline(
  points: FuelTrackPoint[],
  options?: DetectOptions
): AdditionDetectionResult {
  const noiseFloorL = options?.minJumpL ?? 1.5;
  const mergeVisitMs = options?.mergeVisitMs ?? 45 * 60 * 1000;
  const minDistanceKm = options?.minDistanceKm ?? 5;
  const retainFraction = options?.retainFraction ?? 0.45;

  const sorted = [...points]
    .filter((p) => p.oilL != null && p.updatetime > 0)
    .sort((a, b) => a.updatetime - b.updatetime) as Array<FuelTrackPoint & { oilL: number }>;

  if (sorted.length < 8) {
    return { refuels: [], rejected: [], sloshRejected: 0, candidates: 0 };
  }

  const rejected: RejectedRise[] = [];
  const candidates: FillCand[] = [];

  /**
   * Scan for step increases on the RAW gauge (not over-smoothed),
   * then require pump context + durable hold.
   */
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const step = cur.oilL - prev.oilL;

    // Ignore tiny noise; real fills are usually a clear step (or multi-point rise)
    if (step < Math.max(noiseFloorL, 3)) continue;

    // Extend a short rising burst (pump nozzle still flowing) up to 25 min
    let endIdx = i;
    let peakOil = cur.oilL;
    let peakIdx = i;
    while (
      endIdx + 1 < sorted.length &&
      sorted[endIdx + 1].updatetime - prev.updatetime <= 25 * 60 * 1000
    ) {
      const nxt = sorted[endIdx + 1];
      if (nxt.oilL > peakOil) {
        peakOil = nxt.oilL;
        peakIdx = endIdx + 1;
        endIdx++;
        continue;
      }
      // Still near the high — keep extending (settling after fill)
      if (nxt.oilL >= peakOil - 4) {
        endIdx++;
        continue;
      }
      // Dropped a lot from peak but still clearly above start = spike settling; stop chase
      if (nxt.oilL >= prev.oilL + Math.max(3, 0.4 * (peakOil - prev.oilL))) {
        endIdx++;
        break;
      }
      // Collapsed toward pre-fill level — end burst
      break;
    }

    const startPt = prev;
    // Prefer last high-hold sample after peak (ignores absurd 130L spikes that settle to ~70)
    let endPt = sorted[peakIdx];
    const settleSamples = sorted.filter(
      (p) =>
        p.updatetime >= endPt.updatetime &&
        p.updatetime <= endPt.updatetime + 12 * 60 * 1000 &&
        p.oilL >= startPt.oilL + 3
    );
    if (settleSamples.length >= 3) {
      const settleMed = median(settleSamples.map((p) => p.oilL));
      if (settleMed != null && peakOil - settleMed > 12) {
        // Spike above true tank — use settled level as the fill end
        const near = settleSamples.reduce((best, p) =>
          Math.abs(p.oilL - settleMed) < Math.abs(best.oilL - settleMed) ? p : best
        );
        endPt = near;
        peakOil = settleMed;
      }
    }

    const riseL = peakOil - startPt.oilL;
    if (riseL < Math.max(noiseFloorL, 3)) {
      continue;
    }

    // Context around the step: ±8 min for ACC/stop evidence
    const ctx = sorted.filter(
      (p) =>
        p.updatetime >= startPt.updatetime - 8 * 60 * 1000 &&
        p.updatetime <= endPt.updatetime + 5 * 60 * 1000
    );
    const fracAccOff = ctx.length
      ? ctx.filter((p) => isAccOff(p.statusen)).length / ctx.length
      : 0;
    const fracStopped = ctx.length ? ctx.filter((p) => isStopped(p)).length / ctx.length : 0;

    // The step itself should not look like highway driving
    const stepWindow = sorted.filter(
      (p) => p.updatetime >= startPt.updatetime && p.updatetime <= endPt.updatetime
    );
    const stepSpeeds = stepWindow
      .map((p) => saneSpeedKmh(p))
      .filter((s): s is number => s != null);
    const medStepSpeed = median(stepSpeeds);
    const stepMostlyMoving =
      medStepSpeed != null && medStepSpeed > 25 && fracStopped < 0.35 && fracAccOff < 0.2;

    // Before plateau: last 10–15 min BEFORE the step (prefer ACC-off samples)
    const beforePts = sorted.filter(
      (p) =>
        p.updatetime >= startPt.updatetime - 15 * 60 * 1000 &&
        p.updatetime < startPt.updatetime
    );
    const beforeAcc = beforePts.filter((p) => isAccOff(p.statusen));
    const beforePlateau =
      plateauAverage((beforeAcc.length >= 3 ? beforeAcc : beforePts).map((p) => p.oilL)) ??
      startPt.oilL;

    /**
     * After plateau = held full-tank band after the step (between slosh).
     * Use 5–60 min window with upperPlateau so:
     * - premature windows that later include the real fill still read ~full tank
     * - absurd spikes (130L) above the true ~70L hold are ignored
     */
    const afterPts = sorted.filter(
      (p) =>
        p.updatetime > startPt.updatetime + 5 * 60 * 1000 &&
        p.updatetime <= startPt.updatetime + 60 * 60 * 1000
    );
    // Prefer plateau clearly above the pre-fill baseline (the real full tank).
    // Use a firm margin so pre-fill slosh (~+5–10 L) cannot win over the true fill band.
    const afterOils = afterPts.map((p) => p.oilL);
    let afterPlateauStrict = sustainedPlateau(
      afterOils,
      12,
      beforePlateau + Math.max(12, noiseFloorL + 8)
    );
    // Fallback: if nothing that high, try a milder floor (small real purchases)
    if (afterPlateauStrict == null) {
      afterPlateauStrict = sustainedPlateau(
        afterOils,
        12,
        beforePlateau + Math.max(5, noiseFloorL + 2)
      );
    }
    if (afterPlateauStrict == null || afterPts.length < 6) {
      rejected.push({
        startIso: startPt.time || toIso(startPt.updatetime),
        endIso: endPt.time || toIso(endPt.updatetime),
        startOilL: Number(startPt.oilL.toFixed(2)),
        endOilL: Number(peakOil.toFixed(2)),
        addedL: Number(riseL.toFixed(2)),
        reason: 'no_plateau',
        plainReason: 'Not a real purchase: tank did not settle on a higher plateau afterward.',
      });
      continue;
    }

    const boughtL = afterPlateauStrict - beforePlateau;

    // Durability: among samples near the held full-tank band, low percentile must stay high.
    // Do not use the whole window P20 — it still contains pre-fill lows in premature windows.
    const afterNearFill = afterPts.filter((p) => p.oilL >= afterPlateauStrict - 12);
    const holdSeries = (
      afterNearFill.length >= 5 ? afterNearFill : afterPts
    ).map((p) => p.oilL);
    const afterSorted = [...holdSeries].sort((a, b) => a - b);
    const afterP20 = afterSorted[Math.max(0, Math.floor(afterSorted.length * 0.2))];
    const holdFloor = beforePlateau + Math.max(noiseFloorL, 0.3 * Math.max(boughtL, 0));
    const droppedBack = afterNearFill.length >= 5 && afterP20 < holdFloor;

    // The observed step must actually reach near the claimed plateau (blocks fake +14L noise)
    const stepReachedPlateau = peakOil >= afterPlateauStrict - 10;
    // Plateau band must be thick in the after window (not a few spike samples)
    const plateauBandShare = afterNearFill.length / Math.max(1, afterPts.length);

    const fail: string[] = [];
    if (boughtL < noiseFloorL) fail.push('no durable litre gain after the rise');
    // Compare hold to rise, but ignore absurd spike tops (130L then settle ~70)
    const effectiveRise = Math.min(riseL, Math.max(boughtL * 1.35, boughtL + 8));
    if (boughtL > 0 && boughtL < retainFraction * effectiveRise) {
      fail.push(
        `did not hold fuel (kept ~${boughtL.toFixed(1)} L of +${riseL.toFixed(1)} L rise)`
      );
    }
    if (droppedBack) fail.push('tank dropped back quickly — gauge slosh/spike');
    if (!stepReachedPlateau) {
      fail.push(
        `step peak ${peakOil.toFixed(1)} L never reached plateau ${afterPlateauStrict.toFixed(1)} L`
      );
    }
    if (plateauBandShare < 0.28) {
      fail.push(
        `claimed plateau not sustained (${(plateauBandShare * 100).toFixed(0)}% of after samples)`
      );
    }
    if (stepMostlyMoving) fail.push('rise happened while driving');
    // Ignition off is the primary pump signal for this fleet
    if (fracAccOff < 0.18 && fracStopped < 0.45) {
      fail.push('no clear ignition-off / stop at the pump');
    }
    // Real pump stop: odometer barely moves during the fill step
    const kmA = startPt.distanceKm;
    const kmB = endPt.distanceKm;
    const movedKmDuring =
      kmA != null && kmB != null && Number.isFinite(kmA) && Number.isFinite(kmB)
        ? Math.abs(kmB - kmA)
        : null;
    if (movedKmDuring != null && movedKmDuring > 2.5 && fracAccOff < 0.35) {
      fail.push(`vehicle moved ~${movedKmDuring.toFixed(1)} km during claimed fill`);
    }

    // Must still be high after they start moving again (or long parked hold)
    const afterMove = sorted.filter(
      (p) =>
        p.updatetime > endPt.updatetime + 2 * 60 * 1000 &&
        p.updatetime <= endPt.updatetime + 45 * 60 * 1000 &&
        ((saneSpeedKmh(p) != null && (saneSpeedKmh(p) as number) > 5) || isAccOn(p.statusen))
    );
    const heldAfterMove =
      afterMove.length === 0
        ? afterNearFill.length >= 4 && afterPlateauStrict >= beforePlateau + noiseFloorL
        : afterMove.some(
            (p) =>
              p.oilL >= beforePlateau + Math.max(noiseFloorL, 0.3 * Math.max(boughtL, 0))
          );
    if (!heldAfterMove) fail.push('tank not still high after leaving the pump');

    if (fail.length) {
      rejected.push({
        startIso: startPt.time || toIso(startPt.updatetime),
        endIso: endPt.time || toIso(endPt.updatetime),
        startOilL: Number(beforePlateau.toFixed(2)),
        endOilL: Number(afterPlateauStrict.toFixed(2)),
        addedL: Number(Math.max(boughtL, riseL).toFixed(2)),
        reason: 'not_station_fill',
        plainReason: `Not a real purchase: ${fail.join('; ')}.`,
      });
      // Do NOT skip ahead on reject — a later real fill may sit inside a noisy window
      continue;
    }

    candidates.push({
      stepAt: startPt.updatetime,
      stepEnd: endPt.updatetime,
      beforePlateau,
      afterPlateau: afterPlateauStrict,
      boughtL,
      start: startPt,
      end: endPt,
      fracAccOff,
      fracStopped,
      pointCount: Math.max(2, endIdx - (i - 1) + 1),
    });

    // Skip only a little past this accepted step so a later real fill is not swallowed
    const acceptIdx = sorted.findIndex((p) => p.updatetime >= endPt.updatetime);
    i = Math.max(i, acceptIdx >= 0 ? acceptIdx : peakIdx);
  }

  // Merge same station visit (time) then enforce 5 km spacing
  candidates.sort((a, b) => a.stepAt - b.stepAt);
  const merged: FillCand[] = [];
  for (const c of candidates) {
    const prev = merged[merged.length - 1];
    if (prev && c.stepAt - prev.stepEnd <= mergeVisitMs) {
      // Keep the stronger durable purchase entirely (do not dilute with weaker noise)
      if (c.boughtL > prev.boughtL) {
        merged[merged.length - 1] = {
          ...c,
          stepAt: Math.min(prev.stepAt, c.stepAt),
          start: prev.stepAt <= c.stepAt ? prev.start : c.start,
          fracAccOff: Math.max(prev.fracAccOff, c.fracAccOff),
          fracStopped: Math.max(prev.fracStopped, c.fracStopped),
          pointCount: prev.pointCount + c.pointCount,
        };
      } else {
        prev.stepEnd = Math.max(prev.stepEnd, c.stepEnd);
        prev.fracAccOff = Math.max(prev.fracAccOff, c.fracAccOff);
        prev.fracStopped = Math.max(prev.fracStopped, c.fracStopped);
        prev.pointCount += c.pointCount;
      }
      continue;
    }
    merged.push({ ...c });
  }

  const spaced: FillCand[] = [];
  for (const c of merged) {
    const prev = spaced[spaced.length - 1];
    if (!prev) {
      spaced.push(c);
      continue;
    }
    const a = prev.end.distanceKm ?? prev.start.distanceKm;
    const b = c.start.distanceKm ?? c.end.distanceKm;
    let gap: number | null =
      a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && b >= a
        ? b - a
        : null;
    if (gap == null) {
      gap = haversineKm(
        prev.end.lat ?? prev.start.lat,
        prev.end.lon ?? prev.start.lon,
        c.start.lat ?? c.end.lat,
        c.start.lon ?? c.end.lon
      );
    }
    if (gap != null && gap < minDistanceKm) {
      // Too close — keep the larger durable purchase
      if (c.boughtL > prev.boughtL) {
        spaced[spaced.length - 1] = c;
      }
      rejected.push({
        startIso: c.start.time || toIso(c.stepAt),
        endIso: c.end.time || toIso(c.stepEnd),
        startOilL: Number(c.beforePlateau.toFixed(2)),
        endOilL: Number(c.afterPlateau.toFixed(2)),
        addedL: Number(c.boughtL.toFixed(2)),
        reason: 'too_close_km',
        plainReason: `Dropped/merged: only ~${gap.toFixed(1)} km after previous purchase (min ${minDistanceKm} km).`,
      });
      continue;
    }
    spaced.push(c);
  }

  const refuels: FuelAddition[] = spaced.map((c, i) => {
    const noteParts = [
      'Station-style fill',
      c.fracAccOff >= 0.2 ? 'ignition/ACC off at pump' : null,
      c.fracStopped >= 0.4 ? 'vehicle mostly stopped' : null,
      `plateau ${c.beforePlateau.toFixed(1)}→${c.afterPlateau.toFixed(1)} L`,
    ].filter(Boolean);

    return {
      index: i + 1,
      starttime: c.stepAt,
      endtime: c.stepEnd,
      startIso: c.start.time || toIso(c.stepAt),
      endIso: c.end.time || toIso(c.stepEnd),
      startOilL: Number(c.beforePlateau.toFixed(2)),
      endOilL: Number(c.afterPlateau.toFixed(2)),
      addedL: Number(c.boughtL.toFixed(2)),
      startLat: c.start.lat,
      startLon: c.start.lon,
      endLat: c.end.lat,
      endLon: c.end.lon,
      startKm: c.start.distanceKm,
      endKm: c.end.distanceKm,
      pointCount: c.pointCount,
      durationSec: Number(((c.stepEnd - c.stepAt) / 1000).toFixed(0)),
      retainedOilL: Number(c.afterPlateau.toFixed(2)),
      source: 'oiltime_jump',
      kind: 'refuel',
      confidenceNote: noteParts.join(' · '),
    };
  });

  return {
    refuels,
    rejected,
    sloshRejected: rejected.length,
    candidates: candidates.length,
  };
}

export function detectAdditionsFromTimelineLegacy(
  points: FuelTrackPoint[],
  options?: { minJumpL?: number; gapMs?: number }
): FuelAddition[] {
  return detectAdditionsFromTimeline(points, options).refuels;
}

export function mapsLink(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return `https://www.google.com/maps?q=${lat},${lon}`;
}
