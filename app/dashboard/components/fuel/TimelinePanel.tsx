"use client";

import { useEffect, useState } from "react";
import { todayYmd, ymdDaysAgo } from "@/lib/utils";
import DeviceFilters from "./DeviceFilters";
import {
  RawTankGraph,
  RealRefuelsTable,
  useRawFuelLoad,
} from "./RawFuelAnalysis";
import { useDevices } from "./useDevices";

/** Same raw-analysis graph as Daily Fuel — dedicated Fuel Additions entry. */
export default function TimelinePanel() {
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
  const [minJumpL, setMinJumpL] = useState(10);

  const {
    raw,
    loading: rawLoading,
    error: rawError,
    info: rawInfo,
    selectedRefuel,
    setSelectedRefuel,
    load: loadRaw,
    cachedReports,
    refreshCacheList,
  } = useRawFuelLoad();

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
    void refreshCacheList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedDevice || !cachedReports.length) return;
    const hit = cachedReports.find((r) => r.devices.includes(selectedDevice));
    if (hit?.startday && hit?.endday) {
      setStartDate(hit.startday);
      setEndDate(hit.endday);
    }
  }, [selectedDevice, cachedReports]);

  const load = async () => {
    if (!selectedDevice) return;
    await loadRaw({
      deviceid: selectedDevice,
      startday: startDate,
      endday: endDate,
      minJumpL,
      refreshLive: false,
    });
  };

  const fetchLive = async () => {
    if (!selectedDevice) return;
    if (
      !window.confirm(
        "Fetch LIVE reportoiltime from GPS51?\n\nThis burns account/history quota. Prefer Load from cache."
      )
    ) {
      return;
    }
    await loadRaw({
      deviceid: selectedDevice,
      startday: startDate,
      endday: endDate,
      minJumpL,
      refreshLive: true,
    });
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
        loading={rawLoading || loadingDevices}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        submitLabel="Load from cache"
        deviceCount={deviceCount}
      />

      {cachedReports.length > 0 && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          <p className="font-medium mb-1">Saved reports on disk (no GPS51 call)</p>
          <ul className="text-xs space-y-1">
            {cachedReports.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => {
                    if (r.devices[0]) setSelectedDevice(r.devices[0]);
                    if (r.startday) setStartDate(r.startday);
                    if (r.endday) setEndDate(r.endday);
                  }}
                >
                  {r.devices[0]} · {r.startday} → {r.endday} · {r.age}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
        <label className="inline-flex items-center gap-2">
          Min real refill (L)
          <input
            type="number"
            min={1}
            step={1}
            value={minJumpL}
            onChange={(e) => setMinJumpL(Number(e.target.value) || 10)}
            className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm"
          />
        </label>
        {raw && (
          <span className="text-gray-500">
            <span className="font-semibold text-emerald-700">
              {raw.additions.length} real refuel(s)
            </span>
            {raw.sloshRejected > 0 ? (
              <>
                {" "}
                · <span className="text-red-600">{raw.sloshRejected} slosh filtered</span>
              </>
            ) : null}
          </span>
        )}
        <button
          type="button"
          onClick={fetchLive}
          disabled={!selectedDevice || rawLoading}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Fetch live from GPS51
        </button>
      </div>

      {(rawError || deviceError) && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {rawError || deviceError}
        </div>
      )}
      {rawInfo && !rawError && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          {rawInfo}
        </div>
      )}

      <RawTankGraph
        device={raw}
        selectedRefuel={selectedRefuel}
        onSelectRefuel={setSelectedRefuel}
      />

      <RealRefuelsTable
        additions={raw?.additions || []}
        selectedRefuel={selectedRefuel}
        onSelectRefuel={setSelectedRefuel}
        loading={rawLoading}
      />
    </div>
  );
}
