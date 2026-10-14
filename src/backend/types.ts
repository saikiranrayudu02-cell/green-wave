// ---------------------------------------------------------------------------
// GREENWAVE — operational record + live-snapshot types (Step 6)
//
// These mirror the Supabase schema (supabase/migrations/0001_*.sql) so one
// record shape works for the local demo store and the remote repository.
// Live snapshots are the throttled, aggregated operational view published to
// the sync bus — never per-vehicle animation frames.
// ---------------------------------------------------------------------------

export type OpRole =
  | 'ADMIN'
  | 'TRAFFIC_OPERATOR'
  | 'EMERGENCY_DISPATCHER'
  | 'VIEWER'
  // field roles — real authenticated accounts with least-privilege RLS
  | 'AMBULANCE_DRIVER'
  | 'HOSPITAL'

export type OpStatus = 'PENDING' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED'

export type DecisionType =
  | 'NORMAL_ADAPTIVE'
  | 'PHASE_EXTENSION'
  | 'PHASE_CHANGE'
  | 'EMERGENCY_PRIORITY'
  | 'CORRIDOR_PREPARATION'
  | 'CORRIDOR_ACTIVE'
  | 'CORRIDOR_RELEASE'
  | 'INCIDENT_RESPONSE'

export interface EmergencyRecord {
  id: string
  emergencyRef: string
  unit: string
  code: 'MEDICAL' | 'TRAUMA'
  priority: 'CRITICAL' | 'HIGH'
  incident: string
  origin: string
  destination: string
  originIntersectionId: string
  destinationIntersectionId: string
  routeIntersectionIds: string[]
  routeRoadIds: string[]
  distanceKm: number
  baselineSec: number
  status: OpStatus
  corridorActive: boolean
  dispatchedAt?: number
  arrivedAt?: number
  signalWaitSec: number
  savedSec: number
  createdAt: number
  updatedAt: number
}

export interface IncidentRecord {
  id: string
  junctionId: string
  label: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: 'ACTIVE' | 'RESOLVED'
  startedAt: number
  resolvedAt?: number
  createdAt: number
}

export interface DecisionRecord {
  id: string
  simT: number
  junctionId: string
  mode: 'FIXED_TIME' | 'GREENWAVE'
  decisionType: DecisionType
  previousPhase?: string
  selectedPhase: string
  pressure: number
  otherPressure: number
  queue: number
  approaching: number
  reason?: string
  emergencyRef?: string
  createdAt: number
}

export interface SessionRecord {
  id: string
  mode: 'FIXED_TIME' | 'GREENWAVE' | 'EMERGENCY_CORRIDOR'
  operator: string
  role: OpRole
  seed: string
  status: 'RUNNING' | 'ENDED'
  startedAt: number
  endedAt?: number
  createdAt: number
}

/** finalized per-emergency metrics — real simulated values only */
export interface EmergencyMetricsRecord {
  emergencyId: string
  baselineEtaSec: number
  travelSec: number
  signalWaitSec: number
  intersectionsPassed: number
  delayAvoidedSec: number
  createdAt: number
}

/** fixed-time vs adaptive comparison on the same deterministic scenario */
export interface BenchmarkRecord {
  sessionId?: string
  baselineWait: number
  adaptiveWait: number
  baselineSpeed: number
  adaptiveSpeed: number
  baselineQueue: number
  adaptiveQueue: number
  baselineThroughput: number
  adaptiveThroughput: number
  createdAt: number
}

/** condensed display entry for the history drawer */
export interface HistoryEntry {
  ts: number
  kind: 'EMERGENCY' | 'INCIDENT' | 'DECISION' | 'SESSION'
  tone: 'cyan' | 'green' | 'red' | 'amber'
  title: string
  body: string
  meta?: string
}

/* --------------------------- live sync ------------------------------- */

export type SyncKind = 'BUS' | 'REALTIME' | 'CONVEX' | 'NONE'

export interface AmbulanceSnapshot {
  unit: string
  active: boolean
  corridorOpen: boolean
  arrived: boolean
  etaSec: number
  savedSec: number
  routeKey: string
}

export interface OpsSnapshot {
  seq: number
  source: string
  ts: number
  simT: number
  traffic: {
    activeVehicles: number
    avgSpeedKmh: number
    avgWaitSec: number
    queueM: number
    congestion: number // 0..100
    throughput: number
    ratePerHour: number
  }
  incidentActive: boolean
  incidentJunction?: string
  mode: 'FIXED_TIME' | 'GREENWAVE'
  corridorOpen: boolean
  ambulance: AmbulanceSnapshot | null
  corridorJunctions: { id: string; status: string; eta: number }[]
}
