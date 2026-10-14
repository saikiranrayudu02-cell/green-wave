// ---------------------------------------------------------------------------
// GREENWAVE Step 5 — corridor engine benchmark harness
//
// Runs the SAME deterministic scenario twice (same seed, same road graph, same
// dispatch instant, identical traffic history up to dispatch):
//
//   A — FIXED TIME, NO CORRIDOR          (the baseline)
//   B — GREENWAVE + INTELLIGENT CORRIDOR (scheduled green wave)
//
// The ambulance, signals, corridor planner and civilian fleet all run the
// exact engine code the live command center uses (engine/signals.ts,
// engine/corridor.ts, engine/vehicles.ts) — nothing is reimplemented here.
// Reported numbers are simulated-scenario results, not real-world claims.
// ---------------------------------------------------------------------------
import { NETWORK, ORIGIN_EM1_ID, ENTRANCE_ID, DISPLAY_SIGNAL_IDS } from '../src/data/osmRoadNetwork'
import type { AxisGroupName } from '../src/data/osmRoadNetwork'
import { planPair } from '../src/engine/routePlanner'
import { initSigCtl, advanceSigCtl, groupStateOf } from '../src/engine/signals'
import type { SigCtl } from '../src/engine/signals'
import { resetTraffic, trafficTick } from '../src/engine/vehicles'
import type { LightState } from '../src/engine/vehicles'
import {
  buildRouteStops,
  nextRouteStop,
  planCorridorWave,
  corridorRequestFor,
  stepAmbulance,
} from '../src/engine/corridor'
import type { CorridorJunction } from '../src/engine/corridor'
import { clearDecisions } from '../src/engine/pressure'
import { pathLen } from '../src/utils/geo'

const SEED = 13579246
const DT = 1 / 30
const DISPATCH_AT = 60 // sim seconds after start — fleet is mature but identical in A/B

const SPEED_CLOSED = 9.5 // px/s baseline (app value)
const SPEED_OPEN = 42 // px/s under a green corridor (app value)
const STOP_OFFSET = 12 // px before a junction centre where a unit must stop

const pair = planPair(NETWORK, ORIGIN_EM1_ID, ENTRANCE_ID)!
const plan = pair.plan
const stops = buildRouteStops(plan.pts, plan.junctionIds)
const len = pathLen(plan.pts)

const lightOf = (c: SigCtl, g: AxisGroupName): LightState => {
  const st = groupStateOf(c, 0, g)
  return st === 'GREEN' ? 'G' : st === 'YELLOW' ? 'Y' : 'R'
}

interface Out {
  travelSec: number
  signalWaitSec: number
  stopCount: number
}

