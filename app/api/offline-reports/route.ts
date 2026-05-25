import { NextRequest, NextResponse } from 'next/server';
import {
  filterOfflineReportsByDateParams,
  listOfflineReportFiles,
  OFFLINE_REPORTS_RETENTION_DAYS,
} from '@/lib/offlineReportStorage';

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
 * POST /api/offline-reports
 * Body: { token?, date?, from?, to? } — list saved daily offline Excel files from offline_reports/.
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

  const all = listOfflineReportFiles();
  const filtered = filterOfflineReportsByDateParams(all, { date, from, to });

  return NextResponse.json({
    status: 0,
    cause: 'OK',
    retentionDays: OFFLINE_REPORTS_RETENTION_DAYS,
    files: filtered,
    total: filtered.length,
  });
}
