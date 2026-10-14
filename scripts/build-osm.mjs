// ---------------------------------------------------------------------------
// GREENWAVE — OSM extract processor (Phase 2B)
//
// Reads the raw Overpass JSON (src/data/osm/raw-overpass.json), builds a
// routable road graph (junction-split, multi-point geometry), picks the MGH
// entrance + EMS origins, carves a corridor band around the computed demo
// routes, prunes to demo scale (<= ~56 segments / ~40 junctions) while
// guaranteeing each route keeps a genuine graph alternative, and writes
// src/data/osm/network.json. Run:  node scripts/build-osm.mjs
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(here, '..', 'src', 'data', 'osm')
mkdirSync(DATA_DIR, { recursive: true })

const raw = JSON.parse(readFileSync(join(DATA_DIR, 'raw-overpass.json'), 'utf8'))

const ALLOWED = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'])

/* ------------------------------- geo helpers ----------------------------- */
/* haversine, metres */
function hav(a, b) {
  const R = 6371000
  const p1 = (a[0] * Math.PI) / 180
  const p2 = (b[0] * Math.PI) / 180
  const dp = ((b[0] - a[0]) * Math.PI) / 180
  const dl = ((b[1] - a[1]) * Math.PI) / 180
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/* local equirectangular metres around a reference lat */
const latRef = 42.363
const KX = 111320 * Math.cos((latRef * Math.PI) / 180)
const KY = 110540
const toM = (p) => [p[1] * KX, p[0] * KY]

const SEG_PT_DIST = 25 // sample step (m) used when measuring polyline proximity

/* point -> polyline min distance (metres) */
function distToPath(p, path) {
  const mp = toM(p)
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    const a = toM(path[i - 1])
    const b = toM(path[i])
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const len2 = abx * abx + aby * aby
    let t = 0
    if (len2 > 0) t = ((mp[0] - a[0]) * abx + (mp[1] - a[1]) * aby) / len2
    const tt = Math.min(1, Math.max(0, t))
    const d = Math.hypot(mp[0] - (a[0] + abx * tt), mp[1] - (a[1] + aby * tt))
    if (d < best) best = d
  }
  return best
}

/* resample a lat/lon polyline at ~SEG_PT_DIST so min-distance over vertices is accurate */
function resample(pts) {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const d = hav(pts[i - 1], pts[i])
    let acc = carry
    while (acc < d) {
      const t = acc / d
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t])
      acc += SEG_PT_DIST
    }
    carry = acc - d
  }
  out.push(pts[pts.length - 1])
  return out
}

/* ------------------------------- element pass ---------------------------- */
const NODES = new Map()
const WAYS = []
for (const e of raw.elements) {
  if (e.type === 'node' && typeof e.lat === 'number') NODES.set(e.id, { id: e.id, lat: e.lat, lon: e.lon })
  else if (e.type === 'way' && e.tags) WAYS.push(e)
}
const nodeAt = (id) => NODES.get(id)

const roadWays = WAYS.filter((w) => ALLOWED.has(w.tags.highway) && w.nodes.length >= 2 && w.nodes.every((n) => NODES.has(n)))

/* junction detection: nodes shared by >= 2 ways */
const wayCount = new Map()
for (const w of roadWays) for (const n of new Set(w.nodes)) wayCount.set(n, (wayCount.get(n) ?? 0) + 1)

/* split ways into segments between shared nodes */
const rawSegments = []
for (const w of roadWays) {
  const ns = w.nodes
  let run = []
  const emit = () => {
    if (run.length >= 2) {
      const from = run[0]
      const to = run[run.length - 1]
      const coords = run.map((n) => [NODES.get(n).lat, NODES.get(n).lon])
      let length = 0
      for (let i = 1; i < coords.length; i++) length += hav(coords[i - 1], coords[i])
      if (length > 6) rawSegments.push({ wayId: w.id, tags: w.tags, from, to, coords, length })
    }
  }
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i]
    run.push(n)
    if ((wayCount.get(n) ?? 0) >= 2 && i < ns.length - 1 && run.length >= 2) {
      emit()
      run = [n]
    }
  }
  emit()
}

