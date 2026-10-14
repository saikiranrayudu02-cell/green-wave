import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../lib/cn'
import {
  NETWORK,
  SCENE_POLYS,
  DESTINATION,
  ORIGINS,
  VW,
  VH,
  projectionS,
  jPt,
  roadPts,
  congestionLevel,
  projectJunctionsAlong,
  OSM_ATTRIBUTION,
  DISPLAY_SIGNAL_IDS,
  axisRoadLabel,
} from '../data/osmRoadNetwork'
import type { AxisGroupName } from '../data/osmRoadNetwork'
import type { RoadSegment } from '../types/traffic'
import type { CongestionLevel } from '../types/traffic'
import { advanceSigCtl, groupStateOf, initSigCtl } from '../engine/signals'
import type { SigCtl, SignalState } from '../engine/signals'
import { publishSignalState } from '../engine/signalState'
import {
  agentGeom,
  STOP_OFFSET_PX,
  resetTraffic,
  trafficAgents,
  trafficCongestion,
  trafficObservations,
  trafficTick,
} from '../engine/vehicles'
import type { LightState, VehicleAgent } from '../engine/vehicles'
import {
  clearDecisions,
  downstreamCongestion,
  groupPressure,
  junctionDecision,
} from '../engine/pressure'
import { mergeWithSimObservations } from '../engine/trafficDemand'
import { predictionBiasFor, recordJunctionObs } from '../engine/trafficPrediction'
import {
  buildRouteStops,
  clearCorridorState,
  corridorJunctionOf,
  corridorRequestFor,
  nextRouteStop,
  planCorridorWave,
  publishCorridorWave,
  stepAmbulance,
} from '../engine/corridor'
import type { CorridorJunction, CorridorReq, RouteStop } from '../engine/corridor'
import { deg, headingAtDist, laneOffset, pathLen, pointAtDist } from '../utils/geo'
import type { Pt } from '../utils/geo'
import Vehicle from './Vehicle'
import Ambulance from './Ambulance'
import TrafficSignal from './TrafficSignal'
import type { IncidentState, Mode } from '../types'
import { Led } from './ui'

export interface TelemetryPoint {
  id: string
  d: number
  len: number
  arrived: boolean
  /** real seconds the unit has stood at a red signal on this run */
  wait: number
}

export interface UnitSim {
  id: string
  /** active route geometry (from the routing engine, canvas units) */
  pts: Pt[]
  speedOpen: number
  speedClosed: number
  open: boolean
  /** false until the emergency is dispatched — unit parks at origin, no route */
  dispatched: boolean
  arrived: boolean
  d: number
  active: boolean
  /** true while an incident reroute is in effect */
  rerouted: boolean
  /** coordinated signal stops on the route, in travel order */
  junctionIds: string[]
}

interface Props {
  units: UnitSim[]
  incident: IncidentState | null
  mode: Mode
  epoch: number
  /** bumped only on RESET — replays the deterministic traffic + signals */
  resetKey: number
  onTelemetry: (t: TelemetryPoint[]) => void
}

/* ------------------------------------------------------------------ */
/* signalised junctions from the road graph + real controllers          */
/* ------------------------------------------------------------------ */
interface SignalJunction {
  id: string
  x: number
  y: number
}

const DISPLAY_SIGNALS: SignalJunction[] = DISPLAY_SIGNAL_IDS.map((id) => {
  const p = jPt(id)
  return { id, x: p.x, y: p.y }
})

/* per-frame clock (seconds); the sim loop advances it every animation frame */
let frameTime = 0

/* one pure state-machine controller per displayed signal (engine/signals.ts) */
const ctlStore = new Map<string, SigCtl>()
for (const j of DISPLAY_SIGNALS) ctlStore.set(j.id, initSigCtl(j.id, 0))

function toLightChar(s: SignalState): 'G' | 'Y' | 'R' {
  return s === 'GREEN' ? 'G' : s === 'YELLOW' ? 'Y' : 'R'
}

/**
 * Per-frame corridor schedules (junction → request). The sim loop writes this
 * before advancing controllers so signal heads can render the *ambulance*
 * group's lamp while a corridor window is active.
 */
const frameCorr = new Map<string, CorridorReq>()

/** soft-approach radius for optimizer pressure boosting (no hard preemption) */
const SOFT_EMERGENCY_PX = 230

/**
 * Soft emergency priority for the optimizer (greenwave without a corridor):
 * the group the nearest approaching unit needs gets a pressure boost so its
 * signal tends toward green — no hard preemption, safe yellow transitions.
 */
function emergencyGroupAt(
  jId: string,
  units: UnitSim[],
  simRef: React.MutableRefObject<SimUnit[]>,
): AxisGroupName | null {
  for (const u of units) {
    if (!u.dispatched || u.arrived || u.open) continue
    const sim = simRef.current.find((s) => s.id === u.id)
    if (!sim) continue
    for (const jd of sim.stops) {
      if (jd.id !== jId) continue
      const ahead = jd.centerDist - sim.d
      if (ahead > SOFT_EMERGENCY_PX || ahead < -60) continue
      return jd.group
    }
  }
  return null
}

/**
 * Effective corridor request for a junction this frame: the earliest-window
 * schedule across every open corridor unit (future multi-emergency safe).
 */
function corridorReqAt(
  jId: string,
  units: UnitSim[],
  simRef: React.MutableRefObject<SimUnit[]>,
): CorridorReq | null {
  let best: CorridorReq | null = null
  for (const u of units) {
    if (!u.dispatched || u.arrived || !u.open) continue
    const sim = simRef.current.find((s) => s.id === u.id)
    if (!sim) continue
    for (const j of sim.wave) {
      if (j.id !== jId || j.priority === 'NONE') continue
      const req = corridorRequestFor(j)
      if (!req) continue
      if (!best || req.greenAt < best.greenAt) best = req
    }
  }
  return best
}

/** effective displayed state of a signal head this frame */
function displaySignalState(j: SignalJunction, incident: IncidentState | null): 'G' | 'Y' | 'R' {
  if (incident && j.id === incident.junctionId) return 'R'
  const ctl = ctlStore.get(j.id)
  if (!ctl) return 'G'
  const req = frameCorr.get(j.id)
  return toLightChar(groupStateOf(ctl, frameTime, req?.group ?? 'M'))
}

