import { NextRequest, NextResponse } from 'next/server';
import {
  listMileageJsonDates,
  MILEAGE_LATEST_FILENAME,
  mileageJsonFilenameForDate,
  readMileageJsonReport,
} from '@/lib/mileageJsonStorage';

function unauthorized() {
  return NextResponse.json(
    { status: -1, cause: 'Unauthorized', error: 'INVALID_API_KEY' },
    { status: 401 }
  );
}

function validateApiKey(request: NextRequest): boolean {
  const expected = process.env.MILEAGE_API_KEY?.trim();
  if (!expected) return true;

  const headerKey = request.headers.get('x-api-key')?.trim();
  const queryKey = request.nextUrl.searchParams.get('apiKey')?.trim();
  return headerKey === expected || queryKey === expected;
}

/**
 * GET /api/mileage-data
 * Developer JSON API for mileage maintenance snapshots.
 *
 * Query:
 *   - date=YYYY-MM-DD  — specific report (default: latest.json)
 *   - list=1           — return available report dates only
 *   - imei=...         — filter to one vehicle (stored JSON)
 *
 * Auth (optional): set MILEAGE_API_KEY in env, pass X-Api-Key header or ?apiKey=
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
      dates: listMileageJsonDates(),
      latest: MILEAGE_LATEST_FILENAME,
    });
  }

  const date = searchParams.get('date')?.trim();
  const imei = searchParams.get('imei')?.trim();
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
