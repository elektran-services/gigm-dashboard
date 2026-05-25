# GIGM Idle & Stop JSON API — Design & GPS51 Reference

Developer-facing API for **idle time (engine on, not moving)** and **stop time (engine off / parked)** with **location**, stored as JSON snapshots (same pattern as mileage).

---

## Part 1 — GPS51 endpoints reference

### All GPS51 actions used in this project

| # | Action | Used for | In app today |
|---|--------|----------|--------------|
| 1 | `login` | Auth token | Yes |
| 2 | `querymonitorlist` | Fleet list (IMEI, name) | Yes |
| 3 | `lastposition` | Latest position per device | Yes |
| 4 | `reportmileagedetail` | Daily odometer, `totalacc`, `totalidle` | Yes |
| 5 | `reportoffline` | Offline devices | Yes |
| 6 | `querytrips` | Trip segments | Yes |
| 7 | `reportparkdetailbytime` | **Parking / stop events** | Yes (parking reports) |
| 8 | `reportalarm` | Alarms | Yes |
| 9 | `reportaccsbytime` | **ACC on/off segments with location** | **Documented only** (`app/api/Reports.md`) |
| 10 | `querydevicetypeownerbyuser` | Device types | Samples only |
| 11 | `sendcmd` / `batchoperate` | Device commands | Settings |

Full request/response samples: `app/api/Reports.md`.

### Parking — which endpoint?

**`reportparkdetailbytime`**

- Routes: `POST /api/parking`, `POST /api/parking-scheduled`
- Body:

```json
{
  "deviceid": "864943048370114",
  "begintime": "2026-03-01 08:00:00",
  "endtime": "2026-03-02 18:00:00",
  "timezone": 8,
  "interval": 5
}
```

- Per record: `starttime`, `endtime`, `callat`, `callon`, `address`, `durationidle` (ms), `strstatusen` (often `ACC OFF`), `speed`
- **Stop duration:** `endtime − starttime`
- Scheduled job filters stays **≥ 5 minutes** (`MIN_STAY_MS` in `parking-scheduled/route.ts`)
- Parking cron is **disabled** in `monitoringService.js` (mileage-only cron runs today)

### Which API fits idle vs stop with location?

| Need | Best GPS51 action | Location? | Duration? | Notes |
|------|-------------------|-----------|-----------|--------|
| **Stop — engine not running** | `reportparkdetailbytime` | Yes | Yes (event window) | Already used for parking Excel |
| **Idle — engine on (daily total)** | `reportmileagedetail` | No | `totalidle` per day (ms) | No per-event lat/lon |
| **ACC segments — on/off with location** | `reportaccsbytime` | Yes (`slat`/`slon`, `elat`/`elon`) | Yes (`begintime`–`endtime`) | **Not wired in app yet** — primary source for idle/stop segments |
| **Live snapshot** | `lastposition` | Yes | `parkduration`, `accduration` | Current state only, not history |
| **Trips** | `querytrips` | Start/end coords | `triptime`, `parktime` | Trip-based, not dedicated idle report |

### `reportaccsbytime` (to be integrated)

```json
{
  "deviceids": ["864943048370114"],
  "starttime": "2026-03-01 08:00:00",
  "endtime": "2026-03-04 18:00:00",
  "offset": 8
}
```

Each segment: `accstate`, `begintime`, `endtime`, `slat`, `slon`, `elat`, `elon`.

**Important:** Confirm `accstate` values with GPS51 (samples show `2` with long ACC OFF parking, `3` with movement). Map in app after vendor confirmation.

### `reportmileagedetail` idle fields (daily rollup)

- `totalacc` — engine-on time (ms) per day
- `totalidle` — idle time while ACC on (ms) per day
- Used in Mileage Report UI; **no coordinates** for idle events

---

## Part 2 — What we are building (`/api/idle-stop-data`)

Same architecture as mileage:

