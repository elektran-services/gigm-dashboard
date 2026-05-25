import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, token } = body;

    console.log('API Route - Received request:', { 
      username, 
      tokenLength: token?.length,
      hasToken: !!token,
      hasUsername: !!username 
    });

    if (!username || !token) {
      console.error('API Route - Missing credentials:', { username: !!username, token: !!token });
      return NextResponse.json(
        { 
          status: 1,
          cause: 'Username and token are required',
          error: 'Missing credentials' 
        },
        { status: 400 }
      );
    }

    // Build the API URL with token and serverid
    const apiUrl = buildGPS51Url('querymonitorlist', token);
    console.log('API Route - Calling external API for username:', username);

    // Make the request to the external API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
    });

    console.log('API Route - External API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Route - External API error:', errorText);
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
    console.log('API Route - External API response:', { 
      status: data.status, 
      groupCount: data.groups?.length,
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
    console.error('API Route - Exception:', error);
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
