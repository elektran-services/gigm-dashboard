'use client';

import { useState, useEffect } from 'react';
import { getAuthToken, getUserData } from '@/lib/auth';
import { apiCallWithAutoRefresh } from '@/lib/utils';

interface Device {
  deviceid: string;
  name: string;
  groupid?: string;
}

interface Trip {
  maxspeed: number;
  tripdistance: number;
  triptime: number;
  starttime: number;
  endtime: number;
  parktime: number;
  averagespeed: number;
  slat: number;
  slon: number;
  elat: number;
  elon: number;
  trackstarttime: number;
  trackendtime: number;
  fuelreport: any;
}

interface TripData {
  status: number;
  cause: string;
  deviceid: string;
  totalmaxspeed: number;
  totaldistance: number;
  totalaveragespeed: number;
  totaltriptime: number;
  totaltrips: Trip[];
  addressmap?: Record<string, string>;
}

export default function TripReport() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [filteredDevices, setFilteredDevices] = useState<Device[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('08:00');
  const [endDate, setEndDate] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('18:00');
  const [tripData, setTripData] = useState<TripData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [loadingDevices, setLoadingDevices] = useState(true);

  useEffect(() => {
    fetchDevices();
    
    // Set default dates (last 7 days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  }, []);

  const fetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const token = getAuthToken();
      const userData = getUserData();
      
      console.log('TripReport - Fetching devices, userData:', userData);
      
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
      
      console.log('TripReport - API response:', data);
      console.log('TripReport - Groups:', data.groups);
      
      if (data.status === 0 && data.groups) {
        const allDevices = data.groups.flatMap((group: any) => {
          console.log('TripReport - Processing group:', group.groupname, 'devices:', group.devices);
          return group.devices?.map((device: any) => ({
            deviceid: device.deviceid,
            name: device.devicename || device.deviceid,
            groupid: group.groupid
          })) || [];
        });
        console.log('TripReport - All devices extracted:', allDevices);
        setDevices(allDevices);
        setFilteredDevices(allDevices);
      } else {
        console.log('TripReport - Failed to fetch devices, status:', data.status);
        setError('Failed to load devices: ' + (data.cause || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error fetching devices:', err);
      setError('Failed to load devices');
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setFilteredDevices(devices);
      return;
    }

    const searchLower = query.toLowerCase();
    const filtered = devices.filter(
      (device) =>
        device.name.toLowerCase().includes(searchLower) ||
        device.deviceid.toLowerCase().includes(searchLower)
    );
    setFilteredDevices(filtered);
  };

  const fetchTripReport = async () => {
    if (!selectedDevice) {
      setError('Please select a device');
      return;
    }

    setLoading(true);
    setError('');
    setTripData(null);

    try {
      const token = getAuthToken();
      const startDateTime = `${startDate} ${startTime}:00`;
      const endDateTime = `${endDate} ${endTime}:00`;

      const data = await apiCallWithAutoRefresh('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceid: selectedDevice,
          starttime: startDateTime,
          endtime: endDateTime,
          timezone: 1,
          token
        }),
      });

      if (data.status === 0) {
        setTripData(data);
      } else {
        setError(data.cause || 'Failed to fetch trip data');
      }
    } catch (err) {
      console.error('Error fetching trip report:', err);
      setError('Failed to load trip report');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatSpeed = (speed: number) => {
    // Speed is in m/s * 1000, convert to km/h
    return ((speed / 1000) * 3.6).toFixed(1);
  };

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${meters}m`;
    }
    return `${(meters / 1000).toFixed(2)}km`;
  };

  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getAddress = (lat: number, lon: number) => {
    if (!tripData?.addressmap) return 'N/A';
    
    // Round to 5 decimal places as seen in the response
    const key = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
    const key2 = `${lat.toFixed(6)}_${lon.toFixed(6)}`;
    const key3 = `${lat.toFixed(4)}_${lon.toFixed(4)}`;
    
    return tripData.addressmap[key] || tripData.addressmap[key2] || tripData.addressmap[key3] || 'Address not available';
  };

  const exportToCSV = () => {
    if (!tripData || !tripData.totaltrips) return;

    const headers = [
      'Trip #',
      'Start Time',
      'End Time',
      'Duration',
      'Distance',
      'Max Speed (km/h)',
      'Avg Speed (km/h)',
      'Start Location',
      'End Location'
    ];

    const rows = tripData.totaltrips.map((trip, index) => [
      (index + 1).toString(),
      formatDateTime(trip.starttime),
      formatDateTime(trip.endtime),
      formatDuration(trip.triptime),
      formatDistance(trip.tripdistance),
      formatSpeed(trip.maxspeed),
      formatSpeed(trip.averagespeed),
      getAddress(trip.slat, trip.slon),
      getAddress(trip.elat, trip.elon)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trip-report-${selectedDevice}-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Trip Reports</h2>
          <p className="text-sm text-gray-600 mt-0.5">View and analyze trip history</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={!tripData || !tripData.totaltrips || tripData.totaltrips.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Filters</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
                placeholder="Search devices..."
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900 placeholder:text-gray-400"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {searchQuery && (
              <p className="text-xs text-gray-600 mt-1 font-medium">
                {filteredDevices.length} result{filteredDevices.length !== 1 ? 's' : ''} found
              </p>
            )}
          </div>

          {/* Device Selector */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Select a Device {!searchQuery && devices.length > 0 && <span className="text-gray-500">({devices.length} total)</span>}
            </label>
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              disabled={loadingDevices || filteredDevices.length === 0}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">
                {loadingDevices ? 'Loading devices...' : filteredDevices.length === 0 ? 'No devices found' : 'Select a device'}
              </option>
              {filteredDevices.map((device) => (
                <option key={device.deviceid} value={device.deviceid}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          {/* Start Date & Time */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Start Date & Time
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-24 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              />
            </div>
          </div>

          {/* End Date & Time */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              End Date & Time
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-24 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] text-gray-900"
              />
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <div className="mt-3">
          <button
            onClick={fetchTripReport}
            disabled={loading || !selectedDevice}
            className="px-4 py-1.5 text-sm bg-[#e31d00] text-gray-900 rounded hover:bg-[#f04a33] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? 'Loading...' : 'Generate Report'}
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
      {!loading && tripData && tripData.totaltrips && tripData.totaltrips.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded">
          <p className="text-xs">
            Found <span className="font-semibold">{tripData.totaltrips.length}</span> trip(s) - 
            Total Distance: <span className="font-semibold">{formatDistance(tripData.totaldistance)}</span>, 
            Max Speed: <span className="font-semibold">{formatSpeed(tripData.totalmaxspeed)} km/h</span>, 
            Avg Speed: <span className="font-semibold">{formatSpeed(tripData.totalaveragespeed)} km/h</span>
          </p>
        </div>
      )}

      {/* Trip List */}
      {!loading && tripData && tripData.totaltrips && tripData.totaltrips.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Start Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">End Time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Distance</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Max Speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Avg Speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Start Location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">End Location</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tripData.totaltrips.map((trip, index) => (
                  <tr key={index} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">{index + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                      {formatDateTime(trip.starttime)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                      {formatDateTime(trip.endtime)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                      {formatDuration(trip.triptime)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900">
                      {formatDistance(trip.tripdistance)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">
                      {formatSpeed(trip.maxspeed)} km/h
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                      {formatSpeed(trip.averagespeed)} km/h
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div className="max-w-xs truncate" title={getAddress(trip.slat, trip.slon)}>
                        {getAddress(trip.slat, trip.slon)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div className="max-w-xs truncate" title={getAddress(trip.elat, trip.elon)}>
                        {getAddress(trip.elat, trip.elon)}
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
      {!loading && tripData && (!tripData.totaltrips || tripData.totaltrips.length === 0) && (
        <div className="bg-white rounded shadow-sm p-8 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No trips found</h3>
          <p className="text-xs text-gray-600">No trips recorded for the selected device and time period</p>
        </div>
      )}
    </div>
  );
}