/* polygon assets */
const polygons = (tag, val) =>
  WAYS.filter((w) => w.tags && w.tags[tag] === val && w.nodes.length >= 3 && w.nodes.every((n) => NODES.has(n)))
    .map((w) => {
      const ring = w.nodes.map((n) => [NODES.get(n).lat, NODES.get(n).lon])
      let a = 0
      let cx = 0
      let cy = 0
      for (let i = 0; i < ring.length - 1; i++) {
        const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
        a += f
        cx += (ring[i][0] + ring[i + 1][0]) * f
        cy += (ring[i][1] + ring[i + 1][1]) * f
      }
      a /= 2
      const centroid = [cx / (6 * a) || ring[0][0], cy / (6 * a) || ring[0][1]]
      return { id: w.id, name: w.tags.name, ring, centroid, area: Math.abs(a) }
    })
    .sort((p, q) => q.area - p.area)

const parks = polygons('leisure', 'park')
const waters = polygons('natural', 'water')
const campuses = polygons('amenity', 'hospital')
const fireNodes = raw.elements.filter((e) => e.type === 'node' && e.tags && e.tags.amenity === 'fire_station' && typeof e.lat === 'number')

const inRing = (pt, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const hit = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi
    if (hit) inside = !inside
  }
  return inside
}

/* ------------------------------- junctions ------------------------------- */
const junctionIds = new Set()
for (const s of rawSegments) {
  junctionIds.add(s.from)
  junctionIds.add(s.to)
}
const jPos = new Map()
for (const id of junctionIds) {
  const n = nodeAt(id)
  jPos.set(id, [n.lat, n.lon])
}

const signals = new Set(
  raw.elements.filter((e) => e.type === 'node' && e.tags && e.tags.highway === 'traffic_signals' && typeof e.lat === 'number').map((n) => n.id),
)
const signalized = new Set()
for (const j of junctionIds) {
  const p = jPos.get(j)
  const nearest = [...signals]
    .map((s) => nodeAt(s))
    .filter(Boolean)
    .map((s) => ({ s, d: hav(p, [s.lat, s.lon]) }))
    .sort((a, b) => a.d - b.d)[0]
  if (nearest && nearest.d < 20) signalized.add(j)
}

/* ------------------------------- graph edges ----------------------------- */
const edges = rawSegments.map((s, i) => ({
  id: 's' + i,
  from: s.from,
  to: s.to,
  wayId: s.wayId,
  tags: s.tags,
  coords: s.coords,
  length: s.length,
}))

const adj = new Map()
for (const e of edges) {
  if (!adj.has(e.from)) adj.set(e.from, [])
  if (!adj.has(e.to)) adj.set(e.to, [])
  adj.get(e.from).push(e)
  adj.get(e.to).push(e)
}

/* ------------------------------- routing --------------------------------- */
/* Dijkstra over an arbitrary edge set (the full graph during candidate
   selection, the pruned/contracted `live` set afterwards). */
function adjOf(es) {
  const m = new Map()
  for (const e of es) {
    if (!m.has(e.from)) m.set(e.from, [])
    if (!m.has(e.to)) m.set(e.to, [])
    m.get(e.from).push(e)
    m.get(e.to).push(e)
  }
  return m
}

