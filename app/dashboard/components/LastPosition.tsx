"use client";

import { useEffect, useState } from "react";
import { getAuthToken, getUserData } from "@/lib/auth";
import { buildHereReverseGeocodeUrl } from "@/lib/config";
import { apiCallWithAutoRefresh } from "@/lib/utils";

interface PositionRecord {
  positionlastid: number;
  deviceid: string;
  devicetime: number;
  arrivedtime: number;
  updatetime: number;
  validpoistiontime: number;
  callat: number;
  callon: number;
  radius: number;
  speed: number;
  altitude: number;
  course: number;
  mileage: number;
  totaldistance: number;
  status: number;
  alarm: number;
  stralarm: string;
  stralarmen: string;
  strstatus: string;
  strstatusen: string;
  gotsrc: string;
  rxlevel: number;
  gpstotalnum: number;
  gpsvalidnum: number;
  exvoltage: number;
  voltagev: number;
  voltagepercent: number;
  moving: number;
  parklat: number;
  parklon: number;
  parktime: number;
  parkduration: number;
  accswitchtime: number;
  accduration: number;
}

interface LastPositionResponse {
  status: number;
  cause: string;
  lastquerypositiontime: number;
  records: PositionRecord[];
}

interface Device {
  deviceid: string;
  devicename: string;
}

