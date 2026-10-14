// ---------------------------------------------------------------------------
// GREENWAVE — live traffic simulation engine
//
// Step 3: a continuously running trip-based civilian fleet on the real OSM
// road graph. Every agent is born from the spawner, gets a real origin →
// destination pair routed by the same Dijkstra planner the emergency system
// uses, drives along the actual multi-point street geometry, obeys signals
// and queues behind other vehicles, and finally reaches its destination and
// leaves the network — counted as throughput. Nothing teleports, nothing is
// hardcoded: the dashboard metrics (active vehicles, average speed, wait,
// queue length, throughput, congestion) are all derived from this state.
//
//   • spawner      – deterministic seeded generator, 1–3 vehicles every few
//                    seconds, kind mix ~ car 70% / taxi 10% / truck 10% /
//                    bus 10%, capped so the district stays readable;
//   • movement     – per-road posted speed × class × congestion, gradual
//                    accel/decel, red → brake to the stop line + queue,
//                    yellow → stop unless close enough to clear, green → go;
//   • car-following– each agent keeps a safe gap behind the vehicle ahead in
//                    the same lane (same road, same direction), so queues
//                    build and drain naturally and nobody overlaps;
//   • congestion   – recomputed from actual agents every second
//                    (density + stopped share), smoothed, feeds both the map
//                    layer and the spawner's route costs;
//   • metrics      – active count, avg speed (model km/h), avg wait,
//                    queue length at signals, throughput rate, network load,
//                    plus a rolling history for the live chart.
//
// The host (CityMap) owns the signal controllers; this engine only reads
// light states via `stateOf(junctionId, group)`. resetTraffic(seed) replays
// the demo deterministically.
// ---------------------------------------------------------------------------
import {
  NETWORK,
  roadById,
  roadPts,
  DISPLAY_SIGNAL_IDS,
  travelGroupFor,
  projectionS,
  jPt,
} from '../data/osmRoadNetwork'
import type { AxisGroupName } from '../data/osmRoadNetwork'
import { findFastestRoute, PACE } from './routePlanner'
import type { CongestionOverride } from './routePlanner'
import type { Pt } from '../utils/geo'
import { pathLen } from '../utils/geo'

export type VehicleKind = 'sedan' | 'taxi' | 'truck' | 'bus'
export type LightState = 'G' | 'Y' | 'R'
export type VehicleStatus = 'MOVING' | 'SLOWING' | 'STOPPED' | 'QUEUED' | 'ARRIVED'

/* ----------------------------- tuning ------------------------------------ */
/** where a vehicle must be fully stopped, before a junction centre (px) */
export const STOP_OFFSET_PX = 12
/** yellow: close enough to clear rather than stop (px) */
const YELLOW_CLEAR_PX = 40
/** comfortable deceleration (px/s^2) — tuned so a full stop from ~8 px/s
 * takes ~35 px of visible braking */
const BRAKE_DECEL_PX = 1.0
/** following: react within this gap; full stop below MIN_GAP */
const FOLLOW_FRONT_PX = 150
const MIN_GAP_PX = 9
const FULL_GAP_PX = 34
const CLASS_FACTOR: Record<string, number> = {
  primary: 1.0,
  secondary: 0.9,
  tertiary: 0.85,
  unclassified: 0.8,
  residential: 0.75,
}
const KIND_FACTOR: Record<VehicleKind, number> = {
  sedan: 1,
  taxi: 1,
  truck: 0.78,
  bus: 0.72,
}

const ROAD_W: Record<string, number> = {
  primary: 27,
  secondary: 21,
  tertiary: 16,
  unclassified: 11,
  residential: 10,
}

