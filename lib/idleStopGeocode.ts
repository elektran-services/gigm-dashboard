import { API_CONFIG, buildHereReverseGeocodeUrl } from '@/lib/config';

const HERE_DELAY_MS = 100;
const DEFAULT_MAX_KEYS = 400;

export function coordKey(lat: number, lon: number) {
  return `${lat.toFixed(5)}_${lon.toFixed(5)}`;
}

export async function resolveCoordAddressMap(
  keys: string[],
  maxKeys = DEFAULT_MAX_KEYS
): Promise<Record<string, string>> {
  const addressMap: Record<string, string> = {};
  if (!API_CONFIG.HERE.API_KEY || keys.length === 0) return addressMap;

  let n = 0;
  for (const key of keys) {
    if (n >= maxKeys) break;
    if (addressMap[key]) continue;
    const [latS, lonS] = key.split('_');
    try {
      const geoRes = await fetch(buildHereReverseGeocodeUrl(latS, lonS));
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData?.items?.[0]?.address?.label) {
          addressMap[key] = geoData.items[0].address.label;
        }
      }
    } catch {
      /* ignore */
    }
    n += 1;
    await new Promise((r) => setTimeout(r, HERE_DELAY_MS));
  }

  return addressMap;
}
