// saveOverspeedReport.js
// Fetches overspeed report and appends to Excel every 10 minutes

// Polyfill fetch for Node.js if not available
if (typeof fetch !== 'function') {
  global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
}
const ExcelJS = require('exceljs');
const cron = require('node-cron');
const fs = require('fs');

// CONFIGURE THESE VALUES
const API_URL = 'https://api.gps51.com/openapi?action=reportalarm&token=27aad55b60d8c212e8358ccb054f01d8&serverid=2';
const EXCEL_FILE = 'overspeed_report.xlsx';

const TOKEN = '27aad55b60d8c212e8358ccb054f01d8'; // Set your auth token
// List of all device IDs (truncated for brevity, add all as needed)
const DEVICE_IDS = [
  '864943048368340', '864943048368530', '864943048369314', '864943048369470',
  '864943048369082', '864943048369132', '864943048369215', '864943048369702',
  '864943048369884', '864943048369892', '864943048359042', '864943048580746',
  // ... add all device IDs from your list here ...
];
const SPEED_LIMIT = 100; // Only interested in overspeed > 100km/hr

// Helper to get current time range (last 10 minutes)
function getTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 10 * 60 * 1000);
  const pad = n => n.toString().padStart(2, '0');
  const format = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { begintime: format(start), endtime: format(end) };
}



function getDayRange() {
  // Use today as endDay, yesterday as startDay for demo; adjust as needed
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const pad = n => n.toString().padStart(2, '0');
  const format = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  return { startDay: format(start), endDay: format(end) };
}

async function fetchOverspeedData(deviceid) {
  const { startDay, endDay } = getDayRange();
  const body = {
    devices: [deviceid],
    startDay,
    endDay,
    offset: 1,
    needalarm: 5 // 5 = overspeed alarm
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}


async function appendToExcel(records) {
  if (!records || records.length === 0) return;
  const workbook = new ExcelJS.Workbook();
  let worksheet;
  if (fs.existsSync(EXCEL_FILE)) {
    await workbook.xlsx.readFile(EXCEL_FILE);
    worksheet = workbook.getWorksheet('Overspeed') || workbook.addWorksheet('Overspeed');
  } else {
    worksheet = workbook.addWorksheet('Overspeed');
    worksheet.addRow(['Timestamp', 'DeviceID', 'Speed', 'Location', 'OtherData']);
  }
  records.forEach(rec => {
    if (rec.speed && rec.speed > 100) {
      worksheet.addRow([
        new Date().toISOString(),
        rec.deviceid,
        rec.speed,
        rec.location || '',
        JSON.stringify(rec)
      ]);
    }
  });
  await workbook.xlsx.writeFile(EXCEL_FILE);
}


async function runTask() {
  try {
    let totalRecords = 0;
    for (const deviceid of DEVICE_IDS) {
      try {
        const data = await fetchOverspeedData(deviceid);
        if (data && data.alarmrecords && data.alarmrecords.length > 0) {
          await appendToExcel(data.alarmrecords);
          totalRecords += data.alarmrecords.length;
        }
      } catch (err) {
        console.error(`Device ${deviceid} error:`, err.message);
      }
    }
    console.log(`[${new Date().toISOString()}] Appended ${totalRecords} overspeed alarm records.`);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

// Schedule every 10 minutes
cron.schedule('*/10 * * * *', runTask);

// Run immediately on start
runTask();
