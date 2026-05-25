import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { purgeExpiredGeneratedReports } from '@/lib/generatedReportsStorage';

export async function GET(request: NextRequest) {
  try {
    console.log('[Test Email] Starting email test...');

    // Check if email is enabled
    if (process.env.ENABLE_EMAIL_REPORTS !== 'true') {
      return NextResponse.json({
        success: false,
        message: 'Email reports are disabled. Set ENABLE_EMAIL_REPORTS=true in .env.local'
      }, { status: 400 });
    }

    // Verify SMTP configuration
    const smtpConfig = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      emailTo: process.env.EMAIL_TO,
      emailFrom: process.env.EMAIL_FROM,
    };

    console.log('[Test Email] SMTP Configuration:', {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.user,
      emailTo: smtpConfig.emailTo,
      emailFrom: smtpConfig.emailFrom,
      passwordSet: !!smtpConfig.pass
    });

    // Create a test Excel file
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Test Overspeed Report');

    // Add headers
    worksheet.columns = [
      { header: 'Device Name', key: 'deviceName', width: 20 },
      { header: 'Speed (km/h)', key: 'speed', width: 15 },
      { header: 'Duration (seconds)', key: 'duration', width: 18 },
      { header: 'Start Time', key: 'startTime', width: 20 },
      { header: 'End Time', key: 'endTime', width: 20 },
      { header: 'Location', key: 'location', width: 30 },
    ];

    // Add sample data
    worksheet.addRow({
      deviceName: 'TEST-VEHICLE-001',
      speed: 75.5,
      duration: 120,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      location: 'Test Location - Lagos, Nigeria'
    });

    worksheet.addRow({
      deviceName: 'TEST-VEHICLE-002',
      speed: 68.3,
      duration: 95,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      location: 'Test Location - Abuja, Nigeria'
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC107' }
    };

    // Save the test file (same retention folder as automated daily reports)
    const reportsDir = path.join(process.cwd(), 'generated_reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `TEST_Overspeed_Report_${timestamp}.xlsx`;
    const filePath = path.join(reportsDir, filename);

    await workbook.xlsx.writeFile(filePath);
    purgeExpiredGeneratedReports();
    console.log('[Test Email] Test Excel file created:', filePath);

    // Create email transporter
    const smtpPort = parseInt(smtpConfig.port || '465');
    const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465;
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
      debug: true, // Enable debug output
      logger: true, // Log to console
    });

    // Verify transporter configuration
    console.log('[Test Email] Verifying SMTP connection...');
    try {
      await transporter.verify();
      console.log('[Test Email] ✓ SMTP connection verified successfully');
    } catch (verifyError: any) {
      console.error('[Test Email] ✗ SMTP verification failed:', verifyError.message);
      return NextResponse.json({
        success: false,
        message: 'SMTP verification failed',
        error: verifyError.message,
        config: {
          host: smtpConfig.host,
          port: smtpConfig.port,
          user: smtpConfig.user
        }
      }, { status: 500 });
    }

    // Prepare email content
    const reportDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #e31d00 0%, #c41900 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .alert-box { background: #fde8e6; border-left: 4px solid #e31d00; padding: 15px; margin: 20px 0; }
          .stats { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .stat-item { margin: 10px 0; }
          .stat-label { font-weight: bold; color: #666; }
          .stat-value { color: #e31d00; font-size: 20px; font-weight: bold; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          .test-badge { background: #4CAF50; color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🧪 TEST EMAIL - GIGMotors Fleet Alert</h1>
            <p><span class="test-badge">EMAIL SYSTEM TEST</span></p>
          </div>
          <div class="content">
            <div class="alert-box">
              <strong>⚠️ This is a test email</strong><br>
              Your email system is configured correctly and working!
            </div>
            
            <h2>Test Report Details</h2>
            <div class="stats">
              <div class="stat-item">
                <span class="stat-label">Report Date:</span><br>
                <span class="stat-value">${reportDate}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Sample Violations:</span><br>
                <span class="stat-value">2 test records</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Speed Limit:</span><br>
                <span class="stat-value">50 km/h</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Duration Threshold:</span><br>
                <span class="stat-value">60 seconds</span>
              </div>
            </div>

            <p><strong>Attached File:</strong> ${filename}</p>
            <p>The attached Excel file contains sample overspeed violation data for testing purposes.</p>

            <div class="alert-box">
              <strong>✓ Email Configuration Verified</strong><br>
              SMTP Host: ${smtpConfig.host}<br>
              From: ${smtpConfig.emailFrom}<br>
              To: ${smtpConfig.emailTo}
            </div>

            <div class="footer">
              <p>This is an automated test message from GIGMotors Overspeed Monitoring System</p>
              <p>Powered by Elektran Broadcast</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send the email
    console.log('[Test Email] Sending email...');
    const info = await transporter.sendMail({
      from: smtpConfig.emailFrom || smtpConfig.user,
      to: smtpConfig.emailTo?.split(',').map((e: string) => e.trim()).join(', '),
      subject: '🧪 TEST - GIGMotors Overspeed Alert System',
      html: emailHtml,
      attachments: [
        {
          filename: filename,
          path: filePath,
        },
      ],
    });

    console.log('[Test Email] ✓ Email sent successfully!');
    console.log('[Test Email] Message ID:', info.messageId);
    console.log('[Test Email] Response:', info.response);

    return NextResponse.json({
      success: true,
      message: 'Test email sent successfully!',
      details: {
        messageId: info.messageId,
        recipients: smtpConfig.emailTo,
        filename: filename,
        response: info.response
      }
    });

  } catch (error: any) {
    console.error('[Test Email] ✗ Failed to send test email:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to send test email',
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
