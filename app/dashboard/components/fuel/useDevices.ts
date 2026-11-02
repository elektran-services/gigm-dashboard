"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthToken, getUserData } from "@/lib/auth";
import { apiCallWithAutoRefresh } from "@/lib/utils";
import type { DeviceOption } from "./DeviceFilters";

export function useDevices() {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = getAuthToken();
      const user = getUserData();
      if (!token || !user?.username) {
        setError("Not logged in");
        setDevices([]);
        return;
      }

      const data = await apiCallWithAutoRefresh("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, token }),
      });

      if (data.status === 0 && Array.isArray(data.groups)) {
        const all = (data.groups as Array<{ devices?: Array<Record<string, unknown>> }>).flatMap(
          (group) =>
            (group.devices || []).map((device) => ({
              deviceid: String(device.deviceid || ""),
              name: String(device.devicename || device.deviceid || ""),
            }))
        );
        const seen = new Set<string>();
        const unique = all.filter((d) => {
          if (!d.deviceid || seen.has(d.deviceid)) return false;
          seen.add(d.deviceid);
          return true;
        });
        setDevices(unique);
      } else {
        setError(String(data.cause || "Failed to load devices"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) => d.deviceid.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
    );
  }, [devices, searchQuery]);

  const exactImei = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    return devices.find((d) => d.deviceid === q)?.deviceid ?? null;
  }, [devices, searchQuery]);

  return {
    devices,
    filtered,
    searchQuery,
    setSearchQuery,
    loading,
    error,
    refresh: fetchDevices,
    exactImei,
    deviceCount: devices.length,
  };
}
