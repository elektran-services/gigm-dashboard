import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { purgeExpiredMileageReports, resolveSafeMileageReportPath } from '@/lib/mileageReportStorage';

function extractToken(request: NextRequest): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const url = new URL(request.url);
  const q = url.searchParams.get('token');
  if (q && q.length >= 8) return q;
  return null;
}

/**
 * GET /api/mileage-reports/download?category=daily|monthly&file=<xlsx>
 */
export async function GET(request: NextRequest) {
  const token = extractToken(request);
  if (!token || token.length < 8) {
    return NextResponse.json({ status: -1, cause: 'Token required', error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const url = new URL(request.url);
  const categoryRaw = url.searchParams.get('category');
  const category = categoryRaw === 'monthly' ? 'monthly' : categoryRaw === 'daily' ? 'daily' : '';
  if (!category) {
    return NextResponse.json({ status: -1, cause: 'Missing/invalid category' }, { status: 400 });
  }

  const file = url.searchParams.get('file');
  if (!file?.trim()) {
    return NextResponse.json({ status: -1, cause: 'Missing file query parameter' }, { status: 400 });
  }

  purgeExpiredMileageReports();
  const resolved = resolveSafeMileageReportPath(category, file.trim());
  if (!resolved) {
    return NextResponse.json({ status: -1, cause: 'File not found' }, { status: 404 });
  }

  const buf = fs.readFileSync(resolved);
  const name = file.trim().split(/[/\\]/).pop() || 'mileage-report.xlsx';

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
    },
  });
}