1. **Background scan** (cron or manual) calls GPS51, normalizes data, writes JSON files.
2. **Developer GET** reads JSON from disk — fast, no GPS51 token on the client.

No email. No Excel for this feature.

---

## Goals (your use case)

| Goal | How we satisfy it |
|------|-------------------|
| **Stop duration when engine is off** | Events from `reportparkdetailbytime` + ACC-off segments from `reportaccsbytime` |
| **Idle duration when engine is on** | Segments from `reportaccsbytime` (ACC on, low/no movement) + daily `totalidle` from `reportmileagedetail` as rollup |
| **Location for each event** | Lat/lon + HERE address (reuse `mileageLocation` geocode pattern) |
| **Fleet-wide, one call for integrators** | `GET /api/idle-stop-data` returns full snapshot |
| **IMEI + device name** | From `querymonitorlist` |
| **Secure for external systems** | API key header (like `MILEAGE_API_KEY`) |

---

## Proposed endpoints

| Method | Path | Role |
|--------|------|------|
| `POST` | `/api/idle-stop-scheduled` | Internal: scan fleet, write JSON (cron + manual) |
| `GET` | `/api/idle-stop-data` | **Developer:** read latest or dated snapshot |

Optional later: `GET /api/idle-stop-data?imei=…` to filter one vehicle (can also be client-side filter).

---

## GPS51 calls per scan (per device)

| Step | Action | Purpose |
|------|--------|---------|
| 1 | `querymonitorlist` | Device list (once per scan) |
| 2 | `lastposition` | Optional: current park/ACC snapshot on each vehicle |
| 3 | `reportaccsbytime` | ACC segments with start/end time + coordinates |
| 4 | `reportparkdetailbytime` | Stop/park events (engine off), `durationidle` |
| 5 | `reportmileagedetail` | Yesterday’s `totalacc` / `totalidle` daily totals |

**Report window:** previous calendar day `00:00:00` – `23:59:59` (same as parking cron), timezone from env (default `8`).

**Rate limiting:** delay between devices (e.g. 5–8s) to respect GPS51 limits; fleet scan may take several minutes.

---

## JSON storage (mirror mileage)

| File | Purpose |
|------|---------|
| `idle_stop_json/latest.json` | Always newest snapshot |
| `idle_stop_json/idle_stop_YYYY-MM-DD.json` | Dated archive |
| Retention | 365 days (configurable, same pattern as mileage) |

---

## Proposed response shape (`GET /api/idle-stop-data`)

```json
{
  "status": 0,
  "cause": "OK",
  "generatedAt": "2026-05-18T15:00:00.000Z",
  "reportDate": "2026-05-17",
  "timezone": 8,
  "deviceCount": 42,
  "scanErrors": 1,
  "filters": {
    "minStopDurationMinutes": 5,
    "accStateEngineOn": 3,
    "accStateEngineOff": 2
  },
  "summary": {
    "totalStopEvents": 120,
    "totalIdleEvents": 45,
    "totalStopDurationMs": 86400000,
    "totalIdleDurationMs": 3600000,
    "vehiclesWithData": 40
  },
  "vehicles": [
    {
      "imei": "358657103711920",
      "deviceName": "DKA 592 XB",
      "dailyRollup": {
        "statisticsDay": "2026-05-17",
        "engineOnMs": 28800000,
        "idleMs": 3600000,
        "idlePercent": 12.5
      },
      "liveSnapshot": {
        "latitude": 9.02957,
        "longitude": 7.58579,
        "address": "...",
        "status": "ACC OFF …/Defence",
        "parkDurationMs": 79200000,
        "accDurationMs": 79200000,
        "moving": false,
        "positionUpdatedAt": "2026-05-18T09:51:11.261Z"
      },
      "stopEvents": [
        {
          "type": "stop",
          "source": "reportparkdetailbytime",
          "startTime": "2026-05-17T08:12:13.000Z",
          "endTime": "2026-05-17T14:47:26.000Z",
          "durationMs": 23713000,
          "idleWithinStopMs": 58753,
          "latitude": 6.52409,
          "longitude": 3.40403,
          "address": "Third Mainland Bridge, ...",
          "status": "ACC OFF 13H44M/Defence/Voltage 12.7V",
          "speedKmh": 0
        }
      ],
      "idleEvents": [
        {
          "type": "idle",
          "source": "reportaccsbytime",
          "accState": 3,
          "startTime": "2026-05-17T10:00:00.000Z",
          "endTime": "2026-05-17T10:45:00.000Z",
          "durationMs": 2700000,
          "startLatitude": 6.6054,
          "startLongitude": 3.36751,
          "endLatitude": 6.60539,
          "endLongitude": 3.36751,
          "address": "Oregun, Alausa, Ikeja, Lagos, Nigeria"
        }
      ],
      "error": null
    }
  ]
}
```

