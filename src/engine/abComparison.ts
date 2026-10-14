// ---------------------------------------------------------------------------
// GREENWAVE — Step 16: Controlled A/B impact proof (Fixed Timing vs GreenWave)
//
// A thin comparison/evaluation layer around the EXISTING engines. There is no
// second simulator, no second signal controller, no second corridor engine:
//
//   · traffic fleet  → engine/vehicles.ts   (resetTraffic(seed, t) replays)
//   · signals        → engine/signals.ts    (pure SigCtl state machine)
//   · corridor wave  → engine/corridor.ts   (planCorridorWave / stepAmbulance)
//   · prediction     → engine/trafficPrediction.ts (recordJunctionObs +
//                       predictionBiasFor, exactly what the live controller
//                       consumes in greenwave mode)
//   · optimizer      → engine/pressure.ts   (downstreamCongestion + the
//                       adaptive decisions inside advanceSigCtl)
//
// FAIRNESS: both legs start from resetTraffic(seed, 0) + initSigCtl(id, 0) +
// resetPrediction() — identical fleet, identical signal clocks, identical
// route, identical incident, identical ambulance capability. Only the control
// strategy differs:
//
//   FIXED     mode 'fixed'   — fixed baseline cycles, no corridor, no bias
//   GREENWAVE mode 'adaptive' — pressure optimizer + predictive corridor
//                               (corridor wave + forecast bias)
//
// ISOLATION: this module mutates the module-level engine stores, so it must
// run in a FRESH context — the browser executes it inside a Web Worker
// (src/engine/abWorker.ts) and the verification harness runs it in its own
// node process. It is never invoked from the live app's render loop, so the
// live simulation is never disturbed.
// ---------------------------------------------------------------------------
import { DISPLAY_SIGNAL_IDS, projectJunctionsAlong } from '../data/osmRoadNetwork'
import type { AxisGroupName } from '../data/osmRoadNetwork'
import { advanceSigCtl, groupStateOf, initSigCtl } from './signals'
import type { SigCtl } from './signals'
import {
  resetTraffic,
  STOP_OFFSET_PX,
  trafficMetrics,
  trafficObservations,
  trafficTick,
} from './vehicles'
import type { LightState } from './vehicles'
import { downstreamCongestion, clearDecisions } from './pressure'
import {
  buildRouteStops,
  corridorRequestFor,
  effectiveCruise,
  nextRouteStop,
  planCorridorWave,
  stepAmbulance,
} from './corridor'
import type { CorrStatus, CorridorJunction, RouteStop } from './corridor'
import { resetPrediction, recordJunctionObs, predictionBiasFor } from './trafficPrediction'
import { pathLen } from '../utils/geo'
import type { Pt } from '../utils/geo'

/* ------------------------------- types ----------------------------------- */

export type ABLegId = 'fixed' | 'greenwave'

export type ABPhase =
  | 'IDLE'
  | 'CAPTURING'
  | 'RUNNING_FIXED'
  | 'RUNNING_GREENWAVE'
  | 'COMPARING'
  | 'COMPLETE'
  | 'ERROR'

/** everything that defines the scenario — identical for both legs */
export interface ABConfig {
  routeId: string
  /** real route geometry from the routing engine (canvas units) */
  pts: Pt[]
  /** coordinated signal stops on the route, in travel order */
  junctionIds: string[]
  /** incident junction (same for both legs), null = no incident */
  incidentJunctionId: string | null
  /** ambulance capability — SAME cruise for both legs (px/s); only signal
   *  control differs, so the comparison isolates the control strategy */
  speedPx: number
  /** deterministic fleet seed — defaults to the live app's seed */
  seed?: number
  /** hard horizon (sim s) so a stuck leg still yields a measured result */
  horizonSec?: number
  dt?: number
}

/** one second of measured network state during a leg */
export interface ABNetworkSample {
  t: number
  avgWaitSec: number
  avgSpeedKmh: number
  queuedCount: number
  queueM: number
  /** rolling completion rate scaled to veh/hr — the SAME authoritative
   *  throughput metric Analytics renders (trafficMetrics().ratePerHour) */
  ratePerHour: number
  loadPct: number
}

