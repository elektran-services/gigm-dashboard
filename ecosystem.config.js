/**
 * PM2 Process Manager Configuration
 * Manages both Next.js server and monitoring service
 * 
 * Usage:
 *   pm2 start ecosystem.config.js          # Start both services
 *   pm2 stop all                           # Stop all services
 *   pm2 restart all                        # Restart all services
 *   pm2 logs                               # View logs from both services
 *   pm2 status                             # Check status
 *   pm2 monit                              # Real-time monitoring
 *   pm2 save                               # Save current process list
 *   pm2 startup                            # Generate startup script (auto-start on boot)
 */

const path = require('path');

const MANTRAC_PORT = Number(process.env.MANTRAC_PORT || 3005);
const INTERNAL_API_URL = process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${MANTRAC_PORT}`;

/** Run Next directly — on Windows, `script: 'npm'` makes PM2 feed npm.cmd to Node and you get SyntaxError on `::`. */
const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');

module.exports = {
  apps: [
    {
      name: 'gigm-nextjs-server',
      script: nextBin,
      args: 'start',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: MANTRAC_PORT,
        NEXT_PUBLIC_API_URL: INTERNAL_API_URL,
      },
      error_file: './logs/nextjs-error.log',
      out_file: './logs/nextjs-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000
    },
    {
      name: 'gigm-monitoring-service',
      script: './monitoringService.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: INTERNAL_API_URL,
      },
      error_file: './logs/monitoring-error.log',
      out_file: './logs/monitoring-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
