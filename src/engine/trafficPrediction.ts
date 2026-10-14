// ---------------------------------------------------------------------------
// GREENWAVE — deterministic traffic prediction engine (Step 9)
//
// A bounded rolling history of per-(intersection, group) observations feeds a
// lightweight linear-trend predictor. The engine is pure and UI-free; CityMap
// records the SAME fused observations the optimizer consumes, the signal
// controller reads a forward-looking pressure bias, and the command-center
// panel reads forecasts + events.
//
//   • history      – bounded rolling window (default 120 s), sampled at a
//                    fixed interval (default 2 s) so it never grows unbounded
//   • prediction   – least-squares slope over recent samples, extrapolated to
//                    +15/+30/+45/+60 s with hard clamps (no exploding values)
//   • confidence   – "PREDICTION CONFIDENCE" from sample coverage, trend
//                    stability and recency — never presented as model accuracy
//   • risk         – LOW/MODERATE/HIGH/CRITICAL from predicted queue/density
//                    with centralized thresholds (PREDICTION_CONFIG)
//   • bias         – a bounded forward-looking pressure adjustment consumed by
//                    signals.ts; emergency corridor priority (boost 9) always
//                    dwarfs the prediction bias (max 2.2), so prediction can
//                    never override an active corridor
//   • events       – bounded log of proactive actions actually taken
//
// Nothing here is trained, learned or fetched: all values are deterministic
// functions of recorded observations. When history is insufficient the API
// returns INSUFFICIENT_HISTORY instead of inventing a forecast.
// ---------------------------------------------------------------------------
import type {
  PredictionBias,
  PredictionEvent,
  PredictionResult,
  RiskChange,
  CongestionRisk,
  TrafficHistorySample,
} from '../types/prediction'
import type { PerceptionSource } from '../types/perception'
import type { JunctionObs } from './vehicles'

/* ------------------------------ configuration ---------------------------- */
/**
 * Centralized thresholds for the predictor. Kept together so the risk classes
 * and bias limits are auditable. These are simulation parameters — tuned to
 * the live district's approach-zone capacity — not scientific constants.
 */
export const PREDICTION_CONFIG = {
  /** how far back the rolling history reaches (s) */
  historyWindowSec: 120,
  /** minimum gap between two recorded samples (s) */
  sampleIntervalSec: 2,
  /** minimum samples before a forecast is issued */
  minSamples: 8,
  /** a prediction is STALE (treated as insufficient) if the newest sample is older (s) */
  staleSec: 30,
  /** approach-zone capacity used for the density estimate (vehicles) */
  approachCapacity: 8,
  /** clamps — the predictor may never exceed these */
  maxVehicles: 24,
  maxQueue: 30,
  /** confidence: sample count at which coverage saturates */
  fullSamples: 30,
  /** confidence: normalized std-dev that halves the stability term */
  volatilityDivisor: 0.35,
  /** risk thresholds (predicted queue / density at +30 s) */
  queueModerate: 6,
  queueHigh: 12,
  queueCritical: 22,
  densityModerate: 0.3,
  densityHigh: 0.55,
  densityCritical: 0.8,
  /** risk-change band (vehicles at +60 s vs current) below which = STABLE */
  stableBandQueue: 1.5,
  stableBandDensity: 0.05,
  /** forward-looking pressure bias limits (signal controller consumes this) */
  biasMax: 2.2,
  biasPerQueue: 0.35,
  biasPerDensity: 2.0,
  /** mapping from bias magnitude to displayed extension seconds (display only) */
  biasToExtSec: 2.5,
  /** recompute the cached pressure bias at most this often per junction (s) */
  biasCacheSec: 1,
} as const

/* ------------------------------ history store ---------------------------- */
const keyOf = (intersectionId: string, group: 'M' | 'X') => `${intersectionId}:${group}`

const historyByKey = new Map<string, TrafficHistorySample[]>()
const lastSampleAt = new Map<string, number>()

