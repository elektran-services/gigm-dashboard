import fs from 'fs';
import path from 'path';

/** Directory for daily all-device trip Excel exports (365-day retention). */
export const TRIPS_REPORTS_DIR = path.join(process.cwd(), 'trips');

export const TRIPS_REPORTS_RETENTION_DAYS = 365;

export function ensureTripsReportsDir() {
  if (!fs.existsSync(TRIPS_REPORTS_DIR)) {
    fs.mkdirSync(TRIPS_REPORTS_DIR, { recursive: true });
  }
}

export function tripsDailyXlsxPath(dateStr: string): string {
  return path.join(TRIPS_REPORTS_DIR, `trips_daily_report_${dateStr}.xlsx`);
}

/** Remove trips_daily_report_*.xlsx older than maxAgeDays. */
export function purgeExpiredTripReports(maxAgeDays = TRIPS_REPORTS_RETENTION_DAYS) {
  ensureTripsReportsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(TRIPS_REPORTS_DIR)) {
    if (!/^trips_daily_report_\d{4}-\d{2}-\d{2}\.xlsx$/i.test(name)) continue;
    const full = path.join(TRIPS_REPORTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      /* ignore */
    }
  }
}

export interface TripReportFileInfo {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
}

function parseReportDateFromFilename(name: string): string | null {
  const m = name.match(/trips_daily_report_(\d{4}-\d{2}-\d{2})\.xlsx/i);
  return m ? m[1] : null;
}

export function listTripReportFiles(): TripReportFileInfo[] {
  ensureTripsReportsDir();
  purgeExpiredTripReports();
  const out: TripReportFileInfo[] = [];
  for (const name of fs.readdirSync(TRIPS_REPORTS_DIR)) {
    const full = path.join(TRIPS_REPORTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
    if (!name.toLowerCase().startsWith('trips_daily_report_')) continue;
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

export function filterTripReportsByDateParams(
  files: TripReportFileInfo[],
  params: { date?: string; from?: string; to?: string }
): TripReportFileInfo[] {
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

export function resolveSafeTripReportPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename || base.includes('..')) return null;
  if (!SAFE_XLSX.test(base)) return null;
  if (!base.toLowerCase().startsWith('trips_daily_report_')) return null;
  const full = path.join(TRIPS_REPORTS_DIR, base);
  const resolved = path.resolve(full);
  const root = path.resolve(TRIPS_REPORTS_DIR);
  if (!resolved.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
