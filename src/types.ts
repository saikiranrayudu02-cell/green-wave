import type { Emergency } from './types/traffic'

export type Mode = 'fixed' | 'greenwave'

export type EmergencyCode = 'MEDICAL' | 'TRAUMA'

export type ToastKind = 'info' | 'success' | 'warning' | 'critical'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  body?: string
  ts: number
}

/**
 * Runtime emergency record: the domain Emergency (types/traffic.ts) plus the
 * command-center display/telemetry fields. Route statistics (distance, ETA,
 * intersections) are computed by the routing engine from the road graph —
 * nothing here is hardcoded.
 */
export interface EmergencyRuntime extends Emergency {
  unit: string
  tac: string
  code: EmergencyCode
  incident: string
  origin: string
  destination: string
  corridorId: 'r1' | 'r2'
  corridorLabel: string
  /** calculated from the route plan */
  distanceKm: number
  /** signalized intersections on the route */
  intersections: number
  baselineSec: number
  etaSec: number
  savedSec: number
  /** signalized junctions in travel order (drives chips + green wave) */
  junctionIds: string[]
  corridorOpen: boolean
  arrived: boolean
  /** 'detour' while an incident reroute is in effect */
  variant: 'normal' | 'detour'
  /** distance travelled along the active route geometry (units) */
  dist: number
  /** length of the active route geometry (units) */
  len: number
  /** live telemetry: real seconds the unit stood at red signals this run */
  signalWaitSec: number
}

export interface IncidentState {
  id: string
  junctionId: string
  x: number
  y: number
  label: string
  severity: 'heavy' | 'critical'
}