/* ------------------------------ event log -------------------------------- */
const EVENT_CAP = 20
const EVENTS: PredictionEvent[] = []

/** bounded log of proactive actions actually caused by the prediction layer */
export function predictionEvents(): readonly PredictionEvent[] {
  return EVENTS
}

/**
 * One extension/priority decision may hold for many frames — collapse
 * consecutive duplicate events (same junction, same action) within a short
 * window so the log records each decision once, not once per frame.
 */
export function pushPredictionEvent(e: PredictionEvent): void {
  const last = EVENTS[EVENTS.length - 1]
  if (
    last &&
    last.intersectionId === e.intersectionId &&
    last.group === e.group &&
    last.action === e.action &&
    e.t - last.t < 5
  ) {
    return
  }
  EVENTS.push(e)
  if (EVENTS.length > EVENT_CAP) EVENTS.splice(0, EVENTS.length - EVENT_CAP)
}

/** clear history + events (Reset Demo) */
export function resetPrediction(): void {
  historyByKey.clear()
  lastSampleAt.clear()
  biasCache.clear()
  EVENTS.length = 0
}

/* ------------------------------ recording -------------------------------- */
/**
 * Record the fused observation for one junction — exactly the observation the
 * optimizer consumed that frame. Sampling is time-gated (sampleIntervalSec),
 * so the history stays bounded regardless of frame rate.
 */
export function recordJunctionObs(
  intersectionId: string,
  obs: JunctionObs,
  source: PerceptionSource,
  t: number,
): void {
  for (const group of ['M', 'X'] as const) {
    const g = obs[group]
    const k = keyOf(intersectionId, group)
    const last = lastSampleAt.get(k) ?? -Infinity
    if (t - last < PREDICTION_CONFIG.sampleIntervalSec) continue
    lastSampleAt.set(k, t)

    const approaching = g.approaching
    const sample: TrafficHistorySample = {
      t,
      // defensive bounds at the recording boundary — observations can never
      // be negative, so history is guaranteed sane even from a glitchy feed
      vehicleCount: Math.max(0, approaching),
      queue: Math.max(0, g.queue),
      density: clamp01(approaching / PREDICTION_CONFIG.approachCapacity),
      approaching: Math.max(0, approaching),
      stopped: Math.max(0, g.waitCount),
      source,
    }
    let arr = historyByKey.get(k)
    if (!arr) {
      arr = []
      historyByKey.set(k, arr)
    }
    arr.push(sample)
    // bounded memory: drop anything older than the window
    const cutoff = t - PREDICTION_CONFIG.historyWindowSec
    while (arr.length > 0 && arr[0].t < cutoff) arr.shift()
  }
}

function samplesFor(intersectionId: string, group: 'M' | 'X'): TrafficHistorySample[] {
  return historyByKey.get(keyOf(intersectionId, group)) ?? []
}

/* ------------------------------ predictor -------------------------------- */
/** least-squares slope + intercept over (t, value) samples */
function trend(samples: TrafficHistorySample[], value: (s: TrafficHistorySample) => number): {
  slope: number
  intercept: number
} {
  const n = samples.length
  if (n === 0) return { slope: 0, intercept: 0 }
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const s of samples) {
    const v = value(s)
    sx += s.t
    sy += v
    sxx += s.t * s.t
    sxy += s.t * v
  }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sy / n }
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return { slope, intercept }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** extrapolate with hard bounds — the forecast can never explode */
function forecastAt(
  samples: TrafficHistorySample[],
  value: (s: TrafficHistorySample) => number,
  cur: number,
  horizon: number,
  lo: number,
  hi: number,
): number {
  const { slope } = trend(samples, value)
  return clamp(cur + slope * horizon, lo, hi)
}

