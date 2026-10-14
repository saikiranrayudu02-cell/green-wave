// ---------------------------------------------------------------------------
// GREENWAVE — routing engine
//
// Real Dijkstra over the OSM road graph. Cost is NOT plain distance:
//   cost = length * (1 + congestionScore)
// so live traffic changes the fastest route. Segments at CRITICAL congestion
// (incident closure) are treated as impassable, forcing genuine reroutes.
//
// Distances are real metres from the OSM extract; route polylines follow the
// real multi-point street geometry so the ambulance interpolates smoothly
// around bends rather than teleporting between intersections.
//
// AUTHORITATIVE ETA MODEL (emergency routes)
// ------------------------------------------
// Emergency ETAs (Plan.baselineSec / etaSec) are expressed in APPLICATION
// SIM SECONDS — the same clock the traffic simulation, corridor wave and the
// A/B impact runner all use. The live sim loop advances 1 sim-second per
// wall-clock second (CityMap), so these numbers are also wall seconds and
// directly comparable to the measured A/B legs:
//
//   free-flow time  = route polyline px ÷ ambulance cruise px/s
//                   (the SAME cruise the map, corridor engine and A/B runner
//                    use — engine/App BASE speedOpen, passed into planPair)
//   baseline ETA    = free-flow + expected red holds
//                     (½ × SIGNAL_DELAY_S real seconds ÷ PACE → sim seconds,
//                      per coordinated stop — random-arrival expectation)
//   GreenWave ETA   = free-flow (the corridor holds greens; no red waits)
//
// PACE is the sim's liveliness multiplier (visual pacing only — reported km/h
// has PACE removed); it lives here because the ETA model is its only consumer
// outside engine/vehicles.ts, which imports it (no circular dependency).
// ---------------------------------------------------------------------------
import type { RoadNetwork, RoadSegment, RouteResult } from '../types/traffic'
import { NETWORK, isSignalized, roadById, roadPts } from '../data/osmRoadNetwork'
import type { Pt } from '../utils/geo'
import { pathLen } from '../utils/geo'

/** travel-time model constants (calibrated to real city driving) */
export const URBAN_FACTOR = 0.74 // stop-and-go / turning overhead
export const CONGESTION_SPEED_PENALTY = 0.5 // each congestion point cuts ~half the headroom
export const SIGNAL_DELAY_S = 14 // expected wait at a red signal hold (real seconds)
export const GREENWAVE_BOOST = 1.06 // cleared-corridor progression factor
export const CRITICAL_CLOSE_SCORE = 0.95 // >= this → road treated as closed

/**
 * Sim liveliness multiplier: how much faster than real street speeds the
 * fleet visibly moves (px/s are PACE × real m/s × projection scale). The
 * sim clock itself advances 1:1 with wall time, so sim seconds ARE wall
 * seconds — PACE only converts px/s to real km/h. Defined here as the single
 * time-scale constant (engine/vehicles.ts imports it).
 */
export const PACE = 1.5

/** default ambulance cruise (px/s) when a caller doesn't pass one (em-01) */
export const DEFAULT_AMB_SPEED_PX = 42

/** spacing (m) between coordinated signal stops along a corridor */
export const SIGNAL_STOP_SPACING_M = 150

/** roadId -> effective congestion score (used to inject incidents) */
export type CongestionOverride = Record<string, number>

export function effectiveScore(r: RoadSegment, override?: CongestionOverride): number {
  const o = override?.[r.id]
  return o == null ? r.congestion : Math.min(0.98, Math.max(0, o))
}

interface Edge {
  to: string
  road: RoadSegment
  cost: number
}

function adjacency(network: RoadNetwork, override?: CongestionOverride): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>()
  const push = (a: string, b: string, road: RoadSegment, cost: number) => {
    const arr = adj.get(a) ?? []
    arr.push({ to: b, road, cost })
    adj.set(a, arr)
  }
  for (const r of network.roads) {
    const score = effectiveScore(r, override)
    if (score >= CRITICAL_CLOSE_SCORE) continue // incident closure
    const cost = r.length * (1 + score)
    push(r.from, r.to, r, cost)
    push(r.to, r.from, r, cost)
  }
  return adj
}

interface DijkstraResult {
  route: RouteResult
  cost: number
}

