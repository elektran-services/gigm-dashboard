import { NextRequest, NextResponse } from 'next/server';
import { resolveViolationReportPath } from '@/lib/generatedReportsStorage';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';

const REPORTS_DIR = path.join(process.cwd(), 'overspeed_reports');
const FAILED_EMAIL_QUEUE_FILE = path.join(REPORTS_DIR, 'failed_email_queue.json');
const SENT_FILES_DIR = path.join(process.cwd(), 'sent file');
const MAX_EMAIL_RETRIES = 5;

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

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadQueue(): FailedEmailEntry[] {
  if (!fs.existsSync(FAILED_EMAIL_QUEUE_FILE)) return [];
  const raw = fs.readFileSync(FAILED_EMAIL_QUEUE_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function saveQueue(queue: FailedEmailEntry[]) {
  ensureDir(REPORTS_DIR);
  fs.writeFileSync(FAILED_EMAIL_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');
}

function archiveSentFile(sourceFilePath: string) {
  if (!fs.existsSync(sourceFilePath)) return;
  ensureDir(SENT_FILES_DIR);
  const baseName = path.basename(sourceFilePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetPath = path.join(SENT_FILES_DIR, `${timestamp}_${baseName}`);
  fs.copyFileSync(sourceFilePath, targetPath);
}

async function sendMailWithFallback(mailOptions: any) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const primaryPort = parseInt(process.env.SMTP_PORT || '465');
  const primarySecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : primaryPort === 465;

  const primaryTransporter = nodemailer.createTransport({
    host,
    port: primaryPort,
    secure: primarySecure,
    auth: { user, pass },
  });

  try {
    return await primaryTransporter.sendMail(mailOptions);
  } catch (primaryError) {
    // Fallback to SMTPS 465 when primary transport fails.
    const fallbackTransporter = nodemailer.createTransport({
      host,
      port: 465,
      secure: true,
      auth: { user, pass },
    });

    try {
      return await fallbackTransporter.sendMail(mailOptions);
    } catch (_fallbackError) {
      throw primaryError;
    }
  }
}

function getRecipients() {
  return process.env.EMAIL_TO?.split(',').map(email => email.trim()).join(', ');
}

async function resendQueueEntry(entry: FailedEmailEntry) {
  if (process.env.ENABLE_EMAIL_REPORTS !== 'true') {
    return { sent: false, error: 'Email reports disabled' };
  }

  const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_TO'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    return { sent: false, error: `Missing SMTP config: ${missingVars.join(', ')}` };
  }

  const recipients = getRecipients();

  if (entry.type === 'violations' && typeof entry.violationsCount === 'number') {
    const resolved = resolveViolationReportPath(entry.dateStr, entry.filename, entry.filePath);
    if (!resolved) {
      return { sent: false, error: `Report file not found for ${entry.dateStr}` };
    }
    const attachName = entry.filename || path.basename(resolved);

    await sendMailWithFallback({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: recipients,
      subject: `⚠️ Daily Overspeed Alert - ${entry.reportDateDisplay} (${entry.violationsCount} Violations) [RETRY]`,
      html: `
        <p>This is an automatic resend for a previously failed daily overspeed report email.</p>
        <p><strong>Report date:</strong> ${entry.reportDateDisplay}</p>
        <p><strong>Violations:</strong> ${entry.violationsCount}</p>
      `,
      attachments: [{ filename: attachName, path: resolved }],
    });
    archiveSentFile(resolved);
    return { sent: true };
  }

  if (entry.type === 'no_violations' && typeof entry.deviceCount === 'number') {
    await sendMailWithFallback({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: recipients,
      subject: `✅ Daily Overspeed Report - ${entry.reportDateDisplay} (No Violations) [RETRY]`,
      html: `
        <p>This is an automatic resend for a previously failed no-violations summary email.</p>
        <p><strong>Report date:</strong> ${entry.reportDateDisplay}</p>
        <p><strong>Devices monitored:</strong> ${entry.deviceCount}</p>
      `,
    });
    return { sent: true };
  }

  return { sent: false, error: 'Invalid queue entry format' };
}

export async function GET() {
  try {
    if (!fs.existsSync(FAILED_EMAIL_QUEUE_FILE)) {
      return NextResponse.json({
        status: 0,
        message: 'No failed email queue file found',
        count: 0,
        items: [],
      });
    }

    const raw = fs.readFileSync(FAILED_EMAIL_QUEUE_FILE, 'utf-8');
    const items = JSON.parse(raw);
    const safeItems = Array.isArray(items) ? items : [];

    return NextResponse.json({
      status: 0,
      message: 'OK',
      count: safeItems.length,
      items: safeItems,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: -1,
        message: 'Failed to read failed email queue',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(_request: NextRequest) {
  try {
    const queue = loadQueue();
    if (queue.length === 0) {
      return NextResponse.json({
        status: 0,
        message: 'No failed emails to retry',
        retried: 0,
        sent: 0,
        failed: 0,
      });
    }

    const remaining: FailedEmailEntry[] = [];
    let sent = 0;
    let skipped = 0;

    for (const entry of queue) {
      if (entry.retryCount >= MAX_EMAIL_RETRIES) {
        remaining.push(entry);
        skipped++;
        continue;
      }

      try {
        const result = await resendQueueEntry(entry);
        if (result.sent) {
          sent++;
        } else {
          remaining.push({
            ...entry,
            retryCount: entry.retryCount + 1,
            lastError: result.error || 'Resend failed',
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

    saveQueue(remaining);

    return NextResponse.json({
      status: 0,
      message: 'Retry process complete',
      retried: queue.length,
      sent,
      skipped,
      failed: remaining.length,
      remaining,
      maxRetries: MAX_EMAIL_RETRIES,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: -1,
        message: 'Failed to process retry queue',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

