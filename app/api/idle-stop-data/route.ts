import { NextRequest, NextResponse } from 'next/server';
import {
  IDLE_STOP_LATEST_FILENAME,
  idleStopJsonFilenameForDate,
  listIdleStopJsonDates,
  readIdleStopJsonReport,
} from '@/lib/idleStopJsonStorage';

function unauthorized() {
  return NextResponse.json(
    { status: -1, cause: 'Unauthorized', error: 'INVALID_API_KEY' },
    { status: 401 }
  );
}

function validateApiKey(request: NextRequest): boolean {
  const expected = process.env.IDLE_STOP_API_KEY?.trim();
  if (!expected) return true;

  const headerKey = request.headers.get('x-api-key')?.trim();
  const queryKey = request.nextUrl.searchParams.get('apiKey')?.trim();
  return headerKey === expected || queryKey === expected;
}

/**
 * GET /api/idle-stop-data
 * Developer JSON API for idle/stop fleet snapshots.
 *
 * Query:
 *   - date=YYYY-MM-DD  — specific report (default: latest.json)
 *   - list=1           — available report dates only
 *   - imei=...         — filter to one vehicle (client-side filter on stored JSON)
 *
 * Auth (optional): set IDLE_STOP_API_KEY in env, pass X-Api-Key header or ?apiKey=
 */
export async function GET(request: NextRequest) {
  if (!validateApiKey(request)) {
    return unauthorized();
  }

  const { searchParams } = request.nextUrl;

  if (searchParams.get('list') === '1') {
    return NextResponse.json({
      status: 0,
      cause: 'OK',
      dates: listIdleStopJsonDates(),
      latest: IDLE_STOP_LATEST_FILENAME,
    });
  }

  const date = searchParams.get('date')?.trim();
  const imei = searchParams.get('imei')?.trim();
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