/** real corridor transition observed during the GREENWAVE leg */
export interface ABCorridorRow {
  t: number
  junctionId: string
  kind: 'PREPARING' | 'GREEN HELD' | 'PASSED'
  etaSec: number
}

export interface ABLegResult {
  leg: ABLegId
  /** sim seconds from t0 to ambulance arrival (the measured ETA) */
  travelTimeSec: number
  /**
   * signal delay — travel time vs the leg's free-flow cruise time, computed
   * with the engine's own effectiveCruise (same cruise + incident zones, no
   * signals). Both legs use the identical formula; the non-signal floor
   * (launch ramp + incident creep) is present in BOTH numbers, so the delta
   * isolates signal control. Naturally ≥ 0; a corridor leg that held green
   * for the whole route measures only that tiny floor, never a fabricated 0.
   */
  signalWaitSec: number
  arrived: boolean
  /** mean fleet wait over the leg — the honest network delay */
  avgNetworkDelaySec: number
  /** mean vehicles at rest over the leg */
  stoppedVehicles: number
  avgSpeedKmh: number
  avgQueueM: number
  /** mean network throughput rate over the leg (veh/hr) — identical
   *  definition and aggregation to Analytics' ratePerHour */
  ratePerHour: number
  avgLoadPct: number
  samples: number
  /** corridor transitions (empty on the FIXED leg by construction) */
  corridor: ABCorridorRow[]
}

export interface ABDelta {
  /** greenWave − fixed (raw) */
  abs: number
  /** signed % — positive always means GreenWave better */
  pct: number | null
}

export interface ABResult {
  routeId: string
  routeKey: string
  incidentJunctionId: string | null
  seed: number
  horizonSec: number
  dt: number
  startedAtMs: number
  completedAtMs: number
  fixed: ABLegResult
  greenWave: ABLegResult
  delta: {
    emergencyEtaSec: ABDelta
    signalWaitSec: ABDelta
    avgNetworkDelaySec: ABDelta
    stoppedVehicles: ABDelta
    avgQueueM: ABDelta
    avgSpeedKmh: ABDelta
    ratePerHour: ABDelta
  }
}

/* ------------------------------- runner ---------------------------------- */

const LEG_SEED = 13579246 // the live app's demo seed (resetTraffic in CityMap)
const DT = 0.1
const HORIZON = 900

/** signed % — positive = GreenWave better (lowerBetter flips the sign) */
function delta(fixed: number, greenWave: number, lowerBetter: boolean): ABDelta {
  const abs = greenWave - fixed
  const pct =
    fixed === 0 ? null : ((lowerBetter ? fixed - greenWave : greenWave - fixed) / Math.abs(fixed)) * 100
  return { abs, pct }
}

function lightChar(st: ReturnType<typeof groupStateOf>): LightState {
  return st === 'GREEN' ? 'G' : st === 'YELLOW' ? 'Y' : 'R'
}

