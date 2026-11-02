/**
 * Helpers to present reportoildaily fuel figures for non-technical users.
 * GPS51 oil fields are 1/100 litre; platform addoil/totaloil can be noisy.
 */

export type DailyFuelLike = {
  statisticsday: string;
  beginoil_L: number | null;
  endoil_L: number | null;
  addoil_L: number | null;
  totaloil_L: number | null;
  distanceKm: number | null;
};

export type DayFuelVerdict = {
  day: string;
  beginL: number;
  endL: number;
  platformBoughtL: number;
  platformUsedL: number;
  distanceKm: number;
  /** Counted toward “fuel bought” total. */
  trustedBoughtL: number;
  reliable: boolean;
  reason: string;
  plainSummary: string;
};

/** Soft daily cap — above this, treat as sensor/platform junk for fleet trucks. */
const MAX_PLAUSIBLE_BUY_L = 250;
const MAX_PLAUSIBLE_USE_L = 250;

function n(v: number | null | undefined): number {
  return v != null && Number.isFinite(v) ? v : 0;
}

/**
 * Decide if a day’s addoil is believable for a normal vehicle tank.
 * Unrealistic days are explained and excluded from the trusted total.
 */
export function judgeDailyFuelBought(row: DailyFuelLike): DayFuelVerdict {
  const day = row.statisticsday;
  const beginL = n(row.beginoil_L);
  const endL = n(row.endoil_L);
  const platformBoughtL = n(row.addoil_L);
  const platformUsedL = n(row.totaloil_L);
  const distanceKm = n(row.distanceKm);

  const noSignal = beginL <= 0 && endL <= 0 && platformBoughtL <= 0;
  if (noSignal) {
    return {
      day,
      beginL,
      endL,
      platformBoughtL,
      platformUsedL,
      distanceKm,
      trustedBoughtL: 0,
      reliable: false,
      reason: 'no_data',
      plainSummary: 'No fuel reading this day (vehicle offline or no sensor data).',
    };
  }

  if (platformBoughtL <= 0) {
    const tankBit =
      beginL > 0 || endL > 0
        ? `Tank went from ${beginL.toFixed(1)} L to ${endL.toFixed(1)} L.`
        : '';
    return {
      day,
      beginL,
      endL,
      platformBoughtL: 0,
      platformUsedL,
      distanceKm,
      trustedBoughtL: 0,
      reliable: true,
      reason: 'no_purchase',
      plainSummary: `No fuel purchase recorded. ${tankBit}`.trim(),
    };
  }

  const tankRef = Math.max(beginL, endL, 40);
  const buyTooHuge = platformBoughtL > MAX_PLAUSIBLE_BUY_L;
  const buyVsTank = platformBoughtL > tankRef * 5;
  const useTooHuge = platformUsedL > MAX_PLAUSIBLE_USE_L;

  if (buyTooHuge || buyVsTank || useTooHuge) {
    return {
      day,
      beginL,
      endL,
      platformBoughtL,
      platformUsedL,
      distanceKm,
      trustedBoughtL: 0,
      reliable: false,
      reason: 'unrealistic',
      plainSummary: `Ignored: GPS reported ${platformBoughtL.toFixed(0)} L bought (and ${platformUsedL.toFixed(0)} L used) — too high for a normal tank (about ${tankRef.toFixed(0)} L). Likely a sensor glitch, not a real purchase.`,
    };
  }

  const tankChange = endL - beginL;
  const plainSummary =
    `Started with ${beginL.toFixed(1)} L, ended with ${endL.toFixed(1)} L` +
    (tankChange >= 0.5 ? ` (up ${tankChange.toFixed(1)} L)` : tankChange <= -0.5 ? ` (down ${Math.abs(tankChange).toFixed(1)} L)` : '') +
    `. GPS says about ${platformBoughtL.toFixed(1)} L was added` +
    (platformUsedL > 0 ? ` and ${platformUsedL.toFixed(1)} L was used` : '') +
    (distanceKm > 0 ? ` over ${distanceKm.toFixed(0)} km` : '') +
    '.';

  return {
    day,
    beginL,
    endL,
    platformBoughtL,
    platformUsedL,
    distanceKm,
    trustedBoughtL: platformBoughtL,
    reliable: true,
    reason: 'ok',
    plainSummary,
  };
}

export function summarizeFuelBought(rows: DailyFuelLike[]): {
  verdicts: DayFuelVerdict[];
  trustedTotalL: number;
  platformTotalL: number;
  reliableDays: number;
  ignoredDays: number;
  noDataDays: number;
} {
  const verdicts = rows.map(judgeDailyFuelBought);
  const trustedTotalL = verdicts.reduce((s, v) => s + v.trustedBoughtL, 0);
  const platformTotalL = verdicts.reduce((s, v) => s + v.platformBoughtL, 0);
  const reliableDays = verdicts.filter((v) => v.reliable && v.trustedBoughtL > 0).length;
  const ignoredDays = verdicts.filter((v) => v.reason === 'unrealistic').length;
  const noDataDays = verdicts.filter((v) => v.reason === 'no_data').length;
  return {
    verdicts,
    trustedTotalL,
    platformTotalL,
    reliableDays,
    ignoredDays,
    noDataDays,
  };
}
