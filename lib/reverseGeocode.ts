const GEOCODE_TIMEOUT_MS = 5000;

/**
 * Reverse-geocode one point with PositionStack.
 * Returns the place label, or null when the key is missing or the lookup fails.
 */
export async function reverseGeocode(
  lat: number | string,
  lon: number | string,
  timeoutMs = GEOCODE_TIMEOUT_MS
): Promise<string | null> {
  const key = process.env.POSITIONSTACK_API_KEY || '';
  if (!key) return null;

  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const base = process.env.POSITIONSTACK_API_URL || 'https://api.positionstack.com/v1/reverse';
  const url = `${base}?access_key=${encodeURIComponent(key)}&query=${encodeURIComponent(`${latitude},${longitude}`)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    const label = data?.data?.[0]?.label;
    return typeof label === 'string' && label.trim() ? label.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