function dijkstraOn(es, originId, destinationId, blocked = new Set()) {
  const A = adjOf(es)
  if (originId === destinationId) return { intersectionIds: [originId], roadIds: [], dist: 0 }
  const dist = new Map([[originId, 0]])
  const prev = new Map()
  const done = new Set()
  for (;;) {
    let cur = null
    let best = Infinity
    for (const [n, d] of dist) if (!done.has(n) && d < best) {
      best = d
      cur = n
    }
    if (cur === null || cur === destinationId) break
    done.add(cur)
    for (const e of A.get(cur) ?? []) {
      if (blocked.has(e.id)) continue
      const o = e.from === cur ? e.to : e.from
      if (done.has(o)) continue
      const nd = best + e.length
      if (nd < (dist.get(o) ?? Infinity)) {
        dist.set(o, nd)
        prev.set(o, { node: cur, edge: e })
      }
    }
  }
  if (!dist.has(destinationId)) return null
  const intersectionIds = []
  const roadIds = []
  let node = destinationId
  while (node && node !== originId) {
    intersectionIds.push(node)
    const p = prev.get(node)
    if (!p) return null
    roadIds.push(p.edge.id)
    node = p.node
  }
  intersectionIds.push(originId)
  return { intersectionIds: intersectionIds.reverse(), roadIds: roadIds.reverse(), dist: dist.get(destinationId) }
}

/* full-graph helpers used during candidate selection (pre-prune) */
const dijkstra = (o, d, blocked) => dijkstraOn(edges, o, d, blocked)

const edgeById = new Map(edges.map((e) => [e.id, e]))

/* components (by junction id) over a given edge set */
function componentOf(root, es = edges) {
  const A = adjOf(es)
  const seen = new Set([root])
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    for (const e of A.get(n) ?? []) {
      const o = e.from === n ? e.to : e.from
      if (!seen.has(o)) {
        seen.add(o)
        stack.push(o)
      }
    }
  }
  return seen
}

/* k-shortest distinct routes from the entrance to `origin` (each search blocks
   the roads of the routes found so far). */
function kPathsRef(origin, k, es = edges) {
  const out = []
  const blocked = new Set()
  for (let i = 0; i < k; i++) {
    const p = dijkstraOn(es, entranceId, origin, blocked)
    if (!p) break
    out.push(p)
    for (const rid of p.roadIds) blocked.add(rid)
  }
  return out
}

/* ------------------------------- targets --------------------------------- */
const hospital = campuses[0] // biggest hospital campus in the extract
const hospitalName = hospital?.name || 'Massachusetts General Hospital'

/* MGH entrance: closest junction just outside the campus ring */
let entranceId = null
{
  const c = hospital.centroid
  const cands = [...junctionIds]
    .map((j) => ({ j, p: jPos.get(j), d: hav(c, jPos.get(j)) }))
    .filter((x) => !inRing(x.p, hospital.ring))
    .sort((a, b) => a.d - b.d)
  entranceId = cands[0]?.j ?? null
}
const mainComp = componentOf(entranceId)
const hasAltFor = (origin, es = edges) => {
  const p = dijkstraOn(es, entranceId, origin)
  if (!p) return false
  for (const rid of p.roadIds) {
    const r = dijkstraOn(es, entranceId, origin, new Set([rid]))
    if (r) return true
  }
  return false
}

function routeStats(origin, es = edges) {
  const p = dijkstraOn(es, entranceId, origin)
  if (!p) return null
  const sig = p.intersectionIds.filter((j) => signalized.has(j)).length
  return { p, dist: p.dist, sig }
}

/* distinctness of the second path vs the primary (in shared junctions) */
function pathQuality(origin) {
  const p = kPathsRef(origin, 2)[1]
  if (!p) return 0
  const p0 = dijkstraOn(edges, entranceId, origin)
  if (!p0) return 0
  const shared = new Set(p0.intersectionIds)
  const diff = p.intersectionIds.filter((j) => !shared.has(j)).length
  return diff
}

/* candidate junction pool: on a named through road, not too close together */
const majorTouches = new Map()
for (const e of edges) {
  if (['primary', 'secondary', 'tertiary'].includes(e.tags.highway)) {
    if (!majorTouches.has(e.from)) majorTouches.set(e.from, 0)
    if (!majorTouches.has(e.to)) majorTouches.set(e.to, 0)
    majorTouches.set(e.from, majorTouches.get(e.from) + 1)
    majorTouches.set(e.to, majorTouches.get(e.to) + 1)
  }
}
/* pool of plausible second-origin junctions (named through-road candidates) */
const pool = [...mainComp]
  .filter((j) => (majorTouches.get(j) ?? 0) >= 1)
  .filter((j) => {
    const st = routeStats(j)
    if (!st || st.dist < 1100 || st.dist > 1900 || st.sig < 6 || st.sig > 19) return false
    return pathQuality(j) >= 3
  })

