// ---------------------------------------------------------------------------
// GREENWAVE — Traffic demand adapter (Step 8)
//
// Bridges camera perception observations into the existing GreenWave signal
// optimizer. The adapter exposes:
//
//   1. A write API for camera perception results (called by App.tsx after
//      receiving HTTP responses from the Python backend).
//
//   2. A read API that CityMap.tsx can optionally use instead of the raw
//      trafficObservations() when camera data is available.
//
//   3. Source tracking — the UI can display "CAMERA" vs "SIMULATION".
//
// IMPORTANT: This module does NOT modify pressure.ts or vehicles.ts.
// It provides an augmented view of the observations that the caller
// (CityMap.tsx) can choose to use. When no camera data exists, the
// getters return null and the caller falls back to the existing
// trafficObservations() from vehicles.ts — preserving all existing
// simulator behavior unchanged.
// ---------------------------------------------------------------------------

import type {
  TrafficDemandObservation,
  FrameDetectionResult,
  PerceptionSource,
} from '../types/perception'
import type { JunctionObs } from './vehicles'
import { trafficSimT } from './vehicles'
import { mergeObservations, getCameraDemand, isCameraActive } from './perceptionFusion'
import { pushOpsEvent } from './emergencyTimeline'

/* -------------------------------------------------------------------------- */
/*  Demand store                                                               */
/* -------------------------------------------------------------------------- */

/** Per-intersection camera demand indexed by GreenWave junction ID. */
const demandByIntersection = new Map<string, TrafficDemandObservation>()

/** Latest camera metrics (for UI display). */
let latestCameraMetrics: FrameDetectionResult['camera_metrics'] | null = null

/** Timestamp of last camera update (ms since page load). */
let lastCameraUpdateMs = 0

/**
 * Backend reachability — the single shared source of truth, published by
 * TrafficCameraPanel's health probe (the only poller). Consumers such as the
 * Live Traffic module read this so "backend online but no video feed" is
 * never mislabeled as "backend offline".
 */
let backendReachable = false

/**
 * Publish backend reachability (single probe, owned by App). Records the
 * ONLINE ↔ FALLBACK transition as a real ops event so the System module's
 * operations log reflects actual camera health changes.
 */
export function setCameraBackendOnline(online: boolean): void {
  if (backendReachable === online) return
  backendReachable = online
  pushOpsEvent({
    t: trafficSimT(),
    junctionId: null,
    kind: 'system',
    label: online ? 'CAMERA → BACKEND ONLINE' : 'CAMERA → FALLBACK SIMULATION',
  })
}

/** Whether the Python perception backend is reachable and model-loaded. */
export function cameraBackendOnline(): boolean {
  return backendReachable
}

/* -------------------------------------------------------------------------- */
/*  Write API — called by App.tsx after camera detection                       */
/* -------------------------------------------------------------------------- */

/**
 * Store a traffic demand observation produced by the camera perception
 * backend for a specific intersection.
 */
export function storeCameraDemand(
  intersectionId: string,
  demand: TrafficDemandObservation,
): void {
  demandByIntersection.set(intersectionId, demand)
  lastCameraUpdateMs = performance.now()
}

/**
 * Store camera metrics from a detection result (for UI display).
 */
export function storeCameraMetrics(metrics: FrameDetectionResult['camera_metrics']): void {
  latestCameraMetrics = metrics
}

/** Clear all stored camera demand (e.g. on reset or camera disconnect). */
export function clearAllDemand(): void {
  demandByIntersection.clear()
  latestCameraMetrics = null
  lastCameraUpdateMs = 0
}

/* -------------------------------------------------------------------------- */
/*  Read API — used by CityMap.tsx or App.tsx                                  */
/* -------------------------------------------------------------------------- */

/**
 * Get the effective JunctionObs for an intersection, merging camera and
 * simulation data when both are available.
 *
 * Usage in CityMap.tsx (replaces trafficObservations().get(j.id)):
 * ```
 *   import { effectiveObservations } from '../engine/trafficDemand'
 *   const obs = effectiveObservations(j.id) ?? trafficObservations().get(j.id) ?? null
 * ```
 */
export function effectiveObservations(intersectionId: string): JunctionObs | null {
  const simObs = null // caller provides this; this module only augments
  const result = mergeObservations(intersectionId, simObs)
  return result.obs
}

/**
 * Get the effective JunctionObs by merging camera demand with a specific
 * simulation observation. This is the primary integration function.
 *
 * Usage in CityMap.tsx:
 * ```
 *   import { mergeWithSimObservations } from '../engine/trafficDemand'
 *   import { trafficObservations } from '../engine/vehicles'
 *
 *   const simObs = trafficObservations().get(j.id) ?? null
 *   const { obs, source } = mergeWithSimObservations(j.id, simObs)
 *   // use obs in groupPressure(...)
 * ```
 */
export function mergeWithSimObservations(
  intersectionId: string,
  simObs: JunctionObs | null,
): { obs: JunctionObs; source: PerceptionSource } {
  return mergeObservations(intersectionId, simObs)
}

/** Get stored camera demand for an intersection (or null). */
export function getStoredDemand(intersectionId: string): TrafficDemandObservation | null {
  return getCameraDemand(intersectionId)
}

/** Whether any camera data is currently fresh. */
export function hasLiveCameraData(): boolean {
  return isCameraActive()
}

/** Latest camera metrics for UI display. */
export function getCameraMetrics(): FrameDetectionResult['camera_metrics'] | null {
  return latestCameraMetrics
}

/** Milliseconds since last camera update. */
export function msSinceLastCameraUpdate(): number {
  return lastCameraUpdateMs > 0 ? performance.now() - lastCameraUpdateMs : Infinity
}

/**
 * Overall sensor source for the command-center status indicator.
 * Returns the dominant source across all intersections.
 */
export function globalSensorSource(): PerceptionSource {
  if (!isCameraActive()) return 'SIMULATION'
  // Check if we have camera data for any intersection
  for (const entry of demandByIntersection.values()) {
    if (entry.source === 'CAMERA' || entry.source === 'FUSED') return entry.source
  }
  return 'SIMULATION'
}
