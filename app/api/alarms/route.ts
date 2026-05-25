import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { devices, startday, endday, offset, needalarm, token } = body;

    console.log('Alarm API - Received request:', { 
      deviceCount: devices?.length,
      startday, 
      endday,
      offset,
      needalarm,
      hasToken: !!token 
    });

    if (!token) {
      console.error('Alarm API - Missing token');
      return NextResponse.json(
        { 
          status: 1,
          cause: 'Token is required',
          error: 'Missing token' 
        },
        { status: 400 }
      );
    }

    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      console.error('Alarm API - Missing or invalid devices array');
      return NextResponse.json(
        { 
          status: 1,
          cause: 'At least one device is required',
          error: 'Invalid devices parameter' 
        },
        { status: 400 }
      );
    }

    if (!startday || !endday) {
      console.error('Alarm API - Missing date range');
      return NextResponse.json(
        { 
          status: 1,
          cause: 'Start and end dates are required',
          error: 'Missing date range' 
        },
        { status: 400 }
      );
    }

    // Build the API URL with token and serverid
    const apiUrl = buildGPS51Url('reportalarm', token);
    console.log('Alarm API - Calling external API');

    // Make the request to the external API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        devices, 
        startday, 
        endday, 
        offset: offset || 1,
        needalarm: needalarm || "5" 
      }),
    });

    console.log('Alarm API - External API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Alarm API - External API error:', errorText);
      return NextResponse.json(
        { 
          status: 1,
          cause: `External API error: ${response.status}`,
          error: errorText 
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Alarm API - External API response:', { 
      status: data.status, 
      alarmCount: data.alarmrecords?.length,
      cause: data.cause 
    });

    // Always return the data with proper status code
    if (data.status === 0) {
      return NextResponse.json(data);
    } else {
      return NextResponse.json(data, { status: 200 });
    }
  } catch (error) {
    console.error('Alarm API - Exception:', error);
    return NextResponse.json(
      { 
        status: 1,
        cause: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
