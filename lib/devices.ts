import { getAuthToken, getUserData } from "./auth";
import { buildGPS51Url } from "./config";
import { apiCallWithAutoRefresh } from "./utils";

export interface DeviceListItem {
  deviceid: string;
  devicename: string;
}

export interface DeviceGroup<T = DeviceListItem> {
  groupid: number;
  groupname: string;
  devices: T[];
}

interface DeviceListResponse {
  status: number;
  cause?: string;
  groups?: Array<{
    groupid: number;
    groupname: string;
    devices?: Array<Record<string, unknown> & { deviceid: string; devicename?: string }>;
  }>;
}

function isIpWhitelistError(cause?: string): boolean {
  if (!cause) return false;
  const lower = cause.toLowerCase();
  return lower.includes("white list") || lower.includes("whitelist");
}

async function fetchDevicesFromGps51(
  username: string,
  token: string
): Promise<DeviceListResponse> {
  const response = await fetch(buildGPS51Url("querymonitorlist", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return response.json();
}

/**
 * Load devices via /api/devices, falling back to a direct GPS51 call from the
 * browser when the server IP is not whitelisted (login works client-side only).
 */
export async function fetchDeviceGroups<T = DeviceListItem>(): Promise<{
  groups: DeviceGroup<T>[];
  error?: string;
}> {
  const token = getAuthToken();
  const userData = getUserData();

  if (!token || !userData?.username) {
    return { groups: [], error: "Authentication required. Please log in again." };
  }

  const username = userData.username;
  let data: DeviceListResponse;

  try {
    data = await apiCallWithAutoRefresh("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, token }),
    });
  } catch {
    data = { status: 1, cause: "Failed to load devices" };
  }

  if (data.status !== 0 && isIpWhitelistError(data.cause)) {
    const refreshedToken = getAuthToken() || token;
    data = await fetchDevicesFromGps51(username, refreshedToken);
  }

  if (data.status === 0 && data.groups) {
    const groups = data.groups.map((group) => ({
      groupid: group.groupid,
      groupname: group.groupname,
      devices: (group.devices || []).map((device) => ({
        ...device,
        deviceid: device.deviceid,
        devicename: device.devicename || device.deviceid,
      })) as T[],
    }));
    return { groups };
  }

  return {
    groups: [],
    error: data.cause || "Failed to load devices",
  };
}

export function flattenDeviceGroups(groups: DeviceGroup<DeviceListItem>[]): DeviceListItem[] {
  return groups.flatMap((group) => group.devices);
}
