// ---------------------------------------------------------------------------
// EMERGENCY MISSION EXTENSIONS — deterministic verification harness
//
//   npx esbuild scripts/verify-emergency-mission.mts \
//     --bundle --platform=node --format=cjs --outfile=/tmp/mission-check.cjs \
//     && node /tmp/mission-check.cjs
//
// Verifies the P0/P1 mission-state additions layered on the ONE shared case:
//   · hospital readiness score (pure projection of the toggle set)
//   · accept assigns a deterministic bed + gate
//   · decline transition
//   · handover-complete sets handoff COMPLETED (once, idempotent)
//   · capability matching (emergency type → required capabilities)
//   · intelligent recommendation (advisory, deterministic, honest ETA)
//   · reset clears every new field
// Nothing here fabricates ETA/traffic/state — recommendation ETAs are supplied
// by the caller (as App does from the real routePlanner).
// ---------------------------------------------------------------------------

import {
  createEmergencyCase,
  emergencyCaseOf,
  closeAllCases,
  caseCount,
  hospitalAcknowledge,
  hospitalDecline,
  hospitalMarkReady,
  hospitalHandoverComplete,
  setHospitalResource,
  readinessScore,
  emptyReadiness,
  requiredCapabilities,
  READINESS_KEYS,
  HOSPITAL_REGISTRY,
} from '../src/arogya/emergencyCase'
import { recommendHospitals, registryCandidates } from '../src/arogya/hospitalRecommend'

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}`)
  }
}

console.log('\n[1] readiness score is a pure projection of the toggles')
{
  const empty = emptyReadiness()
  const s0 = readinessScore(empty)
  check('empty readiness → 0% NOT_READY', s0.pct === 0 && s0.tier === 'NOT_READY')
  const full = { bed: true, doctor: true, oxygen: true, ventilator: true, stretcher: true, bloodBank: true, emergencyTeam: true }
  const s1 = readinessScore(full)
  check('full readiness → 100% READY', s1.pct === 100 && s1.tier === 'READY')
  const partial = { ...empty, bed: true, doctor: true, oxygen: true, stretcher: true, emergencyTeam: true }
  const s2 = readinessScore(partial)
  check('5/7 readiness → PARTIALLY_READY', s2.tier === 'PARTIALLY_READY' && s2.ready === 5 && s2.total === READINESS_KEYS.length)
}

console.log('\n[2] mission lifecycle: accept assigns bed+gate, decline, handover')
{
  closeAllCases()
  const c = createEmergencyCase({
    greenwaveEmergencyId: 'em-01',
    ambulanceUnitId: 'A-104',
    priority: 'CRITICAL',
    emergencyType: 'Road accident',
    destination: 'Massachusetts General Hospital',
    routeLabel: 'J40 → J17',
  })
  check('new case starts with empty readiness', readinessScore(c.readiness).pct === 0)
  check('new case has no bed/gate before acceptance', c.bedAssignment === null && c.gate === null)
  check('required capabilities derived from type (accident→trauma)', c.requiredCapabilities.includes('trauma'))

  hospitalAcknowledge('em-01')
  const c2 = emergencyCaseOf('em-01')!
  check('accept assigns a bed', !!c2.bedAssignment && c2.bedAssignment.startsWith('Emergency-'))
  check('accept assigns a gate', !!c2.gate && c2.gate.startsWith('Gate-'))
  const bedFirst = c2.bedAssignment
  hospitalAcknowledge('em-01')
  check('bed/gate assignment is deterministic (stable across re-accept)', emergencyCaseOf('em-01')!.bedAssignment === bedFirst)

  setHospitalResource('em-01', 'bed', true)
  setHospitalResource('em-01', 'doctor', true)
  check('individual resource toggles update readiness', readinessScore(emergencyCaseOf('em-01')!.readiness).ready === 2)

  hospitalMarkReady('em-01')
  check('mark ED ready → 100% readiness', readinessScore(emergencyCaseOf('em-01')!.readiness).pct === 100)

  const h1 = hospitalHandoverComplete('em-01')
  const h2 = hospitalHandoverComplete('em-01')
  check('handover complete sets COMPLETED once (idempotent)', h1 === true && h2 === false && emergencyCaseOf('em-01')!.handoffStatus === 'COMPLETED')
  check('handover records a timestamp', typeof emergencyCaseOf('em-01')!.handoverCompletedAt === 'number')
}

console.log('\n[3] decline transition')
{
  closeAllCases()
  createEmergencyCase({ greenwaveEmergencyId: 'em-02', ambulanceUnitId: 'A-205', priority: 'HIGH', emergencyType: 'Cardiac', destination: 'City General Hospital' })
  const r = hospitalDecline('em-02')
  check('decline returns DECLINED', r === 'DECLINED' && emergencyCaseOf('em-02')!.hospitalNotificationStatus === 'DECLINED')
}

console.log('\n[4] capability matching')
{
  check('trauma type requires trauma/imaging/surgery', JSON.stringify(requiredCapabilities('Road accident')) === JSON.stringify(['trauma', 'imaging', 'surgery']))
  check('cardiac type requires cardiac/icu', JSON.stringify(requiredCapabilities('Cardiac arrest')) === JSON.stringify(['cardiac', 'icu']))
  check('generic medical requires nothing special', requiredCapabilities('General medical').length === 0)
}

console.log('\n[5] intelligent recommendation (deterministic, honest ETA)')
{
  // supply fixed demo ETAs (as App does from the real routePlanner)
  const etaMap: Record<string, number> = { 'hosp-mgh': 252, 'hosp-city-general': 180, 'hosp-metropolitan': 360 }
  const candidates = registryCandidates((h) => etaMap[h.id] ?? null)
  const res = recommendHospitals({ emergencyType: 'Road accident', candidates })
  check('every registry hospital is ranked', res.ranked.length === Object.keys(HOSPITAL_REGISTRY).length)
  // City General has NO trauma capability AND 0 beds → must not be recommended
  check('recommended is capability-matched', res.recommended!.capabilityMatch === true)
  check('recommended has an available bed', res.recommended!.emergencyBedsAvailable > 0)
  check('City General (no trauma, 0 beds) is not recommended for trauma', res.recommended!.hospital.id !== 'hosp-city-general')
  check('recommendation is explainable', res.reason.length > 0 && res.recommended!.explanation.includes(res.recommended!.hospital.name))
  // determinism
  const res2 = recommendHospitals({ emergencyType: 'Road accident', candidates })
  check('recommendation is deterministic', res.recommended!.hospital.id === res2.recommended!.hospital.id)
}

console.log('\n[6] reset clears all mission state')
{
  closeAllCases()
  check('no cases after reset', caseCount() === 0)
  check('case lookup returns null after reset', emergencyCaseOf('em-01') === null)
}

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
