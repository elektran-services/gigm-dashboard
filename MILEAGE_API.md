# GIGM Mileage JSON API

Developer-facing mileage maintenance API. Fleet snapshots are generated on a schedule (or on demand), stored as JSON, and read via a secured GET endpoint.

## Overview

| Item | Detail |
|------|--------|
| **Scheduled maintenance** | 5000 km odometer segments |
| **Preventive maintenance** | 10000 km odometer segments |
| **Output** | `mileage_json/latest.json` and `mileage_json/mileage_YYYY-MM-DD.json` |
| **Email / Excel** | Disabled for mileage (JSON only) |
| **Background crons** | **Mileage only** — overspeed, trips, offline, and parking crons are disabled |

Default mileage cron: **12:00 daily** (server local time), configurable via `MILEAGE_CRON` in `.env.local`.

---

## Environment variables

Add to `.env.local` (see `.env.example`):

```env
# GPS51 credentials (for scheduled scan — not for developer read API)
MONITOR_USERNAME=GIGMobility
MONITOR_TOKEN=your-gps51-token
MONITOR_PASSWORD=md5-hash-of-password

# Developer API key (required for GET /api/mileage-data when set)
MILEAGE_API_KEY=your-long-random-secret

# Optional: cron schedule (default 0 12 * * * = noon daily)
# MILEAGE_CRON=0 12 * * *

# HERE API key — used to reverse-geocode lat/lon into addresses
NEXT_PUBLIC_HERE_API_KEY=your-here-key

# Local server URL (monitoring service)
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
```

### Generating `MILEAGE_API_KEY`

Any long random secret works. Examples:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

After changing `.env.local`, restart Next.js:

```bash
pm2 restart nextjs-server
```

| `MILEAGE_API_KEY` | Behavior |
|-------------------|----------|
| Not set | `GET /api/mileage-data` is **open** (local dev only) |
| Set | Requests must send the same key or receive **401** |

---

## Data sources (live GPS51)

All vehicle data comes from GPS51 at scan time — nothing is hardcoded.

| JSON field | Source |
|------------|--------|
| `imei`, `deviceName` | `querymonitorlist` |
| `currentOdometerKm` | `reportmileagedetail` — latest `enddis` ÷ 1000 |
| `location` | `lastposition` — `callat`, `callon`, `strstatusen`, `moving`, `speed` |
| `location.address` | HERE reverse geocode (if API key configured) |
| `scheduledMaintenance`, `preventiveMaintenance` | Calculated in app from odometer |

---

## Maintenance math

Virtual odometer segments (per interval: 5000 or 10000 km):

```
referenceOdometerKm = floor(currentOdometerKm ÷ intervalKm) × intervalKm
distanceSinceReferenceKm = currentOdometerKm − referenceOdometerKm
remainingKm = intervalKm − distanceSinceReferenceKm
```

### Status flags

| Status | Meaning |
|--------|---------|
| `at_threshold` | `distanceSinceReferenceKm ≥ 4999` — completed current segment (due at 5000 or 10000 km) |
| `almost` | `remainingKm ≤ 500` |
| `due` | Past segment end |
| `good` | Otherwise |

### Example (odometer 124,835 km, 5000 km interval)

- Reference: `floor(124835 ÷ 5000) × 5000` = **120,000**
- Distance in segment: **4,835 km**
- Remaining: **165 km** → `almost`, not `at_threshold`

---

## Location fields

| Field | Notes |
|-------|--------|
| `latitude`, `longitude` | From GPS51 `callat`, `callon` |
| `speedKmh` | Converted from GPS51 raw speed (values ≥ 1000 are divided by 1000) |
| `speedRaw` | Raw value from GPS51 |
| `status` | e.g. `ACC OFF …/Defence` — from `strstatusen` |
| `moving` | GPS51 `moving > 0` — may disagree with `status` text; trust `status` + `speedKmh` for engine state |
| `positionUpdatedAt` | ISO timestamp from GPS51 `updatetime` |

---

## API endpoints

### 1. Read mileage data (developers)

**`GET /api/mileage-data`**

| Query | Description |
|-------|-------------|
| *(none)* | Latest report (`mileage_json/latest.json`) |
| `?list=1` | Available report dates |
| `?date=YYYY-MM-DD` | Report for that date |

**Authentication** (when `MILEAGE_API_KEY` is set):

- Header: `X-Api-Key: your-secret-key` **(recommended)**
- Or query: `?apiKey=your-secret-key`

**Example response shape:**

```json
{
  "status": 0,
  "cause": "OK",
  "generatedAt": "2026-05-18T10:18:18.662Z",
  "asOfDate": "2026-05-18",
  "deviceCount": 4,
  "mileageErrors": 1,
  "thresholds": {
    "scheduledMaintenanceKm": 5000,
    "preventiveMaintenanceKm": 10000
  },
  "summary": {
    "atScheduledMaintenance": 0,
    "atPreventiveMaintenance": 0,
    "scheduledAlmostDue": 1,
    "preventiveAlmostDue": 0
  },
  "vehicles": [
    {
      "imei": "358657103711920",
      "deviceName": "DKA 592 XB",
      "location": {
        "latitude": 9.02957,
        "longitude": 7.58579,
        "address": "...",
        "speedKmh": 0,
        "speedRaw": 0,
        "course": 260,
        "status": "ACC OFF …/Defence",
        "moving": false,
        "positionUpdatedAt": "2026-05-18T09:51:11.261Z",
        "gpsSource": "gps"
      },
      "currentOdometerKm": 124835.004,
      "lastStatisticsDay": "2026-05-18",
      "scheduledMaintenance": { "intervalKm": 5000, "atThreshold": false, "status": "almost", "..." : "..." },
      "preventiveMaintenance": { "intervalKm": 10000, "atThreshold": false, "status": "good", "..." : "..." },
      "error": null
    }
  ]
}
```

