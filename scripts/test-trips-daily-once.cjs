/**
 * One-shot test: POST /api/trips-daily using MONITOR_* from .env.local
 * Usage: node scripts/test-trips-daily-once.cjs [YYYY-MM-DD]
 */
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005').replace(/\/$/, '');
const username = process.env.MONITOR_USERNAME;
let token = process.env.MONITOR_TOKEN;
const monitorPassword = process.env.MONITOR_PASSWORD || '';

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isTokenExpiredPayload(data) {
  if (!data || typeof data !== 'object') return false;
  const cause = String(data.cause || '');
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login' ||
    data.error === 'TOKEN_EXPIRED'
  );
}

async function refreshGps51Token() {
  if (!monitorPassword) {
    console.error('Token expired. Set MONITOR_PASSWORD (MD5 per GPS51) in .env.local to auto-refresh, or update MONITOR_TOKEN.');
    return false;
  }
  const res = await fetch('https://api.gps51.com/openapi?action=login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'DEVICE',
      from: 'web',
      username,
      password: monitorPassword,
      browser: 'test-trips-daily-once',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status === 0 && data.token) {
    token = data.token;
    console.log('Refreshed GPS51 token via login (update MONITOR_TOKEN in .env.local to persist).');
    return true;
  }
  console.error('Login failed:', data.cause || JSON.stringify(data));
  return false;
}

async function postTripsDaily(reportDate) {
  const url = `${base}/api/trips-daily`;
  // Native fetch uses ~300s headers timeout; full-fleet export can run much longer.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, token, reportDate }),
    timeout: 2 * 60 * 60 * 1000,
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function main() {
  if (!username || !token) {
    console.error('Missing MONITOR_USERNAME or MONITOR_TOKEN in .env.local');
    process.exit(1);
  }
  const reportDate = process.argv[2] || yesterdayStr();
  const url = `${base}/api/trips-daily`;
  console.log(`POST ${url}`);
  console.log(`reportDate=${reportDate} (token not logged)`);

  let { res, body } = await postTripsDaily(reportDate);
  if (isTokenExpiredPayload(body)) {
    const ok = await refreshGps51Token();
    if (ok) {
      ({ res, body } = await postTripsDaily(reportDate));
    }
  }

  console.log('HTTP', res.status);
  console.log(JSON.stringify(body, null, 2));
  process.exit(res.ok && body.status === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