function pickOrigin(exclude = new Set()) {
  const best = pool
    .filter((c) => !exclude.has(c))
    .map((j) => {
      const st = routeStats(j)
      const q = pathQuality(j)
      return { j, dist: st.dist, sig: st.sig, q, score: -Math.abs(st.dist - 1500) * 0.04 - st.sig * 5 + q * 3 }
    })
    .sort((a, b) => b.score - a.score)[0]
  return best ?? null
}

let em1Origin = null
let em2Origin = null
let em1Stats = null
let em2Stats = null
{
  /* primary origin: Engine 10 (Boston Fire, Chinatown/Purchase St) */
  const ENGINE_10 = fireNodes.find((n) => n.tags && /Engine 10/.test(n.tags.name)) ?? fireNodes[0]
  const nearFire = [...mainComp]
    .map((j) => ({ j, d: hav([ENGINE_10.lat, ENGINE_10.lon], jPos.get(j)) }))
    .sort((a, b) => a.d - b.d)[0]
  if (nearFire && nearFire.d < 140 && routeStats(nearFire.j)) {
    em1Origin = nearFire.j
  } else {
    const alt1 = pool.map((j) => ({ j, st: routeStats(j) })).sort((a, b) => b.st.dist - a.st.dist)[0]
    em1Origin = alt1?.j ?? null
  }
  if (!em1Origin) {
    console.error('!! could not choose em-01 origin')
    process.exit(1)
  }
  em1Stats = routeStats(em1Origin)

  /* second origin: on the opposite side of the entrance from em-01 (spread the
     demo across the whole network), distinct route preferred */
  const entLat = jPos.get(entranceId)[0]
  const em1Lat = jPos.get(em1Origin)[0]
  const wantNorth = em1Lat < entLat
  const r1Roads = new Set(em1Stats.p.roadIds)
  const best2 = pool
    .filter((c) => c !== em1Origin)
    .filter((c) => wantNorth ? jPos.get(c)[0] > entLat + 0.0025 : jPos.get(c)[0] < entLat - 0.0025)
    .map((j) => {
      const st = routeStats(j)
      const overlap = st.p.roadIds.filter((r) => r1Roads.has(r)).length / (st.p.roadIds.length || 1)
      return { j, st, overlap, score: st.dist * 0.002 - overlap * 200 - st.sig * 3 }
    })
    .sort((a, b) => b.score - a.score)[0]
  if (best2) {
    em2Origin = best2.j
    em2Stats = best2.st
  }
  if (!em2Origin) {
    console.error('!! could not choose em-02 origin')
    process.exit(1)
  }
}

/* -------------------------- corridor band prune -------------------------- */
function findAlt(origin, es = edges) {
  const p = dijkstraOn(es, entranceId, origin)
  if (!p) return null
  let best = null
  for (const rid of p.roadIds) {
    const r = dijkstraOn(es, entranceId, origin, new Set([rid]))
    if (r && (!best || r.dist < best.dist)) best = r
  }
  return best
}

/* em-01 keeps a genuine parallel alternative (the incident demo reroutes for
   real); em-02 only needs its own corridor. */
const ROUTES = [
  ...kPathsRef(em1Origin, 2).map((p) => ({ origin: em1Origin, primary: p })),
  ...kPathsRef(em2Origin, 1).map((p) => ({ origin: em2Origin, primary: p })),
]
{
  const nameOf = (id) => [...new Set(roadWays.filter((w) => w.nodes.includes(id)).map((w) => w.tags.name).filter(Boolean))].slice(0, 2).join(' / ') || '(unnamed)'
  console.log('em1Origin', nameOf(em1Origin), 'dist', Math.round(em1Stats.dist), '| em2Origin', nameOf(em2Origin), 'dist', Math.round(em2Stats.dist))
}