/** run one leg from the deterministic initial state */
export function runABLeg(cfg: ABConfig, leg: ABLegId): ABLegResult {
  const seed = cfg.seed ?? LEG_SEED
  const dt = cfg.dt ?? DT
  const horizon = cfg.horizonSec ?? HORIZON
  const cruise = cfg.speedPx

  /* identical starting state for every leg */
  resetTraffic(seed, 0)
  resetPrediction()
  clearDecisions()

  const ctlStore = new Map<string, SigCtl>()
  for (const id of DISPLAY_SIGNAL_IDS) ctlStore.set(id, initSigCtl(id, 0))

  const len = pathLen(cfg.pts)
  const stops: RouteStop[] = buildRouteStops(cfg.pts, cfg.junctionIds)
  const incOnRoute =
    cfg.incidentJunctionId != null
      ? projectJunctionsAlong(cfg.pts).find((j) => j.id === cfg.incidentJunctionId)?.dist ?? null
      : null
  /* free-flow travel time for THIS leg — same cruise + incident zones, zero
     signal constraints (the engine's own effectiveCruise physics). The signal
     delay metric = measured travel − this baseline, identical in both legs. */
  const freeFlowSec = len / Math.max(0.001, effectiveCruise(cruise, incOnRoute, 0, len))

  const corridorOpen = leg === 'greenwave'
  const signal = {
    stateOf: (jid: string, g: AxisGroupName): 'G' | 'Y' | 'R' => {
      const c = ctlStore.get(jid)
      if (!c) return 'G'
      const st = groupStateOf(c, t, g)
      return st === 'GREEN' ? 'G' : st === 'YELLOW' ? 'Y' : 'R'
    },
    serving: (jid: string): AxisGroupName | null => {
      const c = ctlStore.get(jid)
      if (!c) return null
      return c.phase === 'MG' || c.phase === 'MY' ? 'M' : c.phase === 'XG' || c.phase === 'XY' ? 'X' : null
    },
  }

  let t = 0
  let run = { d: 0, v: 0, wait: 0, arrived: false }
  const samples: ABNetworkSample[] = []
  const corridor: ABCorridorRow[] = []
  const prevStatus = new Map<string, CorrStatus>()

  const recordCorr = (j: CorridorJunction) => {
    const key = j.id
    const prev = prevStatus.get(key)
    if (prev === j.status) return
    prevStatus.set(key, j.status)
    if (j.status === 'PREPARING') corridor.push({ t, junctionId: j.id, kind: 'PREPARING', etaSec: j.etaSec })
    else if (j.status === 'ACTIVE') corridor.push({ t, junctionId: j.id, kind: 'GREEN HELD', etaSec: j.etaSec })
    else if (j.status === 'PASSED') corridor.push({ t, junctionId: j.id, kind: 'PASSED', etaSec: 0 })
    if (corridor.length > 60) corridor.splice(0, corridor.length - 60)
  }

  while (t < horizon && !run.arrived) {
    /* corridor wave — pure engine logic, only on the GREENWAVE leg */
    let wave: CorridorJunction[] = []
    if (corridorOpen) {
      wave = planCorridorWave({
        t,
        stops,
        d: run.d,
        cruise,
        incidentDist: incOnRoute != null ? incOnRoute : null,
        corridorOpen: true,
        signal,
      })
      for (const j of wave) recordCorr(j)
    }

    /* advance every real signal controller */
    for (const id of DISPLAY_SIGNAL_IDS) {
      const ctl = ctlStore.get(id)
      if (!ctl) continue
      const wj = corridorOpen ? wave.find((j) => j.id === id && j.priority !== 'NONE') : undefined
      ctlStore.set(
        id,
        advanceSigCtl(ctl, t, dt, {
          junctionId: id,
          mode: leg === 'greenwave' ? 'adaptive' : 'fixed',
          obs: trafficObservations().get(id) ?? null,
          downstream: { M: downstreamCongestion(id, 'M'), X: downstreamCongestion(id, 'X') },
          emergency: null, // the corridor (not the soft boost) carries the unit
          corr: wj ? corridorRequestFor(wj) : null,
          prediction: leg === 'greenwave' ? predictionBiasFor(id, t) : null,
        }),
      )
    }

    /* civilian fleet — reads the same controllers, deterministic fleet */
    trafficTick(
      dt,
      (j, g) => {
        const c = ctlStore.get(j)
        if (!c) return 'G' as LightState
        return lightChar(groupStateOf(c, t, g))
      },
      cfg.incidentJunctionId,
    )

    /* ambulance — shared corridor-engine physics, identical capability */
    let factor = 1
    if (incOnRoute != null) {
      const dd = incOnRoute - run.d
      if (dd > -80 && dd < 200) factor = 0.25
      else if (dd > 200 && dd < 330) factor = 0.55
    }
    const nxt = nextRouteStop(stops, run.d)
    let next: { stopDist: number; light: 'G' | 'Y' | 'R' } | null = null
    if (nxt) {
      const c = ctlStore.get(nxt.id)
      const st = c ? groupStateOf(c, t, nxt.group) : 'GREEN'
      next = { stopDist: nxt.centerDist - STOP_OFFSET_PX, light: lightChar(st) }
    }
    run = stepAmbulance(run, dt, cruise * factor, len, next)

    /* record observations + network samples at 1 s cadence */
    t += dt
    if (Math.abs(t - Math.round(t)) < dt / 2) {
      for (const id of DISPLAY_SIGNAL_IDS) {
        const obs = trafficObservations().get(id)
        if (obs) recordJunctionObs(id, obs, 'SIMULATION', t)
      }
      const m = trafficMetrics()
      samples.push({
        t,
        avgWaitSec: m.avgWaitSec,
        avgSpeedKmh: m.avgSpeedKmh,
        queuedCount: m.queuedCount,
        queueM: m.queueM,
        ratePerHour: m.ratePerHour,
        loadPct: m.loadPct,
      })
    }
  }

  const mean = (pick: (s: ABNetworkSample) => number): number => {
    if (samples.length === 0) return 0
    let s = 0
    for (const x of samples) s += pick(x)
    return s / samples.length
  }

  const travelSec = run.arrived ? t : horizon
  return {
    leg,
    travelTimeSec: travelSec,
    /* delay vs free-flow cruise (see ABLegResult comment). Clamped at 0 only
       against float noise — the physics guarantee travel ≥ free-flow. */
    signalWaitSec: Math.max(0, travelSec - freeFlowSec),
    arrived: run.arrived,
    avgNetworkDelaySec: mean((s) => s.avgWaitSec),
    stoppedVehicles: mean((s) => s.queuedCount),
    avgSpeedKmh: mean((s) => s.avgSpeedKmh),
    avgQueueM: mean((s) => s.queueM),
    ratePerHour: mean((s) => s.ratePerHour),
    avgLoadPct: mean((s) => s.loadPct),
    samples: samples.length,
    corridor,
  }
}

