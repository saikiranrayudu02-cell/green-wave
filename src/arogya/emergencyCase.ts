// ---------------------------------------------------------------------------
// AROGYAOS × GREENWAVE — emergency case + clinical handoff boundary
//
// GREENWAVE (traffic)  : perception · prediction · routing · signals · corridor
// AROGYAOS (clinical)  : emergency case · hospital destination · handoff · copilot
//
// Rules of this boundary:
//  · Clinical data NEVER influences traffic calculations (no engine imports).
//  · No second ambulance, no second ETA, no second corridor: the case stores
//    the existing unit id and the existing route destination label only, and
//    the hospital receiving state is DERIVED from existing GreenWave runtime
//    state by caseStatusForUnit() — no timers, no duplicated simulation.
//  · No ArogyaOS engine (OCR / report analysis / health baseline / Doctor
//    Copilot) exists in this repository, so the clinical content here is
//    clearly labelled DEMO / SIMULATED availability — never presented as a
//    diagnosis or as real OCR output.
//  · Patient information is minimal and synthetic (a demo patient reference).
// ---------------------------------------------------------------------------

import { ENTRANCE_ID } from '../data/osmRoadNetwork'

/** clinical capabilities a receiving hospital can provide (demo registry) */
export interface HospitalCapabilities {
  trauma: boolean
  cardiac: boolean // STEMI / cath lab
  stroke: boolean
  imaging: boolean
  surgery: boolean
  icu: boolean
}

export type CapabilityKey = keyof HospitalCapabilities

/** hospital destination — reuses GreenWave's existing destination label */
export interface HospitalRecord {
  id: string
  name: string
  /** must equal the GreenWave route destination it is bound to */
  greenwaveDestination: string
  /** receiving junction — the existing GreenWave hospital entrance node */
  entranceJunctionId: string
  emergencyLevel: 'COMPREHENSIVE' | 'STEMI' | 'TRAUMA' | 'STROKE'
  /** demo clinical capabilities used for capability matching (feature: matching) */
  capabilities: HospitalCapabilities
  /** demo emergency-bed availability used for intelligent recommendation */
  emergencyBedsAvailable: number
  emergencyBedsTotal: number
}

export type CasePriority = 'CRITICAL' | 'HIGH' | 'NORMAL'

export type CaseStatus =
  | 'CREATED'
  | 'DISPATCHED'
  | 'EN_ROUTE'
  | 'ARRIVING'
  | 'ARRIVED'
  | 'CLOSED'

export type HandoffStatus = 'NOT_READY' | 'READY' | 'REVIEWED' | 'COMPLETED'

/* ------------------------- emergency coordination roles ------------------- */
/* Lightweight demo roles for the coordination network. This is NOT enterprise
   RBAC and is never presented as real authentication: role selection is demo
   routing inside the operator session (see App / EmergencyOpsPage). */

export type DemoRole = 'AMBULANCE_DRIVER' | 'CITY_AUTHORITY' | 'HOSPITAL'

export interface DemoRoleInfo {
  id: DemoRole
  label: string
  sub: string
}

export const DEMO_ROLES: DemoRoleInfo[] = [
  { id: 'AMBULANCE_DRIVER', label: 'AMBULANCE DRIVER', sub: 'UNIT OPS' },
  { id: 'CITY_AUTHORITY', label: 'CITY AUTHORITY', sub: 'TRAFFIC CONTROL' },
  { id: 'HOSPITAL', label: 'HOSPITAL', sub: 'EMERGENCY RECEIVING' },
]

/** city-traffic-control notification state (internal operational event) */
export type CityNotificationStatus = 'NOT_SENT' | 'REQUESTED' | 'ACKNOWLEDGED'
/** hospital receiving notification state (internal operational event) */
export type HospitalNotificationStatus =
  | 'NOT_SENT'
  | 'NOTIFIED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DECLINED'

