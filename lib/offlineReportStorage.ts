import fs from 'fs';
import path from 'path';

/** Directory for scheduled offline device reports (365-day retention). */
export const OFFLINE_REPORTS_DIR = path.join(process.cwd(), 'offline_reports');
export const OFFLINE_REPORTS_RETENTION_DAYS = 365;

export interface OfflineReportFileInfo {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
}

export function ensureOfflineReportsDir() {
  if (!fs.existsSync(OFFLINE_REPORTS_DIR)) {
    fs.mkdirSync(OFFLINE_REPORTS_DIR, { recursive: true });
  }
}

/** Remove offline_daily_report_*.xlsx older than maxAgeDays. */
export function purgeExpiredOfflineReports(maxAgeDays = OFFLINE_REPORTS_RETENTION_DAYS) {
  ensureOfflineReportsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(OFFLINE_REPORTS_DIR)) {
    if (!/^offline_daily_report_\d{4}-\d{2}-\d{2}\.xlsx$/i.test(name)) continue;
    const full = path.join(OFFLINE_REPORTS_DIR, name);
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
  const m = name.match(/offline_daily_report_(\d{4}-\d{2}-\d{2})\.xlsx/i);
  return m ? m[1] : null;
}

export function listOfflineReportFiles(): OfflineReportFileInfo[] {
  ensureOfflineReportsDir();
  purgeExpiredOfflineReports();
  const out: OfflineReportFileInfo[] = [];
  for (const name of fs.readdirSync(OFFLINE_REPORTS_DIR)) {
    const full = path.join(OFFLINE_REPORTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
    if (!name.toLowerCase().startsWith('offline_daily_report_')) continue;
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

export function filterOfflineReportsByDateParams(
  files: OfflineReportFileInfo[],
  params: { date?: string; from?: string; to?: string }
): OfflineReportFileInfo[] {
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

export function resolveSafeOfflineReportPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename || base.includes('..')) return null;
  if (!SAFE_XLSX.test(base)) return null;
  if (!base.toLowerCase().startsWith('offline_daily_report_')) return null;
  const full = path.join(OFFLINE_REPORTS_DIR, base);
  const resolved = path.resolve(full);
  const root = path.resolve(OFFLINE_REPORTS_DIR);
  if (!resolved.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
