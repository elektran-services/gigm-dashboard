"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevices } from "./useDevices";

type CacheRow = {
  key: string;
  action: string;
  devices: string[];
  startday?: string;
  endday?: string;
  age: string;
  ageMs: number;
  savedAt: number;
  sizeBytes: number;
};

type KindFilter = "all" | "reportoiltime" | "reportoildaily" | "reportoilrecord";

function kindLabel(action: string): string {
  if (action === "reportoiltime") return "Fuel track";
  if (action === "reportoildaily") return "Daily fuel";
  if (action === "reportoilrecord") return "Refuel events";
  return action;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export default function FuelReportsPanel() {
  const { devices, loading: loadingDevices } = useDevices();
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) map.set(d.deviceid, d.name);
    return map;
  }, [devices]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/fuel/cache");
      const data = await res.json();
      if (data.status !== 0) {
        throw new Error(data.cause || data.message || "Failed to list reports");
      }
      const next: CacheRow[] = [
        ...((data.oiltime as CacheRow[]) || []).map((r) => ({ ...r, action: "reportoiltime" })),
        ...((data.oildaily as CacheRow[]) || []).map((r) => ({ ...r, action: "reportoildaily" })),
        ...((data.oilrecord as CacheRow[]) || []).map((r) => ({ ...r, action: "reportoilrecord" })),
      ].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      setRows(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list reports");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind !== "all" && r.action !== kind) return false;
      if (deviceFilter && !r.devices.includes(deviceFilter)) return false;
      return true;
    });
  }, [rows, kind, deviceFilter]);

  const download = async (row: CacheRow, format: "xlsx" | "json") => {
    setDownloadingKey(`${row.key}:${format}`);
    setError("");
    try {
      const res = await fetch(
        `/api/fuel/cache/download?key=${encodeURIComponent(row.key)}&format=${format}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.cause || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] ||
        `${row.action}_${row.devices[0] || "device"}_${row.startday || "start"}.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloadingKey(null);
    }
  };

  const deviceOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) for (const id of r.devices) ids.add(id);
    return [...ids].sort();
  }, [rows]);

  return (
    <div className="space-y-4 text-black">
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-black">Saved raw reports</h2>
            <p className="text-sm text-black/70 mt-0.5">
              Local GPS51 files only. View what is on this server and download Excel or JSON — no
              live GPS51 call.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="bg-[#e31d00] hover:bg-[#c41900] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh list"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Report type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as KindFilter)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black bg-white"
            >
              <option value="all">All types</option>
              <option value="reportoiltime">Fuel track (reportoiltime)</option>
              <option value="reportoildaily">Daily fuel (reportoildaily)</option>
              <option value="reportoilrecord">Refuel events (reportoilrecord)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Vehicle</label>
            <select
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black bg-white"
            >
              <option value="">All vehicles</option>
              {deviceOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                  {nameById.get(id) ? ` — ${nameById.get(id)}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <p className="text-sm text-black/70">
              {loading || loadingDevices
                ? "Loading…"
                : `${filtered.length} report${filtered.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-black">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Vehicle</th>
                <th className="text-left px-3 py-2">Date range</th>
                <th className="text-left px-3 py-2">Saved</th>
                <th className="text-right px-3 py-2">Size</th>
                <th className="text-right px-3 py-2">Download</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const deviceid = row.devices[0] || "—";
                const name = nameById.get(deviceid);
                const busy = downloadingKey?.startsWith(row.key);
                return (
                  <tr key={row.key} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-medium">{kindLabel(row.action)}</span>
                      <div className="text-[11px] text-black/50 font-mono">{row.action}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{deviceid}</div>
                      {name ? <div className="text-black/70">{name}</div> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.startday && row.endday
                        ? row.startday === row.endday
                          ? row.startday
                          : `${row.startday} → ${row.endday}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>{formatSavedAt(row.savedAt)}</div>
                      <div className="text-[11px] text-black/50">{row.age} ago</div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {formatBytes(row.sizeBytes)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void download(row, "xlsx")}
                          className="px-3 py-1.5 rounded-lg bg-[#e31d00] text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {downloadingKey === `${row.key}:xlsx` ? "…" : "Excel"}
                        </button>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => void download(row, "json")}
                          className="px-3 py-1.5 rounded-lg border border-gray-300 text-black text-xs font-semibold disabled:opacity-50 hover:bg-gray-50"
                        >
                          {downloadingKey === `${row.key}:json` ? "…" : "JSON"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !filtered.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-black/60">
                    No saved reports on this server yet. The nightly fuel job writes them under
                    .cache/gps51.
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