/* ----------------------------- spawn tuning ------------------------------ */
const SPAWN_SEED = 20240612
/** warm-up fleet so the map is alive from the first frame (all mid-trip) */
const WARMUP_COUNT = 50
const MAX_ACTIVE = 62
/** shortest trip worth animating (m) */
const MIN_TRIP_M = 380
const SPAWN_MIN_S = 2.6
const SPAWN_MAX_S = 4.6
/** how long an arrived vehicle lingers (fade-out) before leaving the network */
const ARRIVE_DWELL_S = 0.55
/** history length for the live chart (samples ≈ seconds) */
const HISTORY_LEN = 60

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ----------------------------- model ------------------------------------- */
/** one road of a trip: geometry + where it starts/ends along the trip */
export interface Leg {
  roadId: string
  dir: 1 | -1
  pts: Pt[]
  len: number
  /** trip distance where this leg starts / ends (px) */
  startD: number
  endD: number
  /** displayed signal junction at the far end (null = free passage) */
  endJunction: string | null
  /** MAIN/CROSS group of the approach travelling this leg */
  group: AxisGroupName
  /** free-flow cruise for this leg (px/s), kind + jitter already baked */
  cruiseBase: number
  roadType: string
  width: number
}

export interface VehicleAgent {
  id: number
  kind: VehicleKind
  tint: number
  /** concatenated trip geometry (real street bends preserved) */
  legs: Leg[]
  len: number
  /** distance travelled along the trip (px) */
  d: number
  /** current leg index (derived each tick) */
  legI: number
  v: number
  /** current leg cruise after congestion (for render dimming / speed factor) */
  cruise: number
  waitTime: number
  travelTime: number
  /** seconds since spawn (fade-in ramp) */
  ageT: number
  /** > 0 while fading out at the destination (ARRIVED) */
  leaving: number
  status: VehicleStatus
}

interface Trip {
  legs: Leg[]
  len: number
}

/* ----------------------------- store ------------------------------------- */
const AGENTS: VehicleAgent[] = []
const demandMap = new Map<string, { M: number; X: number }>()
/** optimizer observations per signalised junction (rebuilt every tick) */
const obsMap = new Map<string, { M: GroupObs; X: GroupObs }>()

/* ----------------------- optimizer observations --------------------------- */
/** how far upstream of a stop line a vehicle counts as "approaching" (px) */
const APPROACH_PX = 260

export interface GroupObs {
  /** vehicles at rest on this approach */
  queue: number
  /** vehicles within the approach zone (moving or queued) */
  approaching: number
  /** mean waiting time of queued vehicles (s) */
  waitAvg: number
  /** internal sums (used by the engine, read by the optimizer) */
  waitSum: number
  waitCount: number
}

export interface JunctionObs {
  M: GroupObs
  X: GroupObs
}

function blankObs(): { M: GroupObs; X: GroupObs } {
  return {
    M: { queue: 0, approaching: 0, waitAvg: 0, waitSum: 0, waitCount: 0 },
    X: { queue: 0, approaching: 0, waitAvg: 0, waitSum: 0, waitCount: 0 },
  }
}
/** roadId → smoothed congestion score (0..1), recomputed every second */
const congestion = new Map<string, number>()
/** rolling history of throughput rate (veh/hr) for the live chart */
const history: number[] = []
/** sim-clock completion stamps for the rolling throughput window */
const completions: number[] = []

let simT = 0
let throughput = 0
let spawnAcc = 0
let nextSpawnIn = 2.4
let conAcc = 0
let idSeq = 1
let rand = mulberry(SPAWN_SEED)

const DISPLAY_SET = new Set(DISPLAY_SIGNAL_IDS)

/** nearest displayed signal within ~30 px (duplicate paired nodes) */
function resolveSignal(nodeId: string): string | null {
  if (DISPLAY_SET.has(nodeId)) return nodeId
  const p = jPt(nodeId)
  let best: string | null = null
  let bd = 30
  for (const id of DISPLAY_SIGNAL_IDS) {
    const q = jPt(id)
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bd) {
      bd = d
      best = id
    }
  }
  return best
}

