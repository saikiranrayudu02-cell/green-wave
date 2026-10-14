// ---------------------------------------------------------------------------
// GREENWAVE — OSM road network (Phase 2B)
//
// Loads the locally-processed OpenStreetMap extract (src/data/osm/network.json)
// and exposes it two ways:
//   • NETWORK            — the typed graph (intersections + road segments) in
//                          geographic coordinates, exactly as the planner sees it
//   • projected helpers  — canvas-space geometry for the command-center map
//                          (uniform fit projection, see src/utils/geo.ts)
// Nothing here touches a live map API; the extract is static and offline-safe.
// ---------------------------------------------------------------------------
import type {
  CongestionLevel,
  Intersection,
  RoadNetwork,
  RoadSegment,
  ScenePolygon,
} from '../types/traffic'
import { fitProjection, haversineM } from '../utils/geo'
import type { Geo, Projection, Pt } from '../utils/geo'
import rawJson from './osm/network.json'

export const VW = 1040
export const VH = 760

/* ------------------------------ raw shape -------------------------------- */
interface RawMeta {
  source: string
  area: string
  hospital: { label: string; entrance: string }
  originEm1: { id: string; label: string }
  originEm2: { id: string; label: string } | null
  incident: { junctionId: string; name?: string } | null
  junctionCount: number
  roadCount: number
  signalizedCount: number
}
interface RawNode {
  id: string
  name?: string
  lat: number
  lng: number
  signalized: boolean
}
interface RawRoad {
  id: string
  from: string
  to: string
  name?: string
  roadType: string
  speedLimit: number
  lanes: number
  length: number
  congestion: number
  coordinates: [number, number][]
}
interface RawScene {
  kind: 'park' | 'water' | 'campus'
  name?: string
  ring: [number, number][]
  centroid?: [number, number]
}
interface RawFile {
  meta: RawMeta
  intersections: RawNode[]
  roads: RawRoad[]
  scenery?: RawScene[]
}
const raw = rawJson as unknown as RawFile

/* ------------------------------ typed graph ------------------------------ */
export const NETWORK: RoadNetwork = {
  intersections: raw.intersections as Intersection[],
  roads: raw.roads as RoadSegment[],
}

const interMap = new Map(NETWORK.intersections.map((i) => [i.id, i]))
const roadMap = new Map(NETWORK.roads.map((r) => [r.id, r]))

export function intersectionById(id: string): Intersection {
  const it = interMap.get(id)
  if (!it) throw new Error(`unknown intersection ${id}`)
  return it
}
export function roadById(id: string): RoadSegment {
  const r = roadMap.get(id)
  if (!r) throw new Error(`unknown road ${id}`)
  return r
}

/* ------------------------------ projection ------------------------------- */
const fitPts: Geo[] = NETWORK.intersections.map((i) => [i.lat, i.lng])
const proj: Projection = fitProjection(fitPts, VW, VH)

export const projectionS = proj.s // canvas units per metre

export function project(p: Geo): Pt {
  return proj.to(p)
}

/** canvas position of a graph intersection */
export function jPt(id: string): Pt {
  const j = intersectionById(id)
  return proj.to([j.lat, j.lng])
}

/** canvas polyline of a road segment (bends included) */
export function roadPts(r: RoadSegment): Pt[] {
  return r.coordinates.map((c) => proj.to(c))
}

export function isSignalized(id: string): boolean {
  return intersectionById(id).signalized
}

/** short display label for a junction, e.g. "Cambridge St" or the code */
export function jShortName(id: string): string {
  const j = intersectionById(id)
  if (!j.name) return id
  const first = j.name.split(' / ')[0]
  return first.replace(/ Street$/, ' St').replace(/ Avenue$/, ' Ave').replace(/ Road$/, ' Rd')
}

/* ------------------------------ congestion ------------------------------- */
export function congestionLevel(score: number): CongestionLevel {
  if (score >= 0.75) return 'CRITICAL'
  if (score >= 0.55) return 'HEAVY'
  if (score >= 0.3) return 'MODERATE'
  return 'NORMAL'
}