function dijkstra(
  network: RoadNetwork,
  originId: string,
  destinationId: string,
  override?: CongestionOverride,
  blocked?: Set<string>,
): DijkstraResult | null {
  const adj = adjacency(network, override)
  if (originId === destinationId) {
    return {
      route: { roadIds: [], intersectionIds: [originId], totalDistance: 0, estimatedTravelTime: 0 },
      cost: 0,
    }
  }

  const dist = new Map<string, number>([[originId, 0]])
  const prev = new Map<string, { node: string; road: RoadSegment }>()
  const visited = new Set<string>()

  for (;;) {
    let cur: string | null = null
    let best = Infinity
    for (const [n, d] of dist) {
      if (!visited.has(n) && d < best) {
        best = d
        cur = n
      }
    }
    if (cur === null || cur === destinationId) break
    visited.add(cur)
    for (const e of adj.get(cur) ?? []) {
      if (visited.has(e.to)) continue
      if (blocked?.has(e.road.id)) continue
      const nd = best + e.cost
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd)
        prev.set(e.to, { node: cur, road: e.road })
      }
    }
  }
  if (!dist.has(destinationId)) return null

  const intersectionIds: string[] = []
  const roadIds: string[] = []
  let node: string | undefined = destinationId
  while (node && node !== originId) {
    intersectionIds.push(node)
    const p = prev.get(node)
    if (!p) return null
    roadIds.push(p.road.id)
    node = p.node
  }
  intersectionIds.push(originId)
  intersectionIds.reverse()
  roadIds.reverse()

  const totalDistance = roadIds.reduce((s, rid) => s + roadById(rid).length, 0)
  const travelSec = estimateTravelSeconds(roadIds, override, false)
  const junctionIds = decimateStops(intersectionIds)
  const estimatedTravelTime = Math.round(travelSec + SIGNAL_DELAY_S * Math.max(0, junctionIds.length - 1))
  return { route: { roadIds, intersectionIds, totalDistance, estimatedTravelTime }, cost: dist.get(destinationId)! }
}

/**
 * Coordinated signal stops along a route: signalized junctions, clustered
 * when a single physical intersection is duplicated in the raw data and
 * decimated so coordination focuses on the major stops (not every mid-block
 * crossing). Returns ids in travel order.
 */
function decimateStops(intersectionIds: string[]): string[] {
  // cumulative route distance (m) at each junction
  const nodes: { id: string; cum: number }[] = []
  {
    let cum = 0
    for (let i = 0; i < intersectionIds.length; i++) {
      nodes.push({ id: intersectionIds[i], cum })
      if (i < intersectionIds.length - 1) {
        // distance to the next junction is along the road that connects them
        const next = intersectionIds[i + 1]
        let roadLen: number | null = null
        // find the segment — brute force over the few roads at this junction
        for (const r of roadsFrom(intersectionIds[i])) {
          if (r.from === next || r.to === next) {
            roadLen = r.length
            break
          }
        }
        cum += roadLen ?? 0
      }
    }
  }
  const sig = nodes.filter((n) => isSignalized(n.id))
  // merge near-duplicates of one physical intersection (< 40 m apart along the route)
  const merged: { id: string; cum: number }[] = []
  for (const s of sig) {
    const last = merged[merged.length - 1]
    if (last && s.cum - last.cum < 40) continue
    merged.push(s)
  }
  const out: string[] = []
  let lastCum = -Infinity
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i]
    const keepFirst = i === 0
    const spaced = s.cum - lastCum >= SIGNAL_STOP_SPACING_M
    const forceLast = i === merged.length - 1
    if (keepFirst || spaced || forceLast) {
      out.push(s.id)
      lastCum = s.cum
    }
  }
  return out
}

function roadsFrom(junctionId: string): RoadSegment[] {
  // cheap index of roads by endpoint (the graph is small; fine to filter)
  return ROAD_INDEX.get(junctionId) ?? []
}

/* tiny static index over the module-level network */
const ROAD_INDEX = new Map<string, RoadSegment[]>()
for (const r of NETWORK.roads) {
  const a = ROAD_INDEX.get(r.from) ?? []
  a.push(r)
  ROAD_INDEX.set(r.from, a)
  const b = ROAD_INDEX.get(r.to) ?? []
  b.push(r)
  ROAD_INDEX.set(r.to, b)
}

/** seconds to traverse the given road sequence at congested (baseline) speeds */
export function estimateTravelSeconds(
  roadIds: string[],
  override?: CongestionOverride,
  greenwave = false,
): number {
  let t = 0
  for (const rid of roadIds) {
    const road = roadById(rid)
    const c = effectiveScore(road, override)
    const vlim = road.speedLimit / 3.6
    const v = greenwave ? vlim * GREENWAVE_BOOST : vlim * URBAN_FACTOR * (1 - CONGESTION_SPEED_PENALTY * c)
    t += road.length / v
  }
  return t
}