/* --------------------- hospital readiness (feature: readiness score) ------ */
/* An operational readiness checklist that lives on the ONE shared case. Every
   value is a real toggle set by the hospital role — the score is a pure
   projection of those toggles, never a fabricated metric. */

export interface HospitalReadiness {
  bed: boolean
  doctor: boolean
  oxygen: boolean
  ventilator: boolean
  stretcher: boolean
  bloodBank: boolean
  emergencyTeam: boolean
}

export const READINESS_KEYS: (keyof HospitalReadiness)[] = [
  'bed',
  'doctor',
  'oxygen',
  'ventilator',
  'stretcher',
  'bloodBank',
  'emergencyTeam',
]

export const READINESS_LABELS: Record<keyof HospitalReadiness, string> = {
  bed: 'Emergency Bed',
  doctor: 'Doctor',
  oxygen: 'Oxygen',
  ventilator: 'Ventilator',
  stretcher: 'Stretcher',
  bloodBank: 'Blood',
  emergencyTeam: 'Emergency Team',
}

export function emptyReadiness(): HospitalReadiness {
  return {
    bed: false,
    doctor: false,
    oxygen: false,
    ventilator: false,
    stretcher: false,
    bloodBank: false,
    emergencyTeam: false,
  }
}

export type ReadinessTier = 'READY' | 'PARTIALLY_READY' | 'NOT_READY'

export interface ReadinessScore {
  ready: number
  total: number
  /** whole-number percentage 0..100 */
  pct: number
  tier: ReadinessTier
}

/** pure projection of the readiness toggles — READY only when fully staffed */
export function readinessScore(r: HospitalReadiness): ReadinessScore {
  const total = READINESS_KEYS.length
  const ready = READINESS_KEYS.reduce((n, k) => n + (r[k] ? 1 : 0), 0)
  const pct = Math.round((ready / total) * 100)
  const tier: ReadinessTier = ready === total ? 'READY' : ready >= Math.ceil(total * 0.6) ? 'PARTIALLY_READY' : 'NOT_READY'
  return { ready, total, pct, tier }
}

/* ----------------- emergency type → required capabilities ----------------- */
/* Maps the EXISTING GreenWave incident/emergency label to the clinical
   capabilities a receiving hospital must provide. Heuristic, deterministic and
   clearly a demo mapping — never presented as triage. */

export function requiredCapabilities(emergencyType: string): CapabilityKey[] {
  const t = emergencyType.toLowerCase()
  if (/(trauma|accident|crash|collision|fall|injury)/.test(t)) return ['trauma', 'imaging', 'surgery']
  if (/(cardiac|heart|stemi|chest|mi\b)/.test(t)) return ['cardiac', 'icu']
  if (/(stroke|cva|neuro)/.test(t)) return ['stroke', 'imaging']
  return [] // generic medical — no special capability requirement
}

/** availability probes for the ArogyaOS subsystems (honest: demo = demo) */
export interface ClinicalAvailability {
  medicalReportOcr: boolean
  reportAnalysis: boolean
  healthBaseline: boolean
  doctorCopilot: boolean
}

/** the minimal shared emergency case (no excessive patient fields) */
export interface EmergencyCase {
  caseId: string
  /** synthetic demo reference — no name, no DOB, no contact details */
  patientRef: string
  priority: CasePriority
  emergencyType: string
  hospitalId: string
  hospitalName: string
  hospitalDestination: string
  /** the EXISTING GreenWave ambulance unit id — never a second unit */
  ambulanceUnitId: string
  /** the EXISTING GreenWave runtime emergency id ('em-01' | 'em-02') */
  greenwaveEmergencyId: string
  status: CaseStatus
  createdAt: number
  clinical: ClinicalAvailability
  handoffStatus: HandoffStatus
  /** true once the clinician opened the handoff (marks REVIEWED) */
  handoffReviewedAt: number | null
  /** existing GreenWave route label (junction order), single source */
  routeLabel: string
  /** city traffic-control notification — internal operational event only */
  cityNotificationStatus: CityNotificationStatus
  /** hospital receiving notification state */
  hospitalNotificationStatus: HospitalNotificationStatus
  /** operational readiness checklist (feature: hospital readiness score) */
  readiness: HospitalReadiness
  /** demo bed assignment, set on acceptance (e.g. 'Emergency-04') */
  bedAssignment: string | null
  /** demo receiving gate, set on acceptance (e.g. 'Gate-2') */
  gate: string | null
  /** required clinical capabilities for this emergency type (matching) */
  requiredCapabilities: CapabilityKey[]
  /** set when the hospital confirms the patient handover is complete */
  handoverCompletedAt: number | null
}