/* polyline of a junction-id route, resampled for proximity tests */
const pathOf = (p) => resample(p.intersectionIds.map((j) => jPos.get(j)))

const PROTECTED_EDGES = new Set()
for (const r of ROUTES) for (const rid of r.primary.roadIds) PROTECTED_EDGES.add(rid)
const PROTECTED_J = new Set([entranceId, em1Origin, em2Origin])

const routePolylines = ROUTES.map((r) => pathOf(r.primary))
const edgeProximity = (e) => {
  let best = Infinity
  const pts = resample(e.coords)
  for (const pl of routePolylines) {
    for (const p of pts) {
      const d = distToPath(p, pl)
      if (d < best) best = d
    }
  }
  return best
}

const BAND_M = 185
let live = edges.filter((e) => PROTECTED_EDGES.has(e.id) || edgeProximity(e) <= BAND_M)

/* drop components that no longer hold a protected node */
function restrictToComp() {
  const keep = componentOf(entranceId, live)
  for (const o of [em1Origin, em2Origin]) if (!keep.has(o)) return false
  live = live.filter((e) => keep.has(e.from) && keep.has(e.to))
  return true
}
restrictToComp()

/* prune leaf spurs (never protected junctions or signalized ones) */
function pruneLeaves() {
  let changed = true
  let guard = 0
  while (changed && guard++ < 400) {
    changed = false
    const deg = new Map()
    for (const e of live) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
    }
    const leaves = [...deg.entries()].filter(([j, n]) => n === 1 && !PROTECTED_J.has(j) && !signalized.has(j)).map(([j]) => j)
    for (const j of leaves) {
      const e = live.find((e) => e.from === j || e.to === j)
      if (e) {
        live = live.filter((x) => x !== e)
        changed = true
      }
    }
  }
}

/* fine-grained pruning down to scale while keeping connectivity + alternatives */
const TARGET_EDGES = 52
const MAX_JUNCTIONS = 44
const removedDuringShrink = []
function verifyRoutes() {
  for (const o of [em1Origin, em2Origin]) {
    const p = dijkstraOn(live, entranceId, o)
    if (!p) return false
    if (!hasAltFor(o, live)) return false
  }
  return true
}
function shrinkToScale() {
  let guard = 0
  while (guard++ < 600) {
    pruneLeaves()
    restrictToComp()
    const jCount = new Set(live.flatMap((e) => [e.from, e.to])).size
    if (live.length <= TARGET_EDGES && jCount <= MAX_JUNCTIONS) break
    // candidate edges to drop: not protected, ordered by (not-protected-first, distance-to-corridor desc)
    const cands = live
      .filter((e) => !PROTECTED_EDGES.has(e.id))
      .map((e) => ({ e, prox: edgeProximity(e), resid: /^(residential|unclassified|living_street)$/.test(e.tags.highway) ? 0 : 1 }))
      .sort((a, b) => a.resid - b.resid || b.prox - a.prox || b.e.length - a.e.length)
    let dropped = false
    for (const c of cands) {
      if (live.length <= TARGET_EDGES && new Set(live.flatMap((e) => [e.from, e.to])).size <= MAX_JUNCTIONS) break
      if (live.length <= TARGET_EDGES && c.resid === 1) {
        // junction cap still over: allow dropping arterials only if connectivity+alts hold
      }
      live = live.filter((x) => x !== c.e)
      if (!verifyRoutes()) {
        live = [...live, c.e]
        continue
      }
      removedDuringShrink.push(c.e)
      dropped = true
      break
    }
    if (!dropped) break
  }
}
pruneLeaves()
restrictToComp()
shrinkToScale()
pruneLeaves()
restrictToComp()

/* --------------------- generalize: contract pass-through nodes ------------ */
/* A degree-2 junction that is not signalized and not an origin/entrance is a
   mid-block node (usually a cross street that was pruned away). Contract it
   into a single road so corridors read as streets, not node chains. */
