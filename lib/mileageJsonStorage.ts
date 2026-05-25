import fs from 'fs';
import path from 'path';

export const MILEAGE_JSON_DIR = path.join(process.cwd(), 'mileage_json');

export const MILEAGE_JSON_RETENTION_DAYS = 365;

export const MILEAGE_LATEST_FILENAME = 'latest.json';

export interface MileageJsonReport {
  status: number;
  cause: string;
  generatedAt: string;
  asOfDate: string;
  deviceCount: number;
  mileageErrors: number;
  thresholds: {
    scheduledMaintenanceKm: number;
    preventiveMaintenanceKm: number;
  };
  summary: {
    atScheduledMaintenance: number;
    atPreventiveMaintenance: number;
    scheduledAlmostDue: number;
    preventiveAlmostDue: number;
  };
  vehicles: Array<{ imei: string }>;
}

export function ensureMileageJsonDir() {
  if (!fs.existsSync(MILEAGE_JSON_DIR)) {
    fs.mkdirSync(MILEAGE_JSON_DIR, { recursive: true });
  }
}

export function mileageJsonFilenameForDate(asOfYmd: string) {
  return `mileage_${asOfYmd}.json`;
}

export function writeMileageJsonReport(asOfYmd: string, report: MileageJsonReport) {
  ensureMileageJsonDir();
  const datedName = mileageJsonFilenameForDate(asOfYmd);
  const datedPath = path.join(MILEAGE_JSON_DIR, datedName);
  const latestPath = path.join(MILEAGE_JSON_DIR, MILEAGE_LATEST_FILENAME);
  const payload = JSON.stringify(report, null, 2);
  fs.writeFileSync(datedPath, payload, 'utf8');
  fs.writeFileSync(latestPath, payload, 'utf8');
  return { datedPath, latestPath, datedName };
}

export function purgeExpiredMileageJson(maxAgeDays = MILEAGE_JSON_RETENTION_DAYS) {
  ensureMileageJsonDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(MILEAGE_JSON_DIR)) {
    if (name === MILEAGE_LATEST_FILENAME) continue;
    if (!/^mileage_\d{4}-\d{2}-\d{2}\.json$/i.test(name)) continue;
    const full = path.join(MILEAGE_JSON_DIR, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

export function readMileageJsonReport(filename: string): MileageJsonReport | null {
  const base = path.basename(filename);
  if (base.includes('..')) return null;
  if (base !== MILEAGE_LATEST_FILENAME && !/^mileage_\d{4}-\d{2}-\d{2}\.json$/i.test(base)) {
    return null;
  }
  const full = path.resolve(MILEAGE_JSON_DIR, base);
  const root = path.resolve(MILEAGE_JSON_DIR);
  if (!full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as MileageJsonReport;
  } catch {
    return null;
  }
}

export function listMileageJsonDates(): string[] {
  ensureMileageJsonDir();
  const dates: string[] = [];
  for (const name of fs.readdirSync(MILEAGE_JSON_DIR)) {
    const m = name.match(/^mileage_(\d{4}-\d{2}-\d{2})\.json$/i);
    if (m) dates.push(m[1]);
  }
  return dates.sort((a, b) => b.localeCompare(a));
}