/* ----------------------------- trips ------------------------------------- */
function buildTrip(
  originId: string,
  destinationId: string,
  override: CongestionOverride | undefined,
): Trip | null {
  const route = findFastestRoute(NETWORK, originId, destinationId, override)
  if (!route || route.roadIds.length === 0) return null
  if (route.totalDistance < MIN_TRIP_M) return null
  const legs: Leg[] = []
  let startD = 0
  for (let k = 0; k < route.roadIds.length; k++) {
    const rid = route.roadIds[k]
    const road = roadById(rid)
    let pts = roadPts(road)
    // drop the duplicated junction node shared with the previous road
    if (k > 0 && pts.length > 1) pts = pts.slice(1)
    if (pts.length < 2) continue
    const len = pathLen(pts)
    if (len < 8) continue
    const dir: 1 | -1 = road.from === route.intersectionIds[k] ? 1 : -1
    const endId = route.intersectionIds[k + 1]
    const endJunction = resolveSignal(endId)
    let group: AxisGroupName = 'M'
    if (endJunction) {
      const p0 = pts[pts.length - 1]
      const p1 = pts[pts.length - 2]
      const dx = p0.x - p1.x
      const dy = p0.y - p1.y
      const m = Math.hypot(dx, dy) || 1
      group = travelGroupFor(endJunction, dx / m, dy / m)
    }
    const kmh = road.speedLimit || 40
    const cruiseBase =
      (kmh / 3.6) * projectionS * PACE * (CLASS_FACTOR[road.roadType] ?? 0.85)
    legs.push({
      roadId: rid,
      dir,
      pts,
      len,
      startD,
      endD: startD + len,
      endJunction,
      group,
      cruiseBase,
      roadType: road.roadType,
      width: ROAD_W[road.roadType] ?? 12,
    })
    startD += len
  }
  if (legs.length === 0 || startD < 40) return null
  return { legs, len: startD }
}

/** route costs for new trips — live congestion so spawns avoid jammed roads */
function liveOverride(): CongestionOverride {
  const out: CongestionOverride = {}
  for (const [rid, score] of congestion) out[rid] = score
  return out
}

function spawnVehicle(warmup: boolean): void {
  for (let attempt = 0; attempt < 6; attempt++) {
    const o = NETWORK.intersections[Math.floor(rand() * NETWORK.intersections.length)]
    const dest =
      NETWORK.intersections[Math.floor(rand() * NETWORK.intersections.length)]
    if (!o || !dest || o.id === dest.id) continue
    const trip = buildTrip(o.id, dest.id, warmup ? undefined : liveOverride())
    if (!trip) continue

    const r = rand()
    const kind: VehicleKind = r < 0.7 ? 'sedan' : r < 0.8 ? 'taxi' : r < 0.9 ? 'truck' : 'bus'
    const jitter = 0.92 + rand() * 0.23
    const kindF = KIND_FACTOR[kind] * jitter
    for (const leg of trip.legs) leg.cruiseBase *= kindF

    const d = warmup ? rand() * trip.len * 0.84 : 6 + rand() * 10
    let legI = 0
    while (legI < trip.legs.length - 1 && d >= trip.legs[legI].endD) legI++
    const a: VehicleAgent = {
      id: idSeq++,
      kind,
      tint: Math.floor(rand() * 3),
      legs: trip.legs,
      len: trip.len,
      d,
      legI,
      v: warmup ? trip.legs[legI].cruiseBase * 0.75 : 0,
      cruise: trip.legs[legI].cruiseBase,
      waitTime: 0,
      travelTime: 0,
      ageT: warmup ? 999 : 0,
      leaving: 0,
      status: 'MOVING',
    }
    AGENTS.push(a)
    return
  }
}

/* ----------------------------- tick -------------------------------------- */
/** distance to the vehicle ahead in the same lane (same road, same dir) */
function leaderGap(
  info: { a: VehicleAgent; leg: Leg; legP: number }[],
  i: number,
): number {
  const { a, leg, legP } = info[i]
  let best = Infinity
  for (let j = 0; j < info.length; j++) {
    const b = info[j]
    if (b.a.id === a.id || b.a.status === 'ARRIVED') continue
    if (b.leg.roadId !== leg.roadId || b.leg.dir !== leg.dir) continue
    const gap = b.legP - legP
    if (gap > 1 && gap < best) best = gap
  }
  return best
}

