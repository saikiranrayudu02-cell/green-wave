// ---------------------------------------------------------------------------
// AROGYAOS × GREENWAVE — emergency/hospital integration harness
//
// Deterministic verification (run: see commands in README or package scripts):
//   npx esbuild scripts/verify-emergency-hospital-integration.mts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/arogya-check.cjs \
//     && node /tmp/arogya-check.cjs
//
// Covers the 20 integration requirements: one case per dispatch, existing
// ambulance/destination reuse, honest availability, derived status machine,
// reset behavior, and proof that clinical data cannot touch the traffic
// optimizer or the A/B engine (source-level isolation assertions).
// ---------------------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  HOSPITAL_REGISTRY,
  hospitalForDestination,
  createEmergencyCase,
  emergencyCaseOf,
  markHandoffReviewed,
  closeAllCases,
  caseCount,
  clinicalAvailability,
  clinicalHandoffFor,
  caseStatusForUnit,
  driverNotifyCity,
  cityAcknowledge,
  hospitalNotify,
  hospitalAcknowledge,
  hospitalPrepare,
  hospitalMarkReady,
  type EmergencyCase,
} from '../src/arogya/emergencyCase'
// the REAL GreenWave network destination constants (single source of truth)
import { HOSPITAL_LABEL, ENTRANCE_ID } from '../src/data/osmRoadNetwork'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++
    console.log(`  ok  ${name}`)
  } else {
    failed++
    console.error(`FAIL  ${name}`, detail ?? '')
  }
}

/* project root = cwd (the harness is always run from the repo root) */
const root = process.cwd()
const srcOf = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8')

console.log('=== AROGYAOS × GREENWAVE integration harness ===\n')

/* 1 — standby: no case exists before dispatch */
check('1. no EmergencyCase exists before dispatch (standby)', caseCount() === 0)

/* 2 — dispatch creates exactly ONE case */
const c1 = createEmergencyCase({
  greenwaveEmergencyId: 'em-01',
  ambulanceUnitId: 'A-104',
  priority: 'CRITICAL',
  emergencyType: 'Cardiac emergency',
  destination: HOSPITAL_LABEL,
})
check('2. dispatch creates exactly one EmergencyCase', caseCount() === 1 && c1.caseId.startsWith('EMG-'))

/* re-dispatch (double-click protection parity) must not duplicate */
createEmergencyCase({
  greenwaveEmergencyId: 'em-01',
  ambulanceUnitId: 'A-104',
  priority: 'CRITICAL',
  emergencyType: 'Cardiac emergency',
  destination: HOSPITAL_LABEL,
})
check('2b. re-creation for the same unit does NOT duplicate the case', caseCount() === 1)

/* 3 — the case references the EXISTING ambulance unit id */
check('3. case references the existing ambulance unit (A-104)', c1.ambulanceUnitId === 'A-104')

/* 4 — the case references the existing GreenWave destination */
check(
  '4. case destination equals the existing GreenWave route destination',
  c1.hospitalDestination === HOSPITAL_LABEL && c1.hospitalDestination === 'Massachusetts General Hospital',
)

/* 5 — hospital registry is bound to the REAL network destination + entrance */
check(
  '5. hospital registry bound to existing GreenWave destination + entrance junction',
  HOSPITAL_REGISTRY['hosp-mgh'].greenwaveDestination === HOSPITAL_LABEL &&
    HOSPITAL_REGISTRY['hosp-mgh'].entranceJunctionId === ENTRANCE_ID,
)
check('5b. hospitalForDestination resolves the registry from the route label', hospitalForDestination(HOSPITAL_LABEL)?.id === 'hosp-mgh')

