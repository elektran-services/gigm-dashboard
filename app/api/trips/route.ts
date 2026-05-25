import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url, buildHereReverseGeocodeUrl } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deviceid, starttime, endtime, timezone, token } = body;

    console.log('Trip request received:', { deviceid, starttime, endtime, timezone });

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

    if (!starttime || !endtime) {
      return NextResponse.json(
        { status: -1, cause: 'Start time and end time are required', error: 'MISSING_TIME_RANGE' },
        { status: 400 }
      );
    }

    const apiUrl = buildGPS51Url('querytrips', token);
    
    const requestBody = {
      deviceid,
      starttime,
      endtime,
      timezone: timezone || 1
    };

    console.log('Calling GPS API:', apiUrl);
    console.log('Request body:', JSON.stringify(requestBody));

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    console.log('GPS API response status:', data.status);

    if (!response.ok) {
      console.error('GPS API error:', data);
      return NextResponse.json(
        { status: data.status || -1, cause: data.cause || 'API request failed', error: 'API_ERROR' },
        { status: response.status }
      );
    }

    // Enhance addressmap with HERE API geocoding
    if (data.status === 0 && data.totaltrips && data.totaltrips.length > 0) {
      const addressmap: Record<string, string> = data.addressmap || {};
      
      // Collect unique coordinates from all trips
      const coordinates = new Set<string>();
      for (const trip of data.totaltrips) {
        if (trip.slat && trip.slon) {
          coordinates.add(`${trip.slat.toFixed(5)}_${trip.slon.toFixed(5)}`);
        }
        if (trip.elat && trip.elon) {
          coordinates.add(`${trip.elat.toFixed(5)}_${trip.elon.toFixed(5)}`);
        }
      }

      // Fetch addresses for coordinates not in the map
      for (const coordKey of coordinates) {
        if (!addressmap[coordKey]) {
          try {
            const [lat, lon] = coordKey.split('_');
            const geoResponse = await fetch(buildHereReverseGeocodeUrl(lat, lon));
            
            if (geoResponse.ok) {
              const geoData = await geoResponse.json();
              if (geoData.items && geoData.items.length > 0 && geoData.items[0].address.label) {
                addressmap[coordKey] = geoData.items[0].address.label;
              }
            }
            // Small delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (err) {
            console.error('Error fetching address:', err);
          }
        }
      }
      
      data.addressmap = addressmap;
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in trips API route:', error);
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
