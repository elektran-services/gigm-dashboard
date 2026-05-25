'use client';

import { useState, useEffect } from 'react';
import { getAuthToken, getUserData } from '@/lib/auth';
import { apiCallWithAutoRefresh } from '@/lib/utils';

interface Device {
  deviceid: string;
  name: string;
  groupid?: string;
}

interface MileageRecord {
  dailydetailreportid: number;
  deviceid: string;
  statisticsday: string;
  timezoneoffset: number;
  createtime: number;
  starttime: number;
  endtime: number;
  begindis: number;
  enddis: number;
  totalacc: number;
  totalidle: number;
  totaldistance: number;
  avgspeed: number;
  onlinestatus: number;
}

interface ServiceInterval {
  oilChange: number;
  tireRotation: number;
  majorService: number;
}

interface MileageData {
  status: number;
  cause: string;
  deviceid: string;
  records: MileageRecord[];
}

export default function MileageReport() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [filteredDevices, setFilteredDevices] = useState<Device[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [mileageData, setMileageData] = useState<MileageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [loadingDevices, setLoadingDevices] = useState(true);
  
  // Service tracking states
  const [serviceIntervals] = useState<ServiceInterval>({
    oilChange: 5000,
    tireRotation: 10000,
    majorService: 20000
  });

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

  const fetchMileageReport = async () => {
    if (!selectedDevice) {
      setError('Please select a device');
      return;
    }

    setLoading(true);
    setError('');
    setMileageData(null);

    try {
      const token = getAuthToken();

      const data = await apiCallWithAutoRefresh('/api/mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceid: selectedDevice,
          startday: startDate,
          endday: endDate,
          offset: 8,
          token
        }),
      });

      if (data.status === 0) {
        setMileageData(data);
      } else {
        setError(data.cause || 'Failed to fetch mileage data');
      }
    } catch (err) {
      console.error('Error fetching mileage report:', err);
      setError('Failed to load mileage report');
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

  const formatDistance = (meters: number) => {
    if (!meters || meters < 0) return "0.00 km";
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatOdometer = (meters: number) => {
    if (!meters || meters < 0) return "0.0 km";
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const getCurrentOdometer = () => {
    if (!mileageData || !mileageData.records || mileageData.records.length === 0) return 0;
    const latestRecord = mileageData.records[mileageData.records.length - 1];
    return latestRecord.enddis / 1000; // Convert to km
  };

  const getServiceStatus = (type: keyof ServiceInterval) => {
    const currentOdo = getCurrentOdometer();
    const interval = serviceIntervals[type];
    
    // Calculate the last service odometer (nearest interval mark below current odometer)
    const lastServiceOdo = Math.floor(currentOdo / interval) * interval;
    const distanceSinceService = currentOdo - lastServiceOdo;
    const remaining = interval - distanceSinceService;
    const percentage = (distanceSinceService / interval) * 100;

    let status: 'good' | 'warning' | 'overdue' = 'good';
    if (percentage >= 100) status = 'overdue';
    else if (percentage >= 80) status = 'warning';

    return { distanceSinceService, remaining, percentage, status, lastServiceOdo };
  };

  const getStatusColor = (status: 'good' | 'warning' | 'overdue') => {
    switch (status) {
      case 'good': return 'bg-green-100 text-green-700';
      case 'warning': return 'bg-red-50 text-[#c41900]';
      case 'overdue': return 'bg-red-100 text-red-700';
    }
  };

  const getProgressColor = (status: 'good' | 'warning' | 'overdue') => {
    switch (status) {
      case 'good': return 'bg-green-500';
      case 'warning': return 'bg-[#e31d00]';
      case 'overdue': return 'bg-red-500';
    }
  };

  const calculateTotalEngineHours = () => {
    if (!mileageData || !mileageData.records) return 0;
    return mileageData.records.reduce((sum, record) => sum + record.totalacc, 0) / (1000 * 60 * 60); // Convert ms to hours
  };

  const formatEngineHours = (milliseconds: number) => {
    const hours = milliseconds / (1000 * 60 * 60);
    return `${hours.toFixed(1)}h`;
  };

  const calculateIdlePercentage = (totalacc: number, totalidle: number) => {
    if (!totalacc || totalacc === 0) return 0;
    return (totalidle / totalacc) * 100;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTimestamp = (timestamp: number) => {
    if (!timestamp || isNaN(timestamp)) return 'N/A';
    try {
      return new Date(timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      return 'Invalid date';
    }
  };

  const exportToCSV = () => {
    if (!mileageData || !mileageData.records) return;

    const headers = [
      'Date',
      'Start Time',
      'End Time',
      'Start Odometer (km)',
      'End Odometer (km)',
      'Distance (km)',
      'Engine Hours',
      'Idle %',
      'Avg Speed (km/h)',
      'Status'
    ];

    const rows = mileageData.records.map(record => [
      record.statisticsday,
      formatTimestamp(record.starttime),
      formatTimestamp(record.endtime),
      (record.begindis / 1000).toFixed(1),
      (record.enddis / 1000).toFixed(1),
      (record.totaldistance / 1000).toFixed(2),
      formatEngineHours(record.totalacc),
      calculateIdlePercentage(record.totalacc, record.totalidle).toFixed(1) + '%',
      record.avgspeed.toFixed(1),
      record.onlinestatus === 1 ? 'Online' : 'Offline'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mileage-report-${selectedDevice}-${startDate}-to-${endDate}.csv`;
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
          <h2 className="text-xl font-bold text-gray-900">Mileage Report</h2>
          <p className="text-sm text-gray-600 mt-0.5">Daily mileage and usage statistics</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={!mileageData || !mileageData.records || mileageData.records.length === 0}
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

        {/* Generate Button */}
        <div className="mt-3">
          <button
            onClick={fetchMileageReport}
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

      {/* Service Configuration Card */}
      {!loading && mileageData && mileageData.records && mileageData.records.length > 0 && (
        <div className="bg-white rounded shadow-sm p-4">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Service Status</h3>
            <p className="text-xs text-gray-600 mt-0.5">Current odometer: <span className="font-semibold text-gray-900">{formatOdometer(getCurrentOdometer() * 1000)}</span> | Total engine hours: <span className="font-semibold text-gray-900">{calculateTotalEngineHours().toFixed(1)}h</span></p>
            <p className="text-xs text-gray-500 mt-1 italic">Service intervals calculated based on standard maintenance schedules</p>
          </div>

          {/* Service Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Oil Change */}
            {(() => {
              const status = getServiceStatus('oilChange');
              return (
                <div className="border border-gray-200 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-xs font-semibold text-gray-900">Oil Change</span>
                    </div>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(status.status)}`}>
                      {status.status === 'overdue' ? 'Overdue' : status.status === 'warning' ? 'Due Soon' : 'Good'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Interval:</span>
                      <span className="font-medium text-gray-900">{serviceIntervals.oilChange} km</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Since last:</span>
                      <span className="font-medium text-gray-900">{status.distanceSinceService.toFixed(0)} km</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Remaining:</span>
                      <span className={`font-medium ${status.remaining < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {status.remaining < 0 ? `Overdue by ${Math.abs(status.remaining).toFixed(0)} km` : `${status.remaining.toFixed(0)} km`}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className={`h-2 rounded-full ${getProgressColor(status.status)}`} style={{ width: `${Math.min(status.percentage, 100)}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Tire Rotation */}
            {(() => {
              const status = getServiceStatus('tireRotation');
              return (
                <div className="border border-gray-200 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span className="text-xs font-semibold text-gray-900">Tire Rotation</span>
                    </div>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(status.status)}`}>
                      {status.status === 'overdue' ? 'Overdue' : status.status === 'warning' ? 'Due Soon' : 'Good'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Interval:</span>
                      <span className="font-medium text-gray-900">{serviceIntervals.tireRotation} km</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Since last:</span>
                      <span className="font-medium text-gray-900">{status.distanceSinceService.toFixed(0)} km</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Remaining:</span>
                      <span className={`font-medium ${status.remaining < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {status.remaining < 0 ? `Overdue by ${Math.abs(status.remaining).toFixed(0)} km` : `${status.remaining.toFixed(0)} km`}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className={`h-2 rounded-full ${getProgressColor(status.status)}`} style={{ width: `${Math.min(status.percentage, 100)}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Major Service */}
            {(() => {
              const status = getServiceStatus('majorService');
              return (
                <div className="border border-gray-200 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs font-semibold text-gray-900">Major Service</span>
                    </div>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(status.status)}`}>
                      {status.status === 'overdue' ? 'Overdue' : status.status === 'warning' ? 'Due Soon' : 'Good'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Interval:</span>
                      <span className="font-medium text-gray-900">{serviceIntervals.majorService} km</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Since last:</span>
                      <span className="font-medium text-gray-900">{status.distanceSinceService.toFixed(0)} km</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Remaining:</span>
                      <span className={`font-medium ${status.remaining < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {status.remaining < 0 ? `Overdue by ${Math.abs(status.remaining).toFixed(0)} km` : `${status.remaining.toFixed(0)} km`}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className={`h-2 rounded-full ${getProgressColor(status.status)}`} style={{ width: `${Math.min(status.percentage, 100)}%` }}></div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Mileage Table */}
      {!loading && mileageData && mileageData.records && mileageData.records.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Time Period</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Odometer</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Distance</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Engine Hours</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Idle %</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Avg Speed</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mileageData.records.map((record, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900 font-medium">{formatDate(record.statisticsday)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">
                        <div className="font-medium">Start: {formatTimestamp(record.starttime)}</div>
                        <div className="text-gray-500">End: {formatTimestamp(record.endtime)}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-xs text-gray-900">
                        <div className="font-medium">{formatOdometer(record.enddis)}</div>
                        <div className="text-gray-500">Start: {formatOdometer(record.begindis)}</div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-xs text-gray-900 font-medium">{formatDistance(record.totaldistance)}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-xs text-gray-900">{formatEngineHours(record.totalacc)}</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-xs text-gray-900">{calculateIdlePercentage(record.totalacc, record.totalidle).toFixed(1)}%</div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="text-xs text-gray-900">{record.avgspeed.toFixed(1)} km/h</div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                        record.onlinestatus === 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {record.onlinestatus === 1 ? 'Online' : 'Offline'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Results */}
      {!loading && mileageData && (!mileageData.records || mileageData.records.length === 0) && (
        <div className="bg-white rounded shadow-sm p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">No data found</h3>
            <p className="text-xs text-gray-600">No mileage records for the selected date range</p>
          </div>
        </div>
      )}
    </div>
  );
}
