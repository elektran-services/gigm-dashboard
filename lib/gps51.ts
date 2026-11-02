import { buildGPS51Url } from './config';

export async function gps51Post<T = Record<string, unknown>>(
  action: string,
  token: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = buildGPS51Url(action, token);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`GPS51 HTTP ${response.status} for action=${action}`);
  }
  return response.json() as Promise<T>;
}
