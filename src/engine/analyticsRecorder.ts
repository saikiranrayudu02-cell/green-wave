// ---------------------------------------------------------------------------
// GREENWAVE — Analytics session recorder (Step 13)
//
// Records REAL measurements from the existing engines on a coarse cadence
// while the operator works. It never simulates, never invents a metric, and
// never runs a second simulation loop — App.tsx calls recordAnalyticsSample()
// from a simple interval that reads trafficMetrics()/observations and the
// shared emergency/corridor state.
//
//   BASELINE = samples recorded while control mode is FIXED
//   OPTIMIZED = samples recorded while control mode is GREENWAVE
//
// History is bounded, survives page/module switches, and is cleared ONLY by
// the application's Reset operation.
// ---------------------------------------------------------------------------

import type {
  AnalyticsComparison,
  AnalyticsSample,
  AnalyticsStatus,
  ControlMode,
  ModeAggregate,
} from '../types/analytics'

/** Bounded session history (cap = 600 samples ≈ 20 min at a 2 s cadence). */
export const MAX_ANALYTICS_SAMPLES = 600

/** minimum real samples in a mode before its aggregate is considered valid */
export const MIN_MODE_SAMPLES = 10

const samples: AnalyticsSample[] = []

export function recordAnalyticsSample(s: AnalyticsSample): void {
  samples.push(s)
  if (samples.length > MAX_ANALYTICS_SAMPLES) samples.splice(0, samples.length - MAX_ANALYTICS_SAMPLES)
}

export function analyticsSamples(): readonly AnalyticsSample[] {
  return samples
}

export function clearAnalytics(): void {
  samples.length = 0
}

export function analyticsStatus(): AnalyticsStatus {
  const c = countByMode()
  if (c.FIXED === 0 && c.GREENWAVE === 0) return 'NO_DATA'
  if (c.FIXED < MIN_MODE_SAMPLES && c.GREENWAVE === 0) return 'COLLECTING_BASELINE'
  if (c.FIXED >= MIN_MODE_SAMPLES && c.GREENWAVE === 0) return 'BASELINE_READY'
  if (c.FIXED < MIN_MODE_SAMPLES || c.GREENWAVE < MIN_MODE_SAMPLES) return 'INSUFFICIENT_DATA'
  return 'COMPARISON_READY'
}

function countByMode(): Record<ControlMode, number> {
  let f = 0
  let g = 0
  for (const s of samples) {
    if (s.mode === 'FIXED') f++
    else g++
  }
  return { FIXED: f, GREENWAVE: g }
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null
  let sum = 0
  for (const n of nums) sum += n
  return sum / nums.length
}

/** Mean of a metric per mode; null when the mode has no samples. */
export function modeAggregate(mode: ControlMode): ModeAggregate {
  const sel = samples.filter((s) => s.mode === mode)
  const agg: ModeAggregate = {
    mode,
    count: sel.length,
    avgWaitSec: mean(sel.map((s) => s.avgWaitSec)),
    avgSpeedKmh: mean(sel.map((s) => s.avgSpeedKmh)),
    stoppedVehicles: mean(sel.map((s) => s.stoppedVehicles)),
    queueTotal: mean(sel.map((s) => s.queueTotal)),
    maxQueue: mean(sel.map((s) => s.maxQueue)),
    queueM: mean(sel.map((s) => s.queueM)),
    throughput: mean(sel.map((s) => s.throughput)),
    ratePerHour: mean(sel.map((s) => s.ratePerHour)),
    vehicleCount: mean(sel.map((s) => s.vehicleCount)),
    loadPct: mean(sel.map((s) => s.loadPct)),
    emergencyEtaSec: mean(sel.filter((s) => s.emergencyEtaSec != null).map((s) => s.emergencyEtaSec as number)),
    emergencyBaselineSec: mean(sel.filter((s) => s.emergencyBaselineSec != null).map((s) => s.emergencyBaselineSec as number)),
    emergencySavedSec: mean(sel.filter((s) => s.emergencySavedSec != null).map((s) => s.emergencySavedSec as number)),
  }
  return agg
}

export function modeAggregates(): { fixed: ModeAggregate; greenwave: ModeAggregate } {
  return { fixed: modeAggregate('FIXED'), greenwave: modeAggregate('GREENWAVE') }
}

/**
 * Compare one metric between modes.
 * changePct is signed so positive always means "better":
 *   LOWER_IS_BETTER  → ((baseline - optimized) / baseline) * 100
 *   HIGHER_IS_BETTER → ((optimized - baseline) / baseline) * 100
 * Returns nulls whenever either side is missing or baseline is 0 —
 * the UI must render "—" instead of NaN/Infinity.
 */
export function compareMetric(
  baseline: number | null,
  optimized: number | null,
  direction: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER',
): AnalyticsComparison {
  if (baseline == null || optimized == null || baseline === 0) {
    return { baseline, optimized, changePct: null, direction }
  }
  const raw = direction === 'LOWER_IS_BETTER' ? baseline - optimized : optimized - baseline
  return { baseline, optimized, changePct: (raw / baseline) * 100, direction }
}