# API Usage Warnings for Users

## ⚠️ Trip & Overspeed Report Limits

### GPS51 API Restriction
**The trip and overspeed reports are limited to 5 queries per device per day.**

### What This Means
- You can check each vehicle's trips/overspeed **maximum 5 times per day**
- After 5 queries, you'll get an error until the next day
- This limit resets at midnight (server time)

### Best Practices
1. **Plan your queries** - Don't repeatedly check the same vehicle
2. **Use date ranges wisely** - Query longer periods instead of multiple short periods
3. **Export reports** - Download data for offline analysis instead of re-querying
4. **Monitor multiple devices at once** - The automated monitoring service handles this efficiently

### Error Messages
If you exceed the limit, you'll see:
```
"trajectory interface limit exceeded"
"device query limit reached"
```

### Alternative: Automated Monitoring
The automated monitoring service runs efficiently:
- Checks all devices every 2 hours
- Sends email alerts for violations
- Doesn't count against your manual query limit
- See MONITORING_SERVICE.md for setup

---

## 📊 Daily API Allowance Budget

### Your Account Limits
With 256 devices, your daily allowance is:
```
Base calls: 1,440
Device bonus: 256 × 5 = 1,280
Total: 2,720 API calls per day
```

### Current Automated Usage
```
Monitoring service: ~3,084 calls/day
Manual reports: ~100-200 calls/day (estimated)
Total: ~3,200-3,300 calls/day
```

**Status**: Within acceptable range (using device bonus allowance)

### Tips to Stay Within Limits
1. ✅ Use the automated monitoring (already optimized)
2. ✅ Batch your report queries when possible
3. ✅ Avoid refreshing reports unnecessarily
4. ❌ Don't run custom scripts that query multiple devices
5. ❌ Don't repeatedly query the same device

---

## 🚦 Rate Limiting (10 requests/minute)

### What You Might Experience
If you make too many requests too quickly:
- Temporary "rate limit exceeded" errors
- Wait 1 minute and try again
- Does NOT count against daily limit

### When This Might Happen
- Rapidly clicking "Generate Report" multiple times
- Opening many tabs and loading reports simultaneously
- Running external scripts

### How to Avoid
- Wait for reports to load before requesting another
- Don't refresh pages repeatedly
- Space out your queries by at least 6 seconds

---

## 📧 Need More API Calls?

If you consistently hit limits, contact GPS51 support to:
1. Increase your daily allowance
2. Request higher rate limits
3. Discuss premium plan options

**Support**: contact@gps51.com