**Filter examples (client-side):**

```javascript
const due5000 = data.vehicles.filter((v) => v.scheduledMaintenance?.atThreshold);
const due10000 = data.vehicles.filter((v) => v.preventiveMaintenance?.atThreshold);
```

---

### 2. Generate / refresh snapshot (internal)

**`POST /api/mileage-scheduled`**

Not protected by `MILEAGE_API_KEY`. Uses GPS51 token + username.

```json
{
  "token": "YOUR_MONITOR_TOKEN",
  "username": "GIGMobility",
  "reportDate": "2026-05-18"
}
```

`reportDate` is optional (defaults to today). Scans all devices, writes JSON files. Typical runtime: ~30s for a small fleet (rate-limited GPS51 calls).

---

## Running the scan

### Automatic (PM2)

```bash
pm2 start ecosystem.config.js
# or
pm2 restart monitoring-service
```

`monitoringService.js` runs **mileage only** at `MILEAGE_CRON` (default 12:00). On startup it runs a catch-up scan if today’s JSON file is missing.

### Manual

```bash
curl -X POST http://127.0.0.1:3001/api/mileage-scheduled \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_TOKEN","username":"GIGMobility"}'
```

PowerShell:

```powershell
$body = @{ token = "YOUR_TOKEN"; username = "GIGMobility" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/mileage-scheduled" `
  -Method POST -Body $body -ContentType "application/json" -TimeoutSec 600
```

---

## Postman testing

Base URL (local): `http://127.0.0.1:3001`

### Latest report

| | |
|--|--|
| Method | `GET` |
| URL | `http://127.0.0.1:3001/api/mileage-data` |
| Header | `X-Api-Key` = value from `MILEAGE_API_KEY` in `.env.local` |

Expect **200** with full JSON. Without the header (when key is set): **401 Unauthorized**.

### List dates

| | |
|--|--|
| Method | `GET` |
| URL | `http://127.0.0.1:3001/api/mileage-data?list=1` |
| Header | `X-Api-Key` |

### Report by date

| | |
|--|--|
| Method | `GET` |
| URL | `http://127.0.0.1:3001/api/mileage-data?date=2026-05-18` |
| Header | `X-Api-Key` |

### Trigger scan (optional)

| | |
|--|--|
| Method | `POST` |
| URL | `http://127.0.0.1:3001/api/mileage-scheduled` |
| Header | `Content-Type: application/json` |
| Body (raw JSON) | `{ "token": "...", "username": "GIGMobility" }` |

No `X-Api-Key` on this endpoint.

### Postman collection variables (suggested)

| Variable | Example |
|----------|---------|
| `baseUrl` | `http://127.0.0.1:3001` |
| `mileageApiKey` | *(from `.env.local`)* |

URL: `{{baseUrl}}/api/mileage-data`  
Header: `X-Api-Key: {{mileageApiKey}}`

---

## GPS51 requirements

- Server public IP must be **whitelisted** in GPS51 for `querymonitorlist`, `reportmileagedetail`, and `lastposition`.
- Login uses `MONITOR_USERNAME` + MD5-hashed `MONITOR_PASSWORD` for token refresh in the monitoring service.

---

## Code locations

| File | Purpose |
|------|---------|
| `lib/mileageFleetScan.ts` | Fleet scan + JSON build |
| `lib/mileageServiceMath.ts` | 5000 / 10000 km segment math |
| `lib/mileageLocation.ts` | Last position + speed normalization |
| `lib/mileageJsonStorage.ts` | Read/write `mileage_json/` |
| `app/api/mileage-data/route.ts` | Developer GET API + API key |
| `app/api/mileage-scheduled/route.ts` | POST trigger for scan |
| `monitoringService.js` | Mileage-only cron |

---

## What to share with external developers

1. Base URL (production HTTPS URL).
2. `MILEAGE_API_KEY` (secure channel — not in git).
3. This document or the endpoint summary:
   - `GET /api/mileage-data` with `X-Api-Key`
   - Optional `?list=1` and `?date=YYYY-MM-DD`
4. They do **not** need GPS51 credentials for reading JSON.

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| `401 Unauthorized` on GET | Add `X-Api-Key` header; restart `nextjs-server` after env change |
| `404` no report | Run `POST /api/mileage-scheduled` first |
| `ip not in white list` on scan | Whitelist server IP with GPS51 |
| `No odometer (enddis)` for a vehicle | GPS51 has no mileage records for that device |
| `speedKmh` looked like 78000 | Fixed: use `speedKmh` (converted) and `speedRaw` (GPS51 value) |
| `moving: true` but `ACC OFF` in status | Raw GPS51 flags; use `status` for ignition state |