function advanceAgent(
  info: { a: VehicleAgent; leg: Leg; legP: number }[],
  i: number,
  dt: number,
  stateOf: (j: string, g: AxisGroupName) => LightState,
  incidentJunctionId: string | null,
): void {
  const { a, leg } = info[i]
  if (a.status === 'ARRIVED') return

  // live congestion slows the stream on busy roads
  const cong = congestion.get(leg.roadId) ?? 0
  const cruise = leg.cruiseBase * (1 - 0.3 * cong)
  a.cruise = cruise

  // car following — keep a safe gap behind the vehicle ahead
  const gap = leaderGap(info, i)
  let vLim = cruise
  if (gap < FOLLOW_FRONT_PX) {
    vLim =
      gap <= MIN_GAP_PX
        ? 0
        : cruise * Math.min(1, (gap - MIN_GAP_PX) / (FULL_GAP_PX - MIN_GAP_PX))
  }

  // only the front-most vehicle of a lane consults the signal
  if (gap >= FOLLOW_FRONT_PX && leg.endJunction) {
    const light =
      incidentJunctionId === leg.endJunction
        ? ('R' as LightState)
        : stateOf(leg.endJunction, leg.group)
    const stopLine = leg.endD - STOP_OFFSET_PX
    const stopDist = stopLine - a.d
    if (light === 'R' && stopDist > 0.5) {
      vLim = Math.min(vLim, Math.sqrt(2 * BRAKE_DECEL_PX * Math.max(0, stopDist)))
      if (stopDist < 2.5) {
        vLim = 0
        if (a.d > stopLine) a.d = stopLine
      }
    } else if (light === 'Y' && stopDist > YELLOW_CLEAR_PX) {
      vLim = Math.min(vLim, Math.sqrt(2 * BRAKE_DECEL_PX * Math.max(0, stopDist)))
    }
  }

  a.v += (vLim - a.v) * Math.min(1, dt * 3.2)
  if (vLim === 0 && a.v < 0.04) a.v = 0
  a.d += a.v * dt
  a.travelTime += dt
  if (a.v < 0.18) a.waitTime += dt
  a.ageT += dt

  a.status =
    a.v < 0.2
      ? gap < FOLLOW_FRONT_PX
        ? 'QUEUED'
        : 'STOPPED'
      : a.v < cruise * 0.65
        ? 'SLOWING'
        : 'MOVING'

  // cross legs as the vehicle passes junctions (never teleports)
  while (a.legI < a.legs.length - 1 && a.d >= a.legs[a.legI].endD - 0.01) a.legI++
  if (a.d >= a.len) {
    a.d = a.len
    a.status = 'ARRIVED'
    a.leaving = ARRIVE_DWELL_S
    a.v = 0
  }
}

/* -------------------------- congestion + metrics -------------------------- */
function updateCongestion(): void {
  for (const road of NETWORK.roads) {
    const pts = roadPts(road)
    const lenPx = pathLen(pts)
    if (lenPx < 20) continue
    let count = 0
    let stopped = 0
    for (const a of AGENTS) {
      if (a.status === 'ARRIVED') continue
      const leg = a.legs[a.legI]
      if (leg && leg.roadId === road.id) {
        count++
        if (a.v < 0.2) stopped++
      }
    }
    // explainable model: density share + stopped share
    const densityF = Math.min(1, count / Math.max(1, lenPx / 380))
    const stoppedF = count > 0 ? stopped / count : 0
    const score = Math.min(0.97, 0.25 * densityF + 0.75 * stoppedF)
    const prev = congestion.get(road.id) ?? road.congestion
    congestion.set(road.id, prev + (score - prev) * 0.35)
  }
}

