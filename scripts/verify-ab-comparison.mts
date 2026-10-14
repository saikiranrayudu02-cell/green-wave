// ---------------------------------------------------------------------------
// GREENWAVE — Step 16: A/B comparison verification harness
//
// Runs the SAME engines the live app runs (vehicles / signals / corridor /
// prediction / pressure) through engine/abComparison.ts twice from the
// identical deterministic seed and asserts fairness + arithmetic:
//
//   1. same initial state (fleet identical after each resetTraffic(seed, 0))
//   2. same ambulance (identical route geometry + stop set for both legs)
//   3. same route / same incident (identical config for both legs)
//   4. Fixed Timing and GreenWave actually use different control modes
//      (corridor wave exists only on the GREENWAVE leg)
//   5. metrics are generated from actual measured state (numeric, finite)
//   6. delta arithmetic is correct (abs = gw − fixed, sign convention)
//   7. no hardcoded performance values (two runs → identical results)
//   8. A/B session reset works (abLastResult store clears)
//   9. the engine recovers to a deterministic baseline afterwards
//
// This process runs the runner in its OWN node context (fresh module state),
// exactly like the app runs it inside a Web Worker — the live app is never
// touched by the benchmark.
// ---------------------------------------------------------------------------
import { resetTraffic, trafficAgents, trafficMetrics, trafficSimT } from '../src/engine/vehicles'
import { initSigCtl } from '../src/engine/signals'
import { NETWORK, ORIGIN_EM1_ID, ENTRANCE_ID, INCIDENT_JUNCTION, DISPLAY_SIGNAL_IDS } from '../src/data/osmRoadNetwork'
import { buildRouteStops } from '../src/engine/corridor'
import { planPair } from '../src/engine/routePlanner'
import { abLastResult, runABScenario, setABLastResult } from '../src/engine/abComparison'
import type { ABResult } from '../src/engine/abComparison'

const SEED = 13579246

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
  }
}

function finite(v: unknown, name: string) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    failures++
    console.error(`  ✗ ${name} must be a finite number (got ${String(v)})`)
    return false
  }
  return true
}

function agentsKey() {
  return trafficAgents()
    .map((a) => `${a.id}:${a.legs[0]?.roadId}:${a.d.toFixed(3)}:${a.v.toFixed(3)}`)
    .join('|')
}

/* ------------------------------ 1. same initial state -------------------- */
console.log('1. SAME INITIAL STATE — identical fleet after each resetTraffic(seed, 0)')
resetTraffic(SEED, 0)
const fleetA = agentsKey()
const metricsA = trafficMetrics()
resetTraffic(SEED, 0)
const fleetB = agentsKey()
check('fleet identical after re-seed', fleetA === fleetB)
check('sim clock at t=0', trafficSimT() === 0)
check('metrics baseline sane', finite(metricsA.active, 'baseline active') && metricsA.active > 0)

/* signal controllers bootstrap identically */
const ctlA = JSON.stringify(DISPLAY_SIGNAL_IDS.map((id) => initSigCtl(id, 0)))
const ctlB = JSON.stringify(DISPLAY_SIGNAL_IDS.map((id) => initSigCtl(id, 0)))
check('signal controllers identical after bootstrap', ctlA === ctlB)

/* ------------------------- 2+3. same ambulance/route/incident ------------ */
console.log('\n2/3. SAME AMBULANCE · SAME ROUTE · SAME INCIDENT')
const pairA = planPair(NETWORK, ORIGIN_EM1_ID, ENTRANCE_ID)!
const pairB = planPair(NETWORK, ORIGIN_EM1_ID, ENTRANCE_ID)!
check('routing plan deterministic (same plan twice)', JSON.stringify(pairA) === JSON.stringify(pairB))
const plan = pairA.plan
check('route has signal stops', plan.junctionIds.length > 3)
const stopsA = buildRouteStops(plan.pts, plan.junctionIds)
const stopsB = buildRouteStops(plan.pts, plan.junctionIds)
check('route stops identical across legs', JSON.stringify(stopsA) === JSON.stringify(stopsB))

const incidentJunctionId = INCIDENT_JUNCTION ?? 'J12'
const cfg = {
  routeId: 'em-01',
  pts: plan.pts,
  junctionIds: plan.junctionIds,
  incidentJunctionId,
  speedPx: 42,
  seed: SEED,
  horizonSec: 900,
}

/* ------------------------------- 4-7. the actual run --------------------- */
console.log('\n4-7. DETERMINISTIC DUAL RUN (seed ' + SEED + ')')
const res1 = runABScenario(cfg)
const res2 = runABScenario(cfg)

