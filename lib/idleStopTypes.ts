export interface IdleStopFilters {
  minStopDurationMinutes: number;
  minIdleDurationMinutes: number;
  accStateEngineOn: number;
  accStateEngineOff: number;
  idleMaxMovementMeters: number;
  idleMaxAvgSpeedKmh: number;
}

export interface IdleStopSummary {
  totalStopEvents: number;
  totalIdleEvents: number;
  totalAccOffEvents: number;
  totalStopDurationMs: number;
  totalStopDurationMinutes: number;
  totalIdleDurationMs: number;
  totalIdleDurationMinutes: number;
  totalAccOffDurationMs: number;
  totalAccOffDurationMinutes: number;
  vehiclesWithData: number;
}

export interface IdleStopDailyRollup {
  statisticsDay: string;
  engineOnMs: number;
  engineOnMinutes: number;
  idleMs: number;
  idleMinutes: number;
  idlePercent: number | null;
}

export interface IdleStopLiveSnapshot {
  latitude: number;
  longitude: number;
  address: string | null;
  status: string | null;
  parkDurationMs: number | null;
  parkDurationMinutes: number | null;
  accDurationMs: number | null;
  accDurationMinutes: number | null;
  moving: boolean;
  speedKmh: number | null;
  positionUpdatedAt: string | null;
}

export interface IdleStopEvent {
  type: 'stop' | 'idle' | 'acc_off';
  source: 'reportparkdetailbytime' | 'reportaccsbytime' | 'reportmileagedetail';
  startTime: string;
  endTime: string;
  durationMs: number;
  durationMinutes: number;
  latitude: number;
  longitude: number;
  endLatitude?: number;
  endLongitude?: number;
  address: string | null;
  status: string | null;
  speedKmh: number | null;
  idleWithinStopMs?: number;
  idleWithinStopMinutes?: number;
  accState?: number;
  movementMeters?: number;
}

export interface IdleStopVehicleJson {
  imei: string;
  deviceName: string;
  dailyRollup: IdleStopDailyRollup | null;
  liveSnapshot: IdleStopLiveSnapshot | null;
  stopEvents: IdleStopEvent[];
  idleEvents: IdleStopEvent[];
  accOffEvents: IdleStopEvent[];
  /** Why idleEvents may be empty (helps integrators). */
  idleNote: string | null;
  error: string | null;
}

export interface IdleStopJsonReport {
  status: number;
  cause: string;
  generatedAt: string;
  reportDate: string;
  timezone: number;
  deviceCount: number;
  scanErrors: number;
  filters: IdleStopFilters;
  summary: IdleStopSummary;
  vehicles: IdleStopVehicleJson[];
}