/** PREDICTION CONFIDENCE 0..1 — coverage + stability + recency (see header) */
function confidenceOf(samples: TrafficHistorySample[], t: number): number {
  if (samples.length < PREDICTION_CONFIG.minSamples) return 0
  const newest = samples[samples.length - 1].t
  const recency = clamp01(1 - Math.max(0, t - newest) / PREDICTION_CONFIG.staleSec)
  const values = samples.map((s) => s.vehicleCount + s.queue)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    mean > 0 ? values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length : 0
  const std = Math.sqrt(variance)
  const stability = clamp01(1 - std / (mean + 1e-6) / PREDICTION_CONFIG.volatilityDivisor)
  const coverage = Math.min(1, samples.length / PREDICTION_CONFIG.fullSamples)
  return clamp(0.05, 0.95, 0.5 * coverage + 0.3 * stability + 0.2 * recency)
}

/** risk class from predicted queue + density (centralized thresholds) */
function riskOf(q: number, d: number): CongestionRisk {
  const c = PREDICTION_CONFIG
  if (q >= c.queueCritical || d >= c.densityCritical) return 'CRITICAL'
  if (q >= c.queueHigh || d >= c.densityHigh) return 'HIGH'
  if (q >= c.queueModerate || d >= c.densityModerate) return 'MODERATE'
  return 'LOW'
}

function riskChangeOf(qCur: number, q60: number, dCur: number, d60: number): RiskChange {
  const c = PREDICTION_CONFIG
  const dq = q60 - qCur
  const dd = d60 - dCur
  if (Math.abs(dq) <= c.stableBandQueue && Math.abs(dd) <= c.stableBandDensity) return 'STABLE'
  if (dq > c.stableBandQueue || dd > c.stableBandDensity) return 'RISING'
  return 'FALLING'
}

/**
 * Short-horizon forecast for one (intersection, group).
 * Returns INSUFFICIENT_HISTORY (never fabricated numbers) when there are too
 * few samples, no data at all, or the newest sample is stale.
 */
