/**
 * Mileage + idle/stop monitoring service.
 * Daily crons write mileage_json/ and idle_stop_json/ snapshots.
 * Overspeed, trips, offline, and parking Excel crons remain disabled.
 */

const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env.production') });
require('dotenv').config({ path: path.join(process.cwd(), '.env.local'), override: true });

const cron = require('node-cron');
const fetch = require('node-fetch');
const readline = require('readline');
const fs = require('fs');

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
/** Daily mileage JSON scan — 20:00 server local time. */
const MILEAGE_CRON = process.env.MILEAGE_CRON || '0 20 * * *';
/** Daily idle/stop JSON scan — 03:00 server local time (previous calendar day). */
const IDLE_STOP_CRON = process.env.IDLE_STOP_CRON || '0 3 * * *';
let credentials = {
  token: process.env.MONITOR_TOKEN || '',
  username: process.env.MONITOR_USERNAME || '',
  password: process.env.MONITOR_PASSWORD || '',
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptCredentials() {
  if (credentials.username && credentials.token) {
    console.log('✓ Using credentials from .env.local');
    if (!credentials.password) {
      console.log('⚠ MONITOR_PASSWORD not set — auto-refresh disabled\n');
    } else {
      console.log('✓ Auto-refresh enabled\n');
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    rl.question('Enter your username: ', (username) => {
      rl.question('Enter your token: ', (token) => {
        credentials = { username, token, password: '' };
        console.log('\n✓ Credentials saved\n');
        resolve();
      });
    });
  });
}

async function refreshToken() {
  if (!credentials.password) {
    console.error('Cannot refresh token: MONITOR_PASSWORD not set in .env.local');
    return false;
  }

  console.log('🔄 Token expired, attempting to refresh...');
  try {
    const response = await fetch('https://api.gps51.com/openapi?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DEVICE',
        from: 'web',
        username: credentials.username,
        password: credentials.password,
        browser: 'MonitoringService',
      }),
    });
    const data = await response.json();
    if (data.status === 0 && data.token) {
      credentials.token = data.token;
      console.log('✓ Token refreshed successfully');
      return true;
    }
    console.error(`✗ Token refresh failed: ${data.cause}`);
    return false;
  } catch (error) {
    console.error(`✗ Token refresh error: ${error.message}`);
    return false;
  }
}

function isTokenExpired(data) {
  if (!data) return false;
  const cause = data.cause || '';
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login'
  );
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
  console.log('⚠ Next.js server may not be ready; mileage cron may fail until it is up.\n');
  return false;
}

