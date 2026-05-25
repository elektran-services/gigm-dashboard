import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, token, deviceids, lastquerypositiontime } = body;

    console.log('LastPosition API - Received request:', { 
      username, 
      deviceidsCount: deviceids?.length,
      lastquerypositiontime 
    });

    if (!username || !token) {
      console.error('LastPosition API - Missing required fields');
      return NextResponse.json(
        { 
          status: 1,
          cause: 'Username and token are required',
          error: 'Missing required fields' 
        },
        { status: 400 }
      );
    }

    // Build the API URL with token and serverid
    const apiUrl = buildGPS51Url('lastposition', token);
    console.log('LastPosition API - Calling external API for username:', username);

    // Make the request to the external API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        username,
        deviceids: deviceids || [],
        lastquerypositiontime: lastquerypositiontime || 0
      }),
    });

    console.log('LastPosition API - External API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('LastPosition API - External API error:', errorText);
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
    console.log('LastPosition API - External API response:', { 
      status: data.status, 
      recordsCount: data.records?.length,
      cause: data.cause 
    });

    // Always return the data with proper status code
    if (data.status === 0) {
      return NextResponse.json(data);
    } else {
      // Return the error from the API but with the data structure intact
      return NextResponse.json(data, { status: 200 });
    }
  } catch (error) {
    console.error('LastPosition API - Exception:', error);
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
