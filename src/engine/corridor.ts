// ---------------------------------------------------------------------------
// GREENWAVE — intelligent emergency green corridor engine (Step 5)
//
// The corridor is a MOVING window, not "turn everything green". At any moment
// the engine looks ahead along the ambulance route and assigns every upcoming
// signalised stop a status + priority derived from live geometry:
//
//   PASSED     – the unit has cleared the junction box → released back to the
//                normal adaptive optimizer
//   ACTIVE     – the unit is at / inside the junction box → green held while
//                it crosses (bounded)
//   PREPARING  – the unit will arrive within the coordination horizon → the
//                signal is scheduled so the required phase is green *at the
//                predicted arrival*, not a second sooner
//   STANDBY    – further down the route: monitored only, normal control
//
// The scheduler is deliberately predictive rather than reactive: a conflicting
// green is served as long as possible and only truncated so that — after a
// normal yellow — the ambulance phase is green exactly when the unit reaches
// the stop line. As the ambulance advances, passed junctions are released and
// new ones join the window; any change (incident, reroute, delay) simply
// re-plans on the next tick because every decision is recomputed from state.
//
// The engine is pure and UI-free. The map host computes the wave each frame,
// feeds `CorridorReq` schedules into the signal controllers (engine/signals.ts)
// and drives the ambulance with `stepAmbulance` (same physics in the live app
// and the benchmark harness). A tiny module store + event log backs the panel
// and inspector — nothing here touches React or the DOM.
// ---------------------------------------------------------------------------
import { STOP_OFFSET_PX } from './vehicles'
import type { AxisGroupName } from '../data/osmRoadNetwork'
import { projectJunctionsAlong, travelGroupFor } from '../data/osmRoadNetwork'
import { headingAtDist } from '../utils/geo'
import type { Pt } from '../utils/geo'
import { pushDecision } from './pressure'

/* ------------------------------ configuration ---------------------------- */
export const CORRIDOR_CONFIG = {
  /** how many upcoming junctions are coordinated at once (excludes ACTIVE) */
  lookAheadIntersections: 3,
  /** eta at/below which a junction is HIGH priority (hard green at arrival) */
  highEtaS: 6.5,
  /** eta at/below which a junction may enter the coordination window */
  prepareEtaS: 15,
  /** the unit is ACTIVE once its stop line is this close (px) */
  activeAheadPx: 30,
  /** … and stays ACTIVE until this far past its stop line (px) */
  activePastPx: 70,
  /** how long the green is kept after the predicted arrival (clearing time) */
  holdAfterS: 3.5,
  /** safety: a request may not preempt a junction for longer than this */
  maxHoldS: 20,
}

/* ------------------------------ corridor types --------------------------- */
export type CorrStatus = 'PASSED' | 'ACTIVE' | 'PREPARING' | 'STANDBY'
export type CorrPriority = 'ACTIVE' | 'HIGH' | 'PREPARE' | 'NONE'

export interface CorridorJunction {
  id: string
  /** index in the route's ordered stop list */
  order: number
  /** phase group the ambulance needs at this junction (MAIN/CROSS axis) */
  group: AxisGroupName
  /** stop-line distance along the route (px) */
  stopDist: number
  /** how far the unit is from the stop line (px, >0 ahead) */
  aheadPx: number
  /** predicted seconds until the unit reaches the stop line */
  etaSec: number
  status: CorrStatus
  priority: CorrPriority
  /** sim time the required phase must be green */
  greenAt: number
  /** sim time the hold ends and the junction returns to normal control */
  releaseAt: number
  /** current state of the required phase ('G'|'Y'|'R') */
  requiredState: 'G' | 'Y' | 'R'
  /** what the corridor is doing with this signal right now */
  action: string
}

export interface RouteStop {
  id: string
  /** junction-centre distance along the route (px) */
  centerDist: number
  group: AxisGroupName
}

export interface CorridorSignal {
  /** state of the given phase group right now */
  stateOf: (jid: string, g: AxisGroupName) => 'G' | 'Y' | 'R'
  /** which group is currently being served (green/yellow), if any */
  serving: (jid: string) => AxisGroupName | null
}

export interface CorridorInput {
  t: number
  /** ordered signal stops on the active route geometry */
  stops: RouteStop[]
  /** distance travelled along the route (px) */
  d: number
  /** corridor cruising speed (px/s) */
  cruise: number
  /** incident junction distance along this route (px), if one lies on it */
  incidentDist: number | null
  corridorOpen: boolean
  signal: CorridorSignal
}

/* --------------------------- incident speed model ------------------------ */
/** speed factor zones around an incident (mirrors the host's creep zones) */
export function incidentFactorAt(dd: number): number {
  if (dd > -80 && dd < 200) return 0.25
  if (dd > 200 && dd < 330) return 0.55
  return 1
}

