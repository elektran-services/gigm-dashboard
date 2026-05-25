# API Usage Policy and Safe-Use Guide

This project integrates with the GPS51 API. The provider can restrict, suspend, or terminate access for abuse or abnormal usage. Treat the limits below as hard constraints.

## Provider Limits (as communicated)

- IP whitelist updates: max 5 changes per account per day
- Daily account calls: `1440 + (valid renewed devices * 5)`
- Trajectory interface: max 5 calls per device per day
- Per-IP rate: max 10 requests per minute

## Important Disclaimer

The provider reserves the right to change limits, enforce restrictions, start charging, or discontinue free usage at any time.  
This application must follow fair-use principles and avoid duplicate or abusive traffic patterns.

## Current Project Behavior (Monitoring Service)

Daily automated monitor flow:

1. One call to `querymonitorlist` to load all devices
2. One `querytrips` call per device for the report date
3. Rate-limited delay between per-device calls (`~7.5s`)

For 256 devices, one full daily run is approximately:

- `1 + 256 = 257` API calls/day from the monitor job
- around `8 requests/minute` peak during the per-device loop

This is intended to remain below:

- 10 requests/min per IP
- 5 trajectory calls/device/day (monitor uses 1/device/day)
- daily account limit (leaving headroom for manual dashboard usage)

## Operational Guardrails

- Keep monitor schedule at once daily unless limits are re-evaluated.
- Do not run multiple monitor jobs concurrently on the same account/token.
- Avoid repeated manual report queries for all devices on the same day.
- Avoid parallel scripts that also call `querytrips` across the fleet.
- Review logs after changes to schedule, retry behavior, or report features.
- If limits tighten, reduce frequency before adding features.

## Change-Control Rule for API-Touching Work

Any change touching:

- cron schedules
- retry loops / timeout strategy
- per-device query patterns
- report endpoints using `querytrips`

must include:

1. estimated calls/day impact
2. requests/minute impact
3. trajectory calls/device/day impact

and must be reviewed against provider limits before deployment.

## Quick Pre-Deploy Checklist

- [ ] Monitor schedule confirmed (daily)
- [ ] No duplicate monitor processes running
- [ ] Per-device delay/rate limiting unchanged or improved
- [ ] Manual testing does not exceed trajectory/device limits
- [ ] PM2 process list reviewed for duplicate jobs
- [ ] Provider limit assumptions re-validated

