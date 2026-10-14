// ---------------------------------------------------------------------------
// GREENWAVE — Camera perception API client (Step 8)
//
// Lightweight HTTP client for the Python/FastAPI YOLO detection backend.
// All calls are fire-and-forget or simple fetches — never blocks the
// simulation. If the backend is unreachable, every function returns null
// so the caller can fall back to simulation-only mode.
// ---------------------------------------------------------------------------

import type { CameraHealth, FrameDetectionResult, CameraMetrics } from '../types/perception'

const BACKEND_URL = 'http://127.0.0.1:8099'
const PROBE_TIMEOUT_MS = 3000
const DETECT_TIMEOUT_MS = 15000

/* -------------------------------------------------------------------------- */
/*  Health                                                                     */
/* -------------------------------------------------------------------------- */

export async function probeHealth(): Promise<CameraHealth> {
  const t0 = performance.now()
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as {
      status: string
      model_loaded: boolean
      camera_status: string
    }
    return {
      reachable: true,
      modelLoaded: data.model_loaded,
      status: data.camera_status as CameraHealth['status'],
      lastDetectionTs: Date.now(),
      lastProbeMs: Math.round(performance.now() - t0),
    }
  } catch {
    return {
      reachable: false,
      modelLoaded: false,
      status: 'OFFLINE',
      lastDetectionTs: 0,
      lastProbeMs: Math.round(performance.now() - t0),
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Frame detection (base64)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Send a single video frame (as base64 JPEG/PNG) for YOLO detection.
 * Returns null if the backend is unreachable or the request fails.
 */
export async function detectFrame(
  imageBase64: string,
  intersectionId: string = '',
): Promise<FrameDetectionResult | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/detect/frame/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, intersection_id: intersectionId }),
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FrameDetectionResult
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*  Frame detection (File/Blob)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Send a single video frame as a File/Blob for YOLO detection.
 */
export async function detectFrameBlob(
  blob: Blob,
  intersectionId: string = '',
): Promise<FrameDetectionResult | null> {
  try {
    const form = new FormData()
    form.append('image', blob, 'frame.jpg')
    if (intersectionId) form.append('intersection_id', intersectionId)
    const res = await fetch(`${BACKEND_URL}/detect/frame`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as FrameDetectionResult
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*  Status                                                                     */
/* -------------------------------------------------------------------------- */

export async function fetchStatus(): Promise<{
  camera_status: string
  model_loaded: boolean
  frame_number: number
  total_detections: number
  active_tracks: number
  latest_metrics: Record<string, unknown>
} | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/status`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*  Convenience: extract CameraMetrics from detection result                    */
/* -------------------------------------------------------------------------- */

export function extractCameraMetrics(result: FrameDetectionResult): CameraMetrics {
  return result.camera_metrics
}
