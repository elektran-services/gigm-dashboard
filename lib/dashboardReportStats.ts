import { listIdleStopJsonDates } from '@/lib/idleStopJsonStorage';
import { listMileageJsonDates } from '@/lib/mileageJsonStorage';

export interface ReportBucketStats {
  count: number;
  /** Latest report day from filename (YYYY-MM-DD). */
  latestReportDate: string | null;
}

export interface DashboardReportStats {
  mileageJson: ReportBucketStats;
  idleStopJson: ReportBucketStats;
  generatedAt: string;
}

/**
 * Snapshot counts of saved JSON reports (mileage + idle/stop).
 */
export function getDashboardReportStats(): DashboardReportStats {
  const mileageDates = listMileageJsonDates();
  const idleStopDates = listIdleStopJsonDates();

  return {
    mileageJson: {
      count: mileageDates.length,
      latestReportDate: mileageDates[0] ?? null,
    },
    idleStopJson: {
      count: idleStopDates.length,
      latestReportDate: idleStopDates[0] ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
}
