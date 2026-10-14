// ---------------------------------------------------------------------------
// GREENWAVE — Step 8B fusion verification harness (TEMPORARY, not production)
//
// Structural check that a clearly-labeled camera TrafficDemandObservation can
// flow through mergeWithSimObservations() into groupPressure(), and that with
// no camera data the result is byte-identical to the simulation-only baseline.
// Run:  npx esbuild scripts/verify-fusion.ts --bundle --platform=node
//       --format=cjs --outfile=/tmp/verify-fusion.cjs && node /tmp/verify-fusion.cjs
// ---------------------------------------------------------------------------
import { setCameraDemand, clearCameraDemand } from '../src/engine/perceptionFusion'
import { mergeWithSimObservations } from '../src/engine/trafficDemand'
import { groupPressure, PRESSURE_WEIGHTS } from '../src/engine/pressure'
import type { TrafficDemandObservation } from '../src/types/perception'

const JID = 'J30' // arbitrary test junction — NOT wired into production UI

// Simulation-only baseline: one queued + one approaching vehicle on MAIN.
const simObs = { M: { queue: 1, approaching: 1, waitAvg: 8, waitSum: 8, waitCount: 1 }, X: { queue: 0, approaching: 0, waitAvg: 0, waitSum: 0, waitCount: 0 } }

// ---- 1. No camera data → must be pure SIMULATION, same numbers as baseline
const noCam = mergeWithSimObservations(JID, simObs)
if (noCam.source !== 'SIMULATION') throw new Error('FAIL: expected SIMULATION source with no camera data')
if (noCam.obs.M.queue !== 1 || noCam.obs.M.approaching !== 1) throw new Error('FAIL: baseline obs mutated')
const pBase = groupPressure('M', simObs, null, PRESSURE_WEIGHTS)
const pNoCam = groupPressure('M', noCam.obs, null, PRESSURE_WEIGHTS)
if (pBase !== pNoCam) throw new Error(`FAIL: pressure drift without camera (${pBase} vs ${pNoCam})`)
console.log('PASS 1 — no camera: source=SIMULATION, pressure identical to baseline')

// ---- 2. Fresh camera observation (labeled TEST-OBSERVATION, 4 vehicles queued)
const camDemand: TrafficDemandObservation = {
  source: 'CAMERA',
  intersection_id: JID,
  timestamp: Date.now(),
  m_vehicle_count: 6,
  m_estimated_queue: 4,
  m_density: 0.8,
  m_approaching: 2,
  m_stopped: 4,
  x_vehicle_count: 1,
  x_estimated_queue: 1,
  x_density: 0.2,
  x_approaching: 0,
  x_stopped: 1,
  camera_weight: 0.7,
  simulation_weight: 0.3,
}
setCameraDemand(JID, camDemand)

const fused = mergeWithSimObservations(JID, simObs)
if (fused.source !== 'FUSED') throw new Error(`FAIL: expected FUSED, got ${fused.source}`)
const pFused = groupPressure('M', fused.obs, null, PRESSURE_WEIGHTS)
if (pFused <= pBase) throw new Error(`FAIL: camera demand did not raise pressure (${pFused} <= ${pBase})`)
console.log(`PASS 2 — camera present: source=FUSED, MAIN pressure ${pBase} → ${pFused} (camera demand raised it)`)

// ---- 3. Camera removed → identical fallback to simulation
clearCameraDemand()
const after = mergeWithSimObservations(JID, simObs)
if (after.source !== 'SIMULATION') throw new Error('FAIL: expected SIMULATION after clear')
const pAfter = groupPressure('M', after.obs, null, PRESSURE_WEIGHTS)
if (pAfter !== pBase) throw new Error('FAIL: fallback pressure differs from baseline')
console.log('PASS 3 — camera cleared: source=SIMULATION, pressure back to baseline')

console.log('\nALL STEP 8B FUSION CHECKS PASSED')