/* --------------------------- demo hospital registry ------------------------ */
/* The registry is bound to the EXISTING GreenWave network destination: the
   primary hospital's `greenwaveDestination` is exactly `HOSPITAL_LABEL` from
   the OSM network meta, so route/ETA/corridor/ETA keep their single source. */

export const HOSPITAL_REGISTRY: Record<string, HospitalRecord> = {
  'hosp-mgh': {
    id: 'hosp-mgh',
    name: 'Massachusetts General Hospital',
    greenwaveDestination: 'Massachusetts General Hospital',
    // the EXISTING GreenWave hospital entrance junction from the OSM network
    entranceJunctionId: ENTRANCE_ID,
    emergencyLevel: 'COMPREHENSIVE',
    capabilities: { trauma: true, cardiac: true, stroke: true, imaging: true, surgery: true, icu: true },
    emergencyBedsAvailable: 2,
    emergencyBedsTotal: 8,
  },
  'hosp-city-general': {
    id: 'hosp-city-general',
    name: 'City General Hospital',
    greenwaveDestination: 'City General Hospital',
    entranceJunctionId: 'J17',
    emergencyLevel: 'STEMI',
    capabilities: { trauma: false, cardiac: true, stroke: true, imaging: true, surgery: false, icu: true },
    emergencyBedsAvailable: 0,
    emergencyBedsTotal: 5,
  },
  'hosp-metropolitan': {
    id: 'hosp-metropolitan',
    name: 'Metropolitan Medical Center',
    greenwaveDestination: 'Metropolitan Medical Center',
    entranceJunctionId: 'J17',
    emergencyLevel: 'TRAUMA',
    capabilities: { trauma: true, cardiac: false, stroke: false, imaging: true, surgery: true, icu: true },
    emergencyBedsAvailable: 5,
    emergencyBedsTotal: 6,
  },
}

/** hospital for a GreenWave destination label — null when unbound */
export function hospitalForDestination(destination: string): HospitalRecord | null {
  for (const h of Object.values(HOSPITAL_REGISTRY)) {
    if (h.greenwaveDestination === destination) return h
  }
  return null
}

/* ------------------------------ case lifecycle ---------------------------- */

let caseSeq = 1041 // next case renders as EMG-1042 (demo sequence)
let cases: Record<string, EmergencyCase> = {}

/** ArogyaOS subsystem availability for this integration build. */
export function clinicalAvailability(): ClinicalAvailability {
  return {
    medicalReportOcr: false, // no OCR engine in this repository — demo only
    reportAnalysis: true, // demo analysis bundle available
    healthBaseline: true, // demo baseline observations available
    doctorCopilot: true, // pre-arrival summary available for clinician review
  }
}

/**
 * Create the ONE emergency case for a dispatched GreenWave unit.
 * `unitId` is the existing ambulance id and `destination` the existing route
 * destination — this function never creates a second ambulance or route.
 */
