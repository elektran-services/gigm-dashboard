import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deviceid, startday, endday, offset, token } = body;

    if (!token) {
      return NextResponse.json(
        { status: -1, cause: 'No token provided', error: 'MISSING_TOKEN' },
        { status: 401 }
      );
    }

    if (!deviceid) {
      return NextResponse.json(
        { status: -1, cause: 'Device ID is required', error: 'MISSING_DEVICEID' },
        { status: 400 }
      );
    }

    if (!startday || !endday) {
      return NextResponse.json(
        { status: -1, cause: 'Start day and end day are required', error: 'MISSING_DATE_RANGE' },
        { status: 400 }
      );
    }

    const apiUrl = buildGPS51Url('reportmileagedetail', token);
    
    const requestBody = {
      deviceid,
      startday,
      endday,
      offset: offset || 8
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { status: data.status || -1, cause: data.cause || 'API request failed', error: 'API_ERROR' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in mileage API route:', error);
    return NextResponse.json(
      { 
        status: -1, 
        cause: 'Internal server error', 
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' 
      },
      { status: 500 }
    );
  }
}
