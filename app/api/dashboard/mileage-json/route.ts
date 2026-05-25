import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardToken } from '@/lib/dashboardAuth';
import {
  listMileageJsonDates,
  MILEAGE_LATEST_FILENAME,
  mileageJsonFilenameForDate,
  readMileageJsonReport,
} from '@/lib/mileageJsonStorage';

/**
 * POST /api/dashboard/mileage-json
 * Body: { token?, list?: true, date?: "YYYY-MM-DD", imei?: string }
 * Session-authenticated read of mileage_json snapshots (dashboard UI).
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
      dates: listMileageJsonDates(),
      latest: MILEAGE_LATEST_FILENAME,
    });
  }

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const imei = typeof body.imei === 'string' ? body.imei.trim() : '';
  const filename = date ? mileageJsonFilenameForDate(date) : MILEAGE_LATEST_FILENAME;
  const report = readMileageJsonReport(filename);

  if (!report) {
    return NextResponse.json(
      {
        status: -1,
        cause: date
          ? `No mileage report found for ${date}`
          : 'No mileage report available yet. Run the scheduled job first.',
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
