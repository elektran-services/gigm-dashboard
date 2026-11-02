import { NextRequest, NextResponse } from 'next/server';
import { scanFuelFleet } from '@/lib/fuelFleetScan';

/**
 * POST /api/fuel/scheduled
 * Body: { token, username, reportDate? }
 * Downloads yesterday's reportoiltime (or reportDate) for each vehicle and
 * writes .cache/gps51. Skips a vehicle that already has that day saved.
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

    const report = await scanFuelFleet({
      token,
      username,
      reportDate: body.reportDate,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error('[FuelScheduled]', error);
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