async function runIdleStopScheduled(reportDate = null) {
  const timeStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  console.log(`\n[IdleStopScheduled] ${timeStr}${reportDate ? ` reportDate=${reportDate}` : ''}`);

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username,
    };
    if (reportDate) requestBody.reportDate = reportDate;

    let response = await fetch(`${API_URL}/api/idle-stop-scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      timeout: 2 * 60 * 60 * 1000,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[IdleStopScheduled] Non-JSON (${response.status}): ${text.substring(0, 200)}`);
      return;
    }

    let data = await response.json();

    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      if (refreshed) {
        requestBody.token = credentials.token;
        response = await fetch(`${API_URL}/api/idle-stop-scheduled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          timeout: 2 * 60 * 60 * 1000,
        });
        data = await response.json();
      } else {
        console.error('[IdleStopScheduled] Token refresh failed; skipping.');
        return;
      }
    }

    if (data.status === 0) {
      console.log(
        `[IdleStopScheduled] OK json=${data.jsonFile || 'n/a'} stops=${data.summary?.totalStopEvents ?? 'n/a'} idle=${data.summary?.totalIdleEvents ?? 'n/a'}`
      );
    } else {
      console.error(`[IdleStopScheduled] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[IdleStopScheduled] Error: ${error.message}`);
  }
}

async function runMileageScheduled(reportDate = null) {
  const timeStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  console.log(`\n[MileageScheduled] ${timeStr}${reportDate ? ` reportDate=${reportDate}` : ''}`);

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username,
    };
    if (reportDate) requestBody.reportDate = reportDate;

    let response = await fetch(`${API_URL}/api/mileage-scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      timeout: 2 * 60 * 60 * 1000,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[MileageScheduled] Non-JSON (${response.status}): ${text.substring(0, 200)}`);
      return;
    }

    let data = await response.json();

    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      if (refreshed) {
        requestBody.token = credentials.token;
        response = await fetch(`${API_URL}/api/mileage-scheduled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          timeout: 2 * 60 * 60 * 1000,
        });
        data = await response.json();
      } else {
        console.error('[MileageScheduled] Token refresh failed; skipping.');
        return;
      }
    }

    if (data.status === 0) {
      console.log(
        `[MileageScheduled] OK json=${data.jsonFile || 'n/a'} at5000=${data.summary?.atScheduledMaintenance ?? 'n/a'} at10000=${data.summary?.atPreventiveMaintenance ?? 'n/a'}`
      );
    } else {
      console.error(`[MileageScheduled] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[MileageScheduled] Error: ${error.message}`);
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

const mileageClock = parseCronWallClock(MILEAGE_CRON, 20, 0);
const idleStopClock = parseCronWallClock(IDLE_STOP_CRON, 3, 0);

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
  console.log('║     GIGMotors Mileage + Idle/Stop JSON monitoring        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Configuration:');
  console.log(`  - Mileage cron: ${MILEAGE_CRON} (daily JSON → mileage_json/)`);
  console.log(`  - Idle/stop cron: ${IDLE_STOP_CRON} (daily JSON → idle_stop_json/)`);
  console.log(`  - Thresholds: 5000 km scheduled, 10000 km preventive`);
  console.log(`  - Developer APIs: GET ${API_URL}/api/mileage-data`);
  console.log(`                    GET ${API_URL}/api/idle-stop-data`);
  console.log('  - Overspeed / trips / offline / parking Excel crons: DISABLED\n');
  console.log(`  - API URL: ${API_URL}\n`);

  await promptCredentials();
  await waitForServer(20, 1000);

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const todayJson = path.join(process.cwd(), 'mileage_json', `mileage_${todayStr}.json`);
  if (!fs.existsSync(todayJson)) {
    console.log(`⚠ No mileage JSON for today (${todayStr}). Running catch-up scan…\n`);
    await runMileageScheduled(todayStr);
  } else {
    console.log(`✅ Today's mileage JSON exists: mileage_${todayStr}.json\n`);
  }

  const idleStopJson = path.join(process.cwd(), 'idle_stop_json', `idle_stop_${yesterdayStr}.json`);
  if (!fs.existsSync(idleStopJson)) {
    console.log(`⚠ No idle/stop JSON for ${yesterdayStr}. Running catch-up scan…\n`);
    await runIdleStopScheduled(yesterdayStr);
  } else {
    console.log(`✅ Idle/stop JSON exists: idle_stop_${yesterdayStr}.json\n`);
  }

  const msMileage = msUntilNextLocalWallClock(new Date(), mileageClock.hour, mileageClock.minute);
  const msIdleStop = msUntilNextLocalWallClock(new Date(), idleStopClock.hour, idleStopClock.minute);
  console.log('📅 Schedule:');
  console.log(`  - Next mileage run: ~${formatCountdown(msMileage)} (pattern ${MILEAGE_CRON})`);
  console.log(`  - Next idle/stop run: ~${formatCountdown(msIdleStop)} (pattern ${IDLE_STOP_CRON})\n`);
  console.log('✅ Service started. Press Ctrl+C to stop.\n');

  let lastMileageCronStart = null;
  let lastIdleStopCronStart = null;

  const mileageCronJob = cron.schedule(MILEAGE_CRON, async () => {
    const t = new Date().toLocaleString();
    lastMileageCronStart = t;
    console.log(`\n🔔 [CRON mileage] START ${t} — ${MILEAGE_CRON}`);
    try {
      await runMileageScheduled();
      console.log(`✅ [CRON mileage] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON mileage] ERROR`, error);
    }
  });

  const idleStopCronJob = cron.schedule(IDLE_STOP_CRON, async () => {
    const t = new Date().toLocaleString();
    lastIdleStopCronStart = t;
    console.log(`\n🔔 [CRON idle-stop] START ${t} — ${IDLE_STOP_CRON}`);
    try {
      await runIdleStopScheduled();
      console.log(`✅ [CRON idle-stop] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON idle-stop] ERROR`, error);
    }
  });

  console.log(`📋 Mileage cron: ${mileageCronJob ? 'SUCCESS' : 'FAILED'} — ${MILEAGE_CRON}`);
  console.log(`📋 Idle/stop cron: ${idleStopCronJob ? 'SUCCESS' : 'FAILED'} — ${IDLE_STOP_CRON}\n`);

  setInterval(async () => {
    const now = new Date();
    const msNextMileage = msUntilNextLocalWallClock(now, mileageClock.hour, mileageClock.minute);
    const msNextIdleStop = msUntilNextLocalWallClock(now, idleStopClock.hour, idleStopClock.minute);
    let nextjsStatus = '🔴 DOWN';
    try {
      const res = await fetchNextJsHealth({ signal: AbortSignal.timeout(5000) });
      if (res.ok || res.status === 404) nextjsStatus = '🟢 UP';
    } catch {
      /* down */
    }
    console.log(`\n💚 [HEARTBEAT] ${now.toLocaleString()}`);
    console.log(`   🟢 Monitoring: RUNNING`);
    console.log(`   ${nextjsStatus} Next.js`);
    console.log(
      `   📅 Mileage ${MILEAGE_CRON} — next ~${formatCountdown(msNextMileage)} — last=${lastMileageCronStart || '—'}`
    );
    console.log(
      `   📅 Idle/stop ${IDLE_STOP_CRON} — next ~${formatCountdown(msNextIdleStop)} — last=${lastIdleStopCronStart || '—'}`
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