let edgeCounter = edges.length
function contractPassThroughs() {
  let guard = 0
  while (guard++ < 500) {
    const deg = new Map()
    for (const e of live) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
    }
    // Contract pure pass-throughs (nodes that are not signalized and not
    // origins/entrance). Signalized nodes are real stops and stay.
    const target = [...deg.entries()].find(([j, n]) => n === 2 && !signalized.has(j) && !PROTECTED_J.has(j))
    if (!target) break
    const j = target[0]
    const [e1, e2] = live.filter((e) => e.from === j || e.to === j)
    const other = (e) => (e.from === j ? e.to : e.from)
    const a = other(e1)
    const b = other(e2)
    if (a === b) {
      live = live.filter((e) => e !== e1 && e !== e2)
      continue
    }
    const segA = e1.from === j ? [...e1.coords].reverse() : e1.coords // ends at j
    const segB = e2.to === j ? [...e2.coords].reverse() : e2.coords // starts at j
    const merged = [...segA.slice(0, -1), ...segB]
    const order = { primary: 0, secondary: 1, tertiary: 2, unclassified: 3, residential: 4, living_street: 5 }
    const tags = order[e1.tags.highway] <= order[e2.tags.highway] ? e1.tags : e2.tags
    const ne = {
      id: 's' + edgeCounter++,
      from: a,
      to: b,
      wayId: e1.wayId,
      tags,
      coords: merged,
      length: e1.length + e2.length,
    }
    live = [...live.filter((e) => e !== e1 && e !== e2), ne]
  }
}
contractPassThroughs()
pruneLeaves()
restrictToComp()

/* ---------------------- demo incident + corridor stops -------------------- */
/* "coordinated stops": signalized junctions along a corridor, with the
   duplicated corner/slip nodes of one intersection clustered (nodes of the
   same junction sit only metres apart in the raw data). */
function clusterSigPath(longOrigin, es = live) {
  const p = dijkstraOn(es, entranceId, longOrigin)
  if (!p) return []
  const sigs = p.intersectionIds.filter((j) => signalized.has(j))
  const stops = []
  let prev = null
  for (const j of sigs) {
    if (prev && hav(jPos.get(prev), jPos.get(j)) < 45) continue // same physical intersection
    stops.push(j)
    prev = j
  }
  return stops
}

/* incident junction: a mid-corridor coordinated stop whose closure reroutes.
   Tested on the FINAL pruned graph (earlier versions checked the full extract
   and picked junctions that later became articulation points). If no stop can
   reroute, re-add the closest discarded street until one can — the demo needs
   a real, visible reroute. */
const rerouteWorksOn = (j, es) => {
  const nom = dijkstraOn(es, entranceId, em1Origin)
  if (!nom) return false
  const override = new Set(es.filter((e) => e.from === j || e.to === j).map((e) => e.id))
  const r = dijkstraOn(es, entranceId, em1Origin, override)
  return !!(r && r.intersectionIds.join(',') !== nom.intersectionIds.join(','))
}
/* edges dropped during shrink, farthest-first — reversed, they are the closest
   discarded streets, ideal for rebuilding a block loop around an incident */
const discardedPool = () => removedDuringShrink.slice().reverse()

const stopsEm1 = clusterSigPath(em1Origin)
const stopsEm2 = clusterSigPath(em2Origin)
let incidentLong = null
{
  const cands = stopsEm1.slice(Math.max(1, Math.floor(stopsEm1.length * 0.28)), -1)
  for (const j of cands) {
    if (rerouteWorksOn(j, live)) {
      incidentLong = j
      break
    }
  }
  if (!incidentLong) {
    // re-add discarded streets (nearest to the corridor first) until a stop reroutes
    const pool = discardedPool()
    const spare = new Set(live.map((e) => e.id))
    for (const j of cands) {
      if (incidentLong) break
      for (const cand of pool) {
        if (spare.has(cand.e.id)) continue
        if (new Set(live.flatMap((e) => [e.from, e.to])).size > 50) break
        spare.add(cand.e.id)
        live = [...live, cand.e]
        if (rerouteWorksOn(j, live)) {
          incidentLong = j
          break
        }
      }
    }
  }
  // final fallback: any mid-corridor stop (degraded — no visible reroute)
  if (!incidentLong) {
    incidentLong = stopsEm1[Math.max(1, Math.floor(stopsEm1.length / 2))] ?? null
  }
}

/* --------------------------- final data model ---------------------------- */
const usedJunctionIds = [...new Set(live.flatMap((e) => [e.from, e.to]))].sort()
const finalComp = componentOf(entranceId)
const usedSet = new Set(usedJunctionIds)

/* name junctions from incident named ways */
const shortByLong = new Map()
const longByShort = new Map()
const jName = (id) => {
  const roadsHere = roadWays.filter((w) => w.nodes.includes(id)).filter((w) => w.tags.name)
  const names = [...new Set(roadsHere.map((w) => w.tags.name))].slice(0, 2)
  return names.length ? names.join(' / ') : undefined
}

/* junction numbering — top-to-bottom so route ids read naturally */
const ordered = [...finalComp].filter((j) => usedSet.has(j)).map((j) => ({ j, lat: jPos.get(j)[0] })).sort((a, b) => b.lat - a.lat || jPos.get(a.j)[1] - jPos.get(b.j)[1])
ordered.forEach(({ j }, i) => {
  const code = 'J' + String(i + 1).padStart(2, '0')
  shortByLong.set(j, code)
  longByShort.set(code, j)
})

const intersections = ordered.map(({ j }) => {
  const p = jPos.get(j)
  const code = shortByLong.get(j)
  return { id: code, name: jName(j), lat: +p[0].toFixed(6), lng: +p[1].toFixed(6), signalized: signalized.has(j) }
})

const SPEED_DEFAULT = { primary: 44, secondary: 40, tertiary: 35, unclassified: 30, residential: 28, living_street: 12 }
const LANES_DEFAULT = { primary: 2, secondary: 2, tertiary: 2, unclassified: 1, residential: 1, living_street: 1 }
const parseSpeed = (tags) => {
  if (tags.maxspeed) {
    const n = parseFloat(tags.maxspeed)
    // OSM maxspeed here is in mph (Boston) — convert to km/h
    if (!Number.isNaN(n)) return Math.round(n * 1.609)
  }
  return SPEED_DEFAULT[tags.highway] ?? 30
}
const idHash = (s) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

const roads = live.map((e) => {
  const t = e.tags
  const type = t.highway
  const seg = {
    id: e.id,
    from: shortByLong.get(e.from),
    to: shortByLong.get(e.to),
    name: t.name,
    roadType: type,
    speedLimit: parseSpeed(t),
    lanes: t.lanes ? Math.max(1, parseInt(t.lanes, 10) || 1) : LANES_DEFAULT[type],
    length: Math.round(e.length),
    congestion: 0.05,
    coordinates: e.coords.map((c) => [+c[0].toFixed(6), +c[1].toFixed(6)]),
  }
  const h = idHash(e.id)
  if (h % 17 === 0) seg.congestion = 0.3
  else if (h % 31 === 0) seg.congestion = 0.42
  return seg
})

const jById = new Map(intersections.map((x) => [x.id, x]))

/* --------------------------- scenery (parks etc.) ------------------------ */
const trimRing = (ring, max) => {
  if (ring.length <= max) return ring
  const out = []
  const step = ring.length / max
  for (let i = 0; i < max; i++) out.push(ring[Math.floor(i * step)])
  return out
}
const scenePoly = (kind, list, limit, minArea) =>
  list
    .filter((p) => p.area >= minArea)
    .slice(0, limit)
    .map((p) => ({ kind, name: p.name, ring: trimRing(p.ring.map((c) => [+c[0].toFixed(6), +c[1].toFixed(6)]), 260), centroid: [+p.centroid[0].toFixed(6), +p.centroid[1].toFixed(6)] }))

