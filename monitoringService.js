/**
 * Fuel monitoring service (fuel cron only).
 *
 * GPS51 login rules:
 * - Token valid 24 hours
 * - Prefer one login every ~23 hours
 * - Do not login frequently
 *
 * Mileage / idle-stop crons are disabled.
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
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

/** GPS51: token lasts 24h — refresh once near 23h, not on every job. */
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
/** Prevent login thrash if API keeps rejecting. */
const FORCE_LOGIN_COOLDOWN_MS = 10 * 60 * 1000;
const SESSION_FILE = path.join(process.cwd(), '.cache', 'monitor_gps51_session.json');

let credentials = {
  token: '',
  username: process.env.MONITOR_USERNAME || '',
  password: process.env.MONITOR_PASSWORD || '',
  loggedAt: 0,
};
let lastForceLoginAt = 0;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function normalizePassword(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
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

function formatAge(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function sessionAgeMs() {
  return credentials.loggedAt ? Date.now() - credentials.loggedAt : Number.POSITIVE_INFINITY;
}

function hasFreshToken() {
  return Boolean(credentials.token && credentials.loggedAt && sessionAgeMs() < TOKEN_TTL_MS);
}

function loadSessionFile() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!raw?.token || !raw?.loggedAt) return;
    credentials.token = String(raw.token);
    credentials.username = String(raw.username || credentials.username);
    credentials.loggedAt = Number(raw.loggedAt) || 0;
  } catch (error) {
    console.warn(`⚠ Could not read session file: ${error.message}`);
  }
}

function saveSessionFile() {
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(
      SESSION_FILE,
      JSON.stringify(
        {
          token: credentials.token,
          username: credentials.username,
          loggedAt: credentials.loggedAt,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn(`⚠ Could not save session file: ${error.message}`);
  }
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

  console.log(`🔐 GPS51 action=login as ${username} (token valid 24h; refresh ~23h)…`);
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
  credentials.loggedAt = Date.now();
  saveSessionFile();
  console.log('✓ GPS51 login OK — token cached for ~23h');
  return credentials.token;
}

/**
 * Reuse token until ~23h old. Login only when missing/stale, or force after API rejection.
 */
async function ensureSession(force = false) {
  if (!force && hasFreshToken()) {
    console.log(
      `✓ Reusing GPS51 token (age ${formatAge(sessionAgeMs())}; next login after 23h)`
    );
    return credentials.token;
  }

  if (force) {
    if (Date.now() - lastForceLoginAt < FORCE_LOGIN_COOLDOWN_MS) {
      console.warn('⚠ Forced login skipped — 10m cooldown (do not login too frequently)');
      return credentials.token || null;
    }
    lastForceLoginAt = Date.now();
  }

  await loginGps51();
  return credentials.token;
}

async function refreshToken() {
  try {
    await ensureSession(true);
    return Boolean(credentials.token);
  } catch (error) {
    console.error(`✗ Token refresh failed: ${error.message}`);
    return false;
  }
}

async function ensureCredentials() {
  credentials.username = credentials.username || process.env.MONITOR_USERNAME || '';
  credentials.password = credentials.password || process.env.MONITOR_PASSWORD || '';
  loadSessionFile();

  // Prefer env MONITOR_TOKEN only if we have no cached session yet
  if (!credentials.token && process.env.MONITOR_TOKEN) {
    credentials.token = process.env.MONITOR_TOKEN;
    credentials.loggedAt = 0; // unknown age → ensureSession will login if password set
  }

  if (credentials.username && credentials.password) {
    await ensureSession(false);
    return;
  }

  if (credentials.username && credentials.token) {
    console.log('⚠ MONITOR_PASSWORD missing — using token only (no auto-refresh)\n');
    return;
  }

  return new Promise((resolve, reject) => {
    rl.question('Enter your username: ', (username) => {
      rl.question('Enter your password (plain or MD5): ', async (password) => {
        try {
          credentials.username = username.trim();
          credentials.password = password.trim();
          await ensureSession(true);
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
    const token = await ensureSession(false);
    if (!token) {
      console.error('[FuelScheduled] No GPS51 token available');
      return;
    }

    const requestBody = {
      token: credentials.token,
      username: credentials.username,
    };
    if (reportDate) requestBody.reportDate = reportDate;

    let data = await postJson(`${API_URL}/api/fuel/scheduled`, requestBody);

    if (isTokenExpired(data)) {
      console.log('[FuelScheduled] Token rejected — one login retry (GPS51 24h rule)…');
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
  console.log('  - Login: action=login once per ~23h (token valid 24h)');
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
      // Reuse token unless ≥23h old — do NOT login every day blindly
      await ensureSession(false);
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

    // Soft refresh when token age reaches ~23h (recommended), not more often
    if (credentials.password && !hasFreshToken()) {
      try {
        await ensureSession(false);
      } catch (error) {
        console.error(`[HEARTBEAT] Login refresh failed: ${error.message}`);
      }
    }

    console.log(`\n💚 [HEARTBEAT] ${now.toLocaleString()}`);
    console.log(`   🟢 Monitoring: RUNNING (fuel only)`);
    console.log(`   ${nextjsStatus} Next.js`);
    console.log(
      `   🔑 Token age ${credentials.loggedAt ? formatAge(sessionAgeMs()) : 'n/a'} (refresh ≥23h)`
    );
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
