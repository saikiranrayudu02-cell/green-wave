// ---------------------------------------------------------------------------
// GREENWAVE — Analytics data model (Step 13)
//
// Every field maps 1:1 to something the existing engines actually measure:
//   - trafficMetrics()  (vehicles.ts) → avgWaitSec, avgSpeedKmh, queuedCount,
//     queueM, throughput, ratePerHour, loadPct, active
//   - trafficObservations() (vehicles.ts) → per-junction queue counts
//   - mode (App) → FIXED | GREENWAVE
//   - EmergencyRuntime (types.ts) → baselineSec / etaSec / savedSec
//   - incident + corridorsOpen (App state) → booleans
// Nothing here is fabricated; a field is simply omitted when it cannot be
// measured reliably.
// ---------------------------------------------------------------------------

export type ControlMode = 'FIXED' | 'GREENWAVE'

export interface AnalyticsSample {
  /** sim clock when recorded (s) */
  t: number
  mode: ControlMode
  /** mean waiting time of active vehicles (s) */
  avgWaitSec: number
  /** mean vehicle speed (km/h, PACE removed) */
  avgSpeedKmh: number
  /** vehicles stopped at rest */
  stoppedVehicles: number
  /** total queued vehicles across signalised approaches */
  queueTotal: number
  /** largest single-approach queue (vehicles) */
  maxQueue: number
  /** average physical queue length at signals (m) */
  queueM: number
  /** cumulative vehicles that completed their route */
  throughput: number
  /** rolling completion rate (veh/hr) */
  ratePerHour: number
  /** active vehicles on the network */
  vehicleCount: number
  /** mean network congestion 0..100 */
  loadPct: number
  emergencyActive: boolean
  /** real GreenWave ETA while a unit is en route (s) — only when dispatched */
  emergencyEtaSec: number | null
  /** real baseline (non-optimized) ETA for the same unit (s) */
  emergencyBaselineSec: number | null
  /** real saved seconds reported by the corridor engine for the unit */
  emergencySavedSec: number | null
  corridorActive: boolean
  incidentActive: boolean
}

/** Mean of a metric over all samples recorded in one control mode. */
export interface ModeAggregate {
  mode: ControlMode
  count: number
  avgWaitSec: number | null
  avgSpeedKmh: number | null
  stoppedVehicles: number | null
  queueTotal: number | null
  maxQueue: number | null
  queueM: number | null
  throughput: number | null
  ratePerHour: number | null
  vehicleCount: number | null
  loadPct: number | null
  /** emergency ETA while this mode was controlling the corridor (s) */
  emergencyEtaSec: number | null
  emergencyBaselineSec: number | null
  emergencySavedSec: number | null
}

export type AnalyticsStatus =
  | 'NO_DATA'
  | 'COLLECTING_BASELINE'
  | 'BASELINE_READY'
  | 'COLLECTING_GREENWAVE'
  | 'COMPARISON_READY'
  | 'INSUFFICIENT_DATA'

export interface AnalyticsComparison {
  /** baseline mean (fixed timing) */
  baseline: number | null
  /** optimized mean (greenwave) */
  optimized: number | null
  /**
   * improvement % — signed so that a POSITIVE value always means "better"
   * (lower is better for wait/queue/stopped, higher is better for speed/
   * throughput). null when either side has no data or baseline is 0.
   */
  changePct: number | null
  /** direction that counts as improvement for this metric */
  direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER'
}