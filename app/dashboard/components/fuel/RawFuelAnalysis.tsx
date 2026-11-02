"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatApiFailure } from "@/lib/apiErrors";
import { mapsLink } from "@/lib/fuelAdditions";
import { apiCallWithAutoRefresh, formatKm, formatLitres } from "@/lib/utils";

export interface RawPoint {
  updatetime: number;
  time: string;
  oilL: number | null;
  distanceKm: number | null;
  speedKmh: number | null;
  lat: number | null;
  lon: number | null;
  statusen: string;
}

export interface RawAddition {
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
  source: string;
}

export interface RawTimelineDevice {
  deviceid: string;
  pointCount: number;
  sampledCount: number;
  additions: RawAddition[];
  additionsSource: string;
  sloshRejected: number;
  candidates: number;
  minJumpL: number;
  retainFraction: number;
  points: RawPoint[];
}

type ChartRow = {
  t: string;
  oil: number | null;
  refuelMark: number | null;
  refuelAdded: number | null;
  refuelIndex: number | null;
};

function nearestPointIndex(points: RawPoint[], targetMs: number): number {
  if (!points.length) return -1;
  let best = 0;
  let bestDiff = Math.abs(points[0].updatetime - targetMs);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].updatetime - targetMs);
    if (d < bestDiff) {
      best = i;
      bestDiff = d;
    }
  }
  return best;
}

/** Load raw reportoiltime + detect real refuels. Default: local cache only (no GPS51). */
export async function fetchRawFuelAnalysis(opts: {
  deviceid: string;
  startday: string;
  endday: string;
  minJumpL: number;
  /** If true, call GPS51 live (burns quota). Default false = cached report only. */
  refreshLive?: boolean;
}): Promise<{ device: RawTimelineDevice; message: string }> {
  const res = await apiCallWithAutoRefresh("/api/fuel/timeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      devices: [opts.deviceid],
      startday: opts.startday,
      endday: opts.endday,
      maxPoints: 1200,
      minJumpL: opts.minJumpL,
      retainFraction: 0.6,
      refresh: Boolean(opts.refreshLive),
    }),
  });

  if (res.status !== 0) {
    throw new Error(formatApiFailure(res, "Raw fuel timeline failed"));
  }

  const device = ((res.devices as RawTimelineDevice[]) || [])[0];
  if (!device) {
    throw new Error("No raw oiltime records for this device/range");
  }

  const parts: string[] = [
    "RAW reportoiltime — real refuels from tank rises (slosh filtered).",
  ];
  if (typeof res.message === "string" && res.message) parts.push(res.message);
  else if (res.fromCache) parts.push("Built from saved local report (no GPS51 call).");
  if (res.cacheBody && typeof res.cacheBody === "object") {
    const cb = res.cacheBody as { startday?: string; endday?: string };
    if (cb.startday && cb.endday) {
      parts.push(`Report range used: ${cb.startday} → ${cb.endday}.`);
    }
  }
  parts.push(
    `${device.pointCount} raw pts · ${device.additions.length} real refuel(s)` +
      (device.sloshRejected ? ` · ${device.sloshRejected} slosh rejected` : "") +
      ` · ${device.candidates} rise candidate(s)`
  );

  return { device, message: parts.join(" ") };
}

export type CachedOiltimeRow = {
  key: string;
  devices: string[];
  startday?: string;
  endday?: string;
  age: string;
};

export async function fetchLocalCachedReports(): Promise<CachedOiltimeRow[]> {
  const res = await fetch("/api/fuel/cache");
  const data = (await res.json()) as {
    oiltime?: CachedOiltimeRow[];
  };
  return data.oiltime || [];
}