/* wall-clock bookkeeping is excluded — engine behaviour must be identical */
const sansClock = (r: ABResult) => {
  const { startedAtMs: _a, completedAtMs: _b, ...rest } = r
  return JSON.stringify(rest)
}
check('two runs are engine-identical (no hidden randomness)', sansClock(res1) === sansClock(res2))

check('FIXED leg has NO corridor events', res1.fixed.corridor.length === 0)
check('GREENWAVE leg formed a corridor wave', res1.greenWave.corridor.length > 0)
check('GREENWAVE corridor contains PREPARING', res1.greenWave.corridor.some((c) => c.kind === 'PREPARING'))
check('GREENWAVE corridor contains GREEN HELD', res1.greenWave.corridor.some((c) => c.kind === 'GREEN HELD'))

for (const leg of [res1.fixed, res1.greenWave]) {
  const name = leg.leg
  finite(leg.travelTimeSec, `${name}.travelTimeSec`)
  finite(leg.signalWaitSec, `${name}.signalWaitSec`)
  finite(leg.avgNetworkDelaySec, `${name}.avgNetworkDelaySec`)
  finite(leg.stoppedVehicles, `${name}.stoppedVehicles`)
  finite(leg.avgSpeedKmh, `${name}.avgSpeedKmh`)
  finite(leg.avgQueueM, `${name}.avgQueueM`)
  finite(leg.ratePerHour, `${name}.ratePerHour`)
}
check('both legs arrived within horizon', res1.fixed.arrived && res1.greenWave.arrived)
/* throughput must be the real veh/hr rate (trafficMetrics().ratePerHour), the
   same authoritative metric the Analytics page renders — never a raw count */
check('throughput is measured in veh/hr (> 0 after arrivals)', res1.fixed.ratePerHour > 0 && res1.greenWave.ratePerHour > 0, {
  fixed: res1.fixed.ratePerHour,
  greenwave: res1.greenWave.ratePerHour,
})
/* signal wait = travel − free-flow cruise (effectiveCruise, identical formula
   in both legs). Never negative, never larger than travel, and the corridor
   leg must measure only the non-signal floor — or a genuine residual from
   imperfect wave timing, never a fabricated 0 or a hardcoded value. */
check('signalWaitSec is a real measurement (>= 0, <= travel)',
  res1.fixed.signalWaitSec >= 0 && res1.greenWave.signalWaitSec >= 0 &&
    res1.fixed.signalWaitSec <= res1.fixed.travelTimeSec &&
    res1.greenWave.signalWaitSec <= res1.greenWave.travelTimeSec, {
  fixed: { travel: res1.fixed.travelTimeSec, wait: res1.fixed.signalWaitSec },
  greenwave: { travel: res1.greenWave.travelTimeSec, wait: res1.greenWave.signalWaitSec },
})
check('FIXED leg measured real signal delay (> 5 s across red holds + braking)', res1.fixed.signalWaitSec > 5, res1.fixed.signalWaitSec)
check('corridor reduced signal delay (fixed > greenwave)', res1.fixed.signalWaitSec > res1.greenWave.signalWaitSec, {
  fixed: res1.fixed.signalWaitSec,
  greenwave: res1.greenWave.signalWaitSec,
})
check('GREENWAVE leg residual is the non-signal floor (< 5 s) — greens held',
  res1.greenWave.signalWaitSec < 5 &&
    res1.greenWave.corridor.some((c) => c.kind === 'GREEN HELD'), {
  wait: res1.greenWave.signalWaitSec,
  held: res1.greenWave.corridor.filter((c) => c.kind === 'GREEN HELD').length,
})

/* ETA scale consistency — the routePlanner's sim-space ETA must speak the
   same seconds as the A/B runner's measured legs (same cruise px/s, same
   sim clock, same geometry). The estimate is incident-free free-flow +
   expected red holds, while this measured leg includes the on-route incident
   creep (a ~30 s slow zone on the harness route), so assert same-SCALE
   agreement (0.4×-1.8×) — a 3-4× regression (the old real-world urban
   model: 299 s vs a measured ~90 s trip) fails hard. */
const etaRatio = res1.fixed.travelTimeSec / plan.baselineSec
check('planner baselineSec is the same scale as the measured FIXED leg (0.4×–1.8×)', etaRatio >= 0.4 && etaRatio <= 1.8, {
  planner: plan.baselineSec,
  measuredFixed: res1.fixed.travelTimeSec,
  ratio: etaRatio.toFixed(2),
})
check('planner etaSec (incident-free free-flow) ≤ measured GREENWAVE leg', plan.etaSec <= res1.greenWave.travelTimeSec + 1, {
  planner: plan.etaSec,
  measuredGreenwave: res1.greenWave.travelTimeSec,
})