export default function LastPosition() {
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filteredDevices, setFilteredDevices] = useState<Device[]>([]);
  const [addressCache, setAddressCache] = useState<Record<string, string>>({});
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [lastQueryTime, setLastQueryTime] = useState<number>(0);

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (positions.length > 0) {
      fetchAddresses();
    }
  }, [positions]);

  const fetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const userData = getUserData();
      const token = getAuthToken();
      
      if (!userData || !token) {
        setError("Authentication required");
        setLoadingDevices(false);
        return;
      }

      // Use apiCallWithAutoRefresh for automatic token refresh
      const data = await apiCallWithAutoRefresh("/api/devices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: userData.username,
          token: token,
        }),
      });
      
      if (data.status === 0 && data.groups) {
        const allDevices: Device[] = [];
        data.groups.forEach((group: any) => {
          if (group.devices) {
            group.devices.forEach((device: any) => {
              allDevices.push({
                deviceid: device.deviceid,
                devicename: device.devicename,
              });
            });
          }
        });
        setDevices(allDevices);
        setFilteredDevices(allDevices);
      } else {
        setError(data.cause || "Failed to fetch devices");
      }
    } catch (err) {
      // Error is already handled by apiCallWithAutoRefresh
      setError("Failed to fetch devices");
      console.error("Error fetching devices:", err);
    } finally {
      setLoadingDevices(false);
    }
  };

  const fetchAddresses = async () => {
    setLoadingAddresses(true);
    const newCache: Record<string, string> = { ...addressCache };
    
    for (const position of positions) {
      const keys = [
        `${position.callat.toFixed(5)}_${position.callon.toFixed(5)}`,
        `${position.parklat.toFixed(5)}_${position.parklon.toFixed(5)}`
      ];
      
      for (const key of keys) {
        if (!newCache[key]) {
          try {
            const [lat, lon] = key.split('_');
            const response = await fetch(buildHereReverseGeocodeUrl(lat, lon));
            const data = await response.json();
            if (data.items && data.items.length > 0) {
              newCache[key] = data.items[0].address.label || `${lat}, ${lon}`;
            } else {
              newCache[key] = `${lat}, ${lon}`;
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Reduced rate limiting
          } catch (err) {
            const [lat, lon] = key.split('_');
            newCache[key] = `${lat}, ${lon}`;
          }
        }
      }
    }
    
    setAddressCache(newCache);
    setLoadingAddresses(false);
  };

  const getAddress = (lat: number, lon: number) => {
    const key = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
    return addressCache[key] || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  };

  const fetchLastPosition = async () => {
    if (selectedDevices.length === 0) {
      setError("Please select at least one device");
      return;
    }

    setLoading(true);
    setError("");
    
    try {
      const userData = getUserData();
      
      if (!userData) {
        setError("Authentication required");
        return;
      }

      const data: LastPositionResponse = await apiCallWithAutoRefresh("/api/lastposition", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: userData.username,
          deviceids: selectedDevices,
          lastquerypositiontime: lastQueryTime,
        }),
      });
      
      if (data.status === 0) {
        setPositions(data.records || []);
        // Update lastQueryTime with the value from response for next query
        if (data.lastquerypositiontime) {
          setLastQueryTime(data.lastquerypositiontime);
        }
      } else {
        setError(data.cause || "Failed to fetch last positions");
      }
    } catch (err) {
      setError("Failed to fetch last positions");
      console.error("Error fetching last positions:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleDeviceSelection = (deviceid: string) => {
    setSelectedDevices(prev => 
      prev.includes(deviceid) 
        ? prev.filter(id => id !== deviceid)
        : [...prev, deviceid]
    );
  };

  const toggleAllDevices = () => {
    if (selectedDevices.length === filteredDevices.length && filteredDevices.length > 0) {
      setSelectedDevices(prev => prev.filter(id => !filteredDevices.find(d => d.deviceid === id)));
    } else {
      const filteredIds = filteredDevices.map(d => d.deviceid);
      setSelectedDevices(prev => {
        const uniqueIds = new Set([...prev, ...filteredIds]);
        return Array.from(uniqueIds);
      });
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setFilteredDevices(devices);
      return;
    }

    const searchLower = query.toLowerCase();
    const filtered = devices.filter(device => 
      device.devicename.toLowerCase().includes(searchLower) ||
      device.deviceid.toLowerCase().includes(searchLower)
    );
    setFilteredDevices(filtered);
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return "N/A";
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (milliseconds: number) => {
    if (!milliseconds || milliseconds < 0) return "N/A";
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  const formatDistance = (meters: number) => {
    if (!meters || meters < 0) return "0.00 km";
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const getDeviceName = (deviceid: string) => {
    const device = devices.find(d => d.deviceid === deviceid);
    return device?.devicename || deviceid;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Last Position Query</h2>
          <p className="text-sm text-gray-600 mt-0.5">View the latest position data for your devices</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Device Selection</h3>
        
        <div className="space-y-3">
          {/* Search Bar */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Search by Device Name or IMEI
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Type to search devices..."
                disabled={loadingDevices}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              <svg 
                className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Device Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-700">
                Select Devices 
                {devices.length > 0 && (
                  <span className="text-gray-500"> ({selectedDevices.length} selected{searchQuery && `, ${filteredDevices.length} shown`})</span>
                )}
              </label>
              <button
                onClick={toggleAllDevices}
                disabled={loadingDevices || filteredDevices.length === 0}
                className="text-xs text-[#e31d00] hover:text-[#f04a33] font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {selectedDevices.filter(id => filteredDevices.find(d => d.deviceid === id)).length === filteredDevices.length && filteredDevices.length > 0 
                  ? "Deselect All" 
                  : "Select All"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded border border-gray-200">
              {loadingDevices ? (
                <div className="col-span-full text-center py-4">
                  <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-500 border-t-transparent"></div>
                    Loading devices...
                  </div>
                </div>
              ) : filteredDevices.length === 0 ? (
                <div className="col-span-full text-center py-4 text-xs text-gray-500">
                  {searchQuery ? `No devices found matching "${searchQuery}"` : "No devices available"}
                </div>
              ) : (
                filteredDevices.map((device) => (
                  <label
                    key={device.deviceid}
                    className="flex items-start gap-2 cursor-pointer hover:bg-white p-2 rounded transition-colors border border-transparent hover:border-gray-300"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDevices.includes(device.deviceid)}
                      onChange={() => toggleDeviceSelection(device.deviceid)}
                      className="w-3.5 h-3.5 text-[#e31d00] border-gray-300 rounded focus:ring-[#e31d00] mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900 truncate">{device.devicename}</div>
                      <div className="text-xs text-gray-500 truncate">{device.deviceid}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Query Button */}
          <div>
            <button
              onClick={fetchLastPosition}
              disabled={loading || selectedDevices.length === 0}
              className="px-4 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'Querying...' : 'Query Positions'}
            </button>
          </div>
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
      {!loading && positions.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded">
          <p className="text-xs">
            Found <span className="font-semibold">{positions.length}</span> position record(s) for {selectedDevices.length} device(s)
            {loadingAddresses && <span className="ml-2 text-xs">(Loading addresses...)</span>}
          </p>
        </div>
      )}

      {/* Position List */}
      {!loading && positions.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Device</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Current Location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Parking Location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Times</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Distance</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Signal</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Voltage</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {positions.map((position) => (
                  <tr key={position.positionlastid} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs font-medium text-gray-900">
                        {getDeviceName(position.deviceid)}
                      </div>
                      <div className="text-xs text-gray-500">{position.deviceid}</div>
                    </td>
                    <td className="px-3 py-2" style={{ minWidth: '180px' }}>
                      <div className="text-xs text-gray-900 max-w-xs">
                        {loadingAddresses ? (
                          <div className="flex items-center gap-1.5">
                            <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent"></div>
                            <span className="text-gray-500">Loading...</span>
                          </div>
                        ) : (
                          <div className="line-clamp-2" title={getAddress(position.callat, position.callon)}>
                            {getAddress(position.callat, position.callon)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {position.callat.toFixed(5)}, {position.callon.toFixed(5)} • {position.gotsrc.toUpperCase()}
                      </div>
                    </td>
                    <td className="px-3 py-2" style={{ minWidth: '180px' }}>
                      {position.parklat && position.parklon ? (
                        <>
                          <div className="text-xs text-gray-900 max-w-xs">
                            {loadingAddresses ? (
                              <div className="flex items-center gap-1.5">
                                <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent"></div>
                                <span className="text-gray-500">Loading...</span>
                              </div>
                            ) : (
                              <div className="line-clamp-2" title={getAddress(position.parklat, position.parklon)}>
                                {getAddress(position.parklat, position.parklon)}
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {position.parklat.toFixed(5)}, {position.parklon.toFixed(5)}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            Since: {formatDate(position.parktime)}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-500">N/A</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs text-gray-900 font-medium">
                        {position.speed.toFixed(1)} km/h
                      </div>
                      <div className="text-xs text-gray-500">
                        Course: {position.course}°
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">
                        {position.strstatusen || position.strstatus}
                      </div>
                      {position.moving > 0 ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 mt-0.5">
                          Moving
                        </span>
                      ) : (
                        <div className="text-xs text-gray-500 mt-0.5">
                          Parked: {formatDuration(position.parkduration)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs text-gray-700 font-medium">Valid:</div>
                      <div className="text-xs text-gray-900 mb-1">
                        {formatDate(position.validpoistiontime)}
                      </div>
                      <div className="text-xs text-gray-700 font-medium">Arrived:</div>
                      <div className="text-xs text-gray-900 mb-1">
                        {formatDate(position.arrivedtime)}
                      </div>
                      <div className="text-xs text-gray-700 font-medium">Updated:</div>
                      <div className="text-xs text-gray-900">
                        {formatDate(position.updatetime)}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs text-gray-900 font-medium">
                        {formatDistance(position.totaldistance)}
                      </div>
                      <div className="text-xs text-gray-500">
                        Total
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs text-gray-900">
                        {position.rxlevel}%
                      </div>
                      <div className="text-xs text-gray-500">
                        GPS: {position.gpsvalidnum}/{position.gpstotalnum}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs text-gray-900 font-medium">
                        {position.strstatusen && position.strstatusen.includes('Voltage')
                          ? position.strstatusen.match(/Voltage\s([\d.]+V)/)?.[1] || `${position.voltagev.toFixed(1)}V`
                          : `${position.voltagev.toFixed(1)}V`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {position.voltagepercent > 0 ? `${position.voltagepercent}%` : 'N/A'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && positions.length === 0 && !error && (
        <div className="bg-white rounded shadow-sm p-8 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No positions queried</h3>
          <p className="text-xs text-gray-600">Select devices and click "Query Positions" to view their last known locations</p>
        </div>
      )}
    </div>
  );
}
