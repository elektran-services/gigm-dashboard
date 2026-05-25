import fs from 'fs';
import path from 'path';

/** Directory for generated Excel reports (365-day retention). */
export const GENERATED_REPORTS_DIR = path.join(process.cwd(), 'generated_reports');

export const GENERATED_REPORTS_RETENTION_DAYS = 365;

export function ensureGeneratedReportsDir() {
  if (!fs.existsSync(GENERATED_REPORTS_DIR)) {
    fs.mkdirSync(GENERATED_REPORTS_DIR, { recursive: true });
  }
}

export function dailyReportXlsxPath(dateStr: string): string {
  return path.join(GENERATED_REPORTS_DIR, `overspeed_daily_report_${dateStr}.xlsx`);
}

export function dailyCompleteMarkerPath(dateStr: string): string {
  return path.join(GENERATED_REPORTS_DIR, `daily_complete_${dateStr}.marker`);
}

/** Written after every successful monitor run (violations or no violations) for that calendar day. */
export function writeDailyCompleteMarker(dateStr: string) {
  ensureGeneratedReportsDir();
  fs.writeFileSync(dailyCompleteMarkerPath(dateStr), `${new Date().toISOString()}\n`, 'utf8');
}

/** True if we have the daily Excel and/or a completion marker (no-violation days may have marker only). */
export function hasDailyCompletionArtifact(dateStr: string): boolean {
  ensureGeneratedReportsDir();
  return fs.existsSync(dailyReportXlsxPath(dateStr)) || fs.existsSync(dailyCompleteMarkerPath(dateStr));
}

/** Remove .xlsx and .marker files older than maxAgeDays from generated_reports only. */
export function purgeExpiredGeneratedReports(maxAgeDays = GENERATED_REPORTS_RETENTION_DAYS) {
  ensureGeneratedReportsDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(GENERATED_REPORTS_DIR)) {
    const full = path.join(GENERATED_REPORTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.marker')) continue;
    try {
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {
      /* ignore */
    }
  }
}

/** Resolve stored violation report path (handles moves to generated_reports/). */
export function resolveViolationReportPath(
  dateStr: string,
  filename: string | undefined,
  legacyFilePath?: string
): string | null {
  ensureGeneratedReportsDir();
  const canonical = path.join(GENERATED_REPORTS_DIR, filename || `overspeed_daily_report_${dateStr}.xlsx`);
  if (legacyFilePath && fs.existsSync(legacyFilePath)) return legacyFilePath;
  if (fs.existsSync(canonical)) return canonical;
  return null;
}

export interface GeneratedReportFileInfo {
  filename: string;
  size: number;
  modifiedAt: string;
  /** YYYY-MM-DD when parsable from filename */
  reportDate: string | null;
}

function parseReportDateFromFilename(name: string): string | null {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function listGeneratedReportFiles(): GeneratedReportFileInfo[] {
  ensureGeneratedReportsDir();
  purgeExpiredGeneratedReports();
  const out: GeneratedReportFileInfo[] = [];
  for (const name of fs.readdirSync(GENERATED_REPORTS_DIR)) {
    const full = path.join(GENERATED_REPORTS_DIR, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
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

export function filterReportsByDateParams(
  files: GeneratedReportFileInfo[],
  params: { date?: string; from?: string; to?: string }
): GeneratedReportFileInfo[] {
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

/** Resolve a user-supplied filename to a path inside GENERATED_REPORTS_DIR, or null. */
export function resolveSafeGeneratedReportPath(filename: string): string | null {
  const base = path.basename(filename);
  if (base !== filename || base.includes('..')) return null;
  if (!SAFE_XLSX.test(base)) return null;
  const full = path.join(GENERATED_REPORTS_DIR, base);
  const resolved = path.resolve(full);
  const root = path.resolve(GENERATED_REPORTS_DIR);
  if (!resolved.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