/** effective cruise between two route distances when an incident lies between */
export function effectiveCruise(cruise: number, inc: number | null, a: number, b: number): number {
  if (inc == null || b <= a) return cruise
  // span distance in px
  const span = b - a
  // slow-zone geometry around the incident (px, along the route)
  const zones: [number, number, number][] = [
    [-80, 200, 0.25],
    [200, 330, 0.55],
  ]
  let tSum = 0
  let covered = 0
  for (const [z0, z1, f] of zones) {
    const lo = Math.max(a, inc + z0)
    const hi = Math.min(b, inc + z1)
    if (hi > lo) {
      tSum += (hi - lo) / Math.max(0.001, cruise * f)
      covered += hi - lo
    }
  }
  const rest = span - covered
  if (rest > 0) tSum += rest / cruise
  return span / Math.max(0.001, tSum)
}

/* ------------------------------ route stops ------------------------------ */
/**
 * Build the ordered signal stops of a route: every junction on the geometry
 * that belongs to the route's coordinated-stop set, with the MAIN/CROSS group
 * the approaching ambulance needs (from its travel heading at each junction).
 */
export function buildRouteStops(pts: Pt[], junctionIds: string[]): RouteStop[] {
  const proj = projectJunctionsAlong(pts)
  const stops = new Set(junctionIds)
  const out: RouteStop[] = []
  for (const jd of proj) {
    if (!stops.has(jd.id)) continue
    const h = headingAtDist(pts, Math.max(0.0001, jd.dist - 14))
    out.push({
      id: jd.id,
      centerDist: jd.dist,
      group: travelGroupFor(jd.id, h.x, h.y),
    })
  }
  return out
}

/* ------------------------------ wave planner ----------------------------- */
/** predicted time (s) for the unit to travel from d to the given distance */
function etaTo(stopDist: number, d: number, cruise: number, inc: number | null): number {
  const ahead = stopDist - d
  if (ahead <= 0) return 0
  const v = effectiveCruise(cruise, inc, d, stopDist)
  return ahead / Math.max(0.001, v)
}

/**
 * Pure corridor plan: statuses + schedules for every route stop of one unit.
 * Everything is recomputed from state every call, so a changed route, an
 * incident or a delay re-plans automatically on the next frame.
 */
export function planCorridorWave(input: CorridorInput): CorridorJunction[] {
  const { t, stops, d, cruise, incidentDist, signal } = input
  const wave: CorridorJunction[] = []
  if (!input.corridorOpen || cruise <= 0 || stops.length === 0) return wave

  // per-stop line distance = centre - stop offset (where the unit must stop)
  const stopLines = stops.map((s) => ({
    s,
    line: s.centerDist - STOP_OFFSET_PX,
  }))

  /* pass 1 — geometry status */
  const staged: {
    stop: RouteStop
    line: number
    ahead: number
    eta: number
    st: 'PASSED' | 'ACTIVE' | 'AHEAD'
  }[] = []
  for (const { s, line } of stopLines) {
    const ahead = line - d
    if (ahead <= -CORRIDOR_CONFIG.activePastPx) {
      staged.push({ stop: s, line, ahead, eta: 0, st: 'PASSED' })
    } else if (ahead <= CORRIDOR_CONFIG.activeAheadPx) {
      staged.push({ stop: s, line, ahead, eta: 0, st: 'ACTIVE' })
    } else {
      staged.push({ stop: s, line, ahead, eta: etaTo(line, d, cruise, incidentDist), st: 'AHEAD' })
    }
  }

  /* pass 2 — priority by eta, then a coordination-window cap so only the next
     few junctions are prepared at once (STANDBY for the rest). Junctions whose
     eta is imminent are always coordinated regardless of the cap. */
  let coordinated = 0
  for (const x of staged) {
    const { stop, line, ahead, eta } = x
    let status: CorrStatus
    let priority: CorrPriority
    let greenAt = t
    let releaseAt = t + CORRIDOR_CONFIG.holdAfterS
    if (x.st === 'PASSED') {
      status = 'PASSED'
      priority = 'NONE'
    } else if (x.st === 'ACTIVE') {
      status = 'ACTIVE'
      priority = 'ACTIVE'
      greenAt = t
      releaseAt = t + CORRIDOR_CONFIG.holdAfterS
    } else if (eta <= CORRIDOR_CONFIG.highEtaS) {
      status = 'PREPARING'
      priority = 'HIGH'
      coordinated++
      greenAt = t + eta
      releaseAt = t + eta + CORRIDOR_CONFIG.holdAfterS
    } else if (eta <= CORRIDOR_CONFIG.prepareEtaS && coordinated < CORRIDOR_CONFIG.lookAheadIntersections) {
      status = 'PREPARING'
      priority = 'PREPARE'
      coordinated++
      greenAt = t + eta
      releaseAt = t + eta + CORRIDOR_CONFIG.holdAfterS
    } else {
      status = 'STANDBY'
      priority = 'NONE'
    }
    wave.push({
      id: stop.id,
      order: wave.length,
      group: stop.group,
      stopDist: line,
      aheadPx: ahead,
      etaSec: Math.max(0, eta),
      status,
      priority,
      greenAt,
      releaseAt,
      requiredState: x.st === 'PASSED' ? 'R' : signal.stateOf(stop.id, stop.group),
      action: describeAction(status, priority, stop.group, eta, signal.serving(stop.id), t, greenAt),
    })
  }
  return wave
}

