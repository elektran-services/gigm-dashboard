import { NextRequest, NextResponse } from 'next/server';
import { scanMileageFleet } from '@/lib/mileageFleetScan';

/**
 * POST /api/mileage-scheduled
 * Body: { token, username, reportDate? }
 * Scans fleet odometers, writes mileage_json/mileage_YYYY-MM-DD.json + latest.json.
 * No email. No Excel.
 */
export async function POST(request: NextRequest) {
  try {
    let body: { token?: string; username?: string; reportDate?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { status: -1, cause: 'Invalid JSON body', error: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const { token, username } = body;
    if (!token || !username) {
      return NextResponse.json(
        { status: -1, cause: 'Token and username are required', error: 'MISSING_CREDENTIALS' },
        { status: 401 }
      );
    }

    const reportDate = body.reportDate ? new Date(body.reportDate) : new Date();

    const { report, jsonFiles } = await scanMileageFleet({
      token,
      username,
      reportDate,
    });

    return NextResponse.json({
      ...report,
      jsonFile: jsonFiles.datedName,
    });
  } catch (error) {
    console.error('[MileageScheduled]', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const isToken = message.toLowerCase().includes('token');
    return NextResponse.json(
      {
        status: -1,
        cause: message,
        error: isToken ? 'TOKEN_EXPIRED' : 'UNKNOWN_ERROR',
      },
      { status: isToken ? 401 : 500 }
    );
  }
}
