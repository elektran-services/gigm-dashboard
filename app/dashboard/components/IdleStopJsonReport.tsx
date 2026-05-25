"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuthToken } from "@/lib/auth";

type IdleStopVehicle = {
  imei: string;
  deviceName: string;
  dailyRollup: {
    idleMinutes: number;
    engineOnMinutes: number;
    idlePercent: number | null;
  } | null;
  stopEvents: unknown[];
  idleEvents: unknown[];
  accOffEvents: unknown[];
  liveSnapshot: { address?: string | null; status?: string | null } | null;
  error: string | null;
};

type IdleStopReport = {
  reportDate: string;
  generatedAt: string;
  deviceCount: number;
  scanErrors: number;
  summary: {
    totalStopEvents: number;
    totalIdleEvents: number;
    totalStopDurationMinutes: number;
    totalIdleDurationMinutes: number;
    vehiclesWithData: number;
  };
  vehicles: IdleStopVehicle[];
};

async function postIdleStopJson(body: Record<string, unknown>) {
  const token = getAuthToken();
  if (!token) throw new Error("Not logged in.");
  const res = await fetch("/api/dashboard/idle-stop-json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token, ...body }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) {
    throw new Error(data.cause || "Failed to load idle/stop report");
  }
  return data;
}

export default function IdleStopJsonReport() {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [report, setReport] = useState<IdleStopReport | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await postIdleStopJson(date ? { date } : {});
      setReport(data as IdleStopReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const listData = await postIdleStopJson({ list: true });
        if (cancelled) return;
        setDates((listData.dates as string[]) || []);
        await loadReport("");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Request failed");
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadReport]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    loadReport(date);
  };

  const handleDownload = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = selectedDate ? `idle_stop_${selectedDate}.json` : "idle_stop_latest.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = (report?.vehicles || []).filter((v) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return v.imei.toLowerCase().includes(q) || v.deviceName.toLowerCase().includes(q);
  });

  const stopCount = (v: IdleStopVehicle) =>
    Array.isArray(v.stopEvents) ? v.stopEvents.length : 0;
  const idleCount = (v: IdleStopVehicle) =>
    Array.isArray(v.idleEvents) ? v.idleEvents.length : 0;
  const accOffCount = (v: IdleStopVehicle) =>
    Array.isArray(v.accOffEvents) ? v.accOffEvents.length : 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Idle / Stop Report</h2>
            <p className="text-sm text-gray-600 mt-1">
              Daily idle and stop snapshots from{" "}
              <span className="font-mono text-xs">idle_stop_json/</span>. Report day is typically
              the previous calendar day.
            </p>
          </div>
          {report && (
            <button
              type="button"
              onClick={handleDownload}
              className="shrink-0 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Download JSON
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Report date</label>
            <select
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#e31d00] focus:border-[#e31d00]"
            >
              <option value="">Latest snapshot</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search vehicle</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="IMEI or device name…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#e31d00] focus:border-[#e31d00]"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">
            {error}
          </div>
        )}

        {report && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {[
              { label: "Report day", value: report.reportDate },
              { label: "Devices", value: String(report.deviceCount) },
              { label: "Stop events", value: String(report.summary.totalStopEvents) },
              { label: "Idle events", value: String(report.summary.totalIdleEvents) },
              {
                label: "Stop time (min)",
                value: String(Math.round(report.summary.totalStopDurationMinutes)),
              },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2"
              >
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-lg font-semibold text-gray-900 tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Device</th>
                <th className="px-4 py-3 font-medium">Stops</th>
                <th className="px-4 py-3 font-medium">Idle</th>
                <th className="px-4 py-3 font-medium">ACC off</th>
                <th className="px-4 py-3 font-medium">Daily idle (min)</th>
                <th className="px-4 py-3 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No vehicles in this report.
                  </td>
                </tr>
              ) : (
                filtered.map((v) => (
                  <tr key={v.imei} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{v.deviceName}</p>
                      <p className="text-xs font-mono text-gray-500">{v.imei}</p>
                      {v.error && <p className="text-xs text-red-600 mt-0.5">{v.error}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">{stopCount(v)}</td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">{idleCount(v)}</td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">{accOffCount(v)}</td>
                    <td className="px-4 py-3 text-gray-700 tabular-nums">
                      {v.dailyRollup?.idleMinutes != null
                        ? Math.round(v.dailyRollup.idleMinutes)
                        : "—"}
                      {v.dailyRollup?.idlePercent != null && (
                        <span className="text-xs text-gray-500 ml-1">
                          ({v.dailyRollup.idlePercent.toFixed(0)}%)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                      {v.liveSnapshot?.address || v.liveSnapshot?.status || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {report?.generatedAt && (
          <p className="text-xs text-gray-400 mt-3">
            Generated {new Date(report.generatedAt).toLocaleString()}
            {report.scanErrors > 0 && (
              <span className="text-amber-600 ml-2">· {report.scanErrors} scan error(s)</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
