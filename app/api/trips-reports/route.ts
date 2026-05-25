import { NextRequest, NextResponse } from 'next/server';
import {
  listTripReportFiles,
  filterTripReportsByDateParams,
  TRIPS_REPORTS_RETENTION_DAYS,
} from '@/lib/tripsReportStorage';

function extractToken(request: NextRequest, body?: Record<string, unknown>): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const fromBody = body?.token;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}

/**
 * POST /api/trips-reports
 * Body: { token?, date?, from?, to? } — list saved daily trip Excel files from trips/.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const token = extractToken(request, body);
  if (!token || token.length < 8) {
    return NextResponse.json({ status: -1, cause: 'Token required', error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const date = typeof body.date === 'string' ? body.date.trim() : undefined;
  const from = typeof body.from === 'string' ? body.from.trim() : undefined;
  const to = typeof body.to === 'string' ? body.to.trim() : undefined;

  const all = listTripReportFiles();
  const filtered = filterTripReportsByDateParams(all, { date, from, to });

  return NextResponse.json({
    status: 0,
    cause: 'OK',
    retentionDays: TRIPS_REPORTS_RETENTION_DAYS,
    files: filtered,
    total: filtered.length,
  });
}