export interface SimMetrics {
  active: number
  /** mean of active vehicle model speeds (km/h, PACE removed) */
  avgSpeedKmh: number
  /** mean waiting time of active vehicles (s) */
  avgWaitSec: number
  /** cumulative vehicles that completed their route and left the network */
  throughput: number
  /** rolling completion rate scaled to veh/hour (real, windowed 60 s) */
  ratePerHour: number
  /** average physical queue length at signalised approaches (m) */
  queueM: number
  /** vehicles currently stopped (at rest) */
  queuedCount: number
  /** mean network congestion score 0..100 */
  loadPct: number
}

let metricsCache: SimMetrics = {
  active: 0,
  avgSpeedKmh: 0,
  avgWaitSec: 0,
  throughput: 0,
  ratePerHour: 0,
  queueM: 0,
  queuedCount: 0,
  loadPct: 0,
}

function updateMetrics(): void {
  let active = 0
  let vSum = 0
  let wSum = 0
  let queued = 0
  const qByJ = new Map<string, number>()
  for (const a of AGENTS) {
    if (a.status === 'ARRIVED') continue
    active++
    vSum += a.v
    wSum += a.waitTime
    if (a.v < 0.2) queued++
    // physical queue length at the signal ahead of this stopped vehicle
    if (a.v >= 0.2) continue
    const leg = a.legs[a.legI]
    if (!leg || !leg.endJunction) continue
    const g = Math.max(0, leg.endD - STOP_OFFSET_PX - a.d)
    if (g < 150 && leg.endD - a.d < 170) {
      const prev = qByJ.get(leg.endJunction) ?? 0
      if (g > prev) qByJ.set(leg.endJunction, g)
    }
  }
  let queuePx = 0
  if (qByJ.size > 0) {
    for (const v of qByJ.values()) queuePx += v
    queuePx /= qByJ.size
  }
  const now = simT
  let rate = 0
  for (const t of completions) if (t > now - 60) rate++
  let load = 0
  for (const v of congestion.values()) load += v
  load = congestion.size ? load / congestion.size : 0
  metricsCache = {
    active,
    avgSpeedKmh: active ? (vSum / active) / projectionS / PACE * 3.6 : 0,
    avgWaitSec: active ? wSum / active : 0,
    throughput,
    ratePerHour: Math.round(rate * 60),
    queueM: queuePx / projectionS,
    queuedCount: queued,
    loadPct: load * 100,
  }
  history.push(metricsCache.ratePerHour)
  if (history.length > HISTORY_LEN) history.shift()
}

/* ----------------------------- public API -------------------------------- */
/**
 * Advance the whole simulation by dt sim seconds. `stateOf` resolves the
 * current light for a (junction, group); the caller owns the controllers.
 */
