# Scheduled jobs (cron)

All times below are **server local time** (the machine running PM2). Cron expressions use standard five-field `node-cron` format: `minute hour day-of-month month day-of-week`.

## How many jobs run in production?

**Five** recurring cron jobs are registered when **`monitoring-service`** starts (`monitoringService.js`, via `ecosystem.config.js`).

| # | Job | Cron expression | Time | Frequency | What it does |
|---|-----|-------------------|------|-----------|----------------|
| 1 | **Overspeed** | `59 23 * * *` | **23:59** | Once per day | Daily overspeed report check → `generated_reports/` (see service comments: run can finish ~40 minutes later, email ~00:30–00:40). |
| 2 | **Trips daily export** | `30 1 * * *` | **01:30** | Once per day | Exports **previous calendar day** to `trips/` (staggered after the overspeed run). |
| 3 | **Offline devices** | `0 10 * * *` | **10:00** | Once per day | Daily offline snapshot → `offline_reports/`. |
| 4 | **Mileage** | `0 12 * * *` | **12:00** | Once per day | Daily mileage threshold job. **Additionally**, on the **last calendar day of the month**, the same schedule triggers the **monthly fleet snapshot** (see `/api/mileage-scheduled`). |
| 5 | **Parking** | `0 15 * * *` | **15:00** | Once per day | Daily parking report for **previous calendar day** → `parking_reports/`. |

### Startup / catch-up (not extra cron rows)

On **monitoring-service** startup, the process may run **one-off** work before normal crons:

- **Overspeed**: If yesterday has no completion marker / daily Excel, it runs a catch-up for that date.
- **Trips**: If yesterday’s trips file is missing, it runs a trips catch-up.

These are **conditional** and do not add standing cron entries.

### Health heartbeat (not a report job)

A **`setInterval` runs every 30 minutes** to log server/cron health. It does not replace or count as one of the five report crons above.

---

## Optional standalone script (not started by PM2)

| Script | Cron expression | Frequency | Note |
|--------|-----------------|-----------|------|
| `saveOverspeedReport.js` | `*/10 * * * *` | Every **10 minutes** | Legacy / alternate overspeed Excel append flow. **Not** part of the PM2 `ecosystem.config.js` apps unless you run it separately. |

---

## Changing schedules

Edit the constants at the top of **`monitoringService.js`** (`CHECK_INTERVAL`, `TRIPS_DAILY_CRON`, `MILEAGE_CRON`, `OFFLINE_CRON`, `PARKING_CRON`), then rebuild/restart as needed and restart the monitoring service:

```bash
pm2 restart monitoring-service
```

---

## API endpoints invoked by the monitoring service

| Cron | Typical internal call |
|------|------------------------|
| Overspeed | `POST /api/monitor-overspeed` (with auth; see `monitoringService.js`) |
| Trips | `POST /api/trips-daily` |
| Mileage | `POST /api/mileage-scheduled` |
| Offline | `POST /api/offline-scheduled` |
| Parking | `POST /api/parking-scheduled` |

Exact payloads and auth are defined in **`monitoringService.js`**.
