"use client";

import { useEffect, useState } from "react";
import { apiCallWithAutoRefresh, formatLitres, todayYmd, ymdDaysAgo } from "@/lib/utils";
import DeviceFilters from "./DeviceFilters";
import { useDevices } from "./useDevices";

interface FuelEvent {
  startIso: string;
  endIso: string;
  startOilL: number | null;
  endOilL: number | null;
  deltaL: number | null;
  oilstate: number;
  oilIndex: number;
  lat: number | null;
  lon: number | null;
  kind: "refuel" | "leak" | "other";
}

export default function EventsPanel() {
  const {
    filtered,
    searchQuery,
    setSearchQuery,
    loading: loadingDevices,
    error: deviceError,
    exactImei,
  } = useDevices();
  const [selectedDevice, setSelectedDevice] = useState("");
  const [startDate, setStartDate] = useState(ymdDaysAgo(30));
  const [endDate, setEndDate] = useState(todayYmd());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<FuelEvent[]>([]);
  const [counts, setCounts] = useState({ refuelCount: 0, leakCount: 0 });
  const [filter, setFilter] = useState<"all" | "refuel" | "leak">("all");

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
      const preferred = filtered.find((d) => d.deviceid === "16075080062");
      setSelectedDevice(preferred?.deviceid || filtered[0].deviceid);
    }
  }, [filtered, selectedDevice, exactImei]);

  const load = async () => {
    if (!selectedDevice) return;
    setLoading(true);
    setError("");
    try {
      const oilstate = filter === "refuel" ? 1 : filter === "leak" ? -1 : 99;
      const data = await apiCallWithAutoRefresh("/api/fuel/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devices: [selectedDevice],
          startday: startDate,
          endday: endDate,
          oilindex: 99,
          oilstate,
        }),
      });
      if (data.status !== 0) throw new Error(String(data.cause || "Events failed"));
      const device = ((data.devices as Array<Record<string, unknown>>) || [])[0];
      setEvents((device?.events as FuelEvent[]) || []);
      setCounts({
        refuelCount: Number(device?.refuelCount || 0),
        leakCount: Number(device?.leakCount || 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <DeviceFilters
        devices={filtered}
        selectedDevice={selectedDevice}
        onDeviceChange={setSelectedDevice}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onSubmit={load}
        loading={loading || loadingDevices}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        submitLabel="Load events"
      />

      <div className="flex flex-wrap gap-2">
        {(["all", "refuel", "leak"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
              filter === f
                ? "bg-[#F59E0B] border-[#F59E0B] text-gray-900"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {f === "all" ? "All events" : f === "refuel" ? "Refuels" : "Leaks"}
          </button>
        ))}
      </div>

      {(error || deviceError) && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error || deviceError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs uppercase text-gray-500">Refuels</p>
          <p className="text-2xl font-bold text-emerald-700">{counts.refuelCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs uppercase text-gray-500">Leaks</p>
          <p className="text-2xl font-bold text-red-700">{counts.leakCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-left px-4 py-2">Start</th>
                <th className="text-right px-4 py-2">Start oil</th>
                <th className="text-right px-4 py-2">End oil</th>
                <th className="text-right px-4 py-2">Delta</th>
                <th className="text-right px-4 py-2">Tank</th>
                <th className="text-left px-4 py-2">Location</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, idx) => (
                <tr key={`${e.startIso}-${idx}`} className="border-t border-gray-100">
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                        e.kind === "refuel"
                          ? "bg-emerald-50 text-emerald-700"
                          : e.kind === "leak"
                            ? "bg-red-50 text-red-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {e.kind}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {e.startIso ? e.startIso.replace("T", " ").slice(0, 19) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{formatLitres(e.startOilL)}</td>
                  <td className="px-4 py-2 text-right">{formatLitres(e.endOilL)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatLitres(e.deltaL)}</td>
                  <td className="px-4 py-2 text-right">{e.oilIndex}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {e.lat != null && e.lon != null ? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` : "—"}
                  </td>
                </tr>
              ))}
              {!events.length && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No refuel/leak events for this range.
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
