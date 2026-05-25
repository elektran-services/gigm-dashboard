import fs from 'fs';
import path from 'path';
import type { IdleStopJsonReport } from '@/lib/idleStopTypes';

export const IDLE_STOP_JSON_DIR = path.join(process.cwd(), 'idle_stop_json');

export const IDLE_STOP_JSON_RETENTION_DAYS = 365;

export const IDLE_STOP_LATEST_FILENAME = 'latest.json';

export function ensureIdleStopJsonDir() {
  if (!fs.existsSync(IDLE_STOP_JSON_DIR)) {
    fs.mkdirSync(IDLE_STOP_JSON_DIR, { recursive: true });
  }
}

export function idleStopJsonFilenameForDate(reportYmd: string) {
  return `idle_stop_${reportYmd}.json`;
}

export function writeIdleStopJsonReport(reportYmd: string, report: IdleStopJsonReport) {
  ensureIdleStopJsonDir();
  const datedName = idleStopJsonFilenameForDate(reportYmd);
  const datedPath = path.join(IDLE_STOP_JSON_DIR, datedName);
  const latestPath = path.join(IDLE_STOP_JSON_DIR, IDLE_STOP_LATEST_FILENAME);
  const payload = JSON.stringify(report, null, 2);
  fs.writeFileSync(datedPath, payload, 'utf8');
  fs.writeFileSync(latestPath, payload, 'utf8');
  return { datedPath, latestPath, datedName };
}

export function purgeExpiredIdleStopJson(maxAgeDays = IDLE_STOP_JSON_RETENTION_DAYS) {
  ensureIdleStopJsonDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(IDLE_STOP_JSON_DIR)) {
    if (name === IDLE_STOP_LATEST_FILENAME) continue;
    if (!/^idle_stop_\d{4}-\d{2}-\d{2}\.json$/i.test(name)) continue;
    const full = path.join(IDLE_STOP_JSON_DIR, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

export function readIdleStopJsonReport(filename: string): IdleStopJsonReport | null {
  const base = path.basename(filename);
  if (base.includes('..')) return null;
  if (base !== IDLE_STOP_LATEST_FILENAME && !/^idle_stop_\d{4}-\d{2}-\d{2}\.json$/i.test(base)) {
    return null;
  }
  const full = path.resolve(IDLE_STOP_JSON_DIR, base);
  const root = path.resolve(IDLE_STOP_JSON_DIR);
  if (!full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as IdleStopJsonReport;
  } catch {
    return null;
  }
}

export function listIdleStopJsonDates(): string[] {
  ensureIdleStopJsonDir();
  const dates: string[] = [];
  for (const name of fs.readdirSync(IDLE_STOP_JSON_DIR)) {
    const m = name.match(/^idle_stop_(\d{4}-\d{2}-\d{2})\.json$/i);
    if (m) dates.push(m[1]);
  }
  return dates.sort((a, b) => b.localeCompare(a));
}
