/** Browser lookup. The PositionStack key stays on the server. */
export async function lookupAddress(
  token: string,
  lat: number | string,
  lon: number | string
): Promise<string | null> {
  const response = await fetch('/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, lat: Number(lat), lon: Number(lon) }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return typeof data.address === 'string' && data.address.trim() ? data.address.trim() : null;
}
