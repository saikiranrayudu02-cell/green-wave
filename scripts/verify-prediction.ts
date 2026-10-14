// ---------------------------------------------------------------------------
// GREENWAVE — Step 9 prediction verification harness (temporary, not UI)
//
// Deterministic checks of the traffic-prediction engine + its signal
// integration. Drives the pure modules with synthetic observations and sim
// clocks — no browser, no backend, no fabricated claims.
//
// Run:
//   npx esbuild scripts/verify-prediction.ts --bundle --platform=node \
//     --format=cjs --outfile=/tmp/verify-prediction.cjs && \
//     node /tmp/verify-prediction.cjs
// ---------------------------------------------------------------------------
import {
  PREDICTION_CONFIG,
  predict,
  predictionBiasFor,
  predictionEvents,
  pushPredictionEvent,
  recordJunctionObs,
  resetPrediction,
} from '../src/engine/trafficPrediction'
import { advanceSigCtl, MAX_GREEN_S, MIN_GREEN_S } from '../src/engine/signals'
import type { SigCtl, AdvanceOpts } from '../src/engine/signals'
import type { CorridorReq } from '../src/engine/corridor'
import type { JunctionObs } from '../src/engine/vehicles'

const J = 'TEST-J'
let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** record `n` samples for a group starting at t0, stepping sampleIntervalSec */
function record(
  jid: string,
  group: 'M' | 'X',
  t0: number,
  n: number,
  make: (i: number) => { vehicleCount: number; queue: number },
  source: 'SIMULATION' | 'CAMERA' | 'FUSED' = 'SIMULATION',
) {
  const interval = PREDICTION_CONFIG.sampleIntervalSec
  for (let i = 0; i < n; i++) {
    const v = make(i)
    const obs: JunctionObs = {
      M: {
        queue: group === 'M' ? v.queue : 0,
        approaching: group === 'M' ? v.vehicleCount : 0,
        waitAvg: 8,
        waitSum: 8,
        waitCount: group === 'M' ? v.queue : 0,
      },
      X: {
        queue: group === 'X' ? v.queue : 0,
        approaching: group === 'X' ? v.vehicleCount : 0,
        waitAvg: 8,
        waitSum: 8,
        waitCount: group === 'X' ? v.queue : 0,
      },
    }
    recordJunctionObs(jid, obs, source, t0 + i * interval)
  }
}

/* ================================ TEST 1 ================================= */
console.log('\nTEST 1 — no history → INSUFFICIENT_HISTORY')
resetPrediction()
const r1 = predict(J, 'M', 100)
check('status is INSUFFICIENT_HISTORY', r1.status === 'INSUFFICIENT_HISTORY', r1.insufficientReason)
check('no fabricated forecast (zero values)', r1.predictedVehicleCount60s === 0 && r1.predictedQueue60s === 0)
check('confidence is 0', r1.confidence === 0)

/* ================================ TEST 2 ================================= */
console.log('\nTEST 2 — stable traffic → forecast near current level')
resetPrediction()
record(J, 'M', 0, 40, () => ({ vehicleCount: 5, queue: 2 }))
const r2 = predict(J, 'M', 100)
check('status READY', r2.status === 'READY')
check(
  'predicted vehicles stay near current (5 ± 1)',
  Math.abs(r2.predictedVehicleCount60s - 5) <= 1,
  `+60s=${r2.predictedVehicleCount60s}`,
)
check('riskChange STABLE', r2.riskChange === 'STABLE')
check('confidence > 0 with enough history', r2.confidence > 0.5, `conf=${r2.confidence.toFixed(2)}`)

/* ================================ TEST 3 ================================= */
console.log('\nTEST 3 — increasing traffic → predicted count increases')
resetPrediction()
record(J, 'M', 0, 40, (i) => ({ vehicleCount: 1 + i * 0.25, queue: Math.round(i * 0.1) }))
const r3 = predict(J, 'M', 100)
check('status READY', r3.status === 'READY')
check('+60s forecast > current', r3.predictedVehicleCount60s > r3.currentVehicleCount, `cur=${r3.currentVehicleCount} +60s=${r3.predictedVehicleCount60s}`)
check('+15 < +30 < +45 < +60', r3.predictedVehicleCount15s <= r3.predictedVehicleCount30s && r3.predictedVehicleCount30s <= r3.predictedVehicleCount45s && r3.predictedVehicleCount45s <= r3.predictedVehicleCount60s)
check('riskChange RISING', r3.riskChange === 'RISING')

