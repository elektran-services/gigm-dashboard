/**
 * One-shot idle/stop API test: scan then read latest JSON.
 * Usage: node scripts/test-idle-stop-once.cjs [reportDate YYYY-MM-DD]
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const base = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const token = process.env.MONITOR_TOKEN;
const username = process.env.MONITOR_USERNAME;
const apiKey = process.env.IDLE_STOP_API_KEY || process.env.MILEAGE_API_KEY;

const reportDate = process.argv[2] || null;

async function main() {
  if (!token || !username) {
    console.error('Set MONITOR_TOKEN and MONITOR_USERNAME in .env.local');
    process.exit(1);
  }

  const scanBody = { token, username };
  if (reportDate) scanBody.reportDate = reportDate;

  console.log(`POST ${base}/api/idle-stop-scheduled`);
  console.log(`  reportDate=${reportDate || '(default: yesterday)'}`);

  const scanRes = await fetch(`${base}/api/idle-stop-scheduled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scanBody),
  });

  const scanText = await scanRes.text();
  let scanData;
  try {
    scanData = JSON.parse(scanText);
  } catch {
    console.error('Scan response not JSON:', scanText.slice(0, 500));
    process.exit(1);
  }

  if (scanData.status !== 0) {
    console.error('Scan failed:', scanData.cause || scanData);
    process.exit(1);
  }

  console.log('\n--- Scan OK ---');
  console.log('  jsonFile:', scanData.jsonFile);
  console.log('  reportDate:', scanData.reportDate);
  console.log('  deviceCount:', scanData.deviceCount);
  console.log('  scanErrors:', scanData.scanErrors);
  console.log('  summary:', JSON.stringify(scanData.summary));

  const headers = { Accept: 'application/json' };
  if (apiKey) headers['X-Api-Key'] = apiKey;

  const readRes = await fetch(`${base}/api/idle-stop-data`, { headers });
  const readData = await readRes.json();

  if (readData.status !== 0) {
    console.error('Read failed:', readData.cause || readData);
    process.exit(1);
  }

  console.log('\n--- GET /api/idle-stop-data OK ---');
  console.log('  generatedAt:', readData.generatedAt);
  console.log('  vehicles:', readData.vehicles?.length);

  const sample = (readData.vehicles || []).slice(0, 3).map((v) => ({
    imei: v.imei,
    deviceName: v.deviceName,
    stops: v.stopEvents?.length ?? 0,
    idle: v.idleEvents?.length ?? 0,
    accOff: v.accOffEvents?.length ?? 0,
    dailyIdleMs: v.dailyRollup?.idleMs,
    error: v.error,
  }));
  console.log('  sample vehicles:', JSON.stringify(sample, null, 2));

  const outPath = path.join(__dirname, '..', 'idle_stop_json', 'latest.json');
  if (fs.existsSync(outPath)) {
    const stat = fs.statSync(outPath);
    console.log(`\n  File: idle_stop_json/latest.json (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