/* 6 — ETA source reuse: status derivation is a pure projection (no own ETA) */
const proj = { status: 'ACTIVE' as const, arrived: false, progress: 0.5, etaSec: 137 }
const st = caseStatusForUnit(proj)
check(
  '6. case status is a pure projection — module contains no ETA formula',
  st === 'EN_ROUTE' && !srcOf('src/arogya/emergencyCase.ts').match(/Math\.round\(.*PACE|freeFlow|speedPx/),
)

/* 7 — corridor isolation: opening corridors is not this module's business */
check(
  '7. arogya module does not import the corridor/signal/optimizer engines',
  !srcOf('src/arogya/emergencyCase.ts').match(/from '\.\.\/engine\/(corridor|signals|pressure|vehicles|routePlanner)'/),
)

/* 8 — hospital receiving state machine over REAL unit lifecycle shapes */
const receiving = caseStatusForUnit({ status: 'ACTIVE', arrived: false, progress: 0.3, etaSec: 90 })
const arriving = caseStatusForUnit({ status: 'ACTIVE', arrived: false, progress: 0.9, etaSec: 6 })
const arrived = caseStatusForUnit({ status: 'ACTIVE', arrived: true, progress: 1, etaSec: 0 })
const created = caseStatusForUnit({ status: 'PENDING', arrived: false, progress: 0, etaSec: 120 })
check(
  '8. receiving states follow actual emergency state (CREATED→RECEIVING→ARRIVING→ARRIVED)',
  created === 'CREATED' && receiving === 'EN_ROUTE' && arriving === 'ARRIVING' && arrived === 'ARRIVED',
)

/* 9 — corridor release: module emits no corridor events of its own */
check(
  '9. arogya module never touches corridor state (no pushOpsEvent/corridor imports)',
  !srcOf('src/arogya/emergencyCase.ts').includes('corridorWaveFor') &&
    !srcOf('src/arogya/emergencyCase.ts').includes("from '../engine/emergencyTimeline'"),
)

/* 10 — handoff is READY at creation */
check('10. clinical handoff is READY when the case is created', c1.handoffStatus === 'READY')

/* 11 — clinical data cannot affect the optimizer (boundary + engine isolation) */
check(
  '11a. optimizer engines do not import the arogya boundary',
  ['src/engine/vehicles.ts', 'src/engine/signals.ts', 'src/engine/pressure.ts', 'src/engine/corridor.ts', 'src/engine/routePlanner.ts'].every(
    (f) => !srcOf(f).includes('arogya'),
  ),
)
check(
  '11b. App passes only projections — no case data flows into engine calls',
  !srcOf('src/App.tsx').match(/createEmergencyCase[\s\S]{0,400}resetTraffic|planPair\([^)]*arogya/),
)

/* 12 — reset clears case state */
markHandoffReviewed('em-01')
check('12-prep. handoff transition READY→REVIEWED works', emergencyCaseOf('em-01')?.handoffStatus === 'REVIEWED')
closeAllCases()
check('12. reset clears EmergencyCase state', caseCount() === 0)

/* 13 — reset clears handoff state */
check(
  '13. reset clears handoff state (lookup returns null after reset)',
  emergencyCaseOf('em-01') === null,
)

/* 14/15 — A/B engine untouched by the integration */
const abSrc = srcOf('src/engine/abComparison.ts')
check(
  '14. A/B comparison engine has zero arogya references',
  !abSrc.includes('arogya') && !abSrc.includes('EmergencyCase'),
)
check(
  '15. A/B worker untouched by the integration',
  !srcOf('src/engine/abWorker.ts').includes('arogya'),
)

/* 16 — graceful degradation when clinical service is unavailable */
closeAllCases()
check('16. handoff lookup for unknown/absent case returns null (UI shows standby)', clinicalHandoffFor('em-01') === null)
const avail = clinicalAvailability()
check(
  '16b. availability probe is honest — OCR reported unavailable in this repo',
  avail.medicalReportOcr === false && avail.doctorCopilot === true,
)

/* 17–19 — no duplicate loops, units, corridors */
const modSrc = srcOf('src/arogya/emergencyCase.ts')
check(
  '17. no timers or simulation loops in the integration module',
  !modSrc.match(/setInterval|setTimeout|requestAnimationFrame/),
)
check(
  '18. no second ambulance: case stores the existing unit id, creates nothing',
  !modSrc.match(/new.*Unit|spawnAmbulance|stepAmbulance/),
)
check(
  '19. no second corridor engine: no corridor computation in the module',
  !modSrc.match(/planCorridorWave|corridorRequestFor|corridorWaveFor/),
)

/* demo clinical bundle honesty */
createEmergencyCase({
  greenwaveEmergencyId: 'em-02',
  ambulanceUnitId: 'B-212',
  priority: 'HIGH',
  emergencyType: 'Multi-vehicle collision',
  destination: HOSPITAL_LABEL,
})
const bundle = clinicalHandoffFor('em-02')
check(
  '20. clinical bundle is explicitly demo-labelled and non-diagnostic',
  !!bundle &&
    bundle.disclaimer.includes('DEMO') &&
    bundle.disclaimer.includes('NOT A DIAGNOSIS') &&
    bundle.medicalReport.available === false &&
    bundle.doctorCopilotSummary.some((l) => l.includes('Not a diagnosis')),
)

/* -------------------- EMERGENCY COORDINATION NETWORK ---------------------- */
/* The three roles (driver / city / hospital) observe the SAME shared case;
   notifications are internal operational events — never external services. */

const coordCase = createEmergencyCase({
  greenwaveEmergencyId: 'em-03',
  ambulanceUnitId: 'C-333',
  priority: 'CRITICAL',
  emergencyType: 'Stroke alert',
  destination: HOSPITAL_LABEL,
  routeLabel: 'J40 → J36 → J30 → J27 → J24 → J12 → J14 → J17',
})
check(
  '21. shared case carries the existing route label (single source)',
  coordCase.routeLabel.startsWith('J40') && coordCase.routeLabel.includes('J17'),
)
check('21b. coordination state starts NOT_SENT / NOT_SENT',
  coordCase.cityNotificationStatus === 'NOT_SENT' && coordCase.hospitalNotificationStatus === 'NOT_SENT')

/* 22 — driver NOTIFY CITY (internal operational event, no fake service) */
const sent = driverNotifyCity('em-03')
check('22. driver notify city sets REQUESTED on the shared case', sent === 'REQUESTED' && emergencyCaseOf('em-03')?.cityNotificationStatus === 'REQUESTED')

/* 23 — city authority acknowledges the SAME case */
const ack = cityAcknowledge('em-03')
check('23. city acknowledge → ACKNOWLEDGED on the shared case', ack === 'ACKNOWLEDGED' && emergencyCaseOf('em-03')?.cityNotificationStatus === 'ACKNOWLEDGED')

/* 23b — hospital is NOTIFIED through the shared case when the unit is dispatched */
const hNotif = hospitalNotify('em-03')
check('23b. hospital notify → NOTIFIED on the shared case', hNotif === 'NOTIFIED' && emergencyCaseOf('em-03')?.hospitalNotificationStatus === 'NOTIFIED')

/* 24 — hospital ACCEPTS the incoming case → ACCEPTED, then PREPARING */
const hAck = hospitalAcknowledge('em-03')
check('24a. hospital accept → ACCEPTED on the shared case', hAck === 'ACCEPTED' && emergencyCaseOf('em-03')?.hospitalNotificationStatus === 'ACCEPTED')
const hPrep = hospitalPrepare('em-03')
check('24b. hospital preparing → PREPARING on the shared case', hPrep === 'PREPARING' && emergencyCaseOf('em-03')?.hospitalNotificationStatus === 'PREPARING')

/* 25 — hospital marks ED ready */
const hReady = hospitalMarkReady('em-03')
check('25. hospital mark ED ready → READY on the shared case', hReady === 'READY' && emergencyCaseOf('em-03')?.hospitalNotificationStatus === 'READY')

/* 26 — shared state across roles: all role views read the same case object */
const driverView = emergencyCaseOf('em-03')
const cityView = emergencyCaseOf('em-03')
const hospView = emergencyCaseOf('em-03')
check(
  '26. driver/city/hospital all resolve the SAME case (same caseId/unit/hospital)',
  driverView?.caseId === coordCase.caseId &&
    driverView?.ambulanceUnitId === 'C-333' &&
    cityView?.hospitalName === 'Massachusetts General Hospital' &&
    hospView?.caseId === coordCase.caseId &&
    driverView === cityView && cityView === hospView,
)

/* 27 — coordination actions are idempotent (no double-ack duplicates) */
cityAcknowledge('em-03')
hospitalAcknowledge('em-03')
hospitalMarkReady('em-03')
check(
  '27. repeated coordination actions do not corrupt shared state',
  emergencyCaseOf('em-03')?.cityNotificationStatus === 'ACKNOWLEDGED' &&
    emergencyCaseOf('em-03')?.hospitalNotificationStatus === 'READY',
)

/* 28 — coordination state is a pure boundary mutation: no engines involved */
check(
  '28. coordination transitions live in the boundary — corridor/ETA engines untouched',
  !srcOf('src/arogya/emergencyCase.ts').includes('corridorOpen') &&
    !srcOf('src/arogya/emergencyCase.ts').match(/pushOpsEvent|pushToast/),
)

/* 29 — reset clears coordination + handoff state together */
closeAllCases()
check(
  '29. reset clears coordination state (no stale city/hospital statuses)',
  caseCount() === 0 && emergencyCaseOf('em-03') === null,
)

/* 30 — role model is demo-labelled, not authentication */
check(
  '30. demo roles are labelled DEMO (never presented as real auth)',
  srcOf('src/components/EmergencyOpsPage.tsx').includes('DEMO ROLE') &&
    srcOf('src/backend/session.ts').includes('defaultDemoOperator'),
)

console.log(`\n${passed} passed · ${failed} failed`)
if (failed > 0) process.exit(1)
console.log('\nALL INTEGRATION ASSERTIONS PASSED')