export function createEmergencyCase(input: {
  greenwaveEmergencyId: string
  ambulanceUnitId: string
  priority: CasePriority
  emergencyType: string
  destination: string
  /** existing GreenWave route label, e.g. 'J40 → J36 → J17' (defaults to —) */
  routeLabel?: string
}): EmergencyCase {
  /* idempotent: ONE case per emergency. A re-creation for the same
     greenwaveEmergencyId (e.g. a double-dispatch path) returns the existing
     case — never a second case with a second id. */
  const existing = cases[input.greenwaveEmergencyId]
  if (existing) return existing
  const hospital = hospitalForDestination(input.destination)
  const caseId = `EMG-${++caseSeq}`
  const c: EmergencyCase = {
    caseId,
    patientRef: 'PT-DEMO-01',
    priority: input.priority,
    emergencyType: input.emergencyType,
    hospitalId: hospital?.id ?? 'unbound',
    hospitalName: hospital?.name ?? input.destination,
    hospitalDestination: input.destination,
    ambulanceUnitId: input.ambulanceUnitId,
    greenwaveEmergencyId: input.greenwaveEmergencyId,
    status: 'DISPATCHED',
    createdAt: Date.now(),
    clinical: clinicalAvailability(),
    handoffStatus: 'READY',
    handoffReviewedAt: null,
    routeLabel: input.routeLabel ?? '—',
    cityNotificationStatus: 'NOT_SENT',
    hospitalNotificationStatus: 'NOT_SENT',
    readiness: emptyReadiness(),
    bedAssignment: null,
    gate: null,
    requiredCapabilities: requiredCapabilities(input.emergencyType),
    handoverCompletedAt: null,
  }
  cases[input.greenwaveEmergencyId] = c
  return c
}

/* deterministic demo bed/gate assignment from the case id (no randomness) */
function assignBedAndGate(caseId: string): { bed: string; gate: string } {
  let h = 0
  for (let i = 0; i < caseId.length; i++) h = (h * 31 + caseId.charCodeAt(i)) >>> 0
  const bedNum = (h % 8) + 1
  const gateNum = (h % 3) + 1
  return { bed: `Emergency-${String(bedNum).padStart(2, '0')}`, gate: `Gate-${gateNum}` }
}

export function emergencyCaseOf(greenwaveEmergencyId: string): EmergencyCase | null {
  return cases[greenwaveEmergencyId] ?? null
}

/* ----------------- coordination state transitions (shared case) ---------- */
/* These mutate the ONE shared case; App pushes the corresponding real
   timeline events and toasts when the transition actually fires. The boundary
   itself emits no events and knows nothing about the corridor engine. */

export function driverNotifyCity(greenwaveEmergencyId: string): 'REQUESTED' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.cityNotificationStatus = 'REQUESTED'
  return 'REQUESTED'
}

export function cityAcknowledge(greenwaveEmergencyId: string): 'ACKNOWLEDGED' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.cityNotificationStatus = 'ACKNOWLEDGED'
  return 'ACKNOWLEDGED'
}

/** hospital receives the shared case through the internal operational network */
export function hospitalNotify(greenwaveEmergencyId: string): 'NOTIFIED' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.hospitalNotificationStatus = 'NOTIFIED'
  return 'NOTIFIED'
}

/** hospital accepts the incoming patient → ACCEPTED (assigns bed + gate) */
export function hospitalAcknowledge(greenwaveEmergencyId: string): 'ACCEPTED' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.hospitalNotificationStatus = 'ACCEPTED'
  if (!c.bedAssignment || !c.gate) {
    const a = assignBedAndGate(c.caseId)
    c.bedAssignment = a.bed
    c.gate = a.gate
  }
  return 'ACCEPTED'
}

/** hospital declines the incoming case → DECLINED (assisted-rerouting trigger) */
export function hospitalDecline(greenwaveEmergencyId: string): 'DECLINED' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.hospitalNotificationStatus = 'DECLINED'
  return 'DECLINED'
}

/** set a single readiness resource toggle; returns the updated readiness */
export function setHospitalResource(
  greenwaveEmergencyId: string,
  key: keyof HospitalReadiness,
  value: boolean,
): HospitalReadiness | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.readiness = { ...c.readiness, [key]: value }
  return c.readiness
}

