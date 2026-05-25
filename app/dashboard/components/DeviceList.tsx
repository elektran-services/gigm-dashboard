"use client";

import { useEffect, useState } from "react";
import { fetchDeviceGroups } from "@/lib/devices";

interface Device {
  deviceid: string;
  devicename: string;
  devicetype: number;
  simnum: string;
  simiccid: string | null;
  createtime: number;
  initloctime: number;
  firstloctime: number;
  overduetime: number;
  expirenotifytime: number;
  prechargeyears: number;
  remark: string | null;
  remark2: string | null;
  creater: string;
  videochannelcount: number;
  videochannelsetting: string | null;
  lastactivetime: number;
  isfree: number;
  allowedit: number;
  stared: number;
  icon: number;
  loginname: string | null;
  forwardid: string | null;
  needalarmstr: string;
  offlinedelay: number;
  cartagcolor: number;
  packageids: number;
  notifyphonenumisopen: number;
  devicetag: string | null;
}

interface Group {
  groupid: number;
  groupname: string;
  remark: string | null;
  shared: number;
  devices: Device[];
}

interface DeviceListResponse {
  status: number;
  cause: string;
  groups: Group[];
}

export default function DeviceList() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;

  useEffect(() => {
    fetchDeviceList();
  }, []);

  // Reset to page 1 when search term or group changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedGroup]);

  const fetchDeviceList = async () => {
    setIsLoading(true);
    setError("");

    try {
      const { groups, error } = await fetchDeviceGroups<Device>();

      if (error) {
        setError(error);
        return;
      }

      const mappedGroups: Group[] = groups.map((group) => ({
        groupid: group.groupid,
        groupname: group.groupname,
        remark: null,
        shared: 0,
        devices: group.devices,
      }));

      setGroups(mappedGroups);
      if (mappedGroups.length > 0) {
        setSelectedGroup(mappedGroups[0].groupid);
      }
    } catch (err) {
      console.error("DeviceList - Exception:", err);
      setError("An error occurred while fetching device list");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const isDeviceActive = (lastActivetime: number) => {
    const now = Date.now();
    const diffMinutes = (now - lastActivetime) / 1000 / 60;
    return diffMinutes < 30; // Consider active if last activity was within 30 minutes
  };

  const filteredGroups = groups.map(group => ({
    ...group,
    devices: group.devices.filter(device =>
      device.devicename.toLowerCase().includes(searchTerm.toLowerCase()) ||
      device.deviceid.includes(searchTerm) ||
      device.simnum.includes(searchTerm)
    ),
  })).filter(group => group.devices.length > 0);

  const currentGroup = filteredGroups.find(g => g.groupid === selectedGroup) || filteredGroups[0];

  // Pagination calculations
  const totalDevices = currentGroup?.devices.length || 0;
  const totalPages = Math.ceil(totalDevices / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentDevices = currentGroup?.devices.slice(startIndex, endIndex) || [];

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#e31d00]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        <p className="font-medium">Error</p>
        <p className="text-sm">{error}</p>
        <button
          onClick={fetchDeviceList}
          className="mt-2 text-sm underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Vehicle Fleet</h2>
        <p className="text-sm text-gray-600 mt-0.5">
          Total: {groups.reduce((acc, g) => acc + g.devices.length, 0)} devices across {groups.length} group(s)
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative w-1/4">
        <input
          type="text"
          placeholder="Search devices..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-1.5 pl-9 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#e31d00] focus:border-transparent text-gray-900"
        />
        <svg
          className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Group Tabs */}
      {filteredGroups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {filteredGroups.map((group) => (
            <button
              key={group.groupid}
              onClick={() => setSelectedGroup(group.groupid)}
              className={`px-3 py-1.5 text-sm rounded whitespace-nowrap transition-colors ${
                selectedGroup === group.groupid
                  ? "bg-[#e31d00] text-gray-900 font-medium"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {group.groupname} ({group.devices.length})
            </button>
          ))}
        </div>
      )}

      {/* Device Table */}
      {currentGroup && totalDevices > 0 ? (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                    IMEI
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                    Device Name
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                    Last Active
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {currentDevices.map((device, index) => {
                  const isActive = isDeviceActive(device.lastactivetime);
                  const globalIndex = startIndex + index + 1;
                  
                  return (
                    <tr key={device.deviceid} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">
                        {globalIndex}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-mono">
                        {device.deviceid}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-900">
                        <span className="font-medium">{device.devicename}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">
                        {formatDate(device.lastactivetime)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-2">
                          <button className="text-gray-600 hover:text-gray-900 transition-colors" title="View Details">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </button>
                          <button className="text-[#e31d00] hover:text-[#f04a33] transition-colors" title="Track">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                        </div>
                      </td>
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
                <span className="font-medium">{Math.min(endIndex, totalDevices)}</span> of{" "}
                <span className="font-medium">{totalDevices}</span> devices
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
                    // Show first page, last page, current page, and pages around current
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
      ) : (
        <div className="text-center py-8 bg-gray-50 rounded">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-gray-600">No devices found</p>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="mt-2 text-xs text-[#e31d00] hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      )}
    </div>
  );
}