### Event classification rules (draft)

| Event type | Source | Rule |
|------------|--------|------|
| `stop` | `reportparkdetailbytime` | `endtime - starttime >= minStopDuration` (default 5 min); classify engine off from `strstatusen` containing `ACC OFF` or speed ≈ 0 |
| `idle` | `reportaccsbytime` | `accstate` = engine-on (confirm with GPS51); duration = `endtime - begintime`; optional: merge with park records where `durationidle > 0` |
| `dailyRollup` | `reportmileagedetail` | Previous day row: `totalacc`, `totalidle` for cross-check totals |

---

## Environment variables (planned)

```env
# Developer read API (optional — if unset, GET is open in dev only)
IDLE_STOP_API_KEY=your-long-random-secret

# Cron schedule (default: 15:00 daily — after parking used to run)
# IDLE_STOP_CRON=0 15 * * *

# Scan defaults
IDLE_STOP_TIMEZONE=8
IDLE_STOP_MIN_STOP_MINUTES=5
IDLE_STOP_PARK_INTERVAL_MINUTES=5

# Reuse existing
MONITOR_USERNAME=
MONITOR_TOKEN=
MONITOR_PASSWORD=
NEXT_PUBLIC_HERE_API_KEY=
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
```

Can use **one shared API key** with mileage (`MILEAGE_API_KEY`) or a separate `IDLE_STOP_API_KEY` — recommend **separate keys** per API for least privilege.

---

## Developer API — `GET /api/idle-stop-data`

| Query | Description |
|-------|-------------|
| *(none)* | Latest report (`idle_stop_json/latest.json`) |
| `?list=1` | Available report dates |
| `?date=YYYY-MM-DD` | Report for that date |
| `?imei=…` | *(optional phase 2)* Single vehicle |

**Auth** (when `IDLE_STOP_API_KEY` is set):

- Header: `X-Api-Key: your-secret-key`
- Or query: `?apiKey=your-secret-key`

---

## Internal scan — `POST /api/idle-stop-scheduled`

```json
{
  "token": "YOUR_MONITOR_TOKEN",
  "username": "GIGMobility",
  "reportDate": "2026-05-17"
}
```

- `reportDate` optional (default: **previous calendar day**)
- Writes `idle_stop_json/idle_stop_YYYY-MM-DD.json` + `latest.json`
- No API key (same as mileage-scheduled — server/cron only)

---

## Files to add (implementation checklist)

| File | Purpose |
|------|---------|
| `lib/idleStopFleetScan.ts` | Orchestrate GPS51 calls + normalize events |
| `lib/idleStopJsonStorage.ts` | Read/write/purge JSON (copy pattern from `mileageJsonStorage.ts`) |
| `lib/idleStopTypes.ts` | TypeScript types for events and report |
| `app/api/idle-stop-scheduled/route.ts` | POST scan trigger |
| `app/api/idle-stop-data/route.ts` | GET developer API |
| `monitoringService.js` | Add idle/stop cron (or extend existing service) |
| `.env.example` | Document new env vars |

Reuse:

