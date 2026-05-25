import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardToken } from '@/lib/dashboardAuth';
import {
  IDLE_STOP_LATEST_FILENAME,
  idleStopJsonFilenameForDate,
  listIdleStopJsonDates,
  readIdleStopJsonReport,
} from '@/lib/idleStopJsonStorage';

/**
 * POST /api/dashboard/idle-stop-json
 * Body: { token?, list?: true, date?: "YYYY-MM-DD", imei?: string }
 * Session-authenticated read of idle_stop_json snapshots (dashboard UI).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!requireDashboardToken(request, body)) {
    return NextResponse.json(
      { status: -1, cause: 'Token required', error: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  if (body.list === true) {
    return NextResponse.json({
      status: 0,
      cause: 'OK',
      dates: listIdleStopJsonDates(),
      latest: IDLE_STOP_LATEST_FILENAME,
    });
  }

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const imei = typeof body.imei === 'string' ? body.imei.trim() : '';
  const filename = date ? idleStopJsonFilenameForDate(date) : IDLE_STOP_LATEST_FILENAME;
  const report = readIdleStopJsonReport(filename);

  if (!report) {
    return NextResponse.json(
      {
        status: -1,
        cause: date
          ? `No idle/stop report found for ${date}`
          : 'No idle/stop report available yet. Run the scheduled job first.',
        error: 'NOT_FOUND',
      },
      { status: 404 }
    );
  }

  if (imei) {
    const vehicles = report.vehicles.filter((v) => v.imei === imei);
    return NextResponse.json({
      ...report,
      deviceCount: vehicles.length,
      vehicles,
      filteredByImei: imei,
    });
  }

  return NextResponse.json(report);
}