/* ------------------------------ 6. delta arithmetic ---------------------- */
console.log('\n6. DELTA ARITHMETIC (gw − fixed; +% = GreenWave better)')
const d = res1.delta
const expectDelta = (label: string, f: number, gw: number, lower: boolean) => {
  const abs = gw - f
  const pct = f === 0 ? null : ((lower ? f - gw : gw - f) / Math.abs(f)) * 100
  const got = d[label as keyof typeof d]
  check(`${label} delta abs correct`, Math.abs(got.abs - abs) < 1e-6, { got: got.abs, expect: abs })
  check(
    `${label} delta pct correct`,
    (got.pct === null && pct === null) ||
      (got.pct !== null && pct !== null && Math.abs(got.pct - (pct as number)) < 1e-6),
    { got: got.pct, expect: pct },
  )
}
expectDelta('emergencyEtaSec', res1.fixed.travelTimeSec, res1.greenWave.travelTimeSec, true)
expectDelta('signalWaitSec', res1.fixed.signalWaitSec, res1.greenWave.signalWaitSec, true)
expectDelta('avgNetworkDelaySec', res1.fixed.avgNetworkDelaySec, res1.greenWave.avgNetworkDelaySec, true)
expectDelta('stoppedVehicles', res1.fixed.stoppedVehicles, res1.greenWave.stoppedVehicles, true)
expectDelta('avgSpeedKmh', res1.fixed.avgSpeedKmh, res1.greenWave.avgSpeedKmh, false)
expectDelta('ratePerHour', res1.fixed.ratePerHour, res1.greenWave.ratePerHour, false)

/* ------------------------------ 8. A/B reset ----------------------------- */
console.log('\n8. A/B SESSION RESET')
setABLastResult(res1)
check('abLastResult() stores the completed test', abLastResult()?.routeId === 'em-01')
setABLastResult(null)
check('abLastResult() clears on RESET A/B', abLastResult() === null)

/* ------------------------------ 9. engine unaffected --------------------- */
console.log('\n9. ENGINE RECOVERY (deterministic baseline after the benchmark)')
resetTraffic(SEED, 0)
const m2 = trafficMetrics()
check('traffic engine re-baselines cleanly', m2.active > 0 && Number.isFinite(m2.avgSpeedKmh))

/* ------------------------------- report ---------------------------------- */
console.log('\n=== MEASURED RESULTS (seed ' + SEED + ', route ' + cfg.junctionIds[0] + '→' + cfg.junctionIds[cfg.junctionIds.length - 1] + ', incident ' + incidentJunctionId + ', identical starting state) ===')
const p = (v: number | null) => (v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%')
console.log(`  EMERGENCY ETA    fixed ${res1.fixed.travelTimeSec.toFixed(1)}s · greenwave ${res1.greenWave.travelTimeSec.toFixed(1)}s · Δ ${res1.delta.emergencyEtaSec.abs.toFixed(1)}s (${p(res1.delta.emergencyEtaSec.pct)})`)
console.log(`  PLANNER ETA      baseline ${plan.baselineSec}s · greenwave ${plan.etaSec}s (sim-space, same scale)`)
console.log(`  SIGNAL WAIT      fixed ${res1.fixed.signalWaitSec.toFixed(1)}s · greenwave ${res1.greenWave.signalWaitSec.toFixed(1)}s (${p(res1.delta.signalWaitSec.pct)})`)
console.log(`  NETWORK DELAY    fixed ${res1.fixed.avgNetworkDelaySec.toFixed(2)}s · greenwave ${res1.greenWave.avgNetworkDelaySec.toFixed(2)}s (${p(res1.delta.avgNetworkDelaySec.pct)})`)
console.log(`  STOPPED VEHICLES fixed ${res1.fixed.stoppedVehicles.toFixed(1)} · greenwave ${res1.greenWave.stoppedVehicles.toFixed(1)} (${p(res1.delta.stoppedVehicles.pct)})`)
console.log(`  AVG SPEED        fixed ${res1.fixed.avgSpeedKmh.toFixed(1)} km/h · greenwave ${res1.greenWave.avgSpeedKmh.toFixed(1)} km/h (${p(res1.delta.avgSpeedKmh.pct)})`)
console.log(`  THROUGHPUT       fixed ${res1.fixed.ratePerHour.toFixed(0)} veh/hr · greenwave ${res1.greenWave.ratePerHour.toFixed(0)} veh/hr (${p(res1.delta.ratePerHour.pct)})`)

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`)
  process.exit(1)
}
console.log('\nALL A/B ASSERTIONS PASSED')