"use client";

import { useEffect, useMemo, useState } from "react";
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
import { getAuthToken } from "@/lib/auth";
import { formatApiFailure } from "@/lib/apiErrors";
import { lookupAddress } from "@/lib/lookupAddress";
import { apiCallWithAutoRefresh, formatKm, formatLitres, todayYmd, ymdDaysAgo } from "@/lib/utils";
import DeviceFilters from "./DeviceFilters";
import { useDevices } from "./useDevices";

type Purchase = {
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
  kind: "refuel";
  source: string;
  label: string;
  startKm?: number | null;
  endKm?: number | null;
};

type PurchaseLeg = {
  odometerKm: number | null;
  travelledKm: number | null;
  litresUsed: number | null;
  lPer100: number | null;
  durationLabel: string | null;
};

function formatFillDuration(start: number, end: number): string | null {
  if (!start || !end || end < start) return null;
  const mins = Math.round((end - start) / 60000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

type TankPoint = {
  t: number;
  km?: number | null;
  label: string;
  whenIso?: string;
  tankL: number | null;
  buyL: number | null;
  buyIndex: number | null;
};

type CacheRow = {
  kind: string;
  devices: string[];
  startday?: string;
  endday?: string;
  age: string;
};

/**
 * Fuel purchases chart: tank level + detected station fills.
 * Local cache only — never calls GPS51 (no limit errors).
 */
export default function DailyFuelPanel() {
  const {
    filtered,
    searchQuery,
    setSearchQuery,
    loading: loadingDevices,
    error: deviceError,
    exactImei,
    deviceCount,
  } = useDevices();
  const [selectedDevice, setSelectedDevice] = useState("");
  const [startDate, setStartDate] = useState(ymdDaysAgo(3));
  const [endDate, setEndDate] = useState(todayYmd());
  const [datesTouched, setDatesTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [tankSeries, setTankSeries] = useState<TankPoint[]>([]);
  const [availableCaches, setAvailableCaches] = useState<CacheRow[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [addresses, setAddresses] = useState<Record<number, string>>({});
  const [addressLoadingIdx, setAddressLoadingIdx] = useState<number | null>(null);

  const selectPurchase = async (index: number) => {
    setSelectedIdx(index);
    const purchase = purchases.find((p) => p.index === index);
    if (!purchase || purchase.lat == null || purchase.lon == null) return;
    if (addresses[index]) return;

    const token = getAuthToken();
    if (!token) return;

    setAddressLoadingIdx(index);
    try {
      const address = await lookupAddress(token, purchase.lat, purchase.lon);
      if (address) {
        setAddresses((prev) => ({ ...prev, [index]: address }));
      }
    } finally {
      setAddressLoadingIdx(null);
    }
  };

  useEffect(() => {
    if (exactImei) {
      setSelectedDevice(exactImei);
      return;
    }
    if (filtered.length === 1) {
      setSelectedDevice(filtered[0].deviceid);
      return;
    }
    if (!selectedDevice && filtered.length) {
      setSelectedDevice(filtered[0].deviceid);
    }
  }, [filtered, selectedDevice, exactImei]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/fuel/cache");
        const data = await res.json();
        const rows: CacheRow[] = [
          ...((data.oilrecord as CacheRow[]) || []).map((r) => ({
            ...r,
            kind: "reportoilrecord",
          })),
          ...((data.oiltime as CacheRow[]) || []).map((r) => ({
            ...r,
            kind: "reportoiltime_disk",
          })),
        ];
        setAvailableCaches(rows);
      } catch {
        setAvailableCaches([]);
      }
    })();
  }, []);

  // Fill From/To from a saved report until the user edits the dates.
  useEffect(() => {
    if (datesTouched || !selectedDevice || !availableCaches.length) return;
    const hit = availableCaches.find((r) => r.devices.includes(selectedDevice));
    if (hit?.startday && hit?.endday) {
      setStartDate(hit.startday);
      setEndDate(hit.endday);
    }
  }, [selectedDevice, availableCaches, datesTouched]);

  const load = async () => {
    if (!selectedDevice || !startDate || !endDate) {
      setError("Choose a device and a From / To date.");
      return;
    }
    setLoading(true);
    setError("");
    setSelectedIdx(null);
    try {
      const data = await apiCallWithAutoRefresh("/api/fuel/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devices: [selectedDevice],
          startday: startDate,
          endday: endDate,
          minJumpL: 1.5,
        }),
      });

      setAvailableCaches((data.availableCaches as CacheRow[]) || []);

      if (data.status !== 0) {
        throw new Error(formatApiFailure(data, "No local purchase data"));
      }

      setPurchases((data.purchases as Purchase[]) || []);
      setTankSeries((data.tankSeries as TankPoint[]) || []);
      setAddresses({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchases");
      setPurchases([]);
      setTankSeries([]);
    } finally {
      setLoading(false);
    }
  };

  /** Prefer continuous tank line; X axis is distance (km). */
  const chartData = useMemo(() => {
    if (tankSeries.length) {
      return tankSeries
        .filter((p) => p.km != null && Number.isFinite(p.km))
        .map((p) => {
          const buy = p.buyIndex != null ? purchases.find((x) => x.index === p.buyIndex) : null;
          return {
            t: p.t,
            km: p.km as number,
            label: `${(p.km as number).toFixed(1)} km`,
            whenIso: p.whenIso || "",
            tankL: p.tankL,
            buyL: p.buyL,
            buyIndex: p.buyIndex,
            buyAmount: buy?.litres ?? null,
            where:
              buy && buy.lat != null && buy.lon != null
                ? `${buy.lat.toFixed(4)}, ${buy.lon.toFixed(4)}`
                : null,
          };
        })
        .sort((a, b) => a.km - b.km);
    }
    return purchases.map((p, i) => ({
      t: p.endtime || p.starttime || new Date(p.whenIso).getTime(),
      km: i,
      label: `${i} km`,
      whenIso: p.whenIso || "",
      tankL: p.endOilL,
      buyL: p.endOilL,
      buyIndex: p.index,
      buyAmount: p.litres,
      where:
        p.lat != null && p.lon != null ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : null,
    }));
  }, [tankSeries, purchases]);

  /** Odometer at the pump, plus distance and fuel used since the previous fill. */
  const mileageByIndex = useMemo(() => {
    const ordered = [...purchases].sort((a, b) => (a.starttime || 0) - (b.starttime || 0));
    const map = new Map<number, PurchaseLeg>();
    let prevOdo: number | null = null;
    let prevEndOil: number | null = null;

    for (const p of ordered) {
      let odo = p.endKm ?? p.startKm ?? null;
      if (odo == null || !Number.isFinite(odo)) {
        const target = p.endtime || p.starttime;
        let bestKm: number | null = null;
        let bestDiff = Infinity;
        for (const pt of tankSeries) {
          if (pt.km == null || !Number.isFinite(pt.km)) continue;
          const diff = Math.abs(pt.t - target);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestKm = pt.km;
          }
        }
        if (bestKm != null && bestDiff < 30 * 60 * 1000) odo = bestKm;
      }

      const travelled =
        odo != null && prevOdo != null && odo >= prevOdo ? Number((odo - prevOdo).toFixed(1)) : null;
      const litresUsed =
        prevEndOil != null && p.startOilL != null
          ? Number((prevEndOil - p.startOilL).toFixed(2))
          : null;
      const lPer100 =
        travelled != null && travelled >= 1 && litresUsed != null && litresUsed > 0
          ? Number(((litresUsed / travelled) * 100).toFixed(2))
          : null;

      map.set(p.index, {
        odometerKm: odo != null ? Number(odo.toFixed(1)) : null,
        travelledKm: travelled,
        litresUsed,
        lPer100,
        durationLabel: formatFillDuration(p.starttime, p.endtime),
      });

      if (odo != null) prevOdo = odo;
      if (p.endOilL != null) prevEndOil = p.endOilL;
    }
    return map;
  }, [purchases, tankSeries]);

  const cacheRangeHint = useMemo(() => {
    if (!selectedDevice || !availableCaches.length) return "";
    const hit = availableCaches.find((r) => r.devices.includes(selectedDevice));
    if (!hit?.startday || !hit?.endday) return "";
    return `cached: ${hit.startday} to ${hit.endday}`;
  }, [selectedDevice, availableCaches]);

  return (
    <div className="space-y-4 text-black">

      <DeviceFilters
        devices={filtered}
        selectedDevice={selectedDevice}
        onDeviceChange={setSelectedDevice}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={(v) => {
          setDatesTouched(true);
          setStartDate(v);
        }}
        onEndDateChange={(v) => {
          setDatesTouched(true);
          setEndDate(v);
        }}
        onSubmit={load}
        loading={loading || loadingDevices}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        submitLabel="Show purchases (local only)"
        cacheRange={cacheRangeHint}
        deviceCount={deviceCount}
      />

      {(error || deviceError) && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error || deviceError}
        </div>
      )}

      {selectedIdx != null && (() => {
        const selected = purchases.find((p) => p.index === selectedIdx);
        if (!selected) return null;
        const address = addresses[selectedIdx];
        const loadingAddress = addressLoadingIdx === selectedIdx;
        const leg = mileageByIndex.get(selected.index);
        return (
          <div className="bg-white rounded-xl border border-[#e31d00]/30 p-4 shadow-sm text-black">
            <p className="font-semibold text-black">
              ● Purchase #{selected.index} · {formatLitres(selected.litres)}
            </p>
            <p className="text-sm mt-1">
              {selected.whenIso ? selected.whenIso.replace("T", " ").slice(0, 19) : "—"}
              {leg?.durationLabel ? ` · fill ${leg.durationLabel}` : ""}
            </p>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <p>
                <span className="block text-xs text-black/60">Mileage</span>
                <span className="font-semibold">{formatKm(leg?.odometerKm, 1)}</span>
              </p>
              <p>
                <span className="block text-xs text-black/60">Distance travelled</span>
                <span className="font-semibold">
                  {leg?.travelledKm != null ? formatKm(leg.travelledKm, 1) : "First fill"}
                </span>
              </p>
              <p>
                <span className="block text-xs text-black/60">Litres used</span>
                <span className="font-semibold">{formatLitres(leg?.litresUsed)}</span>
              </p>
              <p>
                <span className="block text-xs text-black/60">Consumption</span>
                <span className="font-semibold">
                  {leg?.lPer100 != null ? `${leg.lPer100.toFixed(2)} L/100 km` : "—"}
                </span>
              </p>
            </div>
            <p className="text-sm mt-2">
              <span className="font-medium">Address: </span>
              {loadingAddress
                ? "Looking up address…"
                : address ||
                  (selected.lat != null && selected.lon != null
                    ? "Address unavailable"
                    : "No coordinates for this purchase")}
            </p>
            {selected.lat != null && selected.lon != null && selected.mapsUrl ? (
              <a
                href={selected.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-2 text-sm text-[#e31d00] hover:underline font-medium"
              >
                Open map ({selected.lat.toFixed(5)}, {selected.lon.toFixed(5)})
              </a>
            ) : null}
          </div>
        );
      })()}

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm h-[28rem]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div>
            <h3 className="font-semibold text-black">Tank level &amp; real purchases</h3>
            <p className="text-xs text-black/70 mt-0.5">
              Horizontal = Total Mileage (km), same as the downloaded Fuel Graph · Red = tank ·
              Green ● = real fuel bought. Click a green spot for mileage and the address.
            </p>
          </div>
          <p className="text-sm text-black font-medium">
            {purchases.length ? `${purchases.length} real purchase(s)` : "No purchases loaded"}
          </p>
        </div>
        {chartData.length ? (
          <ResponsiveContainer width="100%" height="88%">
            <ComposedChart data={chartData} margin={{ top: 12, right: 12, bottom: 36, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                dataKey="km"
                tick={{ fontSize: 10, fill: "#000" }}
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v: number) => `${Number(v).toFixed(0)}`}
                height={42}
                label={{
                  value: "Total Mileage (km)",
                  position: "insideBottom",
                  offset: -2,
                  fontSize: 11,
                  fill: "#000",
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#000" }}
                domain={["auto", "auto"]}
                label={{ value: "Tank (L)", angle: -90, position: "insideLeft", fontSize: 11, fill: "#000" }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as (typeof chartData)[0];
                  return (
                    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md text-black">
                      <p className="font-semibold text-black mb-1">
                        {row.km.toFixed(1)} km
                        {row.whenIso
                          ? ` · ${row.whenIso.replace("T", " ").slice(0, 19)}`
                          : ""}
                      </p>
                      <p>Tank: {formatLitres(row.tankL)}</p>
                      {row.buyIndex != null && (
                        <>
                          <p className="mt-1 font-semibold text-emerald-700">
                            ● Real purchase #{row.buyIndex}: +{formatLitres(row.buyAmount)}
                            {row.where ? ` · ${row.where}` : ""}
                          </p>
                          {(() => {
                            const leg = mileageByIndex.get(row.buyIndex);
                            if (!leg) return null;
                            return (
                              <p className="mt-1 text-black">
                                Mileage {formatKm(leg.odometerKm, 1)}
                                {leg.travelledKm != null
                                  ? ` · travelled ${formatKm(leg.travelledKm, 1)}`
                                  : " · first fill in this range"}
                              </p>
                            );
                          })()}
                          {addresses[row.buyIndex] ? (
                            <p className="mt-1 text-black">{addresses[row.buyIndex]}</p>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                wrapperStyle={{ fontSize: 12, color: "#000", paddingBottom: 4 }}
              />
              <Line
                type="monotone"
                dataKey="tankL"
                name="Tank level (L)"
                stroke="#e31d00"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Scatter
                dataKey="buyL"
                name="Real fuel bought"
                fill="#059669"
                shape={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: (typeof chartData)[0];
                }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || payload?.buyL == null) return <g />;
                  const hot = selectedIdx === payload.buyIndex;
                  return (
                    <g
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        if (payload.buyIndex != null) void selectPurchase(payload.buyIndex);
                      }}
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={hot ? 10 : 7}
                        fill="#059669"
                        stroke="#fff"
                        strokeWidth={2}
                      />
                      <text
                        x={cx}
                        y={cy - 14}
                        textAnchor="middle"
                        fill="#047857"
                        fontSize={10}
                        fontWeight={700}
                      >
                        +{payload.buyAmount != null ? Math.round(payload.buyAmount) : ""}L
                      </text>
                    </g>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-black/60 text-sm px-6 text-center">
            {loading
              ? "Loading…"
              : "Select a device and date range, then click Show purchases."}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-black">Real fuel bought</h3>
          <p className="text-xs text-black/70 mt-1">
            Time, litres, place, odometer, and kilometres since the previous fill. Click a green
            spot or a row for the address.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-black">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-right px-3 py-2 bg-emerald-50 whitespace-nowrap">Litres</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Tank before</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Tank after</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Mileage</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">Travelled</th>
                <th className="text-left px-3 py-2">Where</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const active = selectedIdx === p.index;
                const leg = mileageByIndex.get(p.index);
                return (
                  <tr
                    key={`${p.starttime}-${p.index}`}
                    className={`border-t border-gray-100 cursor-pointer ${
                      active ? "bg-emerald-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => void selectPurchase(p.index)}
                  >
                    <td className="px-3 py-2 font-semibold text-emerald-700">● {p.index}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.whenIso ? p.whenIso.replace("T", " ").slice(0, 19) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-emerald-700 bg-emerald-50 whitespace-nowrap">
                      {formatLitres(p.litres)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatLitres(p.startOilL)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatLitres(p.endOilL)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatKm(leg?.odometerKm, 1)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {leg?.travelledKm != null ? formatKm(leg.travelledKm, 1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {addresses[p.index] ? (
                        <div className="font-medium text-black mb-1">{addresses[p.index]}</div>
                      ) : addressLoadingIdx === p.index ? (
                        <div className="text-black/60 mb-1">Looking up address…</div>
                      ) : null}
                      <div>
                        {p.lat != null && p.lon != null ? (
                          p.mapsUrl ? (
                            <a
                              href={p.mapsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#e31d00] hover:underline font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Open map ({p.lat.toFixed(5)}, {p.lon.toFixed(5)})
                            </a>
                          ) : (
                            `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
                          )
                        ) : (
                          "Location not available"
                        )}
                      </div>
                      {p.label ? (
                        <div className="text-[11px] text-black/60 mt-0.5">{p.label}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!purchases.length && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-black/60">
                    No real purchases in local data for this vehicle/range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
