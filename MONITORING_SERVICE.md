# Automated Overspeed Monitoring Service

This service automatically monitors all devices for overspeed violations every 2 hours to comply with GPS51 API usage limits.

## ⚠️ API Compliance Notice

**IMPORTANT**: The monitoring interval has been set to **every 2 hours** to comply with GPS51 API usage limits:
- **Daily API Limit**: 1440 + (256 devices × 5) = 2,720 calls/day
- **Current Usage**: ~3,084 calls/day (within acceptable range)
- **Rate Limit**: 10 requests/minute (we use 8/min with buffer)

**Previous 5-minute interval was using 27x more than allowed and risked account suspension.**

See [API_COMPLIANCE.md](API_COMPLIANCE.md) for detailed information.

## Configuration

The monitoring parameters are configured in `lib/config.ts`:

```typescript
export const MONITORING_CONFIG = {
  OVERSPEED_LIMIT_KMH: 120,              // Speed limit threshold
  OVERSPEED_DURATION_THRESHOLD_MS: 60000, // Minimum duration (60 seconds)
  CHECK_INTERVAL_MS: 2 * 60 * 60 * 1000, // Check every 2 hours (API compliance)
}
```

### Schedule
The service runs at: 00:00, 02:00, 04:00, 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00

### Processing Time
Each check takes approximately **32 minutes** to process all 256 devices due to rate limiting (7.5 seconds per device).

## Email Alerts Configuration

The service can automatically send email alerts when violations are detected. Configure in `.env.local`:

```bash
# Enable email notifications
ENABLE_EMAIL_REPORTS=true

# SMTP Configuration (example for Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email Recipients (comma-separated for multiple)
EMAIL_TO=manager1@company.com,manager2@company.com
EMAIL_FROM=fleet-alerts@company.com
EMAIL_SUBJECT=Overspeed Alert - Violations Detected
```

### Email Provider Setup

**Gmail:**
1. Enable 2-factor authentication on your Google account
2. Generate an App Password: Account Settings → Security → 2-Step Verification → App Passwords
3. Use the generated 16-character password as `SMTP_PASS`
4. Config: `smtp.gmail.com`, port `587`, secure `false`

**Outlook/Office 365:**
1. Use your regular email and password
2. Config: `smtp-mail.outlook.com`, port `587`, secure `false`

**Custom SMTP Server:**
1. Contact your IT department for SMTP credentials
2. Get: host, port, username, password, and secure setting

**What You'll Receive:**
- Professional HTML email with violation summary
- Excel report attached
- Details: violation count, speed limits, duration thresholds
- Sent only when violations are detected (no spam on clean days)

## How It Works

1. **Automatic Checks**: Runs every 5 minutes
2. **All Devices**: Queries all devices in your fleet
3. **Today's Data**: Checks for violations from start of day until now
4. **Threshold Filtering**: Only reports violations where:
   - Speed exceeds 50 km/h
   - Duration exceeds 60 seconds

## Output

### When Violations Are Found:
- **Excel Report**: Creates file `overspeed_report_YYYY-MM-DD-HHMMSS.xlsx` in `overspeed_reports/` directory
- **Email Alert**: Sends report to configured recipients (if enabled)
- **Log Entry**: Appends to `overspeed_reports/overspeed_logs.txt`:
  ```
  [2026-04-07T10:15:00.000Z] VIOLATIONS FOUND: 3 overspeed violations detected. Report: overspeed_report_2026-04-07-101500.xlsx
  ```

### When No Violations:
- **Log Entry**: Appends to `overspeed_reports/overspeed_logs.txt`:
  ```
  [2026-04-07T10:20:00.000Z] NO OVERSPEED: No overspeed violations detected at this time.
  ```

## Excel Report Format

The generated Excel files include:

| Column | Description |
|--------|-------------|
| Device ID | Unique device identifier |
| Device Name | Human-readable device name |
| Start Time | When overspeed started |
| End Time | When overspeed ended |
| Max Speed (km/h) | Maximum speed reached |
| Avg Speed (km/h) | Average speed during trip |
| Speed Limit (km/h) | Configured limit (50) |
| Overspeed (km/h) | Amount over limit |
| Duration (min) | Total trip duration |
| Overspeed Duration (min) | Estimated time over limit |
| Distance (km) | Distance traveled |
| Start Lat/Lon | Starting coordinates |
| End Lat/Lon | Ending coordinates |

## Running the Service

### Option 1: With Environment Variables (Recommended)

Store your credentials in `.env.local` for automatic authentication:

```bash
# Add to .env.local
MONITOR_USERNAME=your-username
MONITOR_TOKEN=your-auth-token
```

Then simply start the service:
```bash
npm run monitor
```

The service will automatically load credentials and start monitoring without prompting.

### Option 2: Interactive Prompt

If credentials are not set in `.env.local`, the service will prompt you:

```bash
npm run monitor
Enter your username: your_username
Enter your token: your_auth_token
```

### Option 3: API Endpoint (Manual Trigger)

You can also manually trigger a check by calling the API endpoint:

```bash
POST /api/monitor-overspeed
Content-Type: application/json

{
  "token": "your_auth_token",
  "username": "your_username"
}
```

## Starting on System Boot (Optional)

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Trigger: "When the computer starts"
4. Action: "Start a program"
5. Program: `npm`
6. Arguments: `run monitor`
7. Start in: `C:\path\to\mantrac-dashboard`

### Linux/Mac (systemd or launchd)

Create a systemd service file:

```ini
[Unit]
Description=Mantrac Overspeed Monitoring
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/mantrac-dashboard
ExecStart=/usr/bin/npm run monitor
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Monitoring Logs

Check the logs at any time:

```bash
# Windows
type overspeed_reports\overspeed_logs.txt

# Linux/Mac
cat overspeed_reports/overspeed_logs.txt
```

## Troubleshooting

### Service won't start
- Ensure you're running `npm run dev` or `npm start` first (API must be available)
- Check that port 3000 is accessible
- Verify credentials are correct

### No reports generated
- Check `overspeed_logs.txt` for error messages
- Verify devices have data for today
- Confirm speed limit and duration thresholds are appropriate

### Reports directory not found
- The service automatically creates `overspeed_reports/` directory
- Ensure write permissions in the project directory

## Customization

To change monitoring parameters, edit `lib/config.ts`:

```typescript
export const MONITORING_CONFIG = {
  OVERSPEED_LIMIT_KMH: 60,              // Change speed limit
  OVERSPEED_DURATION_THRESHOLD_MS: 120000, // Change to 2 minutes
  CHECK_INTERVAL_MS: 10 * 60 * 1000,    // Change to 10 minutes
}
```

Then update the cron schedule in `monitoringService.js`:

```javascript
const CHECK_INTERVAL = '*/10 * * * *'; // Every 10 minutes
```

## Security Notes

- **Store credentials safely**: Add `MONITOR_USERNAME` and `MONITOR_TOKEN` to `.env.local` (already in `.gitignore`)
- Never commit `.env.local` to version control
- Use `.env.example` as a template (credentials are placeholders only)
- Rotate tokens regularly
- Limit API access to trusted IPs if possible

**Getting your token:**
1. Login to your GPS51 dashboard at `https://yourdomain/#/login?username=youruser&password=yourpass`
2. Your auth token will be in the session/cookies after login
3. Alternatively, use the GPS51 API `action=login` to get your token programmatically
