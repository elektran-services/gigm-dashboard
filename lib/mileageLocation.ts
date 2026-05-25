import { API_CONFIG, buildHereReverseGeocodeUrl } from '@/lib/config';

const HERE_GEOCODE_DELAY_MS = 100;

export interface GpsLastPositionRecord {
  deviceid: string;
  callat: number;
  callon: number;
  speed: number;
  course: number;
  updatetime: number;
  strstatus?: string;
  strstatusen?: string;
  moving: number;
  gotsrc: string;
  parklat?: number;
  parklon?: number;
}

export interface VehicleLocationJson {
  latitude: number;
  longitude: number;
  address: string | null;
  /** Speed in km/h (converted from GPS51 raw units when needed). */
  speedKmh: number | null;
  /** Raw speed value from GPS51 lastposition (before conversion). */
  speedRaw: number | null;
  course: number | null;
  /** Human-readable status from GPS51 (e.g. "ACC OFF …/Defence"). */
  status: string | null;
  /** GPS51 `moving` flag: 1 = moving, 0 = not moving (may disagree with status text). */
  moving: boolean;
  positionUpdatedAt: string | null;
  gpsSource: string | null;
}

/**
 * GPS51 lastposition `speed` is not always km/h. Trip/overspeed APIs use speed/1000.
 * Values like 78000 → 78 km/h.
 */
export function normalizeSpeedKmh(speed: number): number | null {
  if (!Number.isFinite(speed)) return null;
  if (speed === 0) return 0;
  if (Math.abs(speed) >= 1000) {
    return Math.round((speed / 1000) * 10) / 10;
  }
  return Math.round(speed * 10) / 10;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeout = 20000
) {
  const maxAttempts = retries + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(tid);
      return response;
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  throw new Error('fetchWithRetry failed');
}

export async function fetchFleetLastPositions(
  lastPositionUrl: string,
  username: string
): Promise<Map<string, GpsLastPositionRecord>> {
  const map = new Map<string, GpsLastPositionRecord>();

  const response = await fetchWithRetry(
    lastPositionUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        deviceids: [],
        lastquerypositiontime: 0,
      }),
    },
    2,
    60000
  );

  const data = await response.json();
  if (data.status !== 0 || !Array.isArray(data.records)) {
    console.warn('[MileageLocation] lastposition failed:', data.cause || data.status);
    return map;
  }

  for (const rec of data.records as GpsLastPositionRecord[]) {
    if (rec?.deviceid) {
      map.set(rec.deviceid, rec);
    }
  }

  return map;
}

export async function resolveAddressMap(
  positions: Iterable<GpsLastPositionRecord>
): Promise<Record<string, string>> {
  const addressMap: Record<string, string> = {};
  if (!API_CONFIG.HERE.API_KEY) {
    return addressMap;
  }

  const keys = new Set<string>();
  for (const pos of positions) {
    if (Number.isFinite(pos.callat) && Number.isFinite(pos.callon)) {
      keys.add(`${pos.callat.toFixed(5)}_${pos.callon.toFixed(5)}`);
    }
  }

  for (const key of keys) {
    try {
      const [lat, lon] = key.split('_');
      const geoRes = await fetch(buildHereReverseGeocodeUrl(lat, lon));
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData?.items?.[0]?.address?.label) {
          addressMap[key] = geoData.items[0].address.label;
        }
      }
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, HERE_GEOCODE_DELAY_MS));
  }

  return addressMap;
}

export function buildVehicleLocation(
  position: GpsLastPositionRecord | undefined,
  addressMap: Record<string, string>
): VehicleLocationJson | null {
  if (!position) return null;

  const lat = Number(position.callat);
  const lon = Number(position.callon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const coordKey = `${lat.toFixed(5)}_${lon.toFixed(5)}`;

  const speedRaw = Number.isFinite(position.speed) ? position.speed : null;

  return {
    latitude: lat,
    longitude: lon,
    address: addressMap[coordKey] ?? null,
    speedKmh: speedRaw != null ? normalizeSpeedKmh(speedRaw) : null,
    speedRaw,
    course: Number.isFinite(position.course) ? position.course : null,
    status: position.strstatusen || position.strstatus || null,
    moving: position.moving > 0,
    positionUpdatedAt:
      position.updatetime && Number.isFinite(position.updatetime)
        ? new Date(position.updatetime).toISOString()
        : null,
    gpsSource: position.gotsrc || null,
  };
}
