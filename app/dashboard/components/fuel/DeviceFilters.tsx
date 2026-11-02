"use client";

export interface DeviceOption {
  deviceid: string;
  name: string;
}

interface Props {
  devices: DeviceOption[];
  selectedDevice: string;
  onDeviceChange: (id: string) => void;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  onStartDateChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onStartTimeChange?: (v: string) => void;
  onEndTimeChange?: (v: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  submitLabel?: string;
  onExportExcel?: () => void;
  exporting?: boolean;
}

const inputClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black outline-none focus:ring-2 focus:ring-[#e31d00] focus:border-[#e31d00] bg-white";

export default function DeviceFilters({
  devices,
  selectedDevice,
  onDeviceChange,
  startDate,
  endDate,
  startTime,
  endTime,
  onStartDateChange,
  onEndDateChange,
  onStartTimeChange,
  onEndTimeChange,
  onSubmit,
  loading,
  searchQuery,
  onSearchChange,
  submitLabel = "Load report",
  onExportExcel,
  exporting,
}: Props) {
  const showTime = Boolean(onStartTimeChange && onEndTimeChange);
  const canSubmit =
    Boolean(selectedDevice && startDate && endDate) &&
    (!showTime || Boolean(startTime && endTime));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <div className="xl:col-span-2">
          <label className="block text-xs font-medium text-black mb-1">
            Search : IMEI or Plate Number
          </label>
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="e.g. 358657103711920"
            className={`${inputClass} font-mono placeholder:text-black/40`}
          />
        </div>
        <div className="xl:col-span-2">
          <label className="block text-xs font-medium text-black mb-1">
            Device ({devices.length} match{devices.length === 1 ? "" : "es"})
          </label>
          <select
            value={selectedDevice}
            onChange={(e) => onDeviceChange(e.target.value)}
            className={inputClass}
          >
            <option value="">Select device…</option>
            {devices.map((d) => (
              <option key={d.deviceid} value={d.deviceid}>
                {d.deviceid} — {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className={inputClass}
          />
          {showTime && (
            <input
              type="time"
              value={startTime ?? "00:00"}
              onChange={(e) => onStartTimeChange?.(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">To</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className={inputClass}
          />
          {showTime && (
            <input
              type="time"
              value={endTime ?? "23:59"}
              onChange={(e) => onEndTimeChange?.(e.target.value)}
              className={`${inputClass} mt-1`}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSubmit}
          disabled={loading || !canSubmit}
          className="bg-[#e31d00] hover:bg-[#c41900] text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50 border border-[#e31d00]/30"
        >
          {loading ? "Loading…" : submitLabel}
        </button>
        {onExportExcel && (
          <button
            onClick={onExportExcel}
            disabled={exporting || loading || !selectedDevice}
            className="border border-gray-300 hover:bg-gray-50 text-black font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Excel"}
          </button>
        )}
      </div>
    </div>
  );
}