export function findFastestRoute(
  network: RoadNetwork,
  originId: string,
  destinationId: string,
  override?: CongestionOverride,
): RouteResult | null {
  return dijkstra(network, originId, destinationId, override)?.route ?? null
}

/**
 * Second-best path: drop one road of the fastest route at a time, re-run the
 * search, and keep the cheapest genuinely-different result. Small graph, so
 * the brute force is trivially cheap.
 */
export function findAlternativeRoute(
  network: RoadNetwork,
  originId: string,
  destinationId: string,
  fastest: RouteResult,
  override?: CongestionOverride,
): RouteResult | null {
  let best: DijkstraResult | null = null
  for (const removed of fastest.roadIds) {
    const r = dijkstra(network, originId, destinationId, override, new Set([removed]))
    if (!r) continue
    if (r.route.intersectionIds.join(',') === fastest.intersectionIds.join(',')) continue
    if (!best || r.cost < best.cost) best = r
  }
  return best?.route ?? null
}

/* --------------------------- enriched plan for UI ------------------------ */

export interface Plan {
  /** stable id — road sequence joined; changes when traffic reroutes */
  key: string
  roadIds: string[]
  intersectionIds: string[]
  /** coordinated signal stops on the route, in travel order */
  junctionIds: string[]
  /** polyline geometry (canvas units, follows real street geometry) */
  pts: Pt[]
  totalDistance: number
  distanceKm: number
  /** baseline (fixed-timing) ETA in application sim seconds — free-flow cruise
   *  + expected red holds per coordinated stop (½ × SIGNAL_DELAY_S ÷ PACE).
   *  Same clock/scale as the A/B runner's measured travel time. */
  baselineSec: number
  /** green-corridor ETA in application sim seconds — free-flow cruise only
   *  (the corridor holds greens; no red waits). */
  etaSec: number
  savedSec: number
  congestionAvg: number
}

function toPlan(route: RouteResult, override: CongestionOverride | undefined, speedPx: number): Plan {
  const pts: Pt[] = []
  route.roadIds.forEach((rid, k) => {
    const rp = roadPts(roadById(rid))
    if (k > 0) rp.shift() // drop the duplicated junction node
    pts.push(...rp)
  })
  const junctionIds = decimateStops(route.intersectionIds)
  /* authoritative ETA — the sim's own ambulance physics, in sim seconds:
     free-flow cruise over the real geometry + expected red holds. This is the
     same cruise px/s and the same clock the live map, corridor wave and A/B
     runner use, so the numbers agree across every panel.

     Expected red hold per stop = P(arrive on red) × mean red wait ≈ ½ × 14 s
     real (a random arrival hits the other group's green ~half the time and
     waits ~half the hold) → ÷ PACE → sim seconds. This centers the estimate
     on the measured A/B waits (~4–9 s/stop depending on phase alignment)
     rather than assuming every stop is red. */
  const freeFlowSec = pathLen(pts) / Math.max(0.001, speedPx)
  const signalDelaySec = ((SIGNAL_DELAY_S / 2) / PACE) * Math.max(0, junctionIds.length - 1)
  const baselineSec = Math.round(freeFlowSec + signalDelaySec)
  const etaSec = Math.round(freeFlowSec)
  let csum = 0
  for (const rid of route.roadIds) csum += effectiveScore(roadById(rid), override)
  return {
    key: route.roadIds.join('>'),
    roadIds: route.roadIds,
    intersectionIds: route.intersectionIds,
    junctionIds,
    pts,
    totalDistance: route.totalDistance,
    distanceKm: Math.round(route.totalDistance) / 1000,
    baselineSec,
    etaSec,
    savedSec: Math.max(0, baselineSec - etaSec),
    congestionAvg: route.roadIds.length ? csum / route.roadIds.length : 0,
  }
}

/** fastest plan + its graph-computed alternative for the same origin/dest.
 *  `speedPx` is the ambulance cruise (px/s) used for the ETA — pass the same
 *  value the live map / A/B runner use (App BASE speedOpen). */
export function planPair(
  network: RoadNetwork,
  originId: string,
  destinationId: string,
  override?: CongestionOverride,
  speedPx = DEFAULT_AMB_SPEED_PX,
): { plan: Plan; alt: Plan | null } | null {
  const fastest = findFastestRoute(network, originId, destinationId, override)
  if (!fastest) return null
  const plan = toPlan(fastest, override, speedPx)
  const altRoute = findAlternativeRoute(network, originId, destinationId, fastest, override)
  const alt = altRoute ? toPlan(altRoute, override, speedPx) : null
  return { plan, alt }
}
