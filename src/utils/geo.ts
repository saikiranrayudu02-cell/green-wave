// ---------------------------------------------------------------------------
// GREENWAVE — geographic utilities
//
// All coordinates are [latitude, longitude]. Distances/bearings come from
// haversine; the projection converts a geographic region into the command
// center's canvas space (VW x VH, y grows downward) with a single uniform
// scale so metres stay true in every direction.
// ---------------------------------------------------------------------------

export type Geo = [number, number]

export interface Pt {
  x: number
  y: number
}

export const R_EARTH_M = 6371000

/** great-circle distance in metres */
export function haversineM(a: Geo, b: Geo): number {
  const p1 = (a[0] * Math.PI) / 180
  const p2 = (b[0] * Math.PI) / 180
  const dp = ((b[0] - a[0]) * Math.PI) / 180
  const dl = ((b[1] - a[1]) * Math.PI) / 180
  const s =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(s))
}

/** initial bearing a -> b, radians, clockwise from north */
export function bearing(a: Geo, b: Geo): number {
  const p1 = (a[0] * Math.PI) / 180
  const p2 = (b[0] * Math.PI) / 180
  const dl = ((b[1] - a[1]) * Math.PI) / 180
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return Math.atan2(y, x)
}

/** point at fraction u in [0,1] between two coordinates */
export function interpolateGeo(a: Geo, b: Geo, u: number): Geo {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
}

export interface Projection {
  /** canvas units per metre */
  s: number
  /** geographic -> canvas (y grows downward = north up) */
  to(p: Geo): Pt
}

/**
 * Fit a set of geographic points into the viewBox with uniform scale,
 * centred with letterbox margins exactly like the command-center canvas.
 */
export function fitProjection(points: Geo[], vw: number, vh: number, margin = 0.04): Projection {
  let lat0 = Infinity
  let lat1 = -Infinity
  let lng0 = Infinity
  let lng1 = -Infinity
  for (const p of points) {
    if (p[0] < lat0) lat0 = p[0]
    if (p[0] > lat1) lat1 = p[0]
    if (p[1] < lng0) lng0 = p[1]
    if (p[1] > lng1) lng1 = p[1]
  }
  const latC = (lat0 + lat1) / 2
  const k = 111320 * Math.cos((latC * Math.PI) / 180)
  const dy = (lat1 - lat0) * 110540
  const dx = (lng1 - lng0) * k
  // uniform scale that fits both axes (inflate the box by the margin)
  const spanX = Math.max(dx, 1)
  const spanY = Math.max(dy, 1)
  const s = Math.min(vw / spanX, vh / spanY) / (1 + margin * 2)
  const xC = (lng0 + lng1) / 2
  const yC = (lat0 + lat1) / 2
  return {
    s,
    to(p: Geo): Pt {
      return { x: vw / 2 + (p[1] - xC) * k * s, y: vh / 2 - (p[0] - yC) * 110540 * s }
    },
  }
}

/* ------------------------- canvas polyline helpers ----------------------- */

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** total length of a polyline */
export function pathLen(pts: Pt[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i])
  return d
}

/** point at distance d (units) along the polyline, clamped at the end */
export function pointAtDist(pts: Pt[], d: number): Pt {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (d <= 0) return { x: pts[0].x, y: pts[0].y }
  let rem = d
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i])
    if (rem <= seg) {
      const t = seg === 0 ? 0 : rem / seg
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      }
    }
    rem -= seg
  }
  return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }
}

/** fraction u in [0,1] along the polyline -> point */
export function pointAtFrac(pts: Pt[], u: number): Pt {
  const clamped = Math.min(1, Math.max(0, u))
  return pointAtDist(pts, clamped * pathLen(pts))
}

/** heading (unit vector) at distance d along the polyline */
export function headingAtDist(pts: Pt[], d: number): Pt {
  const len = pathLen(pts)
  const dd = Math.min(Math.max(0.0001, len - 0.0001), Math.max(0.0001, d))
  const a = pointAtDist(pts, Math.max(0, dd - 0.5))
  const b = pointAtDist(pts, Math.min(len, dd + 0.5))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const m = Math.hypot(dx, dy) || 1
  return { x: dx / m, y: dy / m }
}

/** right-hand lane offset for a vehicle travelling along `heading` (dir=1 with it, -1 against) */
export function laneOffset(roadWidth: number, dir: 1 | -1, heading: Pt, frac = 0.22): Pt {
  const s = dir === 1 ? 1 : -1
  return { x: -heading.y * roadWidth * frac * s, y: heading.x * roadWidth * frac * s }
}

export function deg(rad: number): number {
  return (rad * 180) / Math.PI
}
