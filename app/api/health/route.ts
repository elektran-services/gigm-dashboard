import { NextResponse } from 'next/server';

/** Lightweight liveness check for monitoring / load balancers (no API key). */
export async function GET() {
  return NextResponse.json({ status: 0, cause: 'OK', service: 'gigm-dashboard' });
}
