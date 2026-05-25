// getTokenAndDeviceId.js
// Logs in and fetches token and device IDs for MantracNig


const md5 = require('md5');

const API_URL = 'https://api.gps51.com/openapi';
const USERNAME = 'MantracNig';
const PASSWORD = 'MantracNig2025';
const SERVER_ID = '2';

async function login() {
  const loginBody = {
    type: 'DEVICE',
    from: 'web',
    username: USERNAME,
    password: md5(PASSWORD),
    browser: 'NodeScript/1.0'
  };
  const res = await fetch(`${API_URL}?action=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginBody)
  });
  if (!res.ok) throw new Error('Login failed');
  const data = await res.json();
  if (data.status !== 0) throw new Error('Login error: ' + data.cause);
  return data.token;
}

async function getDeviceIds(token) {
  const url = `${API_URL}?action=querymonitorlist&token=${token}&serverid=${SERVER_ID}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME })
  });
  if (!res.ok) throw new Error('Device list fetch failed');
  const data = await res.json();
  if (data.status !== 0) throw new Error('Device list error: ' + data.cause);
  // Device IDs are in data.groups[].devices[]
  const ids = [];
  if (data.groups) {
    data.groups.forEach(group => {
      if (group.devices) {
        group.devices.forEach(device => ids.push(device.deviceid));
      }
    });
  }
  return ids;
}


(async () => {
  try {
    // Use global fetch in Node.js 18+, fallback to node-fetch if not available
    if (typeof fetch !== 'function') {
      global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    }
    const token = await login();
    console.log('TOKEN:', token);
    const deviceIds = await getDeviceIds(token);
    console.log('DEVICE IDS:', deviceIds);
  } catch (err) {
    console.error('ERROR:', err.message);
  }
})();