export function predict(
  intersectionId: string,
  group: 'M' | 'X',
  t: number,
): PredictionResult {
  const samples = samplesFor(intersectionId, group)
  const base: PredictionResult = {
    intersectionId,
    group,
    generatedAt: t,
    status: 'INSUFFICIENT_HISTORY',
    currentVehicleCount: 0,
    predictedVehicleCount15s: 0,
    predictedVehicleCount30s: 0,
    predictedVehicleCount45s: 0,
    predictedVehicleCount60s: 0,
    currentQueue: 0,
    predictedQueue30s: 0,
    predictedQueue60s: 0,
    currentDensity: 0,
    predictedDensity30s: 0,
    predictedDensity60s: 0,
    congestionRisk: 'LOW',
    riskChange: 'STABLE',
    confidence: 0,
    source: 'SIMULATION',
    historySamples: samples.length,
  }

  if (samples.length === 0) return { ...base, insufficientReason: 'NO_DATA' }
  const newest = samples[samples.length - 1]
  if (t - newest.t > PREDICTION_CONFIG.staleSec) {
    return { ...base, insufficientReason: 'STALE', historySamples: samples.length }
  }
  if (samples.length < PREDICTION_CONFIG.minSamples) {
    return { ...base, insufficientReason: 'FEW_SAMPLES', historySamples: samples.length }
  }

  const c = PREDICTION_CONFIG
  const curV = newest.vehicleCount
  const curQ = newest.queue
  const curD = newest.density

  const v15 = forecastAt(samples, (s) => s.vehicleCount, curV, 15, 0, c.maxVehicles)
  const v30 = forecastAt(samples, (s) => s.vehicleCount, curV, 30, 0, c.maxVehicles)
  const v45 = forecastAt(samples, (s) => s.vehicleCount, curV, 45, 0, c.maxVehicles)
  const v60 = forecastAt(samples, (s) => s.vehicleCount, curV, 60, 0, c.maxVehicles)
  const q30 = forecastAt(samples, (s) => s.queue, curQ, 30, 0, c.maxQueue)
  const q60 = forecastAt(samples, (s) => s.queue, curQ, 60, 0, c.maxQueue)
  const d30 = forecastAt(samples, (s) => s.density, curD, 30, 0, 1)
  const d60 = forecastAt(samples, (s) => s.density, curD, 60, 0, 1)

  return {
    ...base,
    status: 'READY',
    currentVehicleCount: curV,
    predictedVehicleCount15s: Math.round(v15),
    predictedVehicleCount30s: Math.round(v30),
    predictedVehicleCount45s: Math.round(v45),
    predictedVehicleCount60s: Math.round(v60),
    currentQueue: curQ,
    predictedQueue30s: Math.round(q30),
    predictedQueue60s: Math.round(q60),
    currentDensity: round2(curD),
    predictedDensity30s: round2(d30),
    predictedDensity60s: round2(d60),
    congestionRisk: riskOf(Math.max(q30, q60), Math.max(d30, d60)),
    riskChange: riskChangeOf(curQ, q60, curD, d60),
    confidence: confidenceOf(samples, t),
    source: newest.source,
    historySamples: samples.length,
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100

/* --------------------------- pressure bias cache ------------------------- */
const biasCache = new Map<string, { t: number; bias: PredictionBias }>()

/**
 * Forward-looking pressure bias for a junction, consumed by signals.ts as an
 * additive adjustment to each group's pressure (bounded to ±biasMax, far below
 * the emergency boost). Computed at most once per biasCacheSec per junction so
 * the per-frame optimizer path stays cheap.
 */
export function predictionBiasFor(intersectionId: string, t: number): PredictionBias {
  const cached = biasCache.get(intersectionId)
  if (cached && t - cached.t < PREDICTION_CONFIG.biasCacheSec) return cached.bias

  const c = PREDICTION_CONFIG
  const bias: PredictionBias = { M: 0, X: 0 }
  for (const group of ['M', 'X'] as const) {
    const r = predict(intersectionId, group, t)
    if (r.status !== 'READY') continue
    const dq = r.predictedQueue60s - r.currentQueue
    const dd = r.predictedDensity60s - r.currentDensity
    const b = dq * c.biasPerQueue + dd * c.biasPerDensity
    bias[group] = round2(clamp(b, -c.biasMax, c.biasMax))
  }
  biasCache.set(intersectionId, { t, bias })
  return bias
}

/** display helper: estimated extension seconds implied by a bias value */
export function estimatedGreenExtensionSec(bias: number): number {
  const sec = Math.round(Math.abs(bias) * PREDICTION_CONFIG.biasToExtSec)
  return clamp(sec, 1, 6)
}

/* ------------------------------ panel helpers ---------------------------- */
/**
 * Which intersection the prediction panel should focus on:
 * the camera junction when camera observations are live, otherwise the
 * junction with the strongest recorded history / highest +30 s forecast.
 * Returns null when no junction has usable history yet.
 */
export function pickPredictionFocus(t: number): { intersectionId: string; group: 'M' | 'X' } | null {
  let best: { intersectionId: string; group: 'M' | 'X' } | null = null
  let bestScore = -1
  for (const k of historyByKey.keys()) {
    const sep = k.lastIndexOf(':')
    const intersectionId = k.slice(0, sep)
    const group = k.slice(sep + 1) as 'M' | 'X'
    const samples = samplesFor(intersectionId, group)
    if (samples.length < PREDICTION_CONFIG.minSamples) continue
    const last = samples[samples.length - 1]
    if (last.source === 'CAMERA' || last.source === 'FUSED') {
      // live camera data wins the focus
      return { intersectionId, group }
    }
    // otherwise score by newest + forecast magnitude
    const r = predict(intersectionId, group, t)
    const score = r.predictedQueue30s * 10 + samples.length
    if (score > bestScore) {
      bestScore = score
      best = { intersectionId, group }
    }
  }
  return best
}