/* ================================ TEST 4 ================================= */
console.log('\nTEST 4 — decreasing traffic → predicted count decreases')
resetPrediction()
record(J, 'M', 0, 40, (i) => ({ vehicleCount: 10 - i * 0.15, queue: 4 - i * 0.06 }))
const r4 = predict(J, 'M', 100)
check('status READY', r4.status === 'READY')
check('+60s forecast < current', r4.predictedVehicleCount60s < r4.currentVehicleCount, `cur=${r4.currentVehicleCount} +60s=${r4.predictedVehicleCount60s}`)
check('riskChange FALLING', r4.riskChange === 'FALLING')

/* ================================ TEST 5 ================================= */
console.log('\nTEST 5 — density stays within 0..1')
resetPrediction()
record(J, 'M', 0, 40, (i) => ({ vehicleCount: 200 + i * 10, queue: 50 })) // absurd input
const r5 = predict(J, 'M', 100)
check('current density in [0,1]', r5.currentDensity >= 0 && r5.currentDensity <= 1, `cur=${r5.currentDensity}`)
check('predicted +30s density in [0,1]', r5.predictedDensity30s >= 0 && r5.predictedDensity30s <= 1, `d30=${r5.predictedDensity30s}`)
check('predicted +60s density in [0,1]', r5.predictedDensity60s >= 0 && r5.predictedDensity60s <= 1, `d60=${r5.predictedDensity60s}`)
check('vehicle count clamped to max', r5.predictedVehicleCount60s <= PREDICTION_CONFIG.maxVehicles, `v60=${r5.predictedVehicleCount60s}`)

/* ================================ TEST 6 ================================= */
console.log('\nTEST 6 — queue never becomes negative')
resetPrediction()
record(J, 'M', 0, 40, (i) => ({ vehicleCount: 8 - i * 0.3, queue: 6 - i * 0.2 }))
const r6 = predict(J, 'M', 100)
check('current queue >= 0', r6.currentQueue >= 0, `cur=${r6.currentQueue}`)
check('predicted +30s queue >= 0', r6.predictedQueue30s >= 0, `q30=${r6.predictedQueue30s}`)
check('predicted +60s queue >= 0', r6.predictedQueue60s >= 0, `q60=${r6.predictedQueue60s}`)

/* ================================ TEST 7 ================================= */
console.log('\nTEST 7 — insufficient/stale data → no fake confidence')
resetPrediction()
record(J, 'M', 0, 5, () => ({ vehicleCount: 5, queue: 2 }))
const r7a = predict(J, 'M', 20)
check('few samples → INSUFFICIENT_HISTORY', r7a.status === 'INSUFFICIENT_HISTORY', r7a.insufficientReason)
check('confidence 0 with few samples', r7a.confidence === 0)
resetPrediction()
record(J, 'M', 0, 20, () => ({ vehicleCount: 5, queue: 2 }))
const r7b = predict(J, 'M', 38 + PREDICTION_CONFIG.staleSec + 5) // newest sample at t=38, now stale
check('stale samples → INSUFFICIENT_HISTORY (STALE)', r7b.status === 'INSUFFICIENT_HISTORY', r7b.insufficientReason)
check('confidence 0 with stale data', r7b.confidence === 0)

/* ============================ TEST 8 + 9 setup =========================== */
function optsFor(prediction: AdvanceOpts['prediction'], corr: CorridorReq | null): AdvanceOpts {
  return {
    junctionId: 'J-SIG',
    mode: 'adaptive',
    obs: { M: { queue: 1, approaching: 1, waitAvg: 8, waitSum: 8, waitCount: 1 }, X: { queue: 0, approaching: 0, waitAvg: 0, waitSum: 0, waitCount: 0 } },
    downstream: { M: 0, X: 0 },
    emergency: null,
    corr,
    prediction,
  }
}

function greenServed(t0: number, start: SigCtl, opts: AdvanceOpts, until: number): number {
  let ctl = start
  let greenStart = t0
  let greenEnd = t0
  for (let t = t0; t <= until; t++) {
    const wasGreen = ctl.phase === 'MG'
    ctl = advanceSigCtl(ctl, t, 1, opts)
    if (!wasGreen && ctl.phase === 'MG') greenStart = t
    if (wasGreen && ctl.phase === 'MG') greenEnd = t
  }
  return greenEnd - greenStart
}

/* ================================ TEST 8 ================================= */
console.log('\nTEST 8 — prediction cannot violate min/max green timing')
const t0 = 5000
// extreme bias keeps MAIN green as long as allowed
const startA: SigCtl = { phase: 'MG', until: t0 + MAX_GREEN_S, mGreen: MIN_GREEN_S, flexMin: t0 + MIN_GREEN_S, corr: null }
const servedA = greenServed(t0, startA, optsFor({ M: 100, X: -100 }, null), t0 + MAX_GREEN_S + 2)
check('main green with huge +bias never exceeds MAX_GREEN_S', servedA <= MAX_GREEN_S + 1, `served=${servedA}s max=${MAX_GREEN_S}s`)
check('main green with huge +bias at least MIN_GREEN_S', servedA >= MIN_GREEN_S - 1, `served=${servedA}s min=${MIN_GREEN_S}s`)
// extreme bias against MAIN forces the switch at the earliest legal moment
const startB: SigCtl = { phase: 'MG', until: t0 + MAX_GREEN_S, mGreen: MIN_GREEN_S, flexMin: t0 + MIN_GREEN_S, corr: null }
const servedB = greenServed(t0, startB, optsFor({ M: -100, X: 100 }, null), t0 + MAX_GREEN_S + 2)
check('main green with huge -bias still serves MIN_GREEN_S', servedB >= MIN_GREEN_S - 1, `served=${servedB}s min=${MIN_GREEN_S}s`)
check('main green with huge -bias switches promptly (<= MIN + 2)', servedB <= MIN_GREEN_S + 2, `served=${servedB}s`)

/* ================================ TEST 9 ================================= */
console.log('\nTEST 9 — emergency corridor remains dominant over prediction')
resetPrediction()
const t9 = 8000
let ctl9: SigCtl = { phase: 'XG', until: t9 + 20, mGreen: 16, flexMin: Infinity, corr: null }
const corr9: CorridorReq = { group: 'M', greenAt: t9 + 5, releaseAt: t9 + 15 }
const opts9 = optsFor({ M: -100, X: 100 }, corr9) // prediction wants CROSS, corridor wants MAIN
let heldGreen = false
for (let t = t9; t <= t9 + 12; t++) {
  ctl9 = advanceSigCtl(ctl9, t, 1, opts9)
}
check('corridor holds MAIN green despite +100 CROSS bias', ctl9.phase === 'MG', `phase=${ctl9.phase}`)
check('corridor schedule still active', ctl9.corr !== null)
// after release, control returns through a normal yellow — never instant flip
const tEnd = t9 + 16
ctl9 = advanceSigCtl(ctl9, tEnd, 4, opts9)
check('release goes through yellow (MY) then returns to control', ctl9.phase === 'MY' || ctl9.phase === 'MG' || ctl9.phase === 'XY' || ctl9.phase === 'XG', `phase=${ctl9.phase}`)

/* =============================== TEST 10 ================================ */
console.log('\nTEST 10 — camera unavailable → prediction continues on SIMULATION')
resetPrediction()
record(J, 'M', 0, 20, () => ({ vehicleCount: 5, queue: 2 }), 'CAMERA')
record(J, 'M', 60, 20, () => ({ vehicleCount: 6, queue: 3 }), 'SIMULATION')
const r10 = predict(J, 'M', 100) // newest SIMULATION sample at t=98
check('status READY after camera disappears', r10.status === 'READY')
check('source is SIMULATION (latest sample)', r10.source === 'SIMULATION', `source=${r10.source}`)
check('forecast reflects sim values', r10.currentVehicleCount === 6, `cur=${r10.currentVehicleCount}`)

/* =============================== TEST 11 ================================ */
console.log('\nTEST 11 — camera available → prediction uses CAMERA / FUSED')
resetPrediction()
record(J, 'M', 0, 20, () => ({ vehicleCount: 7, queue: 4 }), 'CAMERA')
const r11 = predict(J, 'M', 60)
check('source is CAMERA', r11.source === 'CAMERA', `source=${r11.source}`)
resetPrediction()
record(J, 'M', 0, 10, () => ({ vehicleCount: 5, queue: 2 }), 'CAMERA')
record(J, 'M', 30, 10, () => ({ vehicleCount: 6, queue: 3 }), 'FUSED')
const r11b = predict(J, 'M', 70)
check('source is FUSED for fused observations', r11b.source === 'FUSED', `source=${r11b.source}`)

/* =============================== TEST 12 ================================ */
console.log('\nTEST 12 — Reset Demo clears prediction history + event log')
resetPrediction()
pushPredictionEvent({ t: 1, intersectionId: J, group: 'M', forecast: 'PREDICTED DEMAND RISING', action: 'GREEN EXTENDED +3s', detail: 'harness' })
pushPredictionEvent({ t: 2, intersectionId: J, group: 'M', forecast: 'PREDICTED DEMAND RISING', action: 'SIGNAL PRIORITY ADJUSTED', detail: 'harness' })
check('events exist before reset', predictionEvents().length === 2)
resetPrediction()
check('history cleared (NO_DATA)', predict(J, 'M', 10).status === 'INSUFFICIENT_HISTORY')
check('event log cleared', predictionEvents().length === 0)

/* ------------------------------- summary -------------------------------- */
console.log(`\n${failed === 0 ? 'ALL' : 'SOME'} STEP 9 PREDICTION CHECKS PASSED — ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)