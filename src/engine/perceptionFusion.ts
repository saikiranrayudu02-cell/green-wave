// ---------------------------------------------------------------------------
// GREENWAVE — Perception fusion (Step 8)
//
// Deterministic module that holds the latest camera demand observations and
// produces fused JunctionObs-compatible data for the signal optimizer.
//
// Data flow:
//   camera HTTP response
//     → setCameraDemand(intersectionId, observation)
//       → fusedObservations()  (read by CityMap / pressure.ts adapter)
//
// Source priority:
//   1. CAMERA  — valid camera observation exists and is fresh
//   2. SIMULATION — camera unavailable or stale; existing sim data used
//   3. FUSED — both present, camera weighted by freshness
//
// This module NEVER fabricates camera values. When no camera data exists,
// every getter returns null so the caller falls back to simulation.
// ---------------------------------------------------------------------------

import type {
  TrafficDemandObservation,
  PerceptionSource,
} from '../types/perception'
import type { GroupObs, JunctionObs } from './vehicles'

/* -------------------------------------------------------------------------- */
/*  Internal store                                                             */
/* -------------------------------------------------------------------------- */

interface CameraDemandEntry {
  observation: TrafficDemandObservation
  receivedAt: number // performance.now() when received
}

/** intersectionId → latest camera demand */
const cameraDemandMap = new Map<string, CameraDemandEntry>()

/** Maximum age (ms) before a camera observation is considered stale. */
const STALE_MS = 5000

/* -------------------------------------------------------------------------- */
/*  Public API: write                                                          */
/* -------------------------------------------------------------------------- */

/** Store a fresh camera demand observation for one intersection. */
export function setCameraDemand(
  intersectionId: string,
  observation: TrafficDemandObservation,
): void {
  cameraDemandMap.set(intersectionId, {
    observation,
    receivedAt: performance.now(),
  })
}

/** Clear all camera demand (e.g. on reset or camera disconnect). */
export function clearCameraDemand(): void {
  cameraDemandMap.clear()
}

/** Remove camera demand for a specific intersection. */
export function removeCameraDemand(intersectionId: string): void {
  cameraDemandMap.delete(intersectionId)
}

/* -------------------------------------------------------------------------- */
/*  Public API: read                                                           */
/* -------------------------------------------------------------------------- */

/** Get the raw camera demand for an intersection, or null if absent/stale. */
export function getCameraDemand(intersectionId: string): TrafficDemandObservation | null {
  const entry = cameraDemandMap.get(intersectionId)
  if (!entry) return null
  if (performance.now() - entry.receivedAt > STALE_MS) return null
  return entry.observation
}

/** Get the raw camera demand regardless of staleness (for UI display). */
export function getCameraDemandRaw(intersectionId: string): TrafficDemandObservation | null {
  return cameraDemandMap.get(intersectionId)?.observation ?? null
}

/** True when any intersection has fresh camera data. */
export function isCameraActive(): boolean {
  const now = performance.now()
  for (const entry of cameraDemandMap.values()) {
    if (now - entry.receivedAt <= STALE_MS) return true
  }
  return false
}

/** List all intersection IDs that currently have camera demand. */
export function cameraIntersectionIds(): string[] {
  return [...cameraDemandMap.keys()]
}

/* -------------------------------------------------------------------------- */
/*  Fusion: camera demand → JunctionObs                                        */
/* -------------------------------------------------------------------------- */

/** Convert a TrafficDemandObservation into the JunctionObs shape used by pressure.ts. */
function demandToGroupObs(
  _vehicleCount: number,
  estimatedQueue: number,
  _density: number,
  approaching: number,
  stopped: number,
): GroupObs {
  return {
    queue: estimatedQueue,
    approaching,
    waitAvg: stopped > 0 ? 8.0 : 0, // rough estimate: stopped vehicles wait ~8s
    waitSum: stopped * 8.0,
    waitCount: stopped,
  }
}

/**
 * Produce a fused JunctionObs for an intersection.
 *
 * - If camera data is fresh → returns camera-derived obs with source = CAMERA
 * - If camera data is stale/absent → returns null (caller uses simulation)
 *
 * The caller decides how to combine this with simulation data.
 * This function never invents values.
 */
export function fusedCameraObs(intersectionId: string): {
  obs: JunctionObs | null
  source: PerceptionSource
} {
  const demand = getCameraDemand(intersectionId)
  if (!demand) {
    return { obs: null, source: 'SIMULATION' }
  }

  const mObs = demandToGroupObs(
    demand.m_vehicle_count,
    demand.m_estimated_queue,
    demand.m_density,
    demand.m_approaching,
    demand.m_stopped,
  )
  const xObs = demandToGroupObs(
    demand.x_vehicle_count,
    demand.x_estimated_queue,
    demand.x_density,
    demand.x_approaching,
    demand.x_stopped,
  )

  return {
    obs: { M: mObs, X: xObs },
    source: 'CAMERA',
  }
}

/**
 * Merge camera and simulation observations into a single JunctionObs.
 *
 * Fusion strategy:
 *   - When camera data is fresh and has significant vehicle count,
 *     use camera values as the primary signal (weight 0.7 camera, 0.3 sim).
 *   - When camera data is sparse (< 3 vehicles), use it as a
 *     supplementary signal (weight 0.3 camera, 0.7 sim).
 *   - When no camera data, return the simulation obs unchanged.
 *
 * This is a simple linear blend — not a claim of optimal sensor fusion.
 */
export function mergeObservations(
  intersectionId: string,
  simObs: JunctionObs | null,
): {
  obs: JunctionObs
  source: PerceptionSource
} {
  const cam = fusedCameraObs(intersectionId)

  if (!cam.obs) {
    return {
      obs: simObs ?? { M: blankGroupObs(), X: blankGroupObs() },
      source: 'SIMULATION',
    }
  }

  if (!simObs) {
    return { obs: cam.obs, source: 'CAMERA' }
  }

  // Determine blend weight based on camera vehicle count
  const camTotal = cam.obs.M.approaching + cam.obs.X.approaching
  const camWeight = camTotal >= 3 ? 0.7 : 0.3
  const simWeight = 1 - camWeight

  const blended: JunctionObs = {
    M: blendGroupObs(cam.obs.M, simObs.M, camWeight, simWeight),
    X: blendGroupObs(cam.obs.X, simObs.X, camWeight, simWeight),
  }

  return { obs: blended, source: 'FUSED' }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function blankGroupObs(): GroupObs {
  return { queue: 0, approaching: 0, waitAvg: 0, waitSum: 0, waitCount: 0 }
}

function blendGroupObs(
  cam: GroupObs,
  sim: GroupObs,
  camW: number,
  simW: number,
): GroupObs {
  return {
    queue: Math.round(cam.queue * camW + sim.queue * simW),
    approaching: Math.round(cam.approaching * camW + sim.approaching * simW),
    waitAvg: cam.waitAvg * camW + sim.waitAvg * simW,
    waitSum: cam.waitSum * camW + sim.waitSum * simW,
    waitCount: Math.round(cam.waitCount * camW + sim.waitCount * simW),
  }
}