- `buildGPS51Url`, `fetchWithRetry` patterns from mileage/parking
- HERE geocode from `lib/mileageLocation.ts` (or extract shared `lib/geocode.ts`)

---

## Cron & PM2

- Add job in `monitoringService.js`: daily scan → `POST /api/idle-stop-scheduled` with env credentials
- Default time: **15:00** server local (aligned with old parking report) — configurable via `IDLE_STOP_CRON`
- After deploy: `npm run build` + `pm2 restart nextjs-server` + `pm2 restart monitoring-service`

---

## Differences from mileage API

| Aspect | Mileage | Idle / Stop |
|--------|---------|-------------|
| Primary GPS51 APIs | `reportmileagedetail`, `lastposition` | `reportaccsbytime`, `reportparkdetailbytime`, `reportmileagedetail` |
| Main output | Maintenance thresholds (5000 / 10000 km) | Time segments + location |
| Events per vehicle | 1 row + maintenance blocks | Many `stopEvents` + `idleEvents` + daily rollup |
| Payload size | Smaller | Larger (list of events) |
| Parking Excel | Separate legacy flow | Replaced by JSON for developers |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `accstate` meaning unclear | Log raw values; confirm with GPS51; make mapping env-configurable |
| Large JSON for big fleets | Paginate by `?imei=` in phase 2; cap events per device; compress old archives |
| GPS51 rate limits | Per-device delay; retry with backoff (existing pattern) |
| `durationidle` vs true idle | Document source; cross-check with `reportaccsbytime` |
| IP whitelist | Server must be whitelisted (same as mileage) |

---

## Implementation phases

### Phase 1 — MVP (implemented)

- [x] `idleStopJsonStorage` + types
- [x] `idleStopFleetScan` using `reportparkdetailbytime` + `reportmileagedetail` daily rollup
- [x] `POST /api/idle-stop-scheduled`, `GET /api/idle-stop-data`
- [x] `IDLE_STOP_API_KEY` + `.env.example`
- [x] Cron in `monitoringService.js`

### Phase 2 — Enhanced idle segments

- [x] Integrate `reportaccsbytime` for per-event idle with coordinates
- [ ] Dedupe/merge overlapping ACC and park records
- [x] `?imei=` filter on GET

### Phase 3 — Optional

- [ ] Dashboard page for idle/stop (like Mileage Report)
- [ ] Webhooks when total idle exceeds threshold

---

## Postman quick test

1. **Scan** — `POST http://127.0.0.1:3001/api/idle-stop-scheduled`

```json
{
  "token": "YOUR_MONITOR_TOKEN",
  "username": "GIGMobility",
  "reportDate": "2026-05-16"
}
```

`reportDate` is optional (defaults to **yesterday**). Runtime ~5–8s per device.

2. **Read latest** — `GET http://127.0.0.1:3001/api/idle-stop-data`  
   Header: `X-Api-Key: your-IDLE_STOP_API_KEY`

3. **List dates** — `GET http://127.0.0.1:3001/api/idle-stop-data?list=1`

4. **One vehicle** — `GET http://127.0.0.1:3001/api/idle-stop-data?imei=358657103711920`

### Response arrays per vehicle

| Array | Meaning |
|-------|---------|
| `stopEvents` | Parked / engine off (`reportparkdetailbytime`, ≥ 5 min) |
| `idleEvents` | Engine on, little movement (`reportaccsbytime`, accstate 3, ≤ 150 m) |
| `accOffEvents` | ACC off segments (`reportaccsbytime`, accstate 2) |
| `dailyRollup` | Day totals: `engineOnMs`, `idleMs` from `reportmileagedetail` |
| `liveSnapshot` | Current `lastposition` park/ACC duration |

---

## Related docs

- `MILEAGE_API.md` — mileage JSON API (reference implementation)
- `app/api/Reports.md` — raw GPS51 samples
- `app/api/parking-scheduled/route.ts` — existing `reportparkdetailbytime` usage
