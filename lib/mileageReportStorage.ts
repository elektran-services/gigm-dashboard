import fs from 'fs';
import path from 'path';

/** Daily threshold reports (only written when at least one vehicle qualifies). */
export const MILEAGE_REPORT_DIR = path.join(process.cwd(), 'mileage_report');

/** End-of-month full-fleet snapshots. */
export const MILEAGE_OVERALL_REPORT_DIR = path.join(process.cwd(), 'mileage_overall_report');

export const MILEAGE_REPORT_RETENTION_DAYS = 365;

export function ensureMileageReportDir() {
  if (!fs.existsSync(MILEAGE_REPORT_DIR)) {
    fs.mkdirSync(MILEAGE_REPORT_DIR, { recursive: true });
  }
}

export function ensureMileageOverallReportDir() {
  if (!fs.existsSync(MILEAGE_OVERALL_REPORT_DIR)) {
    fs.mkdirSync(MILEAGE_OVERALL_REPORT_DIR, { recursive: true });
  }
}

function purgeDir(dir: string, filenamePrefix: string, maxAgeDays: number) {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().startsWith(filenamePrefix.toLowerCase())) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

export function purgeExpiredMileageReports(maxAgeDays = MILEAGE_REPORT_RETENTION_DAYS) {
  ensureMileageReportDir();
  ensureMileageOverallReportDir();
  purgeDir(MILEAGE_REPORT_DIR, 'mileage_alert_', maxAgeDays);
  purgeDir(MILEAGE_REPORT_DIR, 'mileage_daily_', maxAgeDays);
  purgeDir(MILEAGE_REPORT_DIR, 'mileage_4000km_', maxAgeDays);
  purgeDir(MILEAGE_OVERALL_REPORT_DIR, 'mileage_overall_', maxAgeDays);
}

export interface MileageReportFileInfo {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
  category: 'daily' | 'monthly';
}

function parseDailyDateFromFilename(name: string): string | null {
  const m = name.match(/mileage_(?:daily|alert|4000km)_(\d{4}-\d{2}-\d{2})\.xlsx/i);
  return m ? m[1] : null;
}

function parseMonthlyDateFromFilename(name: string): string | null {
  const m = name.match(/mileage_overall_(\d{4}-\d{2})\.xlsx/i);
  return m ? `${m[1]}-01` : null;
}

export function listMileageReportFiles(category: 'daily' | 'monthly'): MileageReportFileInfo[] {
  purgeExpiredMileageReports();
  const dir = category === 'daily' ? MILEAGE_REPORT_DIR : MILEAGE_OVERALL_REPORT_DIR;
  const out: MileageReportFileInfo[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
    if (category === 'daily' && !/^mileage_(daily|alert|4000km)_/i.test(name)) continue;
    if (category === 'monthly' && !/^mileage_overall_/i.test(name)) continue;

    out.push({
      filename: name,
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      reportDate: category === 'daily' ? parseDailyDateFromFilename(name) : parseMonthlyDateFromFilename(name),
      category,
    });
  }
  return out.sort((a, b) => {
    const da = a.reportDate || '';
    const db = b.reportDate || '';
    if (da !== db) return db.localeCompare(da);
    return b.filename.localeCompare(a.filename);
  });
}

export function filterMileageReportsByDateParams(
  files: MileageReportFileInfo[],
  params: { date?: string; from?: string; to?: string }
): MileageReportFileInfo[] {
  let result = files;
  if (params.date?.trim()) {
    const d = params.date.trim();
    result = result.filter((f) => f.reportDate === d || f.filename.includes(d));
  }
  if (params.from?.trim()) {
    const from = params.from.trim();
    result = result.filter((f) => !f.reportDate || f.reportDate >= from);
  }
  if (params.to?.trim()) {
    const to = params.to.trim();
    result = result.filter((f) => !f.reportDate || f.reportDate <= to);
  }
  return result;
}

const SAFE_XLSX = /^[A-Za-z0-9._-]+\.xlsx$/i;

export function resolveSafeMileageReportPath(
  category: 'daily' | 'monthly',
  filename: string
): string | null {
  const base = path.basename(filename);
  if (base !== filename || base.includes('..')) return null;
  if (!SAFE_XLSX.test(base)) return null;
  if (category === 'daily' && !/^mileage_(daily|alert|4000km)_/i.test(base)) return null;
  if (category === 'monthly' && !/^mileage_overall_/i.test(base)) return null;

  const root = category === 'daily' ? MILEAGE_REPORT_DIR : MILEAGE_OVERALL_REPORT_DIR;
  const full = path.join(root, base);
  const resolved = path.resolve(full);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
