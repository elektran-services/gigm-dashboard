/**
 * Fuel monitoring service (fuel cron only).
 * Logs into GPS51 with MONITOR_USERNAME + MONITOR_PASSWORD, then runs the daily
 * fuel download into .cache/gps51. Mileage / idle-stop crons are disabled.
 */

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(process.cwd(), '.env.production') });
require('dotenv').config({ path: path.join(process.cwd(), '.env.local'), override: true });

const cron = require('node-cron');
const fetch = require('node-fetch');
const readline = require('readline');

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
const GPS51_BASE = process.env.NEXT_PUBLIC_GPS51_API_URL || 'https://api.gps51.com/openapi';
const GPS51_SERVER_ID = process.env.NEXT_PUBLIC_GPS51_SERVER_ID || '2';
/** Daily fuel track — 04:30 server local time (previous calendar day). */
const FUEL_CRON = process.env.FUEL_CRON || '30 4 * * *';

let credentials = {
  token: process.env.MONITOR_TOKEN || '',
  username: process.env.MONITOR_USERNAME || '',
  password: process.env.MONITOR_PASSWORD || '',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function normalizePassword(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  // Already MD5 hex
  if (/^[a-f0-9]{32}$/i.test(value)) return value.toLowerCase();
  return crypto.createHash('md5').update(value, 'utf8').digest('hex');
}

function isTokenExpired(data) {
  if (!data) return false;
  const cause = String(data.cause || data.error || '');
  const status = Number(data.status);
  return (
    status === 9903 ||
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause.includes('global_error_not_find_token') ||
    cause.includes('not_find_token') ||
    cause === 'please login' ||
    cause === 'TOKEN_EXPIRED'
  );
}

async function loginGps51() {
  const username = credentials.username;
  const password = normalizePassword(credentials.password);

  if (!username) {
    throw new Error('MONITOR_USERNAME is not set in .env.local');
  }
  if (!password) {
    throw new Error('MONITOR_PASSWORD is not set in .env.local (plain or MD5 hex)');
  }

  console.log(`🔐 Logging in to GPS51 as ${username}…`);
  const response = await fetch(`${GPS51_BASE}?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'DEVICE',
      from: 'web',
      username,
      password,
      browser: 'GIGM-MonitoringService/1.0',
    }),
  });

  const data = await response.json();
  if (data.status !== 0 || !data.token) {
    throw new Error(data.cause || `GPS51 login failed (HTTP ${response.status})`);
  }

  credentials.token = String(data.token);
  credentials.username = String(data.username || username);
  credentials.password = password;
  console.log('✓ GPS51 login OK — fresh token ready');
  return credentials.token;
}

async function refreshToken() {
  try {
    await loginGps51();
    return true;
  } catch (error) {
    console.error(`✗ Token refresh failed: ${error.message}`);
    return false;
  }
}

async function ensureCredentials() {
  credentials.username = credentials.username || process.env.MONITOR_USERNAME || '';
  credentials.password = credentials.password || process.env.MONITOR_PASSWORD || '';
  credentials.token = credentials.token || process.env.MONITOR_TOKEN || '';

  if (credentials.username && credentials.password) {
    await loginGps51();
    return;
  }

  if (credentials.username && credentials.token) {
    console.log('⚠ MONITOR_PASSWORD missing — using MONITOR_TOKEN only (no auto-refresh)\n');
    return;
  }

  return new Promise((resolve, reject) => {
    rl.question('Enter your username: ', (username) => {
      rl.question('Enter your password (plain or MD5): ', async (password) => {
        try {
          credentials.username = username.trim();
          credentials.password = password.trim();
          await loginGps51();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

async function fetchNextJsHealth(extraOptions = {}) {
  return fetch(`${API_URL}/api/health`, { method: 'GET', ...extraOptions });
}

async function waitForServer(maxAttempts = 20, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetchNextJsHealth();
      if (res.ok || res.status === 404) {
        console.log('✓ Next.js server is ready\n');
        return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log('⚠ Next.js server may not be ready; fuel cron may fail until it is up.\n');
  return false;
}

async function postJson(url, body, timeoutMs = 2 * 60 * 60 * 1000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: timeoutMs,
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    throw new Error(`Non-JSON (${response.status}): ${text.substring(0, 200)}`);
  }
  return response.json();
}

async function runFuelScheduled(reportDate = null) {
  const timeStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  console.log(`\n[FuelScheduled] ${timeStr}${reportDate ? ` reportDate=${reportDate}` : ' (yesterday)'}`);

  try {
    if (!credentials.token) {
      const ok = await refreshToken();
      if (!ok) return;
    }

    const requestBody = {
      token: credentials.token,
      username: credentials.username,
    };
    if (reportDate) requestBody.reportDate = reportDate;

    let data = await postJson(`${API_URL}/api/fuel/scheduled`, requestBody);

    if (isTokenExpired(data)) {
      console.log('[FuelScheduled] Token rejected by GPS51 — refreshing and retrying…');
      const refreshed = await refreshToken();
      if (!refreshed) {
        console.error('[FuelScheduled] Token refresh failed; skipping.');
        return;
      }
      requestBody.token = credentials.token;
      data = await postJson(`${API_URL}/api/fuel/scheduled`, requestBody);
    }

    if (data.status === 0 || data.status === 8905) {
      const summary = data.summary || {};
      console.log(
        `[FuelScheduled] ${data.reportDate || ''} saved=${summary.saved ?? 0} skipped=${summary.skipped ?? 0} failed=${summary.failed ?? 0} liveCalls=${data.liveCalls ?? 'n/a'}${summary.stoppedForQuota ? ' STOPPED quota' : ''}`
      );
      if (data.cause) console.error(`[FuelScheduled] ${data.cause}`);
    } else if (isTokenExpired(data)) {
      console.error(`[FuelScheduled] Still unauthorized after refresh: ${data.cause || 'Unknown error'}`);
    } else {
      console.error(`[FuelScheduled] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[FuelScheduled] Error: ${error.message}`);
  }
}

function parseCronWallClock(cronExpr, fallbackHour, fallbackMinute) {
  const parts = String(cronExpr || '').trim().split(/\s+/);
  if (parts.length >= 2) {
    const minute = Number(parts[0]);
    const hour = Number(parts[1]);
    if (Number.isFinite(minute) && Number.isFinite(hour)) {
      return { hour, minute };
    }
  }
  return { hour: fallbackHour, minute: fallbackMinute };
}

const fuelClock = parseCronWallClock(FUEL_CRON, 4, 30);

function msUntilNextLocalWallClock(from, hour, minute) {
  const target = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, minute, 0, 0);
  if (target <= from) target.setDate(target.getDate() + 1);
  return target - from;
}

function formatCountdown(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

async function startService() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           GIGMotors Fuel monitoring (fuel only)          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Configuration:');
  console.log(`  - Fuel cron: ${FUEL_CRON} (yesterday reportoiltime → .cache/gps51/)`);
  console.log('  - Mileage / idle-stop / overspeed / trips / offline / parking: DISABLED');
  console.log(`  - GPS51: ${GPS51_BASE} (serverid=${GPS51_SERVER_ID})`);
  console.log(`  - API URL: ${API_URL}\n`);

  await ensureCredentials();
  await waitForServer(20, 1000);

  console.log('⛽ Fuel catch-up for yesterday if that day\'s track is missing…\n');
  await runFuelScheduled();

  const msFuel = msUntilNextLocalWallClock(new Date(), fuelClock.hour, fuelClock.minute);
  console.log('📅 Schedule:');
  console.log(`  - Next fuel run: ~${formatCountdown(msFuel)} (pattern ${FUEL_CRON})\n`);
  console.log('✅ Service started. Press Ctrl+C to stop.\n');

  let lastFuelCronStart = null;

  const fuelCronJob = cron.schedule(FUEL_CRON, async () => {
    const t = new Date().toLocaleString();
    lastFuelCronStart = t;
    console.log(`\n🔔 [CRON fuel] START ${t} — ${FUEL_CRON}`);
    try {
      // Always re-login before the daily run so a stale MONITOR_TOKEN cannot block it
      if (credentials.password) {
        await loginGps51();
      }
      await runFuelScheduled();
      console.log(`✅ [CRON fuel] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON fuel] ERROR`, error);
    }
  });

  console.log(`📋 Fuel cron: ${fuelCronJob ? 'SUCCESS' : 'FAILED'} — ${FUEL_CRON}\n`);

  setInterval(async () => {
    const now = new Date();
    const msNextFuel = msUntilNextLocalWallClock(now, fuelClock.hour, fuelClock.minute);
    let nextjsStatus = '🔴 DOWN';
    try {
      const res = await fetchNextJsHealth({ signal: AbortSignal.timeout(5000) });
      if (res.ok || res.status === 404) nextjsStatus = '🟢 UP';
    } catch {
      /* down */
    }
    console.log(`\n💚 [HEARTBEAT] ${now.toLocaleString()}`);
    console.log(`   🟢 Monitoring: RUNNING (fuel only)`);
    console.log(`   ${nextjsStatus} Next.js`);
    console.log(
      `   📅 Fuel ${FUEL_CRON} — next ~${formatCountdown(msNextFuel)} — last=${lastFuelCronStart || '—'}`
    );
    console.log();
  }, 30 * 60 * 1000);
}

process.on('SIGINT', () => {
  console.log('\n\nShutting down monitoring service...');
  rl.close();
  process.exit(0);
});

startService().catch((error) => {
  console.error('Failed to start service:', error);
  process.exit(1);
});
