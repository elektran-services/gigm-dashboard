'use client';

import { useState, useEffect } from 'react';
import { getAuthToken, getUserData } from '@/lib/auth';
import { buildHereReverseGeocodeUrl } from '@/lib/config';
import { apiCallWithAutoRefresh } from '@/lib/utils';

interface Device {
  deviceid: string;
  name: string;
  groupid?: string;
}

interface OverspeedRecord {
  tripid: string;
  deviceid: string;
  deviceName?: string;
  begintime: number;
  endtime: number;
  startlat: number;
  startlon: number;
  endlat: number;
  endlon: number;
  maxspeed: number;
  avgspeed: number;
  speedlimit: number;
  overspeed: number;
  duration: number;
  overspeedduration: number;
  distance: number;
  startaddress?: string;
  endaddress?: string;
}

interface OverspeedData {
  status: number;
  cause: string;
  speedlimit: number;
  totalviolations: number;
  records: OverspeedRecord[];
}

export default function OverspeedReport() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [filteredDevices, setFilteredDevices] = useState<Device[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [speedLimit, setSpeedLimit] = useState<number>(80);
  const [overspeedData, setOverspeedData] = useState<OverspeedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [exportingWithAddresses, setExportingWithAddresses] = useState(false);
  const [reportMode, setReportMode] = useState<'single' | 'all'>('single');
  const [progressMessage, setProgressMessage] = useState('');
  const itemsPerPage = 10;

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredDevices(devices);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = devices.filter(
        (device) =>
          device.name.toLowerCase().includes(query) ||
          device.deviceid.toLowerCase().includes(query)
      );
      setFilteredDevices(filtered);
    }
  }, [searchQuery, devices]);

  const fetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const token = getAuthToken();
      const userData = getUserData();
      
      if (!userData?.username) {
        setError('User data not found');
        setLoadingDevices(false);
        return;
      }

      const data = await apiCallWithAutoRefresh('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: userData.username, 
          token 
        }),
      });
      
      if (data.status === 0 && data.groups) {
        const allDevices = data.groups.flatMap((group: any) =>
          (group.devices || []).map((device: any) => ({
            deviceid: device.deviceid,
            name: device.devicename || device.deviceid,
            groupid: group.groupid
          }))
        );
        setDevices(allDevices);
        setFilteredDevices(allDevices);
      } else {
        setError('Failed to load devices: ' + (data.cause || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error fetching devices:', err);
      setError('Failed to load devices');
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const formatDateForAPI = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const fetchAddressesForRecords = async (records: OverspeedRecord[]) => {
    for (const record of records) {
      // Skip if already has addresses
      if (record.startaddress && record.endaddress) continue;

      // Fetch start address
      if (!record.startaddress && record.startlat && record.startlon) {
        try {
          const response = await fetch(buildHereReverseGeocodeUrl(record.startlat, record.startlon));
          if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0 && data.items[0].address?.label) {
              record.startaddress = data.items[0].address.label;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 150)); // Rate limit
        } catch (err) {
          console.error('Error fetching start address:', err);
        }
      }

      // Fetch end address
      if (!record.endaddress && record.endlat && record.endlon) {
        try {
          const response = await fetch(buildHereReverseGeocodeUrl(record.endlat, record.endlon));
          if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0 && data.items[0].address?.label) {
              record.endaddress = data.items[0].address.label;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 150)); // Rate limit
        } catch (err) {
          console.error('Error fetching end address:', err);
        }
      }
    }
  };

  const fetchAddressesForPage = async (allRecords: OverspeedRecord[], page: number) => {
    setLoadingAddresses(true);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageRecords = allRecords.slice(startIndex, endIndex);

    await fetchAddressesForRecords(pageRecords);
    
    // Trigger re-render
    setOverspeedData(prev => prev ? { ...prev, records: [...allRecords] } : null);
    setLoadingAddresses(false);
  };

  // Fetch addresses when page changes
  useEffect(() => {
    if (overspeedData && overspeedData.records && overspeedData.records.length > 0) {
      fetchAddressesForPage(overspeedData.records, currentPage);
    }
  }, [currentPage]);

  const fetchOverspeedReport = async () => {
    if (reportMode === 'single' && !selectedDevice) {
      setError('Please select a device');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select start and end dates');
      return;
    }

    setLoading(true);
    setError('');
    setOverspeedData(null);
    setProgressMessage('');

    try {
      const token = getAuthToken();
      const begintime = formatDateForAPI(startDate);
      const endtime = formatDateForAPI(endDate);

      if (reportMode === 'single') {
        // Single device report (existing logic)
        const data = await apiCallWithAutoRefresh('/api/overspeed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceid: selectedDevice,
            begintime,
            endtime,
            speedlimit: speedLimit,
            token
          }),
        });

        if (data.status === 0) {
          console.log('Overspeed API Response:', data);
          setOverspeedData(data);
          setCurrentPage(1);
          if (data.records && data.records.length > 0) {
            fetchAddressesForPage(data.records, 1);
          }
        } else {
          const errorMsg = data.cause || data.details || 'Failed to fetch overspeed data';
          setError(errorMsg);
          console.error('API Error:', data);
        }
      } else {
        // All devices report (new logic)
        const allRecords: OverspeedRecord[] = [];
        const devicesToQuery = devices.filter(d => d.deviceid); // Filter out empty deviceids
        
        setProgressMessage(`Processing 0 of ${devicesToQuery.length} devices...`);

        for (let i = 0; i < devicesToQuery.length; i++) {
          const device = devicesToQuery[i];
          setProgressMessage(`Processing ${i + 1} of ${devicesToQuery.length} devices (${device.name})...`);

          try {
            const data = await apiCallWithAutoRefresh('/api/overspeed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deviceid: device.deviceid,
                begintime,
                endtime,
                speedlimit: speedLimit,
                token
              }),
            });

            if (data.status === 0 && data.records && data.records.length > 0) {
              // Add device info to each record
              const recordsWithDevice = data.records.map((record: OverspeedRecord) => ({
                ...record,
                deviceid: device.deviceid,
                deviceName: device.name
              }));
              allRecords.push(...recordsWithDevice);
            }

            // Small delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (err) {
            console.error(`Error fetching data for device ${device.deviceid}:`, err);
            // Continue with other devices even if one fails
          }
        }

        // Sort by start time (most recent first)
        allRecords.sort((a, b) => b.begintime - a.begintime);

        setOverspeedData({
          status: 0,
          cause: 'OK',
          speedlimit: speedLimit,
          totalviolations: allRecords.length,
          records: allRecords
        });
        
        setCurrentPage(1);
        setProgressMessage('');
        
        if (allRecords.length > 0) {
          fetchAddressesForPage(allRecords, 1);
        }
      }
    } catch (err) {
      console.error('Error fetching overspeed report:', err);
      if (err instanceof Error) {
        if (err.name === 'AbortError' || err.message.includes('timeout')) {
          setError('Request timeout - please try a shorter date range');
        } else if (err.message.includes('fetch') || err.message.includes('network')) {
          setError('Network error - please check your connection');
        } else {
          setError(`Error: ${err.message}`);
        }
      } else {
        setError('Failed to load overspeed report');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (timestamp: number) => {
    if (!timestamp || isNaN(timestamp)) return 'Invalid date';
    try {
      return new Date(timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      return 'Invalid date';
    }
  };

  const formatDuration = (milliseconds: number) => {
    const minutes = Math.floor(milliseconds / (1000 * 60));
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
      return `${hours}h ${mins}m`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${mins}m`;
  };

  const exportToCSV = async () => {
    if (!overspeedData || !overspeedData.records) return;

    setExportingWithAddresses(true);
    
    try {
      // Load all addresses if not already loaded
      const recordsNeedingAddresses = overspeedData.records.filter(
        r => !r.startaddress || !r.endaddress
      );
      
      if (recordsNeedingAddresses.length > 0) {
        await fetchAddressesForRecords(recordsNeedingAddresses);
        // Update state with new addresses
        setOverspeedData(prev => prev ? { ...prev, records: [...overspeedData.records] } : null);
      }

      const headers = [
        'Device',
        'Start Time',
        'End Time',
        'Duration',
        'Max Speed (km/h)',
        'Avg Speed (km/h)',
        'Speed Limit (km/h)',
        'Overspeed (km/h)',
        'Distance (km)',
        'Start Location',
        'End Location'
      ];

      const rows = overspeedData.records.map(record => {
        const deviceName = record.deviceName || 
          (reportMode === 'single' ? devices.find(d => d.deviceid === selectedDevice)?.name : null) ||
          record.deviceid;

        return [
          deviceName,
          formatDateTime(record.begintime),
          formatDateTime(record.endtime),
          formatDuration(record.duration),
          record.maxspeed.toFixed(1),
          record.avgspeed.toFixed(1),
          record.speedlimit.toString(),
          record.overspeed.toFixed(1),
          record.distance.toFixed(2),
          record.startaddress || `${record.startlat.toFixed(6)}, ${record.startlon.toFixed(6)}`,
          record.endaddress || `${record.endlat.toFixed(6)}, ${record.endlon.toFixed(6)}`
        ];
      });

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = reportMode === 'all' 
        ? `overspeed-report-all-devices-${startDate}-to-${endDate}.csv`
        : `overspeed-report-${devices.find(d => d.deviceid === selectedDevice)?.name || selectedDevice}-${startDate}-to-${endDate}.csv`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      alert('Error loading addresses for export. Please try again.');
    } finally {
      setExportingWithAddresses(false);
    }
  };

  const getSeverityColor = (overspeed: number) => {
    if (overspeed > 30) return 'bg-red-100 text-red-700';
    if (overspeed > 15) return 'bg-orange-100 text-orange-700';
    return 'bg-red-50 text-[#c41900]';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Overspeed Report</h2>
          <p className="text-sm text-gray-600 mt-0.5">Monitor speed violations and overspeeding events</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={!overspeedData || !overspeedData.records || overspeedData.records.length === 0 || exportingWithAddresses}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          {exportingWithAddresses ? (
            <>
              <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-600 border-t-transparent"></div>
              Loading Addresses...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Filters</h3>
        
        {/* Report Mode Toggle */}
        <div className="mb-4 pb-3 border-b border-gray-200">
          <label className="block text-xs font-medium text-gray-700 mb-2">Report Mode</label>
          <div className="flex gap-3">
            <label className="flex items-center cursor-pointer">
              <input
                type="radio"
                name="reportMode"
                value="single"
                checked={reportMode === 'single'}
                onChange={(e) => setReportMode(e.target.value as 'single' | 'all')}
                className="w-4 h-4 text-[#e31d00] border-gray-300 focus:ring-[#e31d00]"
              />
              <span className="ml-2 text-sm text-gray-700">Single Device</span>
            </label>
            <label className="flex items-center cursor-pointer">
              <input
                type="radio"
                name="reportMode"
                value="all"
                checked={reportMode === 'all'}
                onChange={(e) => setReportMode(e.target.value as 'single' | 'all')}
                className="w-4 h-4 text-[#e31d00] border-gray-300 focus:ring-[#e31d00]"
              />
              <span className="ml-2 text-sm text-gray-700">All Devices</span>
            </label>
          </div>
          {reportMode === 'all' && (
            <p className="text-xs text-gray-500 mt-1.5">
              ⚠️ This will generate reports for all {devices.length} devices. May take several minutes.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search - Only show for single device mode */}
          {reportMode === 'single' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Search Device
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearch}
                placeholder="Search by name or IMEI"
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              />
            </div>
          )}

          {/* Device Selector - Only show for single device mode */}
          {reportMode === 'single' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Select Device
              </label>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                disabled={loadingDevices}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900 disabled:bg-gray-100"
              >
                <option value="">Select a device</option>
                {filteredDevices.map((device) => (
                  <option key={device.deviceid} value={device.deviceid}>
                    {device.name} ({device.deviceid})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Start Date/Time
            </label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              End Date/Time
            </label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
            />
          </div>

          {/* Speed Limit */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Speed Limit (km/h)
            </label>
            <input
              type="number"
              value={speedLimit}
              onChange={(e) => setSpeedLimit(Number(e.target.value))}
              min="1"
              placeholder="80"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
            />
          </div>
        </div>

        {/* Generate Button */}
        <div className="mt-3">
          <button
            onClick={fetchOverspeedReport}
            disabled={loading || (reportMode === 'single' && !selectedDevice) || !startDate || !endDate}
            className="px-4 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? 'Analyzing...' : `Generate Report ${reportMode === 'all' ? `(${devices.length} devices)` : ''}`}
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

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded shadow-sm p-8">
          <div className="flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-[#e31d00] mb-3"></div>
            <p className="text-sm text-gray-600">
              {progressMessage || 'Analyzing speed data...'}
            </p>
            {reportMode === 'all' && (
              <p className="text-xs text-gray-500 mt-1">This may take several minutes for all devices</p>
            )}
            {reportMode === 'single' && (
              <p className="text-xs text-gray-500 mt-1">This may take a moment for large date ranges</p>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {!loading && overspeedData && (
        <div className="bg-white rounded shadow-sm p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-700">
              Found <span className="font-semibold text-red-600">{overspeedData.totalviolations}</span> overspeed violation{overspeedData.totalviolations !== 1 ? 's' : ''}
              {overspeedData.speedlimit && ` (limit: ${overspeedData.speedlimit} km/h)`}
            </p>
            {loadingAddresses && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <div className="animate-spin rounded-full h-3 w-3 border-2 border-[#e31d00] border-t-transparent"></div>
                <span>Loading addresses...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overspeed Records Table */}
      {!loading && overspeedData && overspeedData.records && overspeedData.records.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {reportMode === 'all' && (
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Device</th>
                  )}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Time</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Max Speed</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Overspeed</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Distance</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overspeedData.records
                  .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                  .map((record, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    {reportMode === 'all' && (
                      <td className="px-3 py-2">
                        <div className="text-xs font-medium text-gray-900">{record.deviceName || record.deviceid}</div>
                        <div className="text-xs text-gray-500">{record.deviceid}</div>
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">Start: {formatDateTime(record.begintime)}</div>
                      <div className="text-xs text-gray-500">End: {formatDateTime(record.endtime)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">{formatDuration(record.duration)}</div>
                      <div className="text-xs text-gray-500">~{formatDuration(record.overspeedduration)} over</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs font-medium text-gray-900">{record.maxspeed.toFixed(1)} km/h</div>
                      <div className="text-xs text-gray-500">Avg: {record.avgspeed.toFixed(1)} km/h</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${getSeverityColor(record.overspeed)}`}>
                        +{record.overspeed.toFixed(1)} km/h
                      </span>
                      <div className="text-xs text-gray-500 mt-0.5">Limit: {record.speedlimit} km/h</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">{record.distance.toFixed(2)} km</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900 max-w-xs">
                        {record.startaddress || `${record.startlat.toFixed(6)}, ${record.startlon.toFixed(6)}`}
                      </div>
                      {record.endaddress && record.endaddress !== record.startaddress && (
                        <div className="text-xs text-gray-500 mt-1">→ {record.endaddress}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {overspeedData.records.length > itemsPerPage && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1 || loadingAddresses}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-700">
                  Page <span className="font-semibold">{currentPage}</span> of <span className="font-semibold">{Math.ceil(overspeedData.records.length / itemsPerPage)}</span>
                </span>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(Math.ceil(overspeedData.records.length / itemsPerPage), prev + 1))}
                  disabled={currentPage >= Math.ceil(overspeedData.records.length / itemsPerPage) || loadingAddresses}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
              <p className="text-xs text-gray-600">
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, overspeedData.records.length)} of {overspeedData.records.length} violations
              </p>
            </div>
          )}
        </div>
      )}

      {/* No Violations */}
      {!loading && overspeedData && overspeedData.records && overspeedData.records.length === 0 && (
        <div className="bg-white rounded shadow-sm p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">No overspeed violations</h3>
            <p className="text-xs text-gray-600">All trips were within the speed limit of {speedLimit} km/h</p>
          </div>
        </div>
      )}
    </div>
  );
}