/** roads touching a junction (used by incident closures) */
export function roadsAt(junctionId: string): RoadSegment[] {
  return NETWORK.roads.filter((r) => r.from === junctionId || r.to === junctionId)
}

/* ------------------------------ demo anchors ----------------------------- */
export const ENTRANCE_ID = raw.meta.hospital.entrance
export const ORIGIN_EM1_ID = raw.meta.originEm1.id
export const ORIGIN_EM2_ID = raw.meta.originEm2?.id ?? null
export const INCIDENT_JUNCTION = raw.meta.incident?.junctionId ?? null
export const HOSPITAL_LABEL = raw.meta.hospital.label
export const ORIGIN_EM1_LABEL = raw.meta.originEm1.label
export const ORIGIN_EM2_LABEL = raw.meta.originEm2?.label ?? 'EMS Support Base'
export const AREA_LABEL = raw.meta.area
export const OSM_ATTRIBUTION = raw.meta.source

/** destination = hospital entrance gate junction */
export const DESTINATION = {
  id: ENTRANCE_ID,
  pt: jPt(ENTRANCE_ID),
  label: HOSPITAL_LABEL,
  short: 'MASS GENERAL',
}

export const ORIGINS = [
  { id: ORIGIN_EM1_ID, pt: jPt(ORIGIN_EM1_ID), label: ORIGIN_EM1_LABEL, short: 'DISPATCH A' },
  ...(ORIGIN_EM2_ID ? [{ id: ORIGIN_EM2_ID, pt: jPt(ORIGIN_EM2_ID), label: ORIGIN_EM2_LABEL, short: 'DISPATCH B' }] : []),
]

/* -------------------- signal display + street axis ----------------------- */
/*
 * A single physical intersection is often two signalized OSM nodes only
 * metres apart (one per carriageway). DISPLAY_SIGNAL_IDS keeps one head per
 * intersection so rendered signals never overlap. The per-junction *axis* is
 * the direction of the dominant through street — civilian agents and the
 * ambulance are classified MAIN vs CROSS from the acute angle between their
 * approach direction and that axis, which decides which signal group they
 * obey.
 */
const _sigKept: string[] = []
{
  const sorted = NETWORK.intersections
    .filter((i) => i.signalized)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const it of sorted) {
    if (
      _sigKept.some((id) => {
        const k = intersectionById(id)
        return haversineM([k.lat, k.lng], [it.lat, it.lng]) < 42
      })
    ) {
      continue
    }
    _sigKept.push(it.id)
  }
}

export const DISPLAY_SIGNAL_IDS: string[] = _sigKept

export type AxisGroupName = 'M' | 'X'

const _AXIS = new Map<string, number>()
const _AXIS_ROAD = new Map<string, string>()
{
  const RANK: Record<string, number> = {
    primary: 0,
    secondary: 1,
    tertiary: 2,
    unclassified: 3,
    residential: 4,
  }
  for (const jId of DISPLAY_SIGNAL_IDS) {
    let best: { r: RoadSegment; key: number } | null = null
    for (const r of roadsAt(jId)) {
      if (r.length < 28) continue
      const cw = RANK[r.roadType] ?? 9
      const key = cw * 1e6 - r.length // class first, then length
      if (!best || key < best.key) best = { r, key }
    }
    if (!best) continue
    const r = best.r
    const pts = roadPts(r)
    let dx: number
    let dy: number
    if (r.to === jId && pts.length > 1) {
      // leaving toward the from node → travel up the polyline reversed
      dx = pts[pts.length - 2].x - pts[pts.length - 1].x
      dy = pts[pts.length - 2].y - pts[pts.length - 1].y
    } else if (pts.length > 1) {
      dx = pts[1].x - pts[0].x
      dy = pts[1].y - pts[0].y
    } else {
      continue
    }
    const m = Math.hypot(dx, dy) || 1
    _AXIS.set(jId, Math.atan2(dy / m, dx / m))
    _AXIS_ROAD.set(jId, best.r.id)
  }
}