export function RawTankGraph({
  device,
  selectedRefuel,
  onSelectRefuel,
}: {
  device: RawTimelineDevice | null;
  selectedRefuel: number | null;
  onSelectRefuel: (index: number | null) => void;
}) {
  const chartData: ChartRow[] = useMemo(() => {
    const points = device?.points || [];
    if (!points.length) return [];

    const rows: ChartRow[] = points.map((p) => ({
      t: p.time ? p.time.slice(5, 16).replace("T", " ") : "",
      oil: p.oilL != null ? Number(p.oilL.toFixed(2)) : null,
      refuelMark: null,
      refuelAdded: null,
      refuelIndex: null,
    }));

    for (const a of device?.additions || []) {
      const idx = nearestPointIndex(points, a.endtime || a.starttime);
      if (idx < 0) continue;
      rows[idx] = {
        ...rows[idx],
        oil: rows[idx].oil ?? Number(a.endOilL.toFixed(2)),
        refuelMark: Number(a.endOilL.toFixed(2)),
        refuelAdded: Number(a.addedL.toFixed(2)),
        refuelIndex: a.index,
      };
    }
    return rows;
  }, [device]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm h-[28rem]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <h3 className="font-semibold text-gray-900">Raw tank level</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Continuous oil from <code>reportoiltime</code> track points — not daily summaries.{" "}
            <span className="text-emerald-700 font-semibold">● Real refuel</span> = sustained rise
            that held (slosh filtered).
          </p>
        </div>
        {device && (
          <span className="text-xs text-gray-500">
            {device.sampledCount}/{device.pointCount} pts shown
          </span>
        )}
      </div>
      {chartData.length ? (
        <ResponsiveContainer width="100%" height="88%">
          <ComposedChart data={chartData} margin={{ top: 28, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={36} />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={["auto", "auto"]}
              label={{ value: "Fuel (L)", angle: -90, position: "insideLeft", fontSize: 11 }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as ChartRow;
                return (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
                    <p className="font-semibold text-gray-900 mb-1">{label}</p>
                    <p>Tank: {formatLitres(row.oil)}</p>
                    {row.refuelMark != null && (
                      <p className="mt-1 font-semibold text-emerald-700">
                        ● Real refuel #{row.refuelIndex}: +{formatLitres(row.refuelAdded)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="oil"
              name="Fuel (L) — raw"
              stroke="#d97706"
              dot={false}
              strokeWidth={2}
              connectNulls
            />
            <Scatter
              dataKey="refuelMark"
              name="● Real refuel"
              fill="#059669"
              shape={(props: {
                cx?: number;
                cy?: number;
                payload?: ChartRow;
              }) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null || payload?.refuelMark == null) {
                  return <g />;
                }
                const highlight = selectedRefuel === payload.refuelIndex;
                return (
                  <g
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelectRefuel(payload.refuelIndex)}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={highlight ? 10 : 7}
                      fill="#059669"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                    <text
                      x={cx}
                      y={cy - 14}
                      textAnchor="middle"
                      fill="#047857"
                      fontSize={11}
                      fontWeight={700}
                    >
                      +{payload.refuelAdded != null ? Math.round(payload.refuelAdded) : ""}L
                    </text>
                  </g>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full flex items-center justify-center text-gray-500 text-sm">
          Load raw track to build the tank graph and detect real refuels.
        </div>
      )}
    </div>
  );
}

export function RealRefuelsTable({
  additions,
  selectedRefuel,
  onSelectRefuel,
  loading,
}: {
  additions: RawAddition[];
  selectedRefuel: number | null;
  onSelectRefuel: (index: number | null) => void;
  loading?: boolean;
}) {
  const total = additions.reduce((s, a) => s + a.addedL, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">Real refuels (from raw tank data)</h3>
          <p className="text-xs text-gray-500 mt-1">
            Detected on continuous oil points: rise ≥ threshold, retained after peak (not{" "}
            <code>reportoildaily</code> addoil summaries).
          </p>
        </div>
        <p className="text-sm font-semibold text-emerald-700">
          {additions.length} fill(s) · {formatLitres(total)}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-3 py-2">When (start)</th>
              <th className="text-left px-3 py-2">When (end)</th>
              <th className="text-right px-3 py-2">Duration</th>
              <th className="text-right px-3 py-2">Start oil</th>
              <th className="text-right px-3 py-2">End oil</th>
              <th className="text-right px-3 py-2 bg-emerald-50">Added</th>
              <th className="text-right px-3 py-2">Held after</th>
              <th className="text-left px-3 py-2">Location</th>
              <th className="text-right px-3 py-2">Odo</th>
              <th className="text-left px-3 py-2">Pts</th>
            </tr>
          </thead>
          <tbody>
            {additions.map((a) => {
              const map = mapsLink(a.endLat ?? a.startLat, a.endLon ?? a.startLon);
              const active = selectedRefuel === a.index;
              return (
                <tr
                  key={`${a.starttime}-${a.index}`}
                  className={`border-t border-gray-100 cursor-pointer ${
                    active ? "bg-emerald-50" : "hover:bg-gray-50"
                  }`}
                  onClick={() => onSelectRefuel(a.index)}
                >
                  <td className="px-3 py-2 font-semibold text-emerald-700">● {a.index}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.startIso ? a.startIso.replace("T", " ").slice(0, 19) : "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.endIso ? a.endIso.replace("T", " ").slice(0, 19) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {a.durationSec >= 60
                      ? `${Math.round(a.durationSec / 60)}m`
                      : `${a.durationSec || 0}s`}
                  </td>
                  <td className="px-3 py-2 text-right">{formatLitres(a.startOilL)}</td>
                  <td className="px-3 py-2 text-right">{formatLitres(a.endOilL)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700 bg-emerald-50">
                    {formatLitres(a.addedL)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatLitres(a.retainedOilL)}</td>
                  <td className="px-3 py-2 text-xs">
                    {a.endLat != null && a.endLon != null ? (
                      map ? (
                        <a
                          href={map}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-700 hover:underline"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          {a.endLat.toFixed(5)}, {a.endLon.toFixed(5)}
                        </a>
                      ) : (
                        `${a.endLat.toFixed(5)}, ${a.endLon.toFixed(5)}`
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {formatKm(a.startKm)} → {formatKm(a.endKm)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500">{a.pointCount}</td>
                </tr>
              );
            })}
            {!additions.length && !loading && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                  No real refuels detected in raw points for this range. Try lowering min refill (L)
                  or widening dates. Do not trust day <code>addoil</code> alone — that is a summary.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Small hook-friendly state wrapper used by Daily / Fuel Additions panels. */
export function useRawFuelLoad() {
  const [raw, setRaw] = useState<RawTimelineDevice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selectedRefuel, setSelectedRefuel] = useState<number | null>(null);
  const [cachedReports, setCachedReports] = useState<CachedOiltimeRow[]>([]);

  const refreshCacheList = async () => {
    try {
      setCachedReports(await fetchLocalCachedReports());
    } catch {
      setCachedReports([]);
    }
  };

  const load = async (opts: {
    deviceid: string;
    startday: string;
    endday: string;
    minJumpL: number;
    refreshLive?: boolean;
  }) => {
    setLoading(true);
    setError("");
    setInfo("");
    setSelectedRefuel(null);
    try {
      const { device, message } = await fetchRawFuelAnalysis(opts);
      setRaw(device);
      setInfo(message);
      await refreshCacheList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Raw fuel load failed");
      setRaw(null);
      await refreshCacheList();
    } finally {
      setLoading(false);
    }
  };

  return {
    raw,
    loading,
    error,
    info,
    selectedRefuel,
    setSelectedRefuel,
    load,
    cachedReports,
    refreshCacheList,
  };
}
