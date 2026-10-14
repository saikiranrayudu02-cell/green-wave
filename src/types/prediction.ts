// ---------------------------------------------------------------------------
// GREENWAVE — Predictive traffic intelligence types (Step 9)
//
// Strongly typed structures for the deterministic short-horizon predictor.
// Every value is derived from recorded traffic observations (simulation,
// camera, or fused) — nothing is fabricated. The UI labels the confidence
// value as "PREDICTION CONFIDENCE", never as measured model accuracy.
// ---------------------------------------------------------------------------
import type { PerceptionSource } from './perception'

/** One recorded traffic observation for one (intersection, group). */
export interface TrafficHistorySample {
  /** simulation clock when the sample was recorded (s) */
  t: number
  /** vehicles within the approach zone (moving or queued) */
  vehicleCount: number
  /** vehicles at rest on the approach */
  queue: number
  /** normalised occupancy 0..1 (approach zone occupancy estimate) */
  density: number
  /** vehicles heading into the intersection */
  approaching: number
  /** vehicles at rest (waiting) */
  stopped: number
  /** where the observation came from */
  source: PerceptionSource
}

export type PredictionStatus = 'READY' | 'INSUFFICIENT_HISTORY'

export type CongestionRisk = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'
export type RiskChange = 'STABLE' | 'RISING' | 'FALLING'

/** Short-horizon forecast for one (intersection, group). */
export interface PredictionResult {
  intersectionId: string
  group: 'M' | 'X'
  /** sim clock the prediction was generated at (s) */
  generatedAt: number
  status: PredictionStatus
  /** why prediction is not available (only when status != READY) */
  insufficientReason?: 'NO_DATA' | 'FEW_SAMPLES' | 'STALE'

  currentVehicleCount: number
  predictedVehicleCount15s: number
  predictedVehicleCount30s: number
  predictedVehicleCount45s: number
  predictedVehicleCount60s: number

  currentQueue: number
  predictedQueue30s: number
  predictedQueue60s: number

  currentDensity: number
  predictedDensity30s: number
  predictedDensity60s: number

  /** LOW / MODERATE / HIGH / CRITICAL from predicted queue + density */
  congestionRisk: CongestionRisk
  /** RISING / STABLE / FALLING from the forecast slope */
  riskChange: RiskChange
  /** 0..1 — "PREDICTION CONFIDENCE", not statistical model accuracy */
  confidence: number
  /** source of the most recent recorded observation */
  source: PerceptionSource
  /** number of actual history samples the prediction used */
  historySamples: number
}

/** Forward-looking pressure bias per group consumed by the signal controller. */
export interface PredictionBias {
  M: number
  X: number
}

/** A proactive action actually caused by the prediction layer. */
export interface PredictionEvent {
  /** sim clock of the event (s) */
  t: number
  intersectionId: string
  group: 'M' | 'X'
  /** short forecast label, e.g. "HIGH RISK +30s" */
  forecast: string
  /** the action the signal controller took, e.g. "GREEN EXTENDED +5s" */
  action: string
  /** human-readable operational explanation */
  detail: string
}