/** FIXED leg, then GREENWAVE leg from the identical initial state */
export function runABScenario(cfg: ABConfig): ABResult {
  const startedAtMs = Date.now()
  const fixed = runABLeg(cfg, 'fixed')
  const greenWave = runABLeg(cfg, 'greenwave')
  return assembleABResult(cfg, fixed, greenWave, startedAtMs)
}

/** join the two measured legs into a comparison (shared by worker + harness) */
export function assembleABResult(
  cfg: ABConfig,
  fixed: ABLegResult,
  greenWave: ABLegResult,
  startedAtMs = Date.now(),
): ABResult {
  return {
    routeId: cfg.routeId,
    routeKey: cfg.junctionIds.length > 1 ? `${cfg.junctionIds[0]} → ${cfg.junctionIds[cfg.junctionIds.length - 1]}` : '—',
    incidentJunctionId: cfg.incidentJunctionId,
    seed: cfg.seed ?? LEG_SEED,
    horizonSec: cfg.horizonSec ?? HORIZON,
    dt: cfg.dt ?? DT,
    startedAtMs,
    completedAtMs: Date.now(),
    fixed,
    greenWave,
    delta: {
      emergencyEtaSec: delta(fixed.travelTimeSec, greenWave.travelTimeSec, true),
      signalWaitSec: delta(fixed.signalWaitSec, greenWave.signalWaitSec, true),
      avgNetworkDelaySec: delta(fixed.avgNetworkDelaySec, greenWave.avgNetworkDelaySec, true),
      stoppedVehicles: delta(fixed.stoppedVehicles, greenWave.stoppedVehicles, true),
      avgQueueM: delta(fixed.avgQueueM, greenWave.avgQueueM, true),
      avgSpeedKmh: delta(fixed.avgSpeedKmh, greenWave.avgSpeedKmh, false),
      ratePerHour: delta(fixed.ratePerHour, greenWave.ratePerHour, false),
    },
  }
}

/* ---------------- session store (main thread keeps the last result) ------- */

let lastResult: ABResult | null = null

export function abLastResult(): ABResult | null {
  return lastResult
}

export function setABLastResult(r: ABResult | null): void {
  lastResult = r
}