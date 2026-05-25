"use client";

import { useEffect, useState } from "react";
import { getAuthToken, getUserData } from "@/lib/auth";
import { buildHereReverseGeocodeUrl } from "@/lib/config";
import { apiCallWithAutoRefresh } from "@/lib/utils";

// Address cell component
function AddressCell({ lat, lon }: { lat: number; lon: number }) {
  const [address, setAddress] = useState<string>(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchAddress = async () => {
      try {
        const response = await fetch(buildHereReverseGeocodeUrl(lat, lon));

        if (response.ok && mounted) {
          const data = await response.json();
          if (data.items && data.items.length > 0 && data.items[0].address.label) {
            setAddress(data.items[0].address.label);
          }
        }
      } catch (error) {
        console.error('Error fetching address:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    // Add a small delay to avoid rate limiting
    const timer = setTimeout(fetchAddress, Math.random() * 500);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [lat, lon]);

  return (
    <div className="max-w-xs">
      {isLoading ? (
        <span className="text-gray-400 text-xs">Loading...</span>
      ) : (
        <span className="text-xs text-gray-600" title={address}>
          {address}
        </span>
      )}
    </div>
  );
}

interface AlarmRecord {
  devicealarmid: string;
  deviceid: string;
  username: string;
  userstrid: string;
  devicetime: number;
  updatetime: number;
  arrivedtime: number;
  lon: number;
  lat: number;
  alt: number;
  speed: number;
  course: number;
  alarmtype: number;
  alarm: number;
  alarmbitsstr: string;
  stralarm: string;
  stralarmen: string;
  temperature: number;
  oil: number;
  lastruntime: number;
  totalmileage: number;
  mileage: number;
  startalarmtime: number;
  lastalarmtime: number;
  alarmcount: number;
  disposeperson: string | null;
  disposetime: number;
  disposeway: string | null;
  disposecontent: string | null;
  disposestatus: number;
  notifytype: string;
  notifyresult: string | null;
  aggregate: number;
  lastsavetodb: number;
  commitedtodb: boolean;
  lastpushtime: number;
  av: number;
}

interface AlarmResponse {
  status: number;
  cause: string;
  alarmrecords: AlarmRecord[];
  addressmap: any;
}

interface Device {
  deviceid: string;
  devicename: string;
}

interface Group {
  groupid: number;
  groupname: string;
  devices: Device[];
}


export default function AlarmList() {
  const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [allDevices, setAllDevices] = useState<Device[]>([]);

  // Filter states
  const [filterType, setFilterType] = useState<"all" | "group" | "device">("all");
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7); // Default to 7 days ago
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Search by name/IMEI
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, selectedGroup, selectedDevice, startDate, endDate]);

  const fetchDevices = async () => {
    try {
      const token = getAuthToken();
      const userData = getUserData();

      if (!token || !userData) return;

      const data = await apiCallWithAutoRefresh("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: userData.username,
          token: token,
        }),
      });

      if (data.status === 0 && data.groups) {
        setGroups(data.groups);
        
        // Flatten all devices
        const devices: Device[] = [];
        data.groups.forEach((group: Group) => {
          group.devices.forEach((device: Device) => {
            devices.push({
              deviceid: device.deviceid,
              devicename: device.devicename,
            });
          });
        });
        setAllDevices(devices);
      }
    } catch (err) {
      console.error("Error fetching devices:", err);
    }
  };

  const fetchAlarms = async () => {
    setIsLoading(true);
    setError("");

    try {
      const token = getAuthToken();
      const userData = getUserData();

      if (!token || !userData) {
        setError("Authentication required");
        return;
      }

      // Determine which devices to query
      let deviceIds: string[] = [];
      
      if (filterType === "all") {
        deviceIds = allDevices.map(d => d.deviceid);
      } else if (filterType === "group" && selectedGroup) {
        const group = groups.find(g => g.groupid === selectedGroup);
        if (group) {
          deviceIds = group.devices.map(d => d.deviceid);
        }
      } else if (filterType === "device" && selectedDevice) {
        deviceIds = [selectedDevice];
      }

      if (deviceIds.length === 0) {
        setError("Please select at least one device");
        return;
      }

      console.log('Fetching alarms for devices:', deviceIds);

      const data: AlarmResponse = await apiCallWithAutoRefresh("/api/alarms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devices: deviceIds,
          startday: startDate,
          endday: endDate,
          offset: 1,
          needalarm: "5",
          token: token,
        }),
      });

      if (data.status === 0) {
        setAlarms(data.alarmrecords || []);
      } else {
        setError(data.cause || "Failed to fetch alarms");
      }
    } catch (err) {
      console.error("Error fetching alarms:", err);
      setError("An error occurred while fetching alarms");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getDeviceName = (deviceId: string) => {
    const device = allDevices.find(d => d.deviceid === deviceId);
    return device ? device.devicename : deviceId;
  };

  const getAlarmTypeColor = (stralarmen: string) => {
    const lowerAlarm = stralarmen.toLowerCase();
    if (lowerAlarm.includes('offline')) return 'bg-gray-100 text-gray-800';
    if (lowerAlarm.includes('online')) return 'bg-green-100 text-green-800';
    if (lowerAlarm.includes('speed')) return 'bg-red-100 text-red-800';
    if (lowerAlarm.includes('sos') || lowerAlarm.includes('panic')) return 'bg-red-100 text-red-800';
    return 'bg-blue-100 text-blue-800';
  };


  // Filter alarms by search term (name or IMEI)
  const filteredAlarms = searchTerm.trim()
    ? alarms.filter(alarm => {
        const name = getDeviceName(alarm.deviceid).toLowerCase();
        const imei = alarm.deviceid.toLowerCase();
        const term = searchTerm.toLowerCase();
        return name.includes(term) || imei.includes(term);
      })
    : alarms;

  // Pagination
  const totalAlarms = filteredAlarms.length;
  const totalPages = Math.ceil(totalAlarms / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentAlarms = filteredAlarms.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const exportToCSV = () => {
    if (alarms.length === 0) {
      alert('No data to export');
      return;
    }

    // Define CSV headers
    const headers = ['#', 'Device Name', 'IMEI', 'Alarm Type', 'Time', 'Latitude', 'Longitude', 'Speed (km/h)', 'Status'];
    
    // Create CSV rows
    const rows = alarms.map((alarm, index) => [
      index + 1,
      getDeviceName(alarm.deviceid),
      alarm.deviceid,
      alarm.stralarmen,
      formatDate(alarm.devicetime),
      alarm.lat.toFixed(6),
      alarm.lon.toFixed(6),
      alarm.speed.toFixed(1),
      alarm.disposestatus === 0 ? 'Pending' : 'Resolved'
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `alarm_report_${startDate}_to_${endDate}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Alarm Reports</h2>
          <p className="text-sm text-gray-600 mt-0.5">View and manage device alarms</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={alarms.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Filters</h3>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-3">
          <div className="w-full sm:w-1/4 min-w-50">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Search by Name or IMEI</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Enter device name or IMEI"
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              />
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                className="px-3 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors font-medium"
                disabled={isLoading}
              >
                Search
              </button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Filter Type */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Filter By
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
            >
              <option value="all">All Devices</option>
              <option value="group">By Group</option>
              <option value="device">Single Device</option>
            </select>
          </div>

          {/* Group Selector */}
          {filterType === "group" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Select Group
              </label>
              <select
                value={selectedGroup || ""}
                onChange={(e) => setSelectedGroup(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              >
                <option value="">Choose a group</option>
                {groups.map((group) => (
                  <option key={group.groupid} value={group.groupid}>
                    {group.groupname} ({group.devices.length} devices)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Device Selector */}
          {filterType === "device" && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Select Device
              </label>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              >
                <option value="">Choose a device</option>
                {allDevices.map((device) => (
                  <option key={device.deviceid} value={device.deviceid}>
                    {device.devicename}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
            />
          </div>
        </div>

        {/* Search Button */}
        <div className="mt-3">
          <button
            onClick={fetchAlarms}
            disabled={isLoading || (filterType === "group" && !selectedGroup) || (filterType === "device" && !selectedDevice)}
            className="px-4 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {isLoading ? "Loading..." : "Search Alarms"}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
          <p className="text-xs font-medium">Error</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      {/* Results Summary */}
      {!isLoading && alarms.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded">
          <p className="text-xs">
            Found <span className="font-semibold">{alarms.length}</span> alarm record(s) for the selected period
          </p>
        </div>
      )}

      {/* Alarms Table */}
      {!isLoading && currentAlarms.length > 0 ? (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Device</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Alarm Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Address</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Offline Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {currentAlarms.map((alarm, index) => {
                  const globalIndex = startIndex + index + 1;
                  // Calculate offline duration
                  const now = Date.now();
                  const diff = now - (alarm.updatetime || alarm.devicetime);
                  const hours = Math.floor(diff / (1000 * 60 * 60));
                  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                  let offlineDuration = '';
                  if (hours > 24) {
                    const days = Math.floor(hours / 24);
                    offlineDuration = `${days}d ${hours % 24}h`;
                  } else {
                    offlineDuration = `${hours}h ${minutes}m`;
                  }
                  return (
                    <tr key={alarm.devicealarmid} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">{globalIndex}</td>
                      <td className="px-3 py-2 text-xs text-gray-900">
                        <div className="font-medium leading-tight">{getDeviceName(alarm.deviceid)}</div>
                        <div className="text-xs text-gray-500 font-mono leading-tight">{alarm.deviceid}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${getAlarmTypeColor(alarm.stralarmen)}`}>{alarm.stralarmen}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDate(alarm.devicetime)}</td>
                      <td className="px-3 py-2 text-xs text-gray-600"><AddressCell lat={alarm.lat} lon={alarm.lon} /></td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{alarm.speed.toFixed(1)} km/h</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{offlineDuration}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{alarm.disposestatus === 0 ? (<span className="text-[#e31d00]">Pending</span>) : (<span className="text-green-600">Resolved</span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-gray-50 px-4 py-2.5 border-t border-gray-200 flex items-center justify-between">
              <div className="text-xs text-gray-700">
                Showing <span className="font-medium">{startIndex + 1}</span> to{" "}
                <span className="font-medium">{Math.min(endIndex, totalAlarms)}</span> of{" "}
                <span className="font-medium">{totalAlarms}</span> alarms
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className={`px-2.5 py-1 text-xs rounded border ${
                    currentPage === 1
                      ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  Previous
                </button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                    if (
                      page === 1 ||
                      page === totalPages ||
                      (page >= currentPage - 1 && page <= currentPage + 1)
                    ) {
                      return (
                        <button
                          key={page}
                          onClick={() => goToPage(page)}
                          className={`px-2.5 py-1 text-xs rounded border ${
                            currentPage === page
                              ? "bg-[#e31d00] text-gray-900 border-[#e31d00] font-medium"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {page}
                        </button>
                      );
                    } else if (page === currentPage - 2 || page === currentPage + 2) {
                      return <span key={page} className="px-1.5 text-xs text-gray-500">...</span>;
                    }
                    return null;
                  })}
                </div>

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className={`px-2.5 py-1 text-xs rounded border ${
                    currentPage === totalPages
                      ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : !isLoading && alarms.length === 0 && !error ? (
        <div className="text-center py-8 bg-gray-50 rounded">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="text-sm text-gray-600">No alarms found for the selected criteria</p>
          <p className="text-xs text-gray-500 mt-1">Try adjusting your filters and search again</p>
        </div>
      ) : null}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#e31d00]"></div>
        </div>
      )}
    </div>
  );
}