/** corridor wave entry (coordinated) for a junction across all open units */
function corridorWaveEntryAt(
  jId: string,
  units: UnitSim[],
  simRef: React.MutableRefObject<SimUnit[]>,
): { unitId: string; j: CorridorJunction } | null {
  let best: { unitId: string; j: CorridorJunction } | null = null
  for (const u of units) {
    if (!u.dispatched || u.arrived || !u.open) continue
    const sim = simRef.current.find((s) => s.id === u.id)
    if (!sim) continue
    for (const j of sim.wave) {
      if (j.id !== jId || j.status === 'STANDBY' || j.status === 'PASSED') continue
      if (!best || j.etaSec < best.j.etaSec) best = { unitId: u.id, j }
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* road visual widths by class                                          */
/* ------------------------------------------------------------------ */
const ROAD_W: Record<string, number> = {
  primary: 27,
  secondary: 21,
  tertiary: 16,
  unclassified: 11,
  residential: 10,
  living_street: 10,
}
const ROAD_FILL: Record<string, string> = {
  primary: '#2c3753',
  secondary: '#232e49',
  tertiary: '#1f2941',
  unclassified: '#192238',
  residential: '#182035',
  living_street: '#182035',
}
const roadWidthOf = (r: RoadSegment) => ROAD_W[r.roadType] ?? 12
const roadFillOf = (r: RoadSegment) => ROAD_FILL[r.roadType] ?? '#1a2338'
const isMajor = (r: RoadSegment) => r.roadType === 'primary' || r.roadType === 'secondary'

/* ------------------------------------------------------------------ */
/* static scenery — once per mount                                       */
/* ------------------------------------------------------------------ */
const StaticScene = memo(function StaticScene() {
  const geoPath = (coords: Pt[]) => `M ${coords.map((p) => `${p.x} ${p.y}`).join(' L ')}`

  const parkPolys = SCENE_POLYS.filter((p) => p.kind === 'park')
  const waterPolys = SCENE_POLYS.filter((p) => p.kind === 'water')
  const campusPolys = SCENE_POLYS.filter((p) => p.kind === 'campus')

  return (
    <g>
      {/* water */}
      {waterPolys.map((p, i) => (
        <g key={`w${i}`}>
          <path d={geoPath(p.pts)} fill="#060d18" stroke="#0e2133" strokeWidth={1.6} />
          <path d={geoPath(p.pts)} fill="none" stroke="rgba(90,140,190,0.05)" strokeWidth={7} />
        </g>
      ))}
      {/* parks */}
      {parkPolys.map((p, i) => (
        <g key={`p${i}`}>
          <path d={geoPath(p.pts)} fill="#081410" stroke="#0f2a1e" strokeWidth={1.4} />
          {[0, 1, 2, 3, 4, 5, 6].map((k) => {
            const b = boundsOf(p.pts)
            if (b.w < 8) return null
            const tx = b.x0 + 12 + ((k * 37 + i * 23) % Math.max(8, b.w - 24))
            const ty = b.y0 + 14 + ((k * 29 + i * 17) % Math.max(8, b.h - 28))
            return <circle key={k} cx={tx} cy={ty} r={5} fill="#0d1f17" stroke="#123226" strokeWidth={1} />
          })}
        </g>
      ))}
      {/* hospital campuses */}
      {campusPolys.map((p, i) => (
        <g key={`c${i}`}>
          <path d={geoPath(p.pts)} fill="#0c1524" stroke="#274062" strokeWidth={1.5} />
          {p.centroid && (
            <g>
              <g stroke="#8fb0d4" strokeWidth={2.6} strokeLinecap="round">
                <path d={`M ${p.centroid.x - 9} ${p.centroid.y} h 18 M ${p.centroid.x} ${p.centroid.y - 9} v 18`} opacity={0.55} />
              </g>
              <circle cx={p.centroid.x} cy={p.centroid.y} r={15} fill="none" stroke="#3d5f8c" strokeWidth={1.2} strokeDasharray="3 4" opacity={0.8} />
            </g>
          )}
        </g>
      ))}

      {/* roads: asphalt base, surface, centre markings */}
      {NETWORK.roads.map((r) => (
        <path
          key={`${r.id}-a`}
          d={geoPath(roadPts(r))}
          fill="none"
          stroke="#04060b"
          strokeWidth={roadWidthOf(r) + 7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {NETWORK.roads.map((r) => (
        <path
          key={`${r.id}-s`}
          d={geoPath(roadPts(r))}
          fill="none"
          stroke={roadFillOf(r)}
          strokeWidth={roadWidthOf(r)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {NETWORK.roads
        .filter((r) => isMajor(r) && roadWidthOf(r) >= 20)
        .map((r) => (
          <path
            key={`${r.id}-m`}
            d={geoPath(roadPts(r))}
            fill="none"
            stroke="rgba(180,200,230,0.13)"
            strokeWidth={1.4}
            strokeDasharray="5 11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

      {/* junction pads */}
      {NETWORK.intersections.map((j) => {
        const p = jPt(j.id)
        return (
          <circle
            key={`pad-${j.id}`}
            cx={p.x}
            cy={p.y}
            r={j.signalized ? 6.5 : 4}
            fill={j.signalized ? '#0f1a2c' : '#0c1523'}
            stroke={j.signalized ? '#263654' : '#1c2a45'}
            strokeWidth={1.2}
          />
        )
      })}

      {/* faint neighbourhood / scenery labels */}
      {SCENE_POLYS.map((p, i) => {
        if (!p.label || !p.centroid) return null
        const b = boundsOf(p.pts)
        if (b.w < 90 || b.h < 30) return null
        const tone =
          p.kind === 'water' ? 'rgba(122,170,210,0.16)' : p.kind === 'park' ? 'rgba(96,170,130,0.2)' : 'rgba(130,170,215,0.26)'
        return (
          <text
            key={`lbl-${i}`}
            x={p.centroid.x}
            y={p.centroid.y + (p.kind === 'campus' ? 34 : 0)}
            textAnchor="middle"
            fontSize={p.kind === 'campus' ? 8.5 : 8}
            letterSpacing={p.kind === 'campus' ? 3 : 2.4}
            fontFamily="'IBM Plex Mono', monospace"
            fill={tone}
          >
            {p.label}
          </text>
        )
      })}
    </g>
  )
})

function boundsOf(pts: Pt[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 }
}

function ptsToD(pts: Pt[]): string {
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}`
}

interface SimUnit {
  id: string
  pts: Pt[]
  len: number
  /** ordered route stops: centre distance + the MAIN/CROSS group the unit needs */
  stops: RouteStop[]
  incidentDist: number | null
  d: number
  arrived: boolean
  speedCur: number
  /** real seconds stood at red signals during this run */
  waitT: number
  /** latest corridor plan (fresh each frame while a corridor is open) */
  wave: CorridorJunction[]
}

function buildSim(u: UnitSim, incidentJunctionId: string | null): SimUnit {
  const len = pathLen(u.pts)
  const stops = buildRouteStops(u.pts, u.junctionIds)
  const inc = projectJunctionsAlong(u.pts).find((j) => j.id === incidentJunctionId)
  return {
    id: u.id,
    pts: u.pts,
    len,
    stops,
    incidentDist: inc ? inc.dist : null,
    d: u.d,
    arrived: u.arrived,
    speedCur: 0,
    waitT: 0,
    wave: [],
  }
}

/* ================================================================== */
export default function CityMap({ units, incident, mode, epoch, resetKey, onTelemetry }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [, setTick] = useState(0)
  const [inspected, setInspected] = useState<string | null>(null)

  const simRef = useRef<SimUnit[]>([])
  const propsRef = useRef({ units, incident, mode })
  propsRef.current = { units, incident, mode }
  const cbRef = useRef(onTelemetry)
  cbRef.current = onTelemetry

  /* junctions that carry a corridor label chip on the map */
  const corridorSet = useMemo(() => {
    const s = new Set<string>()
    for (const u of units) for (const j of u.junctionIds) s.add(j)
    return s
  }, [units])

  /* measure host */
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const e = entries[0]
      if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* (re)initialise the internal sim when the parent bumps the epoch */
  useEffect(() => {
    const incId = incident?.junctionId ?? null
    simRef.current = units.map((u) => buildSim(u, incId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch])

  /* full deterministic replay on RESET — signal clock, controllers, fleet */
  useEffect(() => {
    frameTime = 0
    frameCorr.clear()
    for (const j of DISPLAY_SIGNALS) ctlStore.set(j.id, initSigCtl(j.id, 0))
    resetTraffic(13579246, 0)
    clearDecisions()
    clearCorridorState()
    setInspected(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  /* keep each sim's incident creep distance fresh when the incident toggles
     WITHOUT a geometry change (a committed reroute) — the unit still slows
     through the affected zone even though its polyline did not change */
  useEffect(() => {
    const incId = incident?.junctionId ?? null
    for (const sim of simRef.current) {
      if (!incId) {
        sim.incidentDist = null
        continue
      }
      const inc = projectJunctionsAlong(sim.pts).find((j) => j.id === incId)
      sim.incidentDist = inc ? inc.dist : null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident])

  /* follow external position resets (reset demo, redispatch, new unit) */
  useEffect(() => {
    const incId = incident?.junctionId ?? null
    for (const u of units) {
      let sim = simRef.current.find((s) => s.id === u.id)
      if (!sim) {
        sim = buildSim(u, incId)
        simRef.current = [...simRef.current, sim]
        continue
      }
      if (u.arrived !== sim.arrived || Math.abs(u.d - sim.d) > 0.75) {
        sim.d = u.d
        sim.arrived = u.arrived
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units])

  /* 60 Hz sim loop */
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let frameAcc = 0
    let teleAcc = 0
    let waveAcc = 0
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      frameTime += dt

      const { units: uu, incident: inc, mode: md } = propsRef.current

      /* 0. corridor planning — a fresh, moving corridor wave per open unit.
            Purely derived from current state, so delays / reroutes / incident
            re-plan on the next frame without any stored plan to invalidate. */
      frameCorr.clear()
      const signal = {
        stateOf: (jid: string, g: AxisGroupName): 'G' | 'Y' | 'R' => {
          const c = ctlStore.get(jid)
          if (!c) return 'G'
          const st = groupStateOf(c, frameTime, g)
          return st === 'GREEN' ? 'G' : st === 'YELLOW' ? 'Y' : 'R'
        },
        serving: (jid: string): AxisGroupName | null => {
          const c = ctlStore.get(jid)
          if (!c) return null
          return c.phase === 'MG' || c.phase === 'MY' ? 'M' : c.phase === 'XG' || c.phase === 'XY' ? 'X' : null
        },
      }
      for (const sim of simRef.current) {
        const u = uu.find((x) => x.id === sim.id)
        if (!u || !u.dispatched) {
          sim.wave = []
          publishCorridorWave(sim.id, [], frameTime)
          continue
        }
        const corridorOn = u.open && !u.arrived
        sim.wave = corridorOn
          ? planCorridorWave({
              t: frameTime,
              stops: sim.stops,
              d: sim.d,
              cruise: u.speedOpen,
              incidentDist: sim.incidentDist != null && inc ? sim.incidentDist : null,
              corridorOpen: true,
              signal,
            })
          : []
        // keep the UI store (panel/inspector) in sync — throttled publish cadence
        if (waveAcc <= 0 || !corridorOn) publishCorridorWave(sim.id, sim.wave, frameTime)
      }
      waveAcc += dt
      if (waveAcc > 0.1) waveAcc = 0

      /* 1. advance every signal controller — fixed baseline cycles, or the
            pressure optimizer in greenwave mode, or a scheduled corridor
            request from the wave (safe yellow-then-green, green hold) */
      for (const j of DISPLAY_SIGNALS) {
        const ctl = ctlStore.get(j.id)
        if (!ctl) continue
        const req = corridorReqAt(j.id, uu, simRef)
        if (req) frameCorr.set(j.id, req)
        const merged = mergeWithSimObservations(j.id, trafficObservations().get(j.id) ?? null)
        // Step 9: record the exact fused observation the optimizer consumes
        // (prediction history = what the controller sees, never separate data)
        recordJunctionObs(j.id, merged.obs, merged.source, frameTime)
        ctlStore.set(
          j.id,
          advanceSigCtl(ctl, frameTime, dt, {
            junctionId: j.id,
            mode: md === 'greenwave' ? 'adaptive' : 'fixed',
            obs: merged.obs,
            downstream: { M: downstreamCongestion(j.id, 'M'), X: downstreamCongestion(j.id, 'X') },
            emergency: emergencyGroupAt(j.id, uu, simRef),
            corr: req,
            prediction: md === 'greenwave' ? predictionBiasFor(j.id, frameTime) : null,
          }),
        )
      }

      /* 1b. publish real controller snapshots for read-only consumers
            (Live Traffic module) — same controllers, same sim clock */
      for (const j of DISPLAY_SIGNALS) {
        const ctl = ctlStore.get(j.id)
        if (!ctl) continue
        const req = frameCorr.get(j.id) ?? null
        const g = req?.group ?? null
        const held =
          req != null &&
          g != null &&
          frameTime >= req.greenAt - 1 &&
          frameTime < req.releaseAt &&
          ctl.phase === (g === 'M' ? 'MG' : 'XG')
        publishSignalState({
          junctionId: j.id,
          phase: ctl.phase,
          control: req ? 'CORRIDOR' : md === 'greenwave' ? 'ADAPTIVE' : 'FIXED',
          remainS: Math.max(0, Math.ceil(ctl.until - frameTime)),
          lampM: groupStateOf(ctl, frameTime, 'M'),
          lampX: groupStateOf(ctl, frameTime, 'X'),
          corridorHeld: held,
          corridorGroup: held ? g : null,
          t: frameTime,
        })
      }

      /* 2. civilian fleet — reads the controllers, obeys its own group */
      trafficTick(
        dt,
        (j, g) => {
          const c = ctlStore.get(j)
          if (!c) return 'G' as LightState
          const st = groupStateOf(c, frameTime, g)
          return (st === 'GREEN' ? 'G' : st === 'YELLOW' ? 'Y' : 'R') as LightState
        },
        inc?.junctionId ?? null,
      )

      /* 3. ambulances — shared corridor-engine physics (engine/corridor.ts,
            same code the benchmark harness runs): cruise at traffic pace,
            brake to the stop line on red, clear on yellow when close enough,
            and only a corridor-granted green lets it through unimpeded. Real
            standing-at-red time accumulates into waitT. */
      for (const sim of simRef.current) {
        const u = uu.find((x) => x.id === sim.id)
        if (!u) continue
        if (!u.dispatched || u.arrived) {
          sim.speedCur = 0
          continue
        }
        const cruise = u.open ? u.speedOpen : u.speedClosed
        let factor = 1
        // creeping through the incident zone while the reroute engages
        if (inc && sim.incidentDist != null) {
          const dd = sim.incidentDist - sim.d
          if (dd > -80 && dd < 200) factor = 0.25
          else if (dd > 200 && dd < 330) factor = 0.55
        }
        let next: { stopDist: number; light: 'G' | 'Y' | 'R' } | null = null
        const nxt = nextStopOf(sim)
        if (nxt) {
          const ctl = ctlStore.get(nxt.id)
          // the incident junction keeps its real signal controller for the
          // emergency unit (corridor priority or its normal turn on green);
          // a blanket force-red would deadlock a unit whose committed route
          // passes the affected junction. Civilians and the signal head keep
          // their existing incident behavior.
          let st: LightState = 'G'
          if (ctl) {
            const gst = groupStateOf(ctl, frameTime, nxt.group)
            st = gst === 'GREEN' ? 'G' : gst === 'YELLOW' ? 'Y' : 'R'
          }
          next = { stopDist: nxt.centerDist - STOP_OFFSET_PX, light: st }
        }
        const run = stepAmbulance(
          { d: sim.d, v: sim.speedCur, wait: sim.waitT, arrived: sim.arrived },
          dt,
          cruise * factor,
          sim.len,
          next,
        )
        sim.d = run.d
        sim.speedCur = run.v
        sim.waitT = run.wait
        sim.arrived = run.arrived
      }

      teleAcc += dt
      if (teleAcc > 0.12) {
        teleAcc = 0
        cbRef.current(
          simRef.current.map((s) => ({ id: s.id, d: s.d, len: s.len, arrived: s.arrived, wait: s.waitT })),
        )
      }
      frameAcc += dt
      if (frameAcc > 1 / 58) {
        frameAcc = 0
        setTick((t) => t + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* canvas px mapping */
  const scale = box.w > 0 && box.h > 0 ? Math.min(box.w / VW, box.h / VH) : 0
  const cw = VW * scale
  const ch = VH * scale
  const ox = (box.w - cw) / 2
  const oy = (box.h - ch) / 2
  const S = cw / VW

  const destPt = DESTINATION.pt

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden"
      onClick={() => setInspected(null)}
    >
      {/* backdrop */}
      <div
        className="map-grid absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 110% at 50% 38%, rgba(16,28,54,0.55) 0%, rgba(7,11,20,0.25) 48%, rgba(4,6,12,0.6) 100%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: 'inset 0 0 140px rgba(2,4,9,0.85)' }} />

      {scale > 0 && (
        <div className="absolute" style={{ left: ox, top: oy, width: cw, height: ch }}>
          {/* static svg */}
          <svg width={cw} height={ch} viewBox={`0 0 ${VW} ${VH}`} className="block">
            <rect x={0} y={0} width={VW} height={VH} fill="#05080f" />
            <StaticScene />
          </svg>

          {/* animated overlay (world coords -> px via S) */}
          <div className="pointer-events-none absolute left-0 top-0" style={{ width: cw, height: ch }}>
            {/* per-segment congestion layer — driven by the road graph */}
            <CongestionLayer incident={incident} />

            {/* per-corridor svg layers */}
            {simRef.current.map((sim) => {
              const u = units.find((x) => x.id === sim.id)
              if (!u) return null
              const routeOpen = u.open && !sim.arrived
              const head = pointAtDist(sim.pts, sim.d)
              return (
                <CorridorSvg
                  key={sim.id}
                  sim={sim}
                  dispatched={u.dispatched}
                  routeOpen={routeOpen}
                  active={u.active}
                  rerouted={u.rerouted}
                  head={head}
                />
              )
            })}

            {/* corridor wave markers — the coordinated window visibly moves */}
            {simRef.current.map((sim) => {
              const u = units.find((x) => x.id === sim.id)
              if (!u || !u.open || u.arrived) return null
              return sim.wave
                .filter((w) => w.status === 'ACTIVE' || w.status === 'PREPARING')
                .map((w) => <CorridorJunctionMarker key={`${sim.id}:${w.id}`} w={w} scale={S} />)
            })}

            {/* corridor signal lights — click one to inspect its decision */}
            {DISPLAY_SIGNALS.map((j) => (
              <SignalNode
                key={j.id}
                j={j}
                incident={incident}
                corridorSet={corridorSet}
                units={units}
                simRef={simRef}
                scale={S}
                selected={inspected === j.id}
                onInspect={(id) => setInspected(id === inspected ? null : id)}
              />
            ))}

            {/* ordinary traffic — live agents from the traffic engine */}
            {trafficAgents().map((a) => (
              <VehicleNode key={a.id} a={a} scale={S} />
            ))}

            {/* origin markers */}
            {ORIGINS.map((o, i) => {
              const u = units.find((x) => (i === 0 ? x.id === 'em-01' : x.id === 'em-02'))
              return <OriginMarker key={o.id} o={o} visible={!!u} active={!!u && u.active} />
            })}

            {/* destination marker */}
            <div className="absolute z-10" style={{ left: destPt.x * S, top: destPt.y * S }}>
              <div className="-translate-x-1/2 -translate-y-1/2">
                <div className="ring-spread absolute left-0 top-0 h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ops-cyan/50" />
                <div className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-ops-red/70 bg-ops-red/[0.14]">
                  <span className="text-[7px] font-bold leading-none text-ops-red">✚</span>
                </div>
              </div>
            </div>

            {/* ambulances */}
            {simRef.current.map((sim) => {
              const u = units.find((x) => x.id === sim.id)
              if (!u) return null
              const routeOpen = u.open && !sim.arrived
              return (
                <AmbulanceNode
                  key={sim.id}
                  sim={sim}
                  dispatched={u.dispatched}
                  lights={routeOpen || sim.arrived}
                  active={u.active}
                  scale={S}
                />
              )
            })}

            {/* incident marker */}
            {incident && (
              <div className="absolute z-20" style={{ left: incident.x * S, top: incident.y * S }}>
                <div className="-translate-x-1/2 -translate-y-1/2">
                  <div className="ring-spread absolute left-0 top-0 h-[24px] w-[24px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ops-red" />
                  <div
                    className="ring-spread absolute left-0 top-0 h-[24px] w-[24px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ops-red"
                    style={{ animationDelay: '0.8s' }}
                  />
                  <div className="danger-glow h-[10px] w-[10px] rounded-full bg-ops-red shadow-[0_0_14px_rgba(239,61,82,0.9)]" />
                </div>
                <div className="absolute left-[10px] top-[7px] flex items-center gap-1 whitespace-nowrap rounded-[3px] border border-ops-red/50 bg-night-900/90 px-1.5 py-[2px] font-mono text-[7.5px] font-semibold tracking-[0.16em] text-ops-red">
                  <Led tone="red" pulse size={4} />
                  {incident.junctionId} · CONGESTION
                </div>
              </div>
            )}

            {/* scale bar + attribution */}
            <div className="absolute bottom-2 right-2 flex flex-col items-end gap-[3px]">
              <div className="flex items-center gap-1.5">
                <div className="h-px bg-slate-600/70" style={{ width: 300 * projectionS * S }} />
                <span className="font-mono text-[7.5px] tracking-[0.08em] text-slate-600">300 m</span>
              </div>
              <span className="font-mono text-[6.5px] tracking-[0.08em] text-slate-700/80">{OSM_ATTRIBUTION.replace('OpenStreetMap — © ', '© ').split(' (Overpass API)')[0]}</span>
            </div>
          </div>
        </div>
      )}

      {/* optimizer decision inspector — appears when a signal is selected */}
      {inspected && <SignalInspector jid={inspected} mode={mode} onClose={() => setInspected(null)} />}
    </div>
  )
}

/* -------------------- helpers used during render --------------------- */
/** the next route stop the unit still has to obey (stop-line semantics) */
function nextStopOf(sim: SimUnit): RouteStop | null {
  if (sim.arrived) return null
  return nextRouteStop(sim.stops, sim.d)
}

/* -------------------- congestion layer --------------------------------- */
const LEVEL_COLOR: Record<CongestionLevel, string> = {
  NORMAL: 'transparent',
  MODERATE: 'rgba(77,143,201,0.2)',
  HEAVY: 'rgba(232,161,60,0.26)',
  CRITICAL: 'rgba(239,61,82,0.34)',
}

function CongestionLayer({ incident }: { incident: IncidentState | null }) {
  const live = trafficCongestion()
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0" style={{ overflow: 'visible' }}>
      {NETWORK.roads.map((r) => {
        const pts = roadPts(r)
        const adjacent = incident !== null && (r.from === incident.junctionId || r.to === incident.junctionId)
        const base = live.get(r.id) ?? r.congestion
        const score = adjacent ? Math.min(0.98, base + 0.6) : base
        const level = congestionLevel(score)
        if (level === 'NORMAL') return null
        const d = ptsToD(pts)
        const w = roadWidthOf(r) + 3
        return (
          <g key={r.id}>
            <path
              d={d}
              fill="none"
              stroke={LEVEL_COLOR[level]}
              strokeWidth={w}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={adjacent ? 'danger-glow' : undefined}
            />
            {adjacent && (
              <path
                d={d}
                fill="none"
                className="queue-flow"
                stroke="rgba(255,150,165,0.85)"
                strokeWidth={3.5}
                strokeDasharray="26 24"
                strokeLinecap="round"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

/* -------------------- traffic vehicles -------------------------------- */
function VehicleNode({ a, scale }: { a: VehicleAgent; scale: number }) {
  const g = agentGeom(a)
  if (!g) return null
  const pos = pointAtDist(g.pts, g.s)
  const heading = headingAtDist(g.pts, g.s)
  const lat = laneOffset(g.width, g.dir, heading, a.kind === 'truck' || a.kind === 'bus' ? 0.26 : 0.23)
  const x = pos.x + lat.x
  const y = pos.y + lat.y
  // stopped/queued traffic reads dimmer than flowing traffic
  const flow = Math.min(1, a.v / Math.max(1, a.cruise))
  // spawn fade-in / arrival fade-out so vehicles never pop in or vanish
  const fade =
    a.status === 'ARRIVED'
      ? Math.max(0, a.leaving / 0.55)
      : Math.min(1, 0.3 + (a.ageT / 0.6))
  return (
    <div
      className="absolute left-0 top-0 will-change-transform"
      style={{
        transform: `translate(${x * scale}px, ${y * scale}px) rotate(${deg(Math.atan2(heading.y, heading.x))}deg)`,
        opacity: (0.5 + flow * 0.5) * fade,
      }}
    >
      <Vehicle
        kind={a.kind}
        tint={a.tint}
        lengthPx={scale * (a.kind === 'truck' ? 21 : a.kind === 'bus' ? 26 : 14)}
      />
    </div>
  )
}

/* -------------------- signals ------------------------------------------ */
function SignalNode({
  j,
  incident,
  corridorSet,
  units,
  simRef,
  scale,
  selected,
  onInspect,
}: {
  j: SignalJunction
  incident: IncidentState | null
  corridorSet: Set<string>
  units: UnitSim[]
  simRef: React.MutableRefObject<SimUnit[]>
  scale: number
  selected: boolean
  onInspect: (id: string) => void
}) {
  const incidentHere = incident !== null && j.id === incident.junctionId
  const state = displaySignalState(j, incident)
  const isCorr = corridorSet.has(j.id)
  const entry = corridorWaveEntryAt(j.id, units, simRef)
  const isNextForUnit = units.some((u) => {
    if (u.arrived || !u.dispatched) return false
    const sim = simRef.current.find((s) => s.id === u.id)
    if (!sim) return false
    return nextStopOf(sim)?.id === j.id
  })
  const chipVisible = isCorr && (entry != null || isNextForUnit)
  const chip = (() => {
    if (!entry) return null
    if (entry.j.status === 'ACTIVE') {
      return 'hold-breathe border-emerald-400/70 bg-emerald-400/20 text-emerald-100'
    }
    if (entry.j.status === 'PREPARING') {
      return 'border-ops-cyan/60 bg-ops-cyan/12 text-ops-cyan'
    }
    return null
  })()
  return (
    <div
      className="absolute z-10 flex cursor-pointer flex-col items-center"
      style={{ left: j.x * scale, top: j.y * scale }}
      title={`Inspect signal ${j.id}`}
      onClick={(e) => {
        e.stopPropagation()
        onInspect(j.id)
      }}
    >
      <div className="-translate-x-1/2 -translate-y-[calc(100%+4px)] transition-opacity hover:opacity-90">
        {chipVisible && (
          <span
            className={cn(
              'mb-[3px] flex items-center gap-1 rounded-[2px] border px-[3px] py-[1px] text-center font-mono text-[6.5px] font-semibold tracking-[0.06em]',
              chip ??
                (state === 'G'
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200'
                  : incidentHere
                    ? 'danger-glow border-ops-red/60 bg-ops-red/15 text-ops-red'
                    : 'border-white/[0.08] bg-night-900/70 text-slate-500'),
            )}
          >
            {chip && <span className={cn('h-[3px] w-[3px] rounded-full', entry?.j.status === 'ACTIVE' ? 'bg-emerald-200' : 'bg-ops-cyan')} />}
            {j.id}
            {entry && entry.j.status === 'PREPARING' && (
              <span className="tabular text-[6px] font-normal opacity-80">{Math.max(1, Math.round(entry.j.etaSec))}s</span>
            )}
          </span>
        )}
        <TrafficSignal
          state={state}
          size={0.92}
          dim={!isCorr && !incidentHere && !entry}
        />
      </div>
      {selected && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-[30px] w-[30px] rounded-full border border-ops-cyan/70" />
          <div className="ring-spread h-[30px] w-[30px] rounded-full border border-ops-cyan/60" />
        </div>
      )}
    </div>
  )
}

/* -------------------- corridor block inside the inspector ---------------- */
function CorridorInspectorBlock({ jid, mode }: { jid: string; mode: Mode }) {
  const info = corridorJunctionOf(jid)
  if (!info || mode !== 'greenwave') return null
  const j = info.j
  const reqLabel = j.group === 'M' ? 'MAIN' : 'CROSS'
  const active = j.status === 'ACTIVE'
  const prep = j.status === 'PREPARING'
  return (
    <div className="mx-2.5 mb-1.5 overflow-hidden rounded-[3px] border border-emerald-400/20 bg-emerald-400/[0.04]">
      <div className="flex items-center justify-between border-b border-emerald-400/15 bg-emerald-400/[0.05] px-2 py-[3px]">
        <span className="flex items-center gap-1.5 font-mono text-[7px] font-semibold tracking-[0.18em] text-emerald-300/90">
          <Led tone="green" pulse={active} size={4} />
          EMERGENCY CORRIDOR
        </span>
        <span
          className={cn(
            'font-mono text-[7px] font-bold tracking-[0.16em]',
            active ? 'text-emerald-200' : prep ? 'text-ops-cyan' : 'text-emerald-300/70',
          )}
        >
          {active ? '● ACTIVE' : prep ? '◉ PREPARING' : '○ STANDBY'}
        </span>
      </div>
      <div className="space-y-[3px] px-2 py-1.5 font-mono text-[7.5px] tracking-[0.06em] text-slate-300">
        <div className="flex justify-between">
          <span className="text-slate-600">REQUIRED PHASE</span>
          <span className="font-semibold text-emerald-200">{reqLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">AMBULANCE ETA</span>
          <span className="tabular text-emerald-100">
            {active ? 'AT INTERSECTION' : `${j.etaSec.toFixed(1)}s`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">GREEN AT</span>
          <span className="tabular text-slate-200">{Math.max(0, j.greenAt - frameTime).toFixed(1)}s</span>
        </div>
        <div className="pt-[2px] text-[7px] leading-[1.5] tracking-[0.04em] text-slate-400">{j.action}</div>
      </div>
    </div>
  )
}

/* -------------------- optimizer decision inspector ----------------------- */
function SignalInspector({
  jid,
  mode,
  onClose,
}: {
  jid: string
  mode: Mode
  onClose: () => void
}) {
  const ctl = ctlStore.get(jid)
  const obs = mergeWithSimObservations(jid, trafficObservations().get(jid) ?? null).obs
  const down = { M: downstreamCongestion(jid, 'M'), X: downstreamCongestion(jid, 'X') }
  const dec = junctionDecision(jid)
  const pM = groupPressure('M', obs, down)
  const pX = groupPressure('X', obs, down)
  const stM: SignalState = ctl ? groupStateOf(ctl, frameTime, 'M') : 'RED'
  const stX: SignalState = ctl ? groupStateOf(ctl, frameTime, 'X') : 'RED'
  const label = axisRoadLabel(jid)

  const col = (m: string, x: string) => (
    <span className="flex items-center gap-3 font-mono text-[9px] tabular text-slate-300">
      <span className="w-[62px] text-right">{m}</span>
      <span className="w-[62px] text-right">{x}</span>
    </span>
  )
  const row = (k: string, children: React.ReactNode) => (
    <div className="flex items-center justify-between border-t border-white/[0.04] px-2.5 py-[3px]">
      <span className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">{k}</span>
      {children}
    </div>
  )
  const phaseCell = (st: SignalState) => (
    <span className="flex w-[62px] items-center justify-end gap-1 font-mono text-[8px] tracking-[0.08em]">
      <Led
        tone={st === 'GREEN' ? 'green' : st === 'YELLOW' ? 'amber' : 'red'}
        pulse={st === 'GREEN'}
        size={4}
      />
      <span
        className={
          st === 'GREEN'
            ? 'text-emerald-300'
            : st === 'YELLOW'
              ? 'text-ops-amber'
              : 'text-slate-500'
        }
      >
        {st}
      </span>
    </span>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute left-1/2 top-3 z-30 w-[280px] -translate-x-1/2 overflow-hidden rounded-md border border-ops-cyan/20 bg-night-900/95 shadow-[0_14px_36px_rgba(0,0,0,0.55)] backdrop-blur-[2px]"
    >
      <header className="flex h-8 items-center justify-between border-b border-ops-cyan/15 bg-ops-cyan/[0.06] px-2.5">
        <div className="flex items-center gap-1.5">
          <Led tone={mode === 'greenwave' ? 'cyan' : 'slate'} pulse={mode === 'greenwave'} size={4} />
          <span className="font-mono text-[8.5px] font-semibold tracking-[0.18em] text-ops-cyan">
            {mode === 'greenwave' ? 'GREENWAVE DECISION' : 'SIGNAL INSPECTOR'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border border-white/10 font-mono text-[9px] leading-none text-slate-500 transition-colors hover:border-white/25 hover:text-slate-200"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </header>

      <div className="px-2.5 pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-slate-200">{jid}</span>
          <span className="truncate font-mono text-[7.5px] tracking-[0.12em] text-slate-500">{label}</span>
        </div>
      </div>

      {/* emergency corridor block — real values from the corridor engine */}
      <CorridorInspectorBlock jid={jid} mode={mode} />

      <div className="pb-1.5 pt-1">
        <div className="flex items-center justify-between px-2.5 pb-[3px]">
          <span className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">STATE</span>
          <span className="flex items-center gap-3 font-mono text-[7.5px] tracking-[0.16em] text-slate-500">
            <span className="w-[62px] text-right">MAIN</span>
            <span className="w-[62px] text-right">CROSS</span>
          </span>
        </div>
        {row('PHASE', (
          <span className="flex items-center gap-3">
            {phaseCell(stM)}
            {phaseCell(stX)}
          </span>
        ))}
        {row('PRESSURE', col(pM.toFixed(1), pX.toFixed(1)))}
        {row('QUEUE', col(`${obs?.M.queue ?? 0} veh`, `${obs?.X.queue ?? 0} veh`))}
        {row('APPROACH', col(`${obs?.M.approaching ?? 0} veh`, `${obs?.X.approaching ?? 0} veh`))}
        {row('AVG WAIT', col(`${(obs?.M.waitAvg ?? 0).toFixed(1)}s`, `${(obs?.X.waitAvg ?? 0).toFixed(1)}s`))}
        {row('DOWNSTREAM', col(down.M.toFixed(2), down.X.toFixed(2)))}
      </div>

      <footer className="border-t border-ops-cyan/15 bg-night-950/60 px-2.5 py-2">
        <div className="font-mono text-[7px] tracking-[0.16em] text-slate-600">DECISION</div>
        <div className="mt-[2px] font-mono text-[8.5px] leading-[1.5] tracking-[0.04em] text-slate-300">
          {dec
            ? dec.reason
            : mode === 'greenwave'
              ? 'AWAITING OPTIMIZER — measuring queue pressure'
              : 'FIXED TIME — DETERMINISTIC CYCLES ACTIVE'}
        </div>
      </footer>
    </motion.div>
  )
}

/* -------------------- origin markers ----------------------------------- */
function OriginMarker({
  o,
  visible,
  active,
}: {
  o: { id: string; pt: Pt; label: string; short: string }
  visible: boolean
  active: boolean
}) {
  if (!visible) return null
  void o.short
  void active
  return (
    <div className="absolute z-10" style={{ left: o.pt.x, top: o.pt.y }}>
      <div className="-translate-x-1/2 -translate-y-1/2">
        <div className="ring-spread absolute left-0 top-0 h-[20px] w-[20px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ops-cyan/40" />
        <div className="flex h-[12px] w-[12px] items-center justify-center rounded-full border border-ops-cyan/70 bg-night-900/90 shadow-[0_0_10px_rgba(56,196,224,0.4)]">
          <span className="text-[6.5px] font-bold leading-none text-ops-cyan">D</span>
        </div>
        <div className="absolute left-[10px] top-[7px] flex items-center gap-1 whitespace-nowrap rounded-[2px] border border-ops-cyan/25 bg-night-900/80 px-1 py-[1px] font-mono text-[6.5px] tracking-[0.18em] text-slate-500">
          {o.short}
        </div>
      </div>
    </div>
  )
}

/* -------------------- corridor wave junction marker ---------------------- */
function CorridorJunctionMarker({ w, scale }: { w: CorridorJunction; scale: number }) {
  const p = jPt(w.id)
  const active = w.status === 'ACTIVE'
  const label = w.group === 'M' ? 'MAIN' : 'CROSS'
  return (
    <div className="absolute" style={{ left: p.x * scale, top: p.y * scale }}>
      <div className="-translate-x-1/2 -translate-y-1/2">
        {active ? (
          <>
            <span
              className="ring-spread absolute left-0 top-0 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/70"
              style={{ animationDuration: '1.15s' }}
            />
            <span className="absolute left-0 top-0 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300/90 shadow-[0_0_10px_rgba(61,245,154,0.9)]" />
          </>
        ) : (
          <>
            <span
              className="ring-spread absolute left-0 top-0 h-[20px] w-[20px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ops-cyan/50"
              style={{ animationDuration: '2.4s', animationDelay: `${(w.order % 3) * 0.8}s` }}
            />
            <span className="absolute left-0 top-0 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-ops-cyan/80 bg-ops-cyan/40" />
          </>
        )}
        <span
          className={cn(
            'absolute left-[7px] top-[4px] whitespace-nowrap rounded-[2px] border px-1 py-[1px] font-mono text-[6px] font-semibold tracking-[0.14em]',
            active
              ? 'border-emerald-300/50 bg-night-950/85 text-emerald-200'
              : 'border-ops-cyan/30 bg-night-950/85 text-ops-cyan/90',
          )}
        >
          {w.id} {label}
        </span>
      </div>
    </div>
  )
}

/* -------------------- corridor svg overlay ------------------------------ */
function CorridorSvg({
  sim,
  dispatched,
  routeOpen,
  active,
  rerouted,
  head,
}: {
  sim: SimUnit
  dispatched: boolean
  routeOpen: boolean
  active: boolean
  rerouted: boolean
  head: Pt
}) {
  const hf = sim.len > 0 ? Math.min(1, Math.max(0.02, sim.d / sim.len)) : 0.02
  const d = ptsToD(sim.pts)

  if (!dispatched) return null

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} className="absolute inset-0" style={{ overflow: 'visible' }}>
      {!routeOpen ? (
        /* standby plan: draws in once, then waits for the corridor */
        <motion.path
          key="standby"
          d={d}
          fill="none"
          stroke="rgba(133,164,205,0.38)"
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
      ) : (
        <>
          {/* corridor base glow */}
          <path d={d} fill="none" stroke="rgba(47,224,138,0.3)" strokeWidth={10} strokeLinecap="round" />
          {/* cleared corridor: start -> ambulance head */}
          <path
            d={d}
            fill="none"
            pathLength={1}
            stroke="rgba(47,224,138,0.18)"
            strokeWidth={16}
            strokeDasharray={`${hf} ${1 - hf}`}
            strokeLinecap="round"
          />
          <path
            d={d}
            fill="none"
            pathLength={1}
            stroke="#79f5b7"
            strokeWidth={3}
            strokeDasharray={`${hf} ${1 - hf}`}
            strokeLinecap="round"
            opacity={0.95}
          />
          {/* green wave dashes sweeping the full route */}
          <path d={d} fill="none" className="flow-dash" stroke="#a6ffd5" strokeWidth={2} strokeLinecap="round" strokeDasharray="26 40" opacity={0.8} />
        </>
      )}
      {/* destination ring */}
      <circle cx={destPtOf(sim).x} cy={destPtOf(sim).y} r={13} fill="none" stroke={routeOpen ? 'rgba(47,224,138,0.7)' : 'rgba(129,160,205,0.35)'} strokeWidth={1.6} strokeDasharray="4 5" />
      <circle cx={destPtOf(sim).x} cy={destPtOf(sim).y} r={5.5} fill={routeOpen ? 'rgba(47,224,138,0.25)' : 'rgba(129,160,205,0.12)'} stroke={routeOpen ? '#2fe08a' : '#7ea4cd'} strokeWidth={1.6} />
      {/* glow pool under the ambulance head */}
      {routeOpen && <circle cx={head.x} cy={head.y} r={9.5} fill="rgba(47,224,138,0.16)" />}
      {/* active unit ring around its head */}
      {active && routeOpen && <circle cx={head.x} cy={head.y} r={11} fill="none" stroke="rgba(56,196,224,0.85)" strokeWidth={1.4} opacity={0.75} />}
      {/* recalc detour dashes */}
      {rerouted && (
        <path d={d} fill="none" stroke="rgba(56,196,224,0.5)" strokeWidth={2} strokeDasharray="7 6" strokeLinecap="round" opacity={0.85} />
      )}
    </svg>
  )
}

let _destPtCache: Pt = { x: 0, y: 0 }
function destPtOf(sim: SimUnit): Pt {
  // endpoint of the unit's own geometry (its destination)
  return sim.pts.length ? sim.pts[sim.pts.length - 1] : _destPtCache
}

/* -------------------- ambulance html sprite ----------------------------- */
function AmbulanceNode({
  sim,
  dispatched,
  lights,
  active,
  scale,
}: {
  sim: SimUnit
  dispatched: boolean
  lights: boolean
  active: boolean
  scale: number
}) {
  const dd = dispatched ? Math.min(sim.d, Math.max(0.0001, sim.len)) : 0.5
  const heading = headingAtDist(sim.pts, dd)
  const lat = laneOffset(12, 1, heading, 0.2)
  const p = !dispatched
    ? sim.pts[0]
    : sim.arrived
      ? sim.pts[sim.pts.length - 1]
      : pointAtDist(sim.pts, sim.d)
  const x = p.x + lat.x
  const y = p.y + lat.y
  return (
    <div
      className={cn('absolute left-0 top-0 will-change-transform', !active && 'opacity-90')}
      style={{ transform: `translate(${x * scale}px, ${y * scale}px) rotate(${deg(Math.atan2(heading.y, heading.x))}deg)`, zIndex: 5 }}
    >
      {/* pre-dispatch idle pulse at the origin */}
      {!dispatched && (
        <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="ring-spread h-[26px] w-[26px] rounded-full border border-ops-cyan/45" />
          <div
            className="ring-spread h-[26px] w-[26px] rounded-full border border-ops-cyan/35"
            style={{ animationDelay: '0.8s' }}
          />
        </div>
      )}
      <Ambulance lengthPx={scale * 33} lights={lights} arrived={sim.arrived} />
    </div>
  )
}
