# PM2 Process Manager Setup Guide

PM2 automatically manages and keeps your Next.js server and monitoring service running 24/7.

## ✅ What PM2 Does For You

- **Auto-restart** if services crash
- **Auto-start** on system reboot (after setup)
- **Logs** all output to files
- **Monitor** CPU and memory usage
- **Alerts** if services go down

## 🚀 Quick Start

### 1. Start Both Services (Easy Way)
```bash
npm run pm2:start
```

This starts:
- ✅ Next.js server on `http://localhost:3000`
- ✅ Monitoring service (daily checks at 23:59)

### 2. Check Status
```bash
npm run pm2:status
```

You should see:
```
┌────────────────────┬────┬─────────┬──────┬───────┐
│ Name               │ id │ status  │ cpu  │ mem   │
├────────────────────┼────┼─────────┼──────┼───────┤
│ nextjs-server      │ 0  │ online  │ 0%   │ 85mb  │
│ monitoring-service │ 1  │ online  │ 0%   │ 45mb  │
└────────────────────┴────┴─────────┴──────┴───────┘
```

### 3. View Live Logs
```bash
npm run pm2:logs
```

Press `Ctrl+C` to exit logs (services keep running).

## 📋 Common Commands

| Command | Description |
|---------|-------------|
| `npm run pm2:start` | Start both services |
| `npm run pm2:stop` | Stop both services |
| `npm run pm2:restart` | Restart both services |
| `npm run pm2:status` | Check if services are running |
| `npm run pm2:logs` | View real-time logs |
| `npm run pm2:monit` | Real-time monitoring dashboard |
| `npm run pm2:delete` | Remove all services from PM2 |

## 🔄 Auto-Start on System Reboot (One-Time Setup)

To make services auto-start when Windows boots:

```bash
pm2 save
pm2 startup
```

Follow the on-screen instructions. PM2 will generate a command - copy and run it.

## 📊 Monitoring

### Real-Time Dashboard
```bash
npm run pm2:monit
```

Shows CPU, memory, logs in real-time.

### Check Logs Files
Logs are saved to `logs/` folder:
- `logs/nextjs-out.log` - Next.js output
- `logs/nextjs-error.log` - Next.js errors
- `logs/monitoring-out.log` - Monitoring service output
- `logs/monitoring-error.log` - Monitoring service errors

## ⚠️ Troubleshooting

### Services Won't Start
```bash
# Delete old processes
npm run pm2:delete

# Try starting again
npm run pm2:start
```

### Check Detailed Logs
```bash
pm2 logs nextjs-server --lines 50
pm2 logs monitoring-service --lines 50
```

### Restart Specific Service
```bash
pm2 restart nextjs-server
pm2 restart monitoring-service
```

## 🔍 What Gets Monitored

The monitoring service now checks:
- ✅ Next.js server health (every 30 minutes)
- ✅ Cron job status
- ✅ Displays **CRITICAL** alert if Next.js is down

Example heartbeat with Next.js running:
```
💚 [HEARTBEAT] 4/19/2026, 8:00:00 AM
   🟢 Monitoring Service: RUNNING
   🟢 Next.js Server: HEALTHY
   🟢 ACTIVE Cron Job: HEALTHY
   ⏰ Next check in: 15h 59m (at 11:59:00 PM)
```

If Next.js goes down:
```
💚 [HEARTBEAT] 4/19/2026, 8:00:00 AM
   🟢 Monitoring Service: RUNNING
   🔴 DOWN Next.js Server: UNREACHABLE
   🟢 ACTIVE Cron Job: HEALTHY
   ⏰ Next check in: 15h 59m (at 11:59:00 PM)

   ⛔ CRITICAL: Next.js server is DOWN!
   ⛔ Scheduled checks at 23:59 will FAIL until server is restarted!
   ⛔ Run: npm run dev (starts both services together)
```

## 💡 Benefits vs Manual Running

### Before (Manual)
- ❌ Services stop when terminal closes
- ❌ No auto-restart on crash
- ❌ No auto-start on reboot
- ❌ Hard to monitor multiple services
- ❌ **Result: April 18 missed report**

### After (PM2)
- ✅ Services run in background
- ✅ Auto-restart on crash
- ✅ Auto-start on reboot (after setup)
- ✅ Easy monitoring and logs
- ✅ **Result: No more missed reports!**

## 🎯 Recommended Workflow

1. **Development**: Use `npm run dev` (easier to see logs)
2. **Production/Always-On**: Use `npm run pm2:start` (runs 24/7)

## 📞 Need Help?

Run `pm2 --help` or `pm2 <command> --help` for more options.