export function trafficTick(
  dt: number,
  stateOf: (j: string, g: AxisGroupName) => LightState,
  incidentJunctionId: string | null,
): void {
  simT += dt

  /* spawner — continuous deterministic entry into the network */
  spawnAcc += dt
  if (spawnAcc >= nextSpawnIn && AGENTS.length < MAX_ACTIVE) {
    spawnAcc = 0
    nextSpawnIn = SPAWN_MIN_S + rand() * (SPAWN_MAX_S - SPAWN_MIN_S)
    const n = 1 + (rand() < 0.6 ? 1 : 0) + (rand() < 0.12 ? 1 : 0)
    for (let k = 0; k < n; k++) spawnVehicle(false)
  }

  /* per-agent current leg (one pass, used for following + movement) */
  const info: { a: VehicleAgent; leg: Leg; legP: number }[] = []
  for (const a of AGENTS) {
    if (a.status !== 'ARRIVED') {
      while (a.legI < a.legs.length - 1 && a.d >= a.legs[a.legI].endD - 0.01) a.legI++
    }
    const leg = a.legs[Math.min(a.legI, a.legs.length - 1)]
    info.push({ a, leg, legP: a.d - leg.startD })
  }
  for (let i = 0; i < info.length; i++) advanceAgent(info, i, dt, stateOf, incidentJunctionId)

  /* arrivals leave the network — real throughput */
  for (let i = AGENTS.length - 1; i >= 0; i--) {
    const a = AGENTS[i]
    if (a.status !== 'ARRIVED') continue
    a.leaving -= dt
    if (a.leaving <= 0) {
      AGENTS.splice(i, 1)
      throughput++
      completions.push(simT)
    }
  }

  /* queued demand + optimizer observations per signalised junction */
  demandMap.clear()
  obsMap.clear()
  for (const a of AGENTS) {
    if (a.status === 'ARRIVED') continue
    const leg = a.legs[a.legI]
    const jid = leg?.endJunction
    if (!leg || !jid) continue
    if (a.v <= 1.1) {
      const d = demandMap.get(jid) ?? { M: 0, X: 0 }
      d[leg.group]++
      demandMap.set(jid, d)
    }
    let o = obsMap.get(jid)
    if (!o) {
      o = blankObs()
      obsMap.set(jid, o)
    }
    const g = o[leg.group]
    const stopDist = leg.endD - STOP_OFFSET_PX - a.d
    if (stopDist < APPROACH_PX && stopDist > -40) g.approaching++
    if (a.v < 0.5 && stopDist < APPROACH_PX) {
      g.queue++
      g.waitSum += a.waitTime
      g.waitCount++
    }
  }
  for (const o of obsMap.values()) {
    o.M.waitAvg = o.M.waitCount ? o.M.waitSum / o.M.waitCount : 0
    o.X.waitAvg = o.X.waitCount ? o.X.waitSum / o.X.waitCount : 0
  }

  /* congestion + metrics + chart history at 1 Hz */
  conAcc += dt
  if (conAcc >= 1) {
    conAcc -= 1
    updateCongestion()
    updateMetrics()
  }
}

/** deterministic re-seed: identical fleet, signals replay, metrics zeroed */
export function resetTraffic(seed: number, t: number): void {
  AGENTS.length = 0
  demandMap.clear()
  obsMap.clear()
  congestion.clear()
  idSeq = 1
  for (const road of NETWORK.roads) congestion.set(road.id, road.congestion)
  history.length = 0
  completions.length = 0
  throughput = 0
  simT = t
  spawnAcc = 0
  nextSpawnIn = 2.4
  conAcc = 0
  rand = mulberry(seed)
  for (let i = 0; i < WARMUP_COUNT; i++) spawnVehicle(true)
  updateMetrics()
}

/** per-junction waiting demand measured during the last tick */
export function trafficDemand(): ReadonlyMap<string, { M: number; X: number }> {
  return demandMap
}

/** per-junction optimizer observations (queues, approaches, waits) */
export function trafficObservations(): ReadonlyMap<string, JunctionObs> {
  return obsMap
}

/** current live agents (read-only for rendering) */
export function trafficAgents(): readonly VehicleAgent[] {
  return AGENTS
}

/** smoothed live congestion per road segment (0..1) */
export function trafficCongestion(): ReadonlyMap<string, number> {
  return congestion
}

/** current simulation metrics (computed from actual agent state) */
/** current simulation clock in sim seconds (drives operational snapshots) */
export function trafficSimT(): number {
  return simT
}

export function trafficMetrics(): SimMetrics {
  return metricsCache
}

/** rolling throughput-rate history for the live chart */
export function trafficHistory(): readonly number[] {
  return history
}

/** geometry + progress of the agent's current leg, for map rendering */
export function agentGeom(
  a: VehicleAgent,
): { pts: Pt[]; dir: 1 | -1; s: number; width: number; roadType: string } | null {
  const leg = a.legs[Math.min(a.legI, a.legs.length - 1)]
  if (!leg) return null
  return {
    pts: leg.pts,
    dir: leg.dir,
    s: Math.max(0, Math.min(leg.len, a.d - leg.startD)),
    width: leg.width,
    roadType: leg.roadType,
  }
}