import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url } from '@/lib/config';
import { MONITORING_CONFIG } from '@/lib/config';
import {
  GENERATED_REPORTS_DIR,
  ensureGeneratedReportsDir,
  purgeExpiredGeneratedReports,
  writeDailyCompleteMarker,
  resolveViolationReportPath,
} from '@/lib/generatedReportsStorage';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

interface FailedEmailEntry {
  type: 'violations' | 'no_violations';
  dateStr: string;
  reportDateDisplay: string;
  filePath?: string;
  filename?: string;
  violationsCount?: number;
  deviceCount?: number;
  retryCount: number;
  queuedAt: string;
  lastError: string;
}

/** Logs and email queue only; generated .xlsx files go to generated_reports/ */
const REPORTS_DIR = path.join(process.cwd(), 'overspeed_reports');
const SENT_FILES_DIR = path.join(process.cwd(), 'sent file');
const FAILED_EMAIL_QUEUE_FILE = path.join(REPORTS_DIR, 'failed_email_queue.json');
const MAX_EMAIL_RETRIES = 5;

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadFailedEmailQueue(): FailedEmailEntry[] {
  try {
    if (!fs.existsSync(FAILED_EMAIL_QUEUE_FILE)) return [];
    const raw = fs.readFileSync(FAILED_EMAIL_QUEUE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[Email] Failed to load failed-email queue:', error);
    return [];
  }
}

function saveFailedEmailQueue(queue: FailedEmailEntry[]) {
  try {
    fs.writeFileSync(FAILED_EMAIL_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Email] Failed to save failed-email queue:', error);
  }
}

function archiveSentFile(sourceFilePath: string) {
  try {
    if (!fs.existsSync(sourceFilePath)) return;
    ensureDir(SENT_FILES_DIR);
    const baseName = path.basename(sourceFilePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targetPath = path.join(SENT_FILES_DIR, `${timestamp}_${baseName}`);
    fs.copyFileSync(sourceFilePath, targetPath);
    console.log(`[Email] Archived sent report: ${targetPath}`);
  } catch (error) {
    console.error('[Email] Failed to archive sent report:', error);
  }
}

// Email sending function for no violations
async function sendNoViolationsEmail(reportDate: string, deviceCount: number) {
  // Check if email is enabled
  if (process.env.ENABLE_EMAIL_REPORTS !== 'true') {
    console.log('[Email] Email reports disabled in configuration');
    return false;
  }

  const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_TO'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  if (missingVars.length > 0) {
    console.log(`[Email] Missing configuration: ${missingVars.join(', ')}`);
    return false;
  }

  try {
    const smtpPort = parseInt(process.env.SMTP_PORT || '465');
    const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465;

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Prepare recipient list
    const recipients = process.env.EMAIL_TO?.split(',').map(email => email.trim()).join(', ');

    // Send email
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: recipients,
      subject: `✅ Daily Overspeed Report - ${reportDate} (No Violations)`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; padding: 20px; text-align: center;">
            <h2 style="margin: 0; color: #fff;">✅ Daily Overspeed Report</h2>
            <p style="margin: 5px 0 0 0; color: #e8f5e9; font-size: 14px;">${reportDate}</p>
          </div>
          
          <div style="padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: #e8f5e9; padding: 20px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
              <h3 style="margin: 0 0 10px 0; color: #2e7d32; font-size: 24px;">🎉 Great News!</h3>
              <p style="margin: 0; font-size: 18px; color: #388e3c; font-weight: 500;">
                No overspeed violations detected today
              </p>
            </div>
            
            <div style="background-color: white; padding: 15px; border-left: 4px solid #4CAF50; margin-bottom: 20px;">
              <h3 style="margin-top: 0; color: #333;">Daily Summary</h3>
              <ul style="line-height: 1.8; color: #555;">
                <li><strong>Report Date:</strong> ${reportDate}</li>
                <li><strong>Total Violations:</strong> 0</li>
                <li><strong>Devices Monitored:</strong> ${deviceCount}</li>
                <li><strong>Speed Limit:</strong> ${MONITORING_CONFIG.OVERSPEED_LIMIT_KMH} km/h</li>
                <li><strong>Duration Threshold:</strong> ${MONITORING_CONFIG.OVERSPEED_DURATION_THRESHOLD_MS / 1000} seconds</li>
                <li><strong>Status:</strong> <span style="color: #4CAF50; font-weight: bold;">✓ ALL CLEAR</span></li>
              </ul>
            </div>
            
            <div style="background-color: #fde8e6; padding: 15px; border-left: 4px solid #e31d00; margin-bottom: 20px;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                <strong>📋 Note:</strong> All ${deviceCount} device(s) were checked for overspeed violations during the monitoring period from 00:00:00 to 23:59:59 on the report date. No violations exceeded the speed limit of ${MONITORING_CONFIG.OVERSPEED_LIMIT_KMH} km/h for more than ${MONITORING_CONFIG.OVERSPEED_DURATION_THRESHOLD_MS / 1000} seconds.
              </p>
            </div>
            
            <p style="color: #666; font-size: 14px; text-align: center;">
              Keep up the excellent safety performance! 🚗💨
            </p>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px;">
              <p>This is an automated daily message from the GIGMotors Fleet Monitoring System.</p>
              <p>Report generated: ${new Date().toLocaleString()}</p>
              <p><strong>Schedule:</strong> Daily check starts at 23:59 (11:59 PM), email sent around 00:30 AM</p>
            </div>
          </div>
        </div>
      `,
    });

    console.log(`[Email] No violations report sent successfully to: ${recipients}`);
    console.log(`[Email] Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send email:', error);
    return false;
  }
}

// Email sending function
async function sendEmailWithAttachment(
  filePath: string, 
  filename: string, 
  violationsCount: number,
  reportDate: string
) {
  // Check if email is enabled
  if (process.env.ENABLE_EMAIL_REPORTS !== 'true') {
    console.log('[Email] Email reports disabled in configuration');
    return false;
  }

  const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_TO'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  if (missingVars.length > 0) {
    console.log(`[Email] Missing configuration: ${missingVars.join(', ')}`);
    return false;
  }

  try {
    const smtpPort = parseInt(process.env.SMTP_PORT || '465');
    const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465;

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Prepare recipient list
    const recipients = process.env.EMAIL_TO?.split(',').map(email => email.trim()).join(', ');

    // Send email
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: recipients,
      subject: `⚠️ Daily Overspeed Alert - ${reportDate} (${violationsCount} Violations)`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #e31d00; padding: 20px; text-align: center;">
            <h2 style="margin: 0; color: #000;">⚠️ Daily Overspeed Alert</h2>
            <p style="margin: 5px 0 0 0; color: #333; font-size: 14px;">${reportDate}</p>
          </div>
          
          <div style="padding: 20px; background-color: #f9f9f9;">
            <p style="font-size: 16px; margin-bottom: 20px;">
              The automated monitoring system has detected <strong>${violationsCount} overspeed violations</strong> that occurred <strong>today, ${reportDate}</strong>.
            </p>
            
            <div style="background-color: white; padding: 15px; border-left: 4px solid #e31d00; margin-bottom: 20px;">
              <h3 style="margin-top: 0; color: #333;">Today's Violation Summary</h3>
              <ul style="line-height: 1.8;">
                <li><strong>Report Date:</strong> ${reportDate} (Today)</li>
                <li><strong>Total Violations:</strong> ${violationsCount}</li>
                <li><strong>Speed Limit:</strong> ${MONITORING_CONFIG.OVERSPEED_LIMIT_KMH} km/h</li>
                <li><strong>Duration Threshold:</strong> ${MONITORING_CONFIG.OVERSPEED_DURATION_THRESHOLD_MS / 1000} seconds</li>
                <li><strong>Report Schedule:</strong> Check starts at 23:59, email sent around 00:30 AM</li>
              </ul>
            </div>
            
            <p style="color: #666;">
              This is a <strong>daily report</strong> containing only violations from <strong>${reportDate}</strong>.
              Please review the attached Excel report for detailed information:
            </p>
            <ul style="color: #666; line-height: 1.8;">
              <li>Device details and names</li>
              <li>Start and end times</li>
              <li>Maximum and average speeds</li>
              <li>Overspeed duration</li>
              <li>Location coordinates</li>
            </ul>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px;">
              <p>This is an automated daily message from the GIGMotors Fleet Monitoring System.</p>
              <p>Report generated: ${new Date().toLocaleString()}</p>
              <p><strong>Note:</strong> Daily check starts at 23:59 (11:59 PM), and email is sent around 00:30 AM after processing all devices. Contains ALL violations detected from 00:00:00 to 23:59:59. All violations are also logged to overspeed_logs.txt as backup.</p>
            </div>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: filename,
          path: filePath,
        },
      ],
    });

    console.log(`[Email] Report sent successfully to: ${recipients}`);
    console.log(`[Email] Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send email:', error);
    return false;
  }
}

// Helper function to fetch with retries and timeout
async function fetchWithRetry(url: string, options: any, retries = 3, timeout = 10000, silent = false) {
  const maxAttempts = retries + 1; // retries=0 means 1 attempt, retries=1 means 2 attempts, etc.
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      const isLastAttempt = i === maxAttempts - 1;
      if (isLastAttempt) {
        throw error;
      }
      
      // Exponential backoff: wait 1s, 2s, 4s before retrying
      const waitTime = Math.pow(2, i) * 1000;
      if (!silent) {
        console.log(`[Monitor] Fetch failed (attempt ${i + 1}/${maxAttempts}), retrying in ${waitTime}ms...`);
      }
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error('All retry attempts failed');
}

// GPS51 may return epoch timestamps in either seconds or milliseconds.
// Normalize to milliseconds so date filtering remains correct.
function toEpochMs(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value < 1e12 ? value * 1000 : value;
}

async function processFailedEmailQueue() {
  const queue = loadFailedEmailQueue();
  if (queue.length === 0) return;

  console.log(`[Email] Found ${queue.length} failed email(s). Attempting resend...`);
  const remaining: FailedEmailEntry[] = [];

  for (const entry of queue) {
    if (entry.retryCount >= MAX_EMAIL_RETRIES) {
      remaining.push(entry);
      console.log(`[Email] Skipping ${entry.dateStr}: reached max retries (${MAX_EMAIL_RETRIES})`);
      continue;
    }

    try {
      let sent = false;
      if (entry.type === 'violations' && typeof entry.violationsCount === 'number') {
        const resolved = resolveViolationReportPath(entry.dateStr, entry.filename, entry.filePath);
        if (!resolved) {
          console.log(`[Email] Keep in queue (report file not found yet): ${entry.dateStr}`);
          remaining.push(entry);
          continue;
        }
        const attachName = entry.filename || path.basename(resolved);
        sent = await sendEmailWithAttachment(resolved, attachName, entry.violationsCount, entry.reportDateDisplay);
        if (sent) {
          archiveSentFile(resolved);
        }
      } else if (entry.type === 'no_violations' && typeof entry.deviceCount === 'number') {
        sent = await sendNoViolationsEmail(entry.reportDateDisplay, entry.deviceCount);
      }

      if (sent) {
        console.log(`[Email] Resend success for report day ${entry.dateStr}`);
      } else {
        remaining.push({
          ...entry,
          retryCount: entry.retryCount + 1,
          lastError: 'Resend attempt failed',
        });
      }
    } catch (error) {
      remaining.push({
        ...entry,
        retryCount: entry.retryCount + 1,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  saveFailedEmailQueue(remaining);
  const capped = remaining.filter(entry => entry.retryCount >= MAX_EMAIL_RETRIES).length;
  if (remaining.length > 0) {
    console.log(`[Email] ${remaining.length} failed email(s) still pending in queue (${capped} capped at max retries)`);
  } else {
    console.log('[Email] Failed-email queue cleared');
  }
}

export async function POST(request: NextRequest) {
  try {
    // Add error handling for body parsing
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('[Monitor] Failed to parse request body:', parseError);
      return NextResponse.json(
        { 
          status: -1, 
          cause: 'Invalid request body - must be valid JSON',
          error: 'INVALID_REQUEST_BODY' 
        },
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

    // Use provided reportDate for catch-up checks, or current date for scheduled checks
    const reportDate = body.reportDate ? new Date(body.reportDate) : new Date();
    const startOfDay = new Date(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate(), 0, 0, 0);
    const endOfDay = new Date(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate(), 23, 59, 59);
    
    // Current timestamp for logging and file generation
    const now = new Date();

    const formatDateForAPI = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const begintime = formatDateForAPI(startOfDay);
    const endtime = formatDateForAPI(endOfDay);
    const dateStr = begintime.split(' ')[0]; // Get date portion (YYYY-MM-DD) for reports
    // Use the report day's calendar date in emails (not "now"), so text matches Excel and catch-up runs
    const reportDateDisplay = startOfDay.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const checkType = body.reportDate ? `catch-up check for ${dateStr}` : `today (${dateStr})`;
    console.log(`[Monitor] Starting overspeed check for ${checkType}: ${begintime} to ${endtime}`);

    // Get all devices with retry logic
    const devicesUrl = buildGPS51Url('querymonitorlist', token);
    let devicesResponse;
    
    try {
      devicesResponse = await fetchWithRetry(devicesUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      }, 3, 15000);
    } catch (error) {
      console.error('[Monitor] Failed to connect to GPS51 API after retries:', error);
      return NextResponse.json({
        status: -1,
        cause: 'Failed to connect to GPS51 API. Please check your internet connection.',
        error: 'NETWORK_ERROR',
        details: error instanceof Error ? error.message : String(error)
      }, { status: 503 });
    }

    const devicesData = await devicesResponse.json();

    if (devicesData.status !== 0) {
      const errorCause = devicesData.cause || 'Unknown error';
      
      // Check for IP whitelist error
      if (devicesData.status === 8904 || errorCause.includes('ip not in white list')) {
        const ipMatch = errorCause.match(/::(\d+\.\d+\.\d+\.\d+)/);
        const ipAddress = ipMatch ? ipMatch[1] : 'your IP';
        console.error(`[Monitor] IP WHITELIST ERROR: ${ipAddress} is not whitelisted in GPS51 API`);
        return NextResponse.json({
          status: -1,
          cause: `IP address ${ipAddress} is not whitelisted. Please contact GPS51 support to whitelist your IP.`,
          error: 'IP_NOT_WHITELISTED'
        }, { status: 403 });
      }
      
      console.error('[Monitor] Failed to fetch devices:', errorCause);
      return NextResponse.json({
        status: -1,
        cause: `Failed to fetch devices: ${errorCause}`,
        error: 'DEVICE_FETCH_ERROR'
      }, { status: 400 });
    }

    if (!devicesData.groups) {
      console.error('[Monitor] No device groups in response');
      return NextResponse.json({
        status: -1,
        cause: 'No device groups found',
        error: 'NO_GROUPS'
      }, { status: 400 });
    }

    const allDevices = devicesData.groups.flatMap((group: any) =>
      (group.devices || []).map((device: any) => ({
        deviceid: device.deviceid,
        name: device.devicename || device.deviceid,
      }))
    );

    console.log(`[Monitor] Found ${allDevices.length} devices to check`);

    // Query overspeed for all devices
    const allViolations: any[] = [];
    let processedCount = 0;
    let apiCallCount = 1; // Already made 1 call to get devices

    // Rate limiting: GPS51 API allows 10 requests/minute
    // We'll use 8 requests/minute to be safe (7.5 seconds between calls)
    const RATE_LIMIT_DELAY_MS = 7500; // 7.5 seconds between API calls

    for (const device of allDevices) {
      processedCount++;
      
      // Log progress every 50 devices
      if (processedCount % 50 === 0 || processedCount === allDevices.length) {
        console.log(`[Monitor] Progress: ${processedCount}/${allDevices.length} devices checked (${apiCallCount} API calls)`);
      }
      
      try {
        // Rate limiting: Wait before making the API call (except for first device)
        if (processedCount > 1) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
        }

        const tripsUrl = buildGPS51Url('querytrips', token);
        const tripsResponse = await fetchWithRetry(tripsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceid: device.deviceid,
            starttime: begintime,
            endtime: endtime,
            timezone: 8
          }),
        }, 0, 60000, true); // 0 retries (just attempt once), 60 second timeout, silent mode

        apiCallCount++;
        const tripsData = await tripsResponse.json();

        if (tripsData.status === 0 && tripsData.totaltrips) {
          for (const trip of tripsData.totaltrips) {
            // CRITICAL: Only include trips that occurred TODAY
            // Convert trip timestamps (seconds or milliseconds) to Date objects
            const tripStartMs = toEpochMs(Number(trip.starttime));
            const tripEndMs = toEpochMs(Number(trip.endtime));
            const tripStartDate = new Date(tripStartMs);
            const tripEndDate = new Date(tripEndMs);
            
            // Check if trip is within today's date range
            const isTripToday = tripStartDate >= startOfDay && tripStartDate <= endOfDay;
            
            // Skip trips from other days
            if (!isTripToday) {
              continue;
            }
            
            const maxSpeedKmh = trip.maxspeed ? trip.maxspeed / 1000 : 0;
            const avgSpeedKmh = trip.averagespeed ? trip.averagespeed / 1000 : 0;
            const tripDuration = Number(trip.triptime) || (tripEndMs - tripStartMs);

            // Check if exceeds limit and duration threshold
            if (maxSpeedKmh > MONITORING_CONFIG.OVERSPEED_LIMIT_KMH) {
              let overspeedDuration = 0;
              
              if (avgSpeedKmh > MONITORING_CONFIG.OVERSPEED_LIMIT_KMH) {
                overspeedDuration = Math.floor(tripDuration * 0.7);
              } else {
                overspeedDuration = Math.floor(tripDuration * 0.2);
              }

              // Only include if overspeed duration exceeds threshold
              if (overspeedDuration >= MONITORING_CONFIG.OVERSPEED_DURATION_THRESHOLD_MS) {
                allViolations.push({
                  deviceid: device.deviceid,
                  devicename: device.name,
                  begintime: tripStartMs,
                  endtime: tripEndMs,
                  maxspeed: maxSpeedKmh,
                  avgspeed: avgSpeedKmh,
                  speedlimit: MONITORING_CONFIG.OVERSPEED_LIMIT_KMH,
                  overspeed: maxSpeedKmh - MONITORING_CONFIG.OVERSPEED_LIMIT_KMH,
                  duration: tripDuration,
                  overspeedduration: overspeedDuration,
                  distance: trip.tripdistance ? trip.tripdistance / 1000 : 0,
                  startlat: trip.slat,
                  startlon: trip.slon,
                  endlat: trip.elat,
                  endlon: trip.elon,
                });
              }
            }
          }
        }
      } catch (err) {
        // Silently skip devices that timeout or have errors
        // This is normal for offline devices or slow connections
      }
    }

    ensureDir(REPORTS_DIR);
    ensureGeneratedReportsDir();
    purgeExpiredGeneratedReports();
    ensureDir(SENT_FILES_DIR);

    // Attempt resend of previously failed emails before processing current report
    await processFailedEmailQueue();

    if (allViolations.length > 0) {
      console.log(`[Monitor] Found ${allViolations.length} violations for TODAY (${dateStr}). Generating Excel report...`);

      // Generate Excel report
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Daily Overspeed Report');

      // Add title row
      worksheet.mergeCells('A1:O1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Daily Overspeed Report - ${dateStr}`;
      titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF6B00' }
      };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 25;

      // Add summary row
      worksheet.mergeCells('A2:O2');
      const summaryCell = worksheet.getCell('A2');
      summaryCell.value = `Total Violations: ${allViolations.length} | Speed Limit: ${MONITORING_CONFIG.OVERSPEED_LIMIT_KMH} km/h | Duration Threshold: ${MONITORING_CONFIG.OVERSPEED_DURATION_THRESHOLD_MS / 1000}s`;
      summaryCell.font = { italic: true, size: 10 };
      summaryCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF9E6' }
      };
      summaryCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(2).height = 20;

      // Column keys + widths only (do NOT use `header` here — ExcelJS writes header row at row 1
      // by default and clashes with our merged title/summary rows, corrupting the sheet title).
      worksheet.columns = [
        { key: 'deviceid', width: 20 },
        { key: 'devicename', width: 25 },
        { key: 'begintime', width: 20 },
        { key: 'endtime', width: 20 },
        { key: 'maxspeed', width: 15 },
        { key: 'avgspeed', width: 15 },
        { key: 'speedlimit', width: 15 },
        { key: 'overspeed', width: 15 },
        { key: 'duration', width: 15 },
        { key: 'overspeedduration', width: 20 },
        { key: 'distance', width: 15 },
        { key: 'startlat', width: 12 },
        { key: 'startlon', width: 12 },
        { key: 'endlat', width: 12 },
        { key: 'endlon', width: 12 },
      ];

      const headerLabels = [
        'Device ID',
        'Device Name',
        'Start Time',
        'End Time',
        'Max Speed (km/h)',
        'Avg Speed (km/h)',
        'Speed Limit (km/h)',
        'Overspeed (km/h)',
        'Duration (min)',
        'Overspeed Duration (min)',
        'Distance (km)',
        'Start Lat',
        'Start Lon',
        'End Lat',
        'End Lon',
      ];
      const headerRow = worksheet.getRow(3);
      headerLabels.forEach((label, i) => {
        headerRow.getCell(i + 1).value = label;
      });
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFC107' }
      };

      // Add data rows
      allViolations.forEach(violation => {
        worksheet.addRow({
          deviceid: violation.deviceid,
          devicename: violation.devicename,
          begintime: new Date(Number(violation.begintime)).toLocaleString(),
          endtime: new Date(Number(violation.endtime)).toLocaleString(),
          maxspeed: violation.maxspeed.toFixed(1),
          avgspeed: violation.avgspeed.toFixed(1),
          speedlimit: violation.speedlimit,
          overspeed: violation.overspeed.toFixed(1),
          duration: (violation.duration / 60000).toFixed(1),
          overspeedduration: (violation.overspeedduration / 60000).toFixed(1),
          distance: violation.distance.toFixed(2),
          startlat: violation.startlat.toFixed(6),
          startlon: violation.startlon.toFixed(6),
          endlat: violation.endlat.toFixed(6),
          endlon: violation.endlon.toFixed(6),
        });
      });

      // Save Excel file with date in filename (YYYY-MM-DD format)
      const excelFilename = `overspeed_daily_report_${dateStr}.xlsx`;
      const excelPath = path.join(GENERATED_REPORTS_DIR, excelFilename);
      await workbook.xlsx.writeFile(excelPath);

      console.log(`[Monitor] Excel report saved: ${excelPath}`);

      // Send email with daily summary: attachment is the file just written above
      const emailSent = await sendEmailWithAttachment(excelPath, excelFilename, allViolations.length, reportDateDisplay);
      if (emailSent) {
        console.log(`[Monitor] Email sent with daily summary - ${allViolations.length} violations detected for ${dateStr}`);
        archiveSentFile(excelPath);
      } else {
        console.log(`[Monitor] Email NOT sent - report generated but SMTP delivery failed for ${dateStr}`);
        const queue = loadFailedEmailQueue();
        queue.push({
          type: 'violations',
          dateStr,
          reportDateDisplay,
          filePath: excelPath,
          filename: excelFilename,
          violationsCount: allViolations.length,
          retryCount: 0,
          queuedAt: new Date().toISOString(),
          lastError: 'Initial send failed',
        });
        saveFailedEmailQueue(queue);
      }

      // Log to overspeed_logs.txt
      const logPath = path.join(REPORTS_DIR, 'overspeed_logs.txt');
      const logEntry = `[${now.toISOString()}] DAILY REPORT (${dateStr}): ${allViolations.length} violations detected. Report: ${excelFilename}. Email ${emailSent ? 'sent' : 'failed'}.\n`;
      fs.appendFileSync(logPath, logEntry);

      writeDailyCompleteMarker(dateStr);

      return NextResponse.json({
        status: 0,
        cause: 'OK',
        message: 'Overspeed violations found',
        violations: allViolations.length,
        reportFile: excelFilename,
        reportPath: excelPath,
      });
    } else {
      console.log(`[Monitor] No violations found for TODAY (${dateStr}).`);

      // Send "no violations" email (same report day as the query window)
      const emailSent = await sendNoViolationsEmail(reportDateDisplay, allDevices.length);
      if (emailSent) {
        console.log(`[Monitor] Email sent with daily summary - No violations detected for ${dateStr}`);
      } else {
        console.log(`[Monitor] Email NOT sent - No-violations summary failed for ${dateStr}`);
        const queue = loadFailedEmailQueue();
        queue.push({
          type: 'no_violations',
          dateStr,
          reportDateDisplay,
          deviceCount: allDevices.length,
          retryCount: 0,
          queuedAt: new Date().toISOString(),
          lastError: 'Initial send failed',
        });
        saveFailedEmailQueue(queue);
      }

      // Log to overspeed_logs.txt
      const logPath = path.join(REPORTS_DIR, 'overspeed_logs.txt');
      const logEntry = `[${now.toISOString()}] DAILY REPORT (${dateStr}): No violations detected. Email ${emailSent ? 'sent' : 'failed'}.\n`;
      fs.appendFileSync(logPath, logEntry);

      writeDailyCompleteMarker(dateStr);

      return NextResponse.json({
        status: 0,
        cause: 'OK',
        message: 'No overspeed violations found',
        violations: 0,
      });
    }

  } catch (error) {
    console.error('[Monitor] Error in overspeed monitoring:', error);
    
    return NextResponse.json(
      { 
        status: -1, 
        cause: error instanceof Error ? error.message : 'Internal server error',
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      },
      { status: 500 }
    );
  }
}
