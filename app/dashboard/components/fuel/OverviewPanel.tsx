"use client";

import { useEffect, useState } from "react";
import { apiCallWithAutoRefresh, formatKm, formatLitres, ymdDaysAgo, todayYmd } from "@/lib/utils";
import DeviceFilters from "./DeviceFilters";
import { useDevices } from "./useDevices";

interface PositionRecord {
  deviceid: string;
  oilL: number | null;
  tank1L: number | null;
  distanceKm: number | null;
  speedKmh: number | null;
  statusen: string;
  oiladstr: string;
  voltage: number;
  moving: number;
  updatetime: number;
}

interface DailySummary {
  avgoilper100km: number | null;
  avgoilperhour: number | null;
  currenttotaloilL: number | null;
  days: Array<{
    statisticsday: string;
    distanceKm: number | null;
    usedOilL: number | null;
    addOilL: number | null;
    leakOilL: number | null;
    oilper100km: number | null;
  }>;
}

export default function OverviewPanel() {
  const {
    filtered,
    searchQuery,
    setSearchQuery,
    loading: loadingDevices,
    error: deviceError,
    exactImei,
  } = useDevices();
  const [selectedDevice, setSelectedDevice] = useState("");
  const [startDate, setStartDate] = useState(ymdDaysAgo(7));
  const [endDate, setEndDate] = useState(todayYmd());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<PositionRecord | null>(null);
  const [daily, setDaily] = useState<DailySummary | null>(null);

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
      const [posData, dailyData] = await Promise.all([
        apiCallWithAutoRefresh("/api/lastposition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceids: [selectedDevice] }),
        }),
        apiCallWithAutoRefresh("/api/fuel/daily", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            devices: [selectedDevice],
            startday: startDate,
            endday: endDate,
          }),
        }),
      ]);

      if (posData.status !== 0) throw new Error(String(posData.cause || "Position failed"));
      if (dailyData.status !== 0) throw new Error(String(dailyData.cause || "Daily fuel failed"));

      const records = (posData.records as PositionRecord[]) || [];
      setPosition(records[0] || null);
      const devices = (dailyData.devices as DailySummary[]) || [];
      setDaily(devices[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overview");
      setPosition(null);
      setDaily(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDevice) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  const exportExcel = async () => {
    if (!selectedDevice) return;
    setExporting(true);
    setError("");
    try {
      const res = await fetch("/api/fuel/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devices: [selectedDevice],
          startday: startDate,
          endday: endDate,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        throw new Error(String(data.cause || "Excel export failed"));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fuel_raw_${startDate}_to_${endDate}_${selectedDevice}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Excel export failed");
    } finally {
      setExporting(false);
    }
  };

  const periodDistance = daily?.days.reduce((s, d) => s + (d.distanceKm || 0), 0) ?? 0;
  const periodUsed = daily?.days.reduce((s, d) => s + (d.usedOilL || 0), 0) ?? 0;
  const periodAdd = daily?.days.reduce((s, d) => s + (d.addOilL || 0), 0) ?? 0;
  const periodLeak = daily?.days.reduce((s, d) => s + (d.leakOilL || 0), 0) ?? 0;

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
        submitLabel="Refresh"
        onExportExcel={exportExcel}
        exporting={exporting}
      />

      {(error || deviceError) && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error || deviceError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Current fuel" value={formatLitres(position?.oilL ?? daily?.currenttotaloilL)} hint={position?.oiladstr || "Live tank"} />
        <StatCard label="Odometer" value={formatKm(position?.distanceKm)} hint={position?.statusen || "Last position"} />
        <StatCard label="Period distance" value={formatKm(periodDistance)} hint={`${startDate} → ${endDate}`} />
        <StatCard label="Avg L/100km" value={daily?.avgoilper100km != null ? `${daily.avgoilper100km.toFixed(2)}` : "—"} hint={`Used ${formatLitres(periodUsed)} · Refuel ${formatLitres(periodAdd)} · Leak ${formatLitres(periodLeak)}`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent daily fuel</h3>
          <span className="text-xs text-gray-500">{daily?.days.length || 0} days</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Day</th>
                <th className="text-right px-4 py-2 font-medium">Distance</th>
                <th className="text-right px-4 py-2 font-medium">Used</th>
                <th className="text-right px-4 py-2 font-medium">Refuel</th>
                <th className="text-right px-4 py-2 font-medium">Leak</th>
                <th className="text-right px-4 py-2 font-medium">L/100km</th>
              </tr>
            </thead>
            <tbody>
              {(daily?.days || []).slice().reverse().map((day) => (
                <tr key={day.statisticsday} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-900">{day.statisticsday}</td>
                  <td className="px-4 py-2 text-right">{formatKm(day.distanceKm)}</td>
                  <td className="px-4 py-2 text-right">{formatLitres(day.usedOilL)}</td>
                  <td className="px-4 py-2 text-right text-emerald-700">{formatLitres(day.addOilL)}</td>
                  <td className="px-4 py-2 text-right text-red-700">{formatLitres(day.leakOilL)}</td>
                  <td className="px-4 py-2 text-right">{day.oilper100km?.toFixed(2) ?? "—"}</td>
                </tr>
              ))}
              {!daily?.days?.length && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No daily fuel rows for this range.
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

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-2 truncate" title={hint}>{hint}</p>
    </div>
  );
}
