"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuthToken } from "@/lib/auth";

type MaintenanceDetail = {
  status?: string;
  atThreshold?: boolean;
  remainingKm?: number;
};

type MileageVehicle = {
  imei: string;
  deviceName: string;
  currentOdometerKm: number | null;
  location?: { address?: string | null; status?: string | null } | null;
  scheduledMaintenance: MaintenanceDetail | null;
  preventiveMaintenance: MaintenanceDetail | null;
  error: string | null;
};

type MileageReport = {
  asOfDate: string;
  generatedAt: string;
  deviceCount: number;
  summary: {
    atScheduledMaintenance: number;
    atPreventiveMaintenance: number;
    scheduledAlmostDue: number;
    preventiveAlmostDue: number;
  };
  vehicles: MileageVehicle[];
};

function statusBadge(status?: string, atThreshold?: boolean) {
  if (atThreshold) return "bg-red-100 text-red-800";
  if (status === "almost") return "bg-amber-100 text-amber-800";
  if (status === "due") return "bg-orange-100 text-orange-800";
  return "bg-emerald-100 text-emerald-800";
}

async function postMileageJson(body: Record<string, unknown>) {
  const token = getAuthToken();
  if (!token) throw new Error("Not logged in.");
  const res = await fetch("/api/dashboard/mileage-json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token, ...body }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) {
    throw new Error(data.cause || "Failed to load mileage report");
  }
  return data;
}

export default function MileageJsonReport() {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [report, setReport] = useState<MileageReport | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await postMileageJson(date ? { date } : {});
      setReport(data as MileageReport);
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
        const listData = await postMileageJson({ list: true });
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
    a.download = selectedDate ? `mileage_${selectedDate}.json` : "mileage_latest.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = (report?.vehicles || []).filter((v) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return v.imei.toLowerCase().includes(q) || v.deviceName.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Mileage Report</h2>
            <p className="text-sm text-gray-600 mt-1">
              Daily fleet maintenance snapshots from{" "}
              <span className="font-mono text-xs">mileage_json/</span>. Scheduled service at 5,000
              km; preventive at 10,000 km.
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
              { label: "As of", value: report.asOfDate },
              { label: "Devices", value: String(report.deviceCount) },
              { label: "At 5k km", value: String(report.summary.atScheduledMaintenance) },
              { label: "Almost 5k", value: String(report.summary.scheduledAlmostDue) },
              { label: "At 10k km", value: String(report.summary.atPreventiveMaintenance) },
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
                <th className="px-4 py-3 font-medium">Odometer (km)</th>
                <th className="px-4 py-3 font-medium">5k service</th>
                <th className="px-4 py-3 font-medium">10k service</th>
                <th className="px-4 py-3 font-medium">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
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
                    <td className="px-4 py-3 text-gray-700 tabular-nums">
                      {v.currentOdometerKm != null
                        ? v.currentOdometerKm.toLocaleString(undefined, {
                            maximumFractionDigits: 1,
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {v.scheduledMaintenance ? (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadge(
                            v.scheduledMaintenance.status,
                            v.scheduledMaintenance.atThreshold
                          )}`}
                        >
                          {v.scheduledMaintenance.atThreshold
                            ? "Due"
                            : v.scheduledMaintenance.status || "good"}
                          {v.scheduledMaintenance.remainingKm != null &&
                            ` · ${Math.round(v.scheduledMaintenance.remainingKm)} km left`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {v.preventiveMaintenance ? (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadge(
                            v.preventiveMaintenance.status,
                            v.preventiveMaintenance.atThreshold
                          )}`}
                        >
                          {v.preventiveMaintenance.atThreshold
                            ? "Due"
                            : v.preventiveMaintenance.status || "good"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                      {v.location?.address || v.location?.status || "—"}
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
          </p>
        )}
      </div>
    </div>
  );
}
