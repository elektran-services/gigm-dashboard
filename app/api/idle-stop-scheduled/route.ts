import { NextRequest, NextResponse } from 'next/server';
import { scanIdleStopFleet } from '@/lib/idleStopFleetScan';

/**
 * POST /api/idle-stop-scheduled
 * Body: { token, username, reportDate? }
 * Scans fleet idle/stop data, writes idle_stop_json/idle_stop_YYYY-MM-DD.json + latest.json.
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

    const { report, jsonFiles } = await scanIdleStopFleet({
      token,
      username,
      reportDate: body.reportDate,
    });

    return NextResponse.json({
      ...report,
      jsonFile: jsonFiles.datedName,
    });
  } catch (error) {
    console.error('[IdleStopScheduled]', error);
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
