// ---------------------------------------------------------------------------
// GREENWAVE — Max-Pressure-inspired signal optimizer (Step 4)
//
// This is an engineering adaptation of pressure-based traffic-signal control,
// NOT a claim of novel research. Every decision is derived from the actual
// simulated traffic state measured in engine/vehicles.ts (queues, approaching
// vehicles, waiting time) plus the live downstream congestion of the roads a
// phase would discharge into:
//
//     pressure(group) =
//         queue×Wq            — vehicles at rest on the approach
//       + approaching×Wa     — vehicles heading into the intersection
//       + (queue×waitAvg)×Ww — total vehicle-seconds starved (fairness)
//       − downstream×Wd      — spillback: don't push into a jam
//       + emergency boost    — ambulance movement priority on its route
//
// The controller (engine/signals.ts) consumes these pressures at each decision
// point: it serves a minimum green, then switches when the competing group's
// pressure exceeds the current one (with hysteresis), and is force-yielded at
// the maximum green — so no approach starves and no phase is abandoned early.
//
// A rolling decision log records every choice and its reason; the command
// center's intersection inspector renders the latest entry from real state.
// ---------------------------------------------------------------------------
import { roadById, roadPts, roadsAt, travelGroupFor } from '../data/osmRoadNetwork'
import type { AxisGroupName } from '../data/osmRoadNetwork'
import { trafficCongestion } from './vehicles'
import type { GroupObs, JunctionObs } from './vehicles'

/* --------------------------- configuration ------------------------------- */
/** pressure formula weights (simulation parameters, not scientific constants) */
export interface PressureWeights {
  queue: number
  approaching: number
  waiting: number
  downstream: number
}

export const PRESSURE_WEIGHTS: PressureWeights = {
  queue: 1.0,
  approaching: 0.5,
  waiting: 0.04,
  downstream: 2.2,
}

/** added to the pressure of the group an approaching ambulance needs */
export const EMERGENCY_PRESSURE_BOOST = 9
/** a competing group must beat the current one by this much to win the phase */
export const PRESSURE_HYSTERESIS = 2.5

/* --------------------------- decision log -------------------------------- */
export interface SignalDecision {
  /** sim clock of the decision (s) */
  t: number
  junctionId: string
  /** the group the decision favours / just switched to */
  group: AxisGroupName
  phase: string
  pressure: number
  otherPressure: number
  queue: number
  approaching: number
  reason: string
}

const DECISIONS: SignalDecision[] = []
const DECISION_CAP = 320

export function pushDecision(d: SignalDecision): void {
  DECISIONS.push(d)
  if (DECISIONS.length > DECISION_CAP) DECISIONS.splice(0, DECISIONS.length - DECISION_CAP)
}

export function signalDecisions(): readonly SignalDecision[] {
  return DECISIONS
}

/** latest decision for one junction (the inspector reads this) */
export function junctionDecision(junctionId: string): SignalDecision | null {
  for (let i = DECISIONS.length - 1; i >= 0; i--) {
    if (DECISIONS[i].junctionId === junctionId) return DECISIONS[i]
  }
  return null
}

export function clearDecisions(): void {
  DECISIONS.length = 0
}

/* --------------------------- pressure math ------------------------------- */
/** pressure of one group from live observations; no junction id needed here */
export function groupPressure(
  group: AxisGroupName,
  obs: JunctionObs | null,
  downstream: { M: number; X: number } | null,
  weights: PressureWeights = PRESSURE_WEIGHTS,
): number {
  const o: GroupObs = obs?.[group] ?? { queue: 0, approaching: 0, waitAvg: 0, waitSum: 0, waitCount: 0 }
  const down = downstream?.[group] ?? 0
  return (
    weights.queue * o.queue +
    weights.approaching * o.approaching +
    weights.waiting * (o.queue * o.waitAvg) -
    weights.downstream * down
  )
}

/**
 * Live congestion of the roads a group's movement discharges into — i.e. the
 * outgoing segments whose direction matches the group's axis. Used to avoid
 * feeding vehicles into an already-jammed downstream block.
 */
export function downstreamCongestion(junctionId: string, group: AxisGroupName): number {
  let worst = 0
  for (const r of roadsAt(junctionId)) {
    const pts = roadPts(r)
    if (pts.length < 2) continue
    let dx: number
    let dy: number
    if (r.from === junctionId) {
      dx = pts[1].x - pts[0].x
      dy = pts[1].y - pts[0].y
    } else if (r.to === junctionId) {
      dx = pts[pts.length - 2].x - pts[pts.length - 1].x
      dy = pts[pts.length - 2].y - pts[pts.length - 1].y
    } else {
      continue
    }
    const m = Math.hypot(dx, dy) || 1
    if (travelGroupFor(junctionId, dx / m, dy / m) !== group) continue
    const c = trafficCongestion().get(r.id) ?? roadById(r.id).congestion
    if (c > worst) worst = c
  }
  return worst
}