/** hospital confirms patient handover complete → handoff COMPLETED */
export function hospitalHandoverComplete(greenwaveEmergencyId: string): boolean {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return false
  if (c.handoffStatus === 'COMPLETED') return false
  c.handoffStatus = 'COMPLETED'
  c.handoverCompletedAt = Date.now()
  return true
}

/** hospital moves from ACCEPTED → PREPARING (readiness begins) */
export function hospitalPrepare(greenwaveEmergencyId: string): 'PREPARING' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.hospitalNotificationStatus = 'PREPARING'
  return 'PREPARING'
}

export function hospitalMarkReady(greenwaveEmergencyId: string): 'READY' | null {
  const c = cases[greenwaveEmergencyId]
  if (!c || c.status === 'CLOSED') return null
  c.hospitalNotificationStatus = 'READY'
  // marking the ED ready confirms every resource is in place
  c.readiness = { bed: true, doctor: true, oxygen: true, ventilator: true, stretcher: true, bloodBank: true, emergencyTeam: true }
  return 'READY'
}

export function markHandoffReviewed(greenwaveEmergencyId: string): void {
  const c = cases[greenwaveEmergencyId]
  if (c && c.handoffStatus === 'READY') {
    c.handoffStatus = 'REVIEWED'
    c.handoffReviewedAt = Date.now()
  }
}

export function closeAllCases(): void {
  cases = {}
}

export function caseCount(): number {
  return Object.keys(cases).length
}

/* --------------------- status derivation (NO new clock) ------------------- */
/* The case status is a pure projection of the EXISTING GreenWave runtime —
   the minimal shape needed keeps this module decoupled from App internals. */

export interface UnitProjection {
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED'
  arrived: boolean
  /** remaining distance fraction 0..1 along the active route */
  progress: number
  /** live remaining ETA (s) from the authoritative GreenWave model */
  etaSec: number
}

/** DERIVED receiving status — no timer, no duplicated movement simulation. */
export function caseStatusForUnit(u: UnitProjection): CaseStatus {
  if (u.arrived || u.status === 'COMPLETED') return 'ARRIVED'
  if (u.status === 'PENDING') return 'CREATED'
  if (u.progress >= 0.85 || u.etaSec <= 10) return 'ARRIVING'
  return 'EN_ROUTE'
}

/* ----------------------- demo clinical handoff bundle --------------------- */
/* Explicitly SIMULATED: no OCR engine and no real patient record exists in
   this repository. Availability labels say DEMO; the copilot text is a fixed
   information-summary template for clinician review — never a diagnosis. */

export interface ClinicalHandoffBundle {
  availability: ClinicalAvailability
  medicalReport: { available: boolean; label: string }
  reportAnalysis: { available: boolean; label: string }
  healthBaseline: { available: boolean; label: string }
  doctorCopilotSummary: string[]
  disclaimer: string
}

export function clinicalHandoffFor(caseId: string): ClinicalHandoffBundle | null {
  const c = cases[caseId]
  if (!c) return null
  return {
    availability: c.clinical,
    medicalReport: {
      available: false,
      label: 'DEMO DATA AVAILABLE — no OCR engine connected in this build',
    },
    reportAnalysis: {
      available: true,
      label: 'DEMO ANALYSIS AVAILABLE — simulated report summary for review',
    },
    healthBaseline: {
      available: true,
      label: 'DEMO BASELINE AVAILABLE — simulated observations for review',
    },
    doctorCopilotSummary: [
      `Pre-arrival context assembled for case ${c.caseId} (${c.priority} · ${c.emergencyType}).`,
      'Patient reference is synthetic demo data — no real patient record is connected.',
      'Availability flags above state exactly which ArogyaOS subsystems are attached to this build.',
      'AI-generated clinical summary for clinician review. Not a diagnosis.',
    ],
    disclaimer:
      'DEMO / SIMULATED CLINICAL INFORMATION · AI-GENERATED SUMMARY FOR CLINICIAN REVIEW · NOT A DIAGNOSIS',
  }
}