function describeAction(
  status: CorrStatus,
  priority: CorrPriority,
  group: AxisGroupName,
  eta: number,
  serving: AxisGroupName | null,
  t: number,
  greenAt: number,
): string {
  const gLabel = group === 'M' ? 'MAIN' : 'CROSS'
  switch (status) {
    case 'PASSED':
      return 'Released — adaptive control resumed'
    case 'ACTIVE':
      return `Holding ${gLabel} while unit crosses`
    case 'PREPARING': {
      if (priority === 'HIGH') {
        return `Green ${gLabel} locked for arrival in ${Math.max(1, Math.round(eta))}s`
      }
      if (serving === group) {
        return `Extend current ${gLabel} green toward arrival`
      }
      const clearIn = Math.max(0, Math.round(greenAt - 4 - t))
      return clearIn <= 0
        ? `Begin ${gLabel} transition now`
        : `Serve cross until ${clearIn}s, then transition to ${gLabel}`
    }
    default:
      return 'Monitoring — normal control'
  }
}

/* --------------------------- controller request -------------------------- */
/** What the signal controller should enforce this frame for a junction. */
export interface CorridorReq {
  group: AxisGroupName
  /** the required phase must be green by this sim time */
  greenAt: number
  /** release (return to normal control) at this sim time */
  releaseAt: number
}

export function corridorRequestFor(j: CorridorJunction): CorridorReq | null {
  if (j.priority === 'NONE') return null
  const hold = Math.min(CORRIDOR_CONFIG.maxHoldS, CORRIDOR_CONFIG.holdAfterS + Math.max(0, j.etaSec))
  return {
    group: j.group,
    greenAt: j.greenAt,
    releaseAt: Math.min(j.releaseAt, j.greenAt + hold),
  }
}

/* ------------------------------ unit physics ----------------------------- */
export interface UnitRun {
  d: number
  v: number
  /** seconds the unit has stood at a red signal (real signal delay) */
  wait: number
  arrived: boolean
}

export const AMB_BRAKE_PX = 2.2
/** yellow: if further than this from the stop line, stop instead of clearing */
export const AMB_YELLOW_CLEAR_PX = 46

export interface NextStop {
  /** stop-line distance along the route (px) */
  stopDist: number
  light: 'G' | 'Y' | 'R'
}

/**
 * The next route stop the unit still has to obey: the first stop whose stop
 * line has not yet been left more than ~2 px behind. Once the unit has truly
 * crossed the line it is committed and rolls on; until then it must brake.
 */
export function nextRouteStop(stops: RouteStop[], d: number): RouteStop | null {
  if (stops.length === 0) return null
  for (const s of stops) {
    if (s.centerDist - STOP_OFFSET_PX > d - 2) return s
  }
  return null
}

/**
 * Advance one ambulance by dt under the same physics the command center uses:
 * cruise speed, gradual accel/decel, brake to the stop line on red, clear on
 * yellow when close enough, stop when too far. Accumulates standing-at-red
 * time into `wait`. Pure — shared by the live map and the benchmark harness.
 */
export function stepAmbulance(
  run: UnitRun,
  dt: number,
  cruise: number,
  len: number,
  next: NextStop | null,
): UnitRun {
  let { d, v, wait } = run
  let target = cruise
  let stopped = false
  if (next) {
    const stopDist = next.stopDist - d
    if (next.light === 'R') {
      if (d < next.stopDist - 0.6) {
        // approaching a red — brake toward the line; the last few px settle to 0
        target = Math.min(target, Math.sqrt(2 * AMB_BRAKE_PX * Math.max(0, stopDist)))
        if (stopDist < 6) target = 0
      } else if (d < next.stopDist + 0.6) {
        // at the line on red — hold until the phase actually turns green
        target = 0
        stopped = true
        d = next.stopDist
      }
      // beyond line + 0.6 on red = entered legally under green — roll through
    } else if (next.light === 'Y' && stopDist > AMB_YELLOW_CLEAR_PX) {
      target = Math.min(target, Math.sqrt(2 * AMB_BRAKE_PX * stopDist))
      if (stopDist < 6) target = 0
    }
  }
  v += (target - v) * Math.min(1, dt * 4)
  if (target === 0 && v < 0.05) v = 0
  d += v * dt
  if (stopped && d > next!.stopDist) d = next!.stopDist
  // real signal delay: standing at the red stop line (unit parks a few px short)
  if (next && next.light === 'R') {
    const sd = next.stopDist - d
    if (v < 0.4 && sd <= 6.5 && sd >= -0.5) wait += dt
  }
  if (d >= len) {
    return { d: len, v: 0, wait, arrived: true }
  }
  return { d, v, wait, arrived: false }
}

