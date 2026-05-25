import { NextRequest } from 'next/server';

export function extractDashboardToken(
  request: NextRequest,
  body?: Record<string, unknown>
): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const fromBody = body?.token;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}

export function requireDashboardToken(
  request: NextRequest,
  body?: Record<string, unknown>
): string | null {
  const token = extractDashboardToken(request, body);
  if (!token || token.length < 8) return null;
  return token;
}
