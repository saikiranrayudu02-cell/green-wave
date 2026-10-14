// ---------------------------------------------------------------------------
// GREENWAVE — Camera perception types (Step 8)
//
// TypeScript types that mirror the Python perception backend models
// (backend/camera/models.py). All detection data originates from actual
// processed video frames via pretrained YOLO — never fabricated.
// ---------------------------------------------------------------------------

export type VehicleClass = 'car' | 'bus' | 'truck' | 'motorcycle'

export type CameraStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE'

/** Sensor data provenance — drives the UI source indicator. */
export type PerceptionSource = 'CAMERA' | 'SIMULATION' | 'FUSED'

export interface BoundingBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface VehicleObservation {
  track_id: number
  vehicle_class: VehicleClass
  confidence: number
  bbox: BoundingBox
  timestamp: number
  approach_id: string | null
  direction: string | null
  speed_px_per_frame: number
  is_stopped: boolean
}

export interface ApproachMetrics {
  approach_id: string
  vehicle_count: number
  cars: number
  buses: number
  trucks: number
  motorcycles: number
  estimated_queue: number
  /** Normalised density 0..1 (vehicles / ROI capacity). */
  density: number
  avg_confidence: number
  approaching_count: number
  stopped_count: number
  moving_count: number
}

export interface CameraMetrics {
  camera_id: string
  status: CameraStatus
  intersection_id: string
  fps: number
  inference_fps: number
  total_detections: number
  active_tracks: number
  estimated_queue: number
  traffic_density: number
  frame_number: number
  approaches: ApproachMetrics[]
}

export interface FrameDetectionResult {
  frame_number: number
  timestamp: number
  inference_ms: number
  fps: number
  total_vehicles: number
  active_tracks: number
  detections: VehicleObservation[]
  approaches: Record<string, ApproachMetrics>
  camera_metrics: CameraMetrics
}

/**
 * Traffic demand observation — the bridge between camera perception and the
 * GreenWave signal optimizer. Maps camera approaches to the M/X axis groups
 * used by the existing pressure calculation in pressure.ts.
 */
export interface TrafficDemandObservation {
  source: PerceptionSource
  intersection_id: string
  timestamp: number

  /** Main axis group (NORTH/SOUTH). */
  m_vehicle_count: number
  m_estimated_queue: number
  m_density: number
  m_approaching: number
  m_stopped: number

  /** Cross axis group (EAST/WEST). */
  x_vehicle_count: number
  x_estimated_queue: number
  x_density: number
  x_approaching: number
  x_stopped: number

  /** Fusion weights — how much to trust camera vs simulation. */
  camera_weight: number
  simulation_weight: number
}

export interface PerceptionConfig {
  confidence_threshold: number
  nms_threshold: number
  inference_interval: number
}

export interface CameraHealth {
  /** Backend reachable? */
  reachable: boolean
  /** YOLO model loaded on the server? */
  modelLoaded: boolean
  /** Overall camera status. */
  status: CameraStatus
  /** Last successful detection timestamp (ms). */
  lastDetectionTs: number
  /** Latency of last health probe (ms). */
  lastProbeMs: number
}