/* --------------------------- UI store + event log ------------------------ */
export interface CorridorEvent {
  t: number
  junctionId: string
  /** 'PREPARE' | 'ACTIVE' | 'RELEASE' */
  kind: 'PREPARE' | 'ACTIVE' | 'RELEASE'
  group: AxisGroupName
  etaSec: number
  reason: string
}

const waveStore = new Map<string, CorridorJunction[]>()
const prevStatus = new Map<string, CorrStatus>()
const events: CorridorEvent[] = []
const EVENT_CAP = 80

/** host publishes the latest wave (usually each frame; read at UI cadence) */
export function publishCorridorWave(unitId: string, wave: CorridorJunction[], t: number): void {
  waveStore.set(unitId, wave)
  for (const j of wave) {
    const key = `${unitId}:${j.id}`
    const prev = prevStatus.get(key)
    if (prev === j.status) continue
    prevStatus.set(key, j.status)
    if (j.status === 'PREPARING') {
      const ev: CorridorEvent = {
        t,
        junctionId: j.id,
        kind: 'PREPARE',
        group: j.group,
        etaSec: j.etaSec,
        reason: `Corridor preparation — ambulance ETA ${j.etaSec.toFixed(1)}s · required ${j.group === 'M' ? 'MAIN' : 'CROSS'} phase`,
      }
      events.push(ev)
      pushDecision({
        t,
        junctionId: j.id,
        group: j.group,
        phase: j.group === 'M' ? 'MG' : 'XG',
        pressure: 0,
        otherPressure: 0,
        queue: 0,
        approaching: 0,
        reason: `CORRIDOR PREPARE — ${j.group === 'M' ? 'MAIN' : 'CROSS'} planned for arrival in ${j.etaSec.toFixed(1)}s`,
      })
    } else if (j.status === 'ACTIVE') {
      const ev: CorridorEvent = {
        t,
        junctionId: j.id,
        kind: 'ACTIVE',
        group: j.group,
        etaSec: 0,
        reason: `${j.group === 'M' ? 'MAIN' : 'CROSS'} phase held — unit entering intersection`,
      }
      events.push(ev)
      pushDecision({
        t,
        junctionId: j.id,
        group: j.group,
        phase: j.group === 'M' ? 'MG' : 'XG',
        pressure: 0,
        otherPressure: 0,
        queue: 0,
        approaching: 0,
        reason: `CORRIDOR ACTIVE — ${j.group === 'M' ? 'MAIN' : 'CROSS'} held for crossing unit`,
      })
    } else if (j.status === 'PASSED' && prev === 'ACTIVE') {
      const ev: CorridorEvent = {
        t,
        junctionId: j.id,
        kind: 'RELEASE',
        group: j.group,
        etaSec: 0,
        reason: `Unit cleared intersection · returning to adaptive optimization`,
      }
      events.push(ev)
      pushDecision({
        t,
        junctionId: j.id,
        group: j.group,
        phase: j.group === 'M' ? 'MG' : 'XG',
        pressure: 0,
        otherPressure: 0,
        queue: 0,
        approaching: 0,
        reason: `CORRIDOR RELEASED — unit cleared · normal control resumed`,
      })
    }
  }
  // drop superseded events for junctions that are long gone / released
  for (const key of [...prevStatus.keys()]) {
    if (!wave.some((j) => `${unitId}:${j.id}` === key)) prevStatus.delete(key)
  }
  if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP)
}

export function corridorWaveFor(unitId: string): readonly CorridorJunction[] {
  return waveStore.get(unitId) ?? []
}

export function corridorEventsLog(): readonly CorridorEvent[] {
  return events
}

export function clearCorridorState(): void {
  waveStore.clear()
  prevStatus.clear()
  events.length = 0
}

/** the junction of any corridor wave that is currently coordinated */
export function corridorJunctionOf(jid: string): { unitId: string; j: CorridorJunction } | null {
  for (const [unitId, wave] of waveStore) {
    const j = wave.find((x) => x.id === jid && x.priority !== 'NONE')
    if (j) return { unitId, j }
  }
  return null
}