function _wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/**
 * MAIN vs CROSS for a vehicle travelling with unit direction (dx, dy) into a
 * junction. The axis is treated as a line (both directions), so a vehicle
 * heading the other way down the same street is still MAIN.
 */
export function travelGroupFor(junctionId: string, dx: number, dy: number): AxisGroupName {
  const axis = _AXIS.get(junctionId)
  if (axis == null) return 'M'
  const travel = Math.atan2(dy, dx)
  let d = Math.abs(_wrapAngle(travel - axis))
  if (d > Math.PI / 2) d = Math.PI - d
  return d <= (Math.PI * 50) / 180 ? 'M' : 'X'
}

/** angle (radians) of the dominant street axis at a junction */
export function signalAxisAngle(junctionId: string): number | null {
  return _AXIS.get(junctionId) ?? null
}

/** short street name of the dominant through road at a junction */
export function axisRoadLabel(junctionId: string): string {
  const rid = _AXIS_ROAD.get(junctionId)
  const r = rid ? roadMap.get(rid) : undefined
  const name = r?.name
  if (!name) return 'MAIN STREET'
  return name
    .toUpperCase()
    .replace(/ STREET$/, ' ST')
    .replace(/ AVENUE$/, ' AVE')
    .replace(/ ROAD$/, ' RD')
    .replace(/ BOULEVARD$/, ' BLVD')
    .replace(/ HIGHWAY$/, ' HWY')
}

/* ------------------------------ scenery ---------------------------------- */
export interface ScenePoly {
  kind: ScenePolygon['kind']
  name?: string
  /** projected closed ring, canvas units */
  pts: Pt[]
  centroid?: Pt
  /** readable label once projected (only for large polygons) */
  label?: string
}

function polyLabel(kind: ScenePolygon['kind'], name: string | undefined): string | undefined {
  if (!name) {
    if (kind === 'water') return 'CHARLES RIVER'
    if (kind === 'park') return 'PUBLIC GARDEN'
    return undefined
  }
  return name.toUpperCase()
}

export const SCENE_POLYS: ScenePoly[] = (raw.scenery ?? []).map((p) => ({
  kind: p.kind,
  name: p.name,
  pts: p.ring.map((c) => proj.to(c as Geo)),
  centroid: p.centroid ? proj.to(p.centroid as Geo) : undefined,
  label: polyLabel(p.kind, p.name),
}))

/* --------------------------- geometry helpers ---------------------------- */
/** total length of a canvas polyline */
export function pathLen(pts: Pt[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return d
}

/**
 * Distance travelled along `pts` up to the closest projection of every graph
 * intersection — used to walk a unit past its junctions in route order.
 */
export function projectJunctionsAlong(pts: Pt[]): { id: string; dist: number }[] {
  const res: { id: string; dist: number }[] = []
  for (const j of NETWORK.intersections) {
    const p = jPt(j.id)
    let cum = 0
    let best = { d: Infinity, dist: 0 }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const abx = b.x - a.x
      const aby = b.y - a.y
      const len2 = abx * abx + aby * aby
      let t = 0
      if (len2 > 0) t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
      const tt = Math.min(1, Math.max(0, t))
      const dd = Math.hypot(p.x - (a.x + abx * tt), p.y - (a.y + aby * tt))
      if (dd < best.d) best = { d: dd, dist: cum + tt * Math.sqrt(len2) }
      cum += Math.sqrt(len2)
    }
    if (best.d < 16) res.push({ id: j.id, dist: best.dist })
  }
  res.sort((a, b) => a.dist - b.dist)
  return res
}

/** metres-per-canvas-unit helper for distance math in map space */
export function metresToUnits(m: number): number {
  return m * proj.s
}

/** metre distance between two intersections (haversine, for scale bars etc.) */
export function junctionDistanceM(aId: string, bId: string): number {
  const a = intersectionById(aId)
  const b = intersectionById(bId)
  return haversineM([a.lat, a.lng], [b.lat, b.lng])
}
