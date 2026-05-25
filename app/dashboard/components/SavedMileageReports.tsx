"use client";

import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/auth";

type ReportFile = {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
};

type MileageCategory = "daily" | "monthly";

async function fetchMileageReportsList(
  category: MileageCategory,
  filters: { date?: string; from?: string; to?: string }
) {
  const token = getAuthToken();
  if (!token) throw new Error("Not logged in.");
  const res = await fetch("/api/mileage-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      token,
      category,
      ...(filters.date?.trim() ? { date: filters.date.trim() } : {}),
      ...(filters.from?.trim() ? { from: filters.from.trim() } : {}),
      ...(filters.to?.trim() ? { to: filters.to.trim() } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) {
    throw new Error(data.cause || "Failed to load mileage reports");
  }
  return data as { files: ReportFile[]; retentionDays?: number };
}

export default function SavedMileageReports() {
  const [activeTab, setActiveTab] = useState<MileageCategory>("daily");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [retentionDays, setRetentionDays] = useState(365);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const applyFilters = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMileageReportsList(activeTab, { date, from, to });
      setFiles(data.files || []);
      if (typeof data.retentionDays === "number") setRetentionDays(data.retentionDays);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMileageReportsList(activeTab, {});
        if (!cancelled) {
          setFiles(data.files || []);
          if (typeof data.retentionDays === "number") setRetentionDays(data.retentionDays);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Request failed");
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const handleDownload = async (filename: string) => {
    const token = getAuthToken();
    if (!token) return;
    setDownloading(filename);
    setError(null);
    try {
      const url = `/api/mileage-reports/download?category=${activeTab}&file=${encodeURIComponent(filename)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.cause || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  const formatSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Mileage Report</h2>
          <p className="text-sm text-gray-600 mt-1">
            Download saved mileage reports from local storage. Files are kept for{" "}
            <span className="font-medium text-gray-800">{retentionDays} days</span>.
          </p>
        </div>

        <div className="border-b border-gray-200 mb-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("daily")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                activeTab === "daily"
                  ? "bg-[#e31d00] text-gray-900"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Daily Mileage Reports
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("monthly")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                activeTab === "monthly"
                  ? "bg-[#e31d00] text-gray-900"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Monthly Mileage Reports
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Exact date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#e31d00] focus:border-[#e31d00]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#e31d00] focus:border-[#e31d00]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#e31d00] focus:border-[#e31d00]"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#e31d00] text-gray-900 font-medium text-sm hover:bg-[#c41900] disabled:opacity-50"
            >
              {loading ? "Loading..." : "Apply filters"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDate("");
                setFrom("");
                setTo("");
                applyFilters();
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">{error}</div>
        )}

        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Report date</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Modified</th>
                <th className="px-4 py-3 font-medium w-32"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {files.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No mileage reports match your filters.
                  </td>
                </tr>
              ) : (
                files.map((f) => (
                  <tr key={f.filename} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 font-mono text-xs break-all">{f.filename}</td>
                    <td className="px-4 py-3 text-gray-700">{f.reportDate || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{formatSize(f.size)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{new Date(f.modifiedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(f.filename)}
                        disabled={downloading === f.filename}
                        className="text-[#e31d00] hover:text-[#c41900] font-medium text-xs disabled:opacity-50"
                      >
                        {downloading === f.filename ? "..." : "Download"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
