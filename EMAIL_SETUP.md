# Email Alert Setup Guide

This guide will help you configure email alerts for the overspeed monitoring service.

## Quick Setup (3 Steps)

### 1. Enable Email Alerts

Edit `.env.local` and set:
```bash
ENABLE_EMAIL_REPORTS=true
```

### 2. Configure Your Email Provider

Choose your email provider and add the configuration:

#### Option A: Gmail (Recommended for testing)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password-here
```

**To get Gmail App Password:**
1. Go to Google Account Settings → Security
2. Enable 2-Step Verification
3. Search for "App passwords" and create one
4. Select "Mail" and "Other (Custom name)"
5. Copy the 16-character password and use it as `SMTP_PASS`

#### Option B: Outlook/Office 365

```bash
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

#### Option C: Custom SMTP Server

```bash
SMTP_HOST=mail.yourcompany.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alerts@yourcompany.com
SMTP_PASS=your-password
```

Contact your IT department for the correct values.

### 3. Set Email Recipients

Add one or more email addresses (comma-separated):

```bash
EMAIL_TO=manager1@company.com,manager2@company.com,fleet@company.com
EMAIL_FROM=mantrac-alerts@company.com
EMAIL_SUBJECT=Overspeed Alert - Violations Detected
```

## Complete Example (.env.local)

```bash
# Monitoring Credentials
MONITOR_USERNAME=MantracNig
MONITOR_TOKEN=8aa771e43859067428f8a53941126583

# Enable Email Alerts
ENABLE_EMAIL_REPORTS=true

# Gmail SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=fleet-monitor@gmail.com
SMTP_PASS=abcd efgh ijkl mnop

# Recipients
EMAIL_TO=manager@mantrac.com,ops@mantrac.com
EMAIL_FROM=mantrac-alerts@gmail.com
EMAIL_SUBJECT=⚠️ Overspeed Alert - Action Required
```

## Testing the Setup

1. **Start the monitoring service:**
   ```bash
   npm run dev
   ```

2. **Wait for violations** (or manually trigger a check)

3. **Check console output:**
   ```
   [Monitor] Excel report saved: ...
   [Email] Report sent successfully to: manager@mantrac.com
   [Email] Message ID: <abc123@smtp.gmail.com>
   ```

4. **Check your email** for the overspeed alert with Excel attachment

## Troubleshooting

### Email not sending?

**Check console logs for:**
- `[Email] Email reports disabled` → Set `ENABLE_EMAIL_REPORTS=true`
- `[Email] Missing configuration` → Add all required SMTP variables
- `[Email] Failed to send email` → Check SMTP credentials

### Gmail "Less secure app" error?

Gmail requires **App Passwords** when 2FA is enabled. Regular passwords won't work. Follow the Gmail setup steps above.

### Outlook authentication error?

Some Outlook accounts require modern authentication. Try:
1. Enable "Allow apps that use less secure sign in" in your account settings
2. Or use Office 365 OAuth (requires additional setup)

### Wrong sender address?

The `EMAIL_FROM` might be overridden by your SMTP provider. Gmail always uses `SMTP_USER` as the sender.

## Email Features

### What's Included in the Email:

✅ **Professional HTML email** with Mantrac branding  
✅ **Violation summary** (count, date, thresholds)  
✅ **Excel report attached** with full details  
✅ **Device information** (names, speeds, locations)  
✅ **Only sent when violations detected** (no spam)

### Example Email:

```
Subject: ⚠️ Overspeed Alert - Action Required

The automated monitoring system has detected 25 overspeed violations 
on April 7, 2026.

Violation Summary:
• Total Violations: 25
• Speed Limit: 50 km/h
• Duration Threshold: 60 seconds
• Report Date: April 7, 2026

Please review the attached Excel report for detailed information...

[overspeed_report_2026-04-07T10-15-00.xlsx attached]
```

## Disable Email Alerts

To temporarily disable emails without removing configuration:

```bash
ENABLE_EMAIL_REPORTS=false
```

Reports will still be generated locally in `overspeed_reports/` folder.

## Security Best Practices

1. ✅ Never commit `.env.local` to Git (already in `.gitignore`)
2. ✅ Use App Passwords instead of regular passwords
3. ✅ Limit recipients to authorized personnel only
4. ✅ Rotate SMTP passwords periodically
5. ✅ Use a dedicated email account for automated alerts

## Need Help?

- **Gmail Setup:** https://support.google.com/accounts/answer/185833
- **Outlook Setup:** https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings
- **Nodemailer Docs:** https://nodemailer.com/about/

For issues with the monitoring service, check:
- [MONITORING_SERVICE.md](MONITORING_SERVICE.md) - Service documentation
- Console logs for error messages
- `.env.local` configuration
