import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardToken } from '@/lib/dashboardAuth';
import { getDashboardReportStats } from '@/lib/dashboardReportStats';

function extractToken(request: NextRequest, body?: Record<string, unknown>): string | null {
  return requireDashboardToken(request, body);
}

/**
 * POST /api/dashboard-stats
 * Body: { token? } — local saved report file counts (no GPS51 calls).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const token = extractToken(request, body);
  if (!token) {
    return NextResponse.json({ status: -1, cause: 'Token required', error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const stats = getDashboardReportStats();

  return NextResponse.json({
    status: 0,
    cause: 'OK',
    ...stats,
  });
}