function runScenario(opts: { corridor: boolean; mode: 'fixed' | 'adaptive' }): Out {
  resetTraffic(SEED, 0)
  clearDecisions()

  const ctls = new Map<string, SigCtl>()
  for (const id of DISPLAY_SIGNAL_IDS) ctls.set(id, initSigCtl(id, 0))

  const unit = { d: 0, v: 0, wait: 0, arrived: false }
  let dispatched = false
  let arrivalT = -1
  let lastStopI = -1
  let stopCount = 0
  const maxT = DISPATCH_AT + 700

  for (let t = 0; t <= maxT && !unit.arrived; t += DT) {
    const active = t >= DISPATCH_AT
    if (active && !dispatched) dispatched = true

    const stateOf = (jid: string, g: AxisGroupName): LightState => {
      const c = ctls.get(jid)
      return c ? lightOf(c, g) : 'G'
    }

    /* corridor wave for the open unit (scenario B, once dispatched) */
    let wave: CorridorJunction[] = []
    if (opts.corridor && active) {
      wave = planCorridorWave({
        t,
        stops,
        d: unit.d,
        cruise: SPEED_OPEN,
        incidentDist: null,
        corridorOpen: true,
        signal: {
          stateOf,
          serving: (jid) => {
            const c = ctls.get(jid)
            if (!c) return null
            return c.phase === 'MG' || c.phase === 'MY'
              ? 'M'
              : c.phase === 'XG' || c.phase === 'XY'
                ? 'X'
                : null
          },
        },
      })
    }
    const reqByJ = new Map<string, { group: AxisGroupName; greenAt: number; releaseAt: number }>()
    for (const j of wave) {
      if (j.priority === 'NONE') continue
      const r = corridorRequestFor(j)
      if (r) {
        const cur = reqByJ.get(j.id)
        if (!cur || r.greenAt < cur.greenAt) reqByJ.set(j.id, r)
      }
    }

    /* signals — fixed cycles (A) or adaptive + corridor windows (B) */
    for (const id of DISPLAY_SIGNAL_IDS) {
      const c = ctls.get(id)!
      ctls.set(
        id,
        advanceSigCtl(c, t, DT, {
          junctionId: id,
          mode: opts.mode === 'adaptive' && active ? 'adaptive' : 'fixed',
          obs: null,
          downstream: { M: 0, X: 0 },
          emergency: null,
          corr: opts.corridor && active ? (reqByJ.get(id) ?? null) : null,
        }),
      )
    }

    /* civilian fleet — the identical seeded stream in both runs */
    trafficTick(
      DT,
      (j, g) => {
        const c = ctls.get(j)
        return c ? lightOf(c, g) : 'G'
      },
      null,
    )

    /* ambulance — the same physics the live map runs */
    if (active) {
      let next: { stopDist: number; light: LightState } | null = null
      const s = nextRouteStop(stops, unit.d)
      if (s) next = { stopDist: s.centerDist - STOP_OFFSET, light: stateOf(s.id, s.group) }
      const cruise = opts.corridor ? SPEED_OPEN : SPEED_CLOSED
      const run = stepAmbulance(unit, DT, cruise, len, next)
      unit.d = run.d
      unit.v = run.v
      unit.wait = run.wait
      unit.arrived = run.arrived
      if (unit.arrived) arrivalT = t
      // count distinct signal stops (unit came to rest at a red stop line)
      if (next && next.light === 'R') {
        const sdl = next.stopDist - unit.d
        if (unit.v < 0.4 && sdl <= 6.5 && sdl >= -3) {
          const stopI = stops.findIndex((s) => Math.abs(s.centerDist - STOP_OFFSET - next!.stopDist) < 2)
          if (stopI !== lastStopI) {
            lastStopI = stopI
            stopCount++
          }
        }
      }
    }
  }

  return {
    travelSec: arrivalT > 0 ? arrivalT - DISPATCH_AT : -1,
    signalWaitSec: unit.wait,
    stopCount,
  }
}

// ---------------------------------------------------------------------------
const a = runScenario({ corridor: false, mode: 'fixed' })
const b = runScenario({ corridor: true, mode: 'adaptive' })

console.log('GREENWAVE STEP 5 — deterministic corridor benchmark (same seed, same dispatch instant)')
console.log(`route: ${ORIGIN_EM1_ID} → ${ENTRANCE_ID} · ${stops.length} signal stops · ${len.toFixed(0)} px`)
console.log('')
console.log(`A · FIXED TIME, NO CORRIDOR`.padEnd(42), `travel ${a.travelSec.toFixed(1)}s   signal wait ${a.signalWaitSec.toFixed(1)}s   red stops ${a.stopCount}`)
console.log(`B · GREENWAVE + CORRIDOR`.padEnd(42), `travel ${b.travelSec.toFixed(1)}s   signal wait ${b.signalWaitSec.toFixed(1)}s   red stops ${b.stopCount}`)
console.log('')
if (a.travelSec > 0 && b.travelSec > 0) {
  const saveT = (1 - b.travelSec / a.travelSec) * 100
  const saveW = Math.max(0, a.signalWaitSec - b.signalWaitSec)
  console.log(`simulated improvement: travel time −${saveT.toFixed(1)}%   signal delay avoided ${saveW.toFixed(1)}s (${a.signalWaitSec.toFixed(1)}s → ${b.signalWaitSec.toFixed(1)}s)`)
} else {
  console.log('one scenario never arrived — check corridor/signal behaviour')
  process.exit(1)
}
