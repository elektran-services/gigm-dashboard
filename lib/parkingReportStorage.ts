import fs from 'fs';
import path from 'path';

/** Directory for scheduled parking reports (365-day retention). */
export const PARKING_REPORTS_DIR = path.join(process.cwd(), 'parking_reports');
export const PARKING_REPORTS_RETENTION_DAYS = 365;

export interface ParkingReportFileInfo {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
}

export function ensureParkingReportsDir() {
  if (!fs.existsSync(PARKING_REPORTS_DIR)) {
    fs.mkdirSync(PARKING_REPORTS_DIR, { recursive: true });
  }
}

/** Remove parking_daily_report_*.xlsx older than maxAgeDays. */
export function purgeExpiredParkingReports(maxAgeDays = PARKING_REPORTS_RETENTION_DAYS) {
  ensureParkingReportsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(PARKING_REPORTS_DIR)) {
    if (!/^parking_daily_report_\d{4}-\d{2}-\d{2}\.xlsx$/i.test(name)) continue;
    const full = path.join(PARKING_REPORTS_DIR, name);
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

function parseReportDateFromFilename(name: string): string | null {
  const m = name.match(/parking_daily_report_(\d{4}-\d{2}-\d{2})\.xlsx/i);
  return m ? m[1] : null;
}

export function listParkingReportFiles(): ParkingReportFileInfo[] {
  ensureParkingReportsDir();
  purgeExpiredParkingReports();
  const out: ParkingReportFileInfo[] = [];
  for (const name of fs.readdirSync(PARKING_REPORTS_DIR)) {
    const full = path.join(PARKING_REPORTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
    if (!name.toLowerCase().startsWith('parking_daily_report_')) continue;
    out.push({
      filename: name,
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      reportDate: parseReportDateFromFilename(name),
    });
  }
  return out.sort((a, b) => {
    const da = a.reportDate || '';
    const db = b.reportDate || '';
    if (da !== db) return db.localeCompare(da);
    return b.filename.localeCompare(a.filename);
  });
}

export function filterParkingReportsByDateParams(
  files: ParkingReportFileInfo[],
  params: { date?: string; from?: string; to?: string }
): ParkingReportFileInfo[] {
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

export function resolveSafeParkingReportPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename || base.includes('..')) return null;
  if (!SAFE_XLSX.test(base)) return null;
  if (!base.toLowerCase().startsWith('parking_daily_report_')) return null;
  const full = path.join(PARKING_REPORTS_DIR, base);
  const resolved = path.resolve(full);
  const root = path.resolve(PARKING_REPORTS_DIR);
  if (!resolved.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
