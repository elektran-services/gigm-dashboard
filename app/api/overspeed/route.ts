import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url, buildHereReverseGeocodeUrl } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deviceid, begintime, endtime, speedlimit, token } = body;

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

    if (!begintime || !endtime) {
      return NextResponse.json(
        { status: -1, cause: 'Start time and end time are required', error: 'MISSING_TIME_RANGE' },
        { status: 400 }
      );
    }

    const speedLimit = speedlimit || 80; // Default 80 km/h

    // Call querytrips API endpoint
    const apiUrl = buildGPS51Url('querytrips', token);
    
    const requestBody = {
      deviceid,
      starttime: begintime,
      endtime: endtime,
      timezone: 8  // Default China time zone
    };

    console.log('Overspeed API - Requesting trips:', requestBody);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error('GPS API HTTP Error:', response.status, response.statusText);
      return NextResponse.json(
        { status: -1, cause: `API request failed: ${response.statusText}`, error: 'API_ERROR' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Trips API Response:', { status: data.status, totalTrips: data.totaltrips?.length || 0 });

    if (data.status !== 0) {
      console.error('GPS API Error:', data.cause);
      return NextResponse.json(
        { status: data.status || -1, cause: data.cause || 'API request failed', error: 'API_ERROR' },
        { status: 400 }
      );
    }

    // Parse the requested date range
    const requestedStartTime = new Date(begintime).getTime();
    const requestedEndTime = new Date(endtime).getTime();
    
    console.log('Requested date range:', { 
      start: begintime, 
      end: endtime,
      startMs: requestedStartTime,
      endMs: requestedEndTime 
    });

    // Extract overspeed violations from totaltrips
    const overspeedRecords: any[] = [];

    if (data.totaltrips && Array.isArray(data.totaltrips) && data.totaltrips.length > 0) {
      for (const trip of data.totaltrips) {
        // Filter trips by date range - API returns all trips, we need to filter
        if (trip.starttime < requestedStartTime || trip.starttime > requestedEndTime) {
          continue; // Skip trips outside the requested date range
        }
        // Speed in API response is in meters per hour
        // Convert to km/h by dividing by 1000
        const maxSpeedKmh = trip.maxspeed ? trip.maxspeed / 1000 : 0;
        const avgSpeedKmh = trip.averagespeed ? trip.averagespeed / 1000 : 0;

        console.log(`Trip ${trip.starttime}: maxspeed=${maxSpeedKmh} km/h, avgspeed=${avgSpeedKmh} km/h, limit=${speedLimit} km/h`);

        // Check if max speed exceeds the limit
        if (maxSpeedKmh > speedLimit) {
          // Calculate overspeed duration
          const tripDuration = trip.triptime || (trip.endtime - trip.starttime);
          let overspeedDuration = 0;
          
          if (avgSpeedKmh > speedLimit) {
            // Average speed also exceeded, likely overspeeding for most of the trip
            overspeedDuration = Math.floor(tripDuration * 0.7);
          } else {
            // Only max speed exceeded, likely brief overspeed
            overspeedDuration = Math.floor(tripDuration * 0.2);
          }

          overspeedRecords.push({
            deviceid: data.deviceid,
            begintime: trip.starttime,
            endtime: trip.endtime,
            startlat: trip.slat,
            startlon: trip.slon,
            endlat: trip.elat,
            endlon: trip.elon,
            maxspeed: maxSpeedKmh,
            avgspeed: avgSpeedKmh,
            speedlimit: speedLimit,
            overspeed: maxSpeedKmh - speedLimit,
            duration: tripDuration,
            overspeedduration: overspeedDuration,
            distance: trip.tripdistance ? trip.tripdistance / 1000 : 0,
            startaddress: '',
            endaddress: ''
          });
        }
      }
    }

    console.log(`Found ${overspeedRecords.length} overspeed violations`);

    // Enhance with HERE API addresses (limit to prevent timeout)
    if (overspeedRecords.length > 0) {
      const MAX_GEOCODE_RECORDS = 30;
      const GEOCODE_TIMEOUT = 5000;
      
      const recordsToGeocode = overspeedRecords.slice(0, MAX_GEOCODE_RECORDS);
      
      for (const record of recordsToGeocode) {
        // Geocode start location
        if (record.startlat && record.startlon &&
            !isNaN(record.startlat) && !isNaN(record.startlon) &&
            Math.abs(record.startlat) <= 90 && Math.abs(record.startlon) <= 180) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT);
            
            const geoResponse = await fetch(
              buildHereReverseGeocodeUrl(record.startlat, record.startlon),
              { signal: controller.signal }
            );
            
            clearTimeout(timeoutId);
            
            if (geoResponse.ok) {
              const geoData = await geoResponse.json();
              if (geoData.items && geoData.items.length > 0 && geoData.items[0].address?.label) {
                record.startaddress = geoData.items[0].address.label;
              }
            }
            
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (err) {
            console.error('Error fetching start address:', err);
          }
        }

        // Geocode end location
        if (record.endlat && record.endlon &&
            !isNaN(record.endlat) && !isNaN(record.endlon) &&
            Math.abs(record.endlat) <= 90 && Math.abs(record.endlon) <= 180) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT);
            
            const geoResponse = await fetch(
              buildHereReverseGeocodeUrl(record.endlat, record.endlon),
              { signal: controller.signal }
            );
            
            clearTimeout(timeoutId);
            
            if (geoResponse.ok) {
              const geoData = await geoResponse.json();
              if (geoData.items && geoData.items.length > 0 && geoData.items[0].address?.label) {
                record.endaddress = geoData.items[0].address.label;
              }
            }
            
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (err) {
            console.error('Error fetching end address:', err);
          }
        }
      }

      if (overspeedRecords.length > MAX_GEOCODE_RECORDS) {
        console.log(`Geocoded ${MAX_GEOCODE_RECORDS} of ${overspeedRecords.length} records to prevent timeout`);
      }
    }

    return NextResponse.json({
      status: 0,
      cause: 'OK',
      speedlimit: speedLimit,
      totalviolations: overspeedRecords.length,
      records: overspeedRecords
    });

  } catch (error) {
    console.error('Error in overspeed API route:', error);
    
    let errorMessage = 'Internal server error';
    let statusCode = 500;
    
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        errorMessage = 'Request timeout - the operation took too long';
        statusCode = 504;
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Network error - failed to connect to API';
        statusCode = 503;
      } else {
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json(
      { 
        status: -1, 
        cause: errorMessage, 
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: statusCode }
    );
  }
}