/* only polygons plausibly intersecting the kept network */
const nearNet = (p) => {
  for (const e of live) {
    if (distToPath(p.centroid, resample(e.coords)) < 950) return true
  }
  return false
}
const scenery = [
  ...scenePoly('water', waters.filter(nearNet), 6, 4e-5),
  ...scenePoly('park', parks.filter(nearNet), 10, 9e-6),
  ...scenePoly('campus', campuses.filter(nearNet), 5, 1e-7),
]

/* ------------------------------- demo meta ------------------------------- */
const entranceCode = shortByLong.get(entranceId)
const em1Code = shortByLong.get(em1Origin)
const em2Code = shortByLong.get(em2Origin)

/* summary route info for verification */
const brief = (originCode, alt = false) => {
  const long = longByShort.get(originCode)
  const p = alt ? findAlt(long, live) : dijkstraOn(live, entranceId, long)
  if (!p) return null
  const sig = p.intersectionIds.filter((j) => signalized.has(j)).length
  return {
    distM: Math.round(p.dist),
    segs: p.roadIds.length,
    junctions: p.intersectionIds.length,
    sig,
    stops: sig,
    codes: alt ? undefined : p.intersectionIds.map((j) => shortByLong.get(j)),
  }
}

const meta = {
  source: 'OpenStreetMap — © OpenStreetMap contributors (Overpass API)',
  area: 'Central Boston · MGH / Beacon Hill / Chinatown corridor',
  fetchedAt: new Date().toISOString(),
  hospital: { label: hospitalName, entrance: entranceCode },
  originEm1: { id: em1Code, label: 'Fire Station · Engine 10' },
  originEm2: em2Code ? { id: em2Code, label: jById.get(em2Code)?.name ? `EMS Base · ${jById.get(em2Code).name.split(' / ')[0]}` : 'EMS Support Base' } : null,
  incident: incidentLong ? { junctionId: shortByLong.get(incidentLong), name: incidentLong ? jName(incidentLong) : undefined } : null,
  corridor: brief(em1Code),
  corridorAlt: brief(em1Code, true),
  corridor2: brief(em2Code),
  corridor2Alt: brief(em2Code, true),
  junctionCount: intersections.length,
  roadCount: roads.length,
  signalizedCount: intersections.filter((x) => x.signalized).length,
}

const out = { meta, intersections, roads, scenery }
writeFileSync(join(DATA_DIR, 'network.json'), JSON.stringify(out))

console.log(JSON.stringify({
  junctionCount: intersections.length,
  roadCount: roads.length,
  signalized: meta.signalizedCount,
  entrance: entranceCode,
  em1: em1Code,
  em2: em2Code,
  incident: meta.incident?.junctionId ?? null,
  corridor: meta.corridor,
  corridorAlt: meta.corridorAlt,
  corridor2: meta.corridor2,
  corridor2Alt: meta.corridor2Alt,
  scenery: scenery.map((s) => `${s.kind}:${s.name ?? '(unnamed)'}[${s.ring.length}]`),
}, null, 1))

/* keep a trimmed provenance copy of the raw extract */
const trim = (d) => {
  const nodeSet = new Set()
  for (const e of d.elements) if (e.type === 'way') for (const n of e.nodes) nodeSet.add(n)
  for (const e of d.elements) if (e.type === 'node' && e.tags) nodeSet.add(e.id)
  return {
    ...d,
    elements: d.elements
      .filter((e) => (e.type === 'way' ? nodeSet.has(e.nodes[0]) : nodeSet.has(e.id)))
      .map((e) => (e.type === 'way' ? { type: 'way', id: e.id, tags: e.tags, nodes: e.nodes } : { type: 'node', id: e.id, lat: e.lat, lon: e.lon, tags: e.tags })),
  }
}
writeFileSync(join(DATA_DIR, 'raw-overpass.json'), JSON.stringify(trim(raw)))
