import { NextRequest, NextResponse } from 'next/server';
import { reverseGeocode } from '@/lib/reverseGeocode';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (token.length < 8) {
      return NextResponse.json({ address: null, error: 'MISSING_TOKEN' }, { status: 401 });
    }

    const address = await reverseGeocode(body?.lat, body?.lon);
    return NextResponse.json({ address });
  } catch {
    return NextResponse.json({ address: null }, { status: 500 });
  }
}
