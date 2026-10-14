import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { cn } from './lib/cn'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import MobileAppView from './components/MobileAppView'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import CityMap from './components/CityMap'
import type { TelemetryPoint, UnitSim } from './components/CityMap'
import EmergencyPanel from './components/EmergencyPanel'
import MetricsStrip from './components/MetricsStrip'
import type { MetricsData } from './components/MetricsStrip'
import IncidentAlert from './components/IncidentAlert'
import DemoControls from './components/DemoControls'
import TrafficLegend from './components/TrafficLegend'
import TrafficCameraPanel from './components/TrafficCameraPanel'
import PredictiveTrafficPanel from './components/PredictiveTrafficPanel'
import {
  EmergenciesHeader,
  EmergenciesRail,
  EmergenciesLegend,
} from './components/EmergenciesPage'
import {
  CorridorsHeader,
  CorridorsRail,
  CorridorsLegend,
} from './components/CorridorsPage'
import {
  LiveTrafficHeader,
  LiveTrafficLeft,
  LiveTrafficRight,
  LiveTrafficLegend,
} from './components/LiveTrafficPage'
import { AnalyticsHeader, AnalyticsLeft, AnalyticsRight } from './components/AnalyticsPage'
import {
  DigitalTwinHeader,
  DigitalTwinLeft,
  DigitalTwinRight,
  DigitalTwinLegend,
  DigitalTwinLayers,
  ALL_TWIN_LAYERS,
  type TwinLayerKey,
  type TwinLayers,
} from './components/DigitalTwinPage'
import { SystemHeader, SystemLeft, SystemRight } from './components/SystemPage'
import ImpactComparisonPanel from './components/ImpactComparisonPanel'
import ClinicalHandoffModal from './components/ClinicalHandoffModal'
import type { EmergencyCase, CasePriority, DemoRole } from './arogya/emergencyCase'
import {
  createEmergencyCase,
  closeAllCases,
  caseStatusForUnit,
  markHandoffReviewed,
  emergencyCaseOf,
  driverNotifyCity,
  cityAcknowledge,
  hospitalNotify,
  hospitalAcknowledge,
  hospitalDecline,
  hospitalPrepare,
  hospitalMarkReady,
  setHospitalResource,
  hospitalHandoverComplete,
  type CaseStatus,
  type HospitalReadiness,
} from './arogya/emergencyCase'
import { recommendHospitals, registryCandidates } from './arogya/hospitalRecommend'
import type { RecommendationResult } from './arogya/hospitalRecommend'
import EmergencyOpsPage from './components/EmergencyOpsPage'
import { setCameraBackendOnline } from './engine/trafficDemand'
import { probeHealth } from './backend/cameraClient'
import { clearOpsTimeline, pushOpsEvent } from './engine/emergencyTimeline'
import { clearFlowHistory } from './engine/liveFlow'
import { clearAnalytics, recordAnalyticsSample } from './engine/analyticsRecorder'
import { trafficObservations } from './engine/vehicles'
import { setABLastResult } from './engine/abComparison'
import type { ABPhase, ABResult } from './engine/abComparison'
import ABWorker from './engine/abWorker?worker&inline'
import { fmtClock } from './lib/format'
import { Led, MicroLabel } from './components/ui'
import HistoryDrawer from './components/HistoryDrawer'
import SessionModal from './components/SessionModal'
import { demoEntryEnabled } from './backend/config'
import {
  repository,
  localRepository,
  setActiveRepository,
  classifyDecision,
} from './backend/repo'
import { ensureCloudSession, releaseCloudSession, cloudSessionActive } from './backend/cloud'
import { liveBus } from './backend/live'
import {
  CONVEX_DEMO_ORG,
  attachSupabaseIdentity,
  clearLiveState,
  convexConfigured,
  initConvex,
  publishCorridor,
  publishDecision,
  publishEmergency,
  publishIncident,
  publishSnapshot,
  resolveIncident,
} from './backend/convex'
import {
  resolveBootSession,
  signInDemo,
  defaultDemoOperator,
  signInSupabase,
  signOutSession,
  signUpOperator,
  type OperatorSession,
} from './backend/session'
import { supabase as supabaseClient } from './backend/supabase'
import type { DecisionRecord, OpRole, OpsSnapshot } from './backend/types'
import {
  NETWORK,
  jPt,
  roadsAt,
  INCIDENT_JUNCTION,
  ENTRANCE_ID,
  ORIGIN_EM1_ID,
  ORIGIN_EM2_ID,
  HOSPITAL_LABEL,
  ORIGIN_EM1_LABEL,
  ORIGIN_EM2_LABEL,
  projectJunctionsAlong,
} from './data/osmRoadNetwork'
import { planPair } from './engine/routePlanner'
import type { CongestionOverride, Plan } from './engine/routePlanner'
import { trafficHistory, trafficMetrics, trafficSimT } from './engine/vehicles'
import type { SimMetrics } from './engine/vehicles'
import { signalDecisions } from './engine/pressure'
import { resetPrediction } from './engine/trafficPrediction'
import { corridorWaveFor } from './engine/corridor'
import type { CorridorJunction } from './engine/corridor'
import { pathLen, pointAtDist } from './utils/geo'
import type { Pt } from './utils/geo'
import type { EmergencyCode, EmergencyRuntime, IncidentState, Mode, Toast } from './types'

/* ------------------------------------------------------------------ */
interface BaseDef {
  id: 'em-01' | 'em-02'
  unit: string
  tac: string
  code: EmergencyCode
  type: EmergencyCode
  priority: 'CRITICAL' | 'HIGH'
  incident: string
  origin: string
  destination: string
  /** compact labels for the map header (route summary line) */
  originShort: string
  destShort: string
  originIntersectionId: string
  destinationIntersectionId: string
  corridorId: 'r1' | 'r2'
  corridorLabel: string
  speedOpen: number
  speedClosed: number
}

const HOSPITAL_SHORT = 'MGH ER'
const ORIGIN1_SHORT = 'Engine 10'
const ORIGIN2_SHORT = 'EMS Base · Commercial St'

const BASE: Record<'em-01' | 'em-02', BaseDef> = {
  'em-01': {
    id: 'em-01',
    unit: 'A-104',
    tac: 'UNIT A-104',
    code: 'MEDICAL',
    type: 'MEDICAL',
    priority: 'CRITICAL',
    incident: 'Cardiac emergency',
    origin: ORIGIN_EM1_LABEL,
    destination: HOSPITAL_LABEL,
    originShort: ORIGIN1_SHORT,
    destShort: HOSPITAL_SHORT,
    originIntersectionId: ORIGIN_EM1_ID,
    destinationIntersectionId: ENTRANCE_ID,
    corridorId: 'r1',
    corridorLabel: 'CORRIDOR A',
    speedOpen: 42,
    speedClosed: 9.5,
  },
  'em-02': {
    id: 'em-02',
    unit: 'B-212',
    tac: 'UNIT B-212',
    code: 'TRAUMA',
    type: 'TRAUMA',
    priority: 'HIGH',
    incident: 'Multi-vehicle collision',
    origin: ORIGIN_EM2_LABEL,
    destination: HOSPITAL_LABEL,
    originShort: ORIGIN2_SHORT,
    destShort: HOSPITAL_SHORT,
    originIntersectionId: ORIGIN_EM2_ID ?? ORIGIN_EM1_ID,
    destinationIntersectionId: ENTRANCE_ID,
    corridorId: 'r2',
    corridorLabel: 'CORRIDOR B',
    speedOpen: 36,
    speedClosed: 8.5,
  },
}

type Pair = { plan: Plan; alt: Plan | null }

/** nominal (incident-free) routing plans — computed once from the graph */
const NOMINAL: Record<'em-01' | 'em-02', Pair> = {
  'em-01': planPair(NETWORK, BASE['em-01'].originIntersectionId, BASE['em-01'].destinationIntersectionId, undefined, BASE['em-01'].speedOpen)!,
  'em-02': planPair(NETWORK, BASE['em-02'].originIntersectionId, BASE['em-02'].destinationIntersectionId, undefined, BASE['em-02'].speedOpen)!,
}

/** congestion override while the corridor incident is active */
function incidentOverride(): CongestionOverride {
  const out: CongestionOverride = {}
  if (!INCIDENT_JUNCTION) return out
  for (const r of roadsAt(INCIDENT_JUNCTION)) {
    out[r.id] = Math.min(0.98, r.congestion + 0.93)
  }
  return out
}

type RuntimeBase = Omit<
  EmergencyRuntime,
  'distanceKm' | 'intersections' | 'baselineSec' | 'etaSec' | 'savedSec' | 'junctionIds'
>

function applyPlanFields(u: RuntimeBase, plan: Plan): EmergencyRuntime {
  return {
    ...u,
    distanceKm: plan.distanceKm,
    intersections: plan.junctionIds.length,
    baselineSec: plan.baselineSec,
    etaSec: plan.etaSec,
    savedSec: plan.savedSec,
    junctionIds: plan.junctionIds,
  }
}

function mkRuntime(def: BaseDef, plan: Plan, dist = 0): EmergencyRuntime {
  return applyPlanFields(
    {
      id: def.id,
      type: def.type,
      priority: def.priority,
      originIntersectionId: def.originIntersectionId,
      destinationIntersectionId: def.destinationIntersectionId,
      status: 'PENDING',
      unit: def.unit,
      tac: def.tac,
      code: def.code,
      incident: def.incident,
      origin: def.origin,
      destination: def.destination,
      corridorId: def.corridorId,
      corridorLabel: def.corridorLabel,
      corridorOpen: false,
      arrived: false,
      variant: 'normal',
      dist,
      len: pathLen(plan.pts),
      signalWaitSec: 0,
    },
    plan,
  )
}

/* closest-distance projection of an arbitrary point onto a polyline */
function remapDist(pts: Pt[], p: Pt): number {
  let cum = 0
  let best = { d: Infinity, dist: 0 }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    let t = 0
    if (len2 > 0) t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
    const tt = Math.min(1, Math.max(0, t))
    const dd = Math.hypot(p.x - (a.x + abx * tt), p.y - (a.y + aby * tt))
    if (dd < best.d) best = { d: dd, dist: cum + tt * Math.sqrt(len2) }
    cum += Math.sqrt(len2)
  }
  return best.dist
}

/**
 * Distance along `curPts` (canvas units) up to the junction where the unit's
 * current intersection sequence first differs from the target plan's. Both
 * plans start at the same origin, so the first differing node is the fork.
 */
function forkDistance(
  curIds: string[],
  tgtIds: string[],
  curPts: Pt[],
): number | null {
  let i = 0
  while (i < curIds.length && i < tgtIds.length && curIds[i] === tgtIds[i]) i++
  if (i >= curIds.length) return null
  const jId = curIds[i]
  const found = projectJunctionsAlong(curPts).find((j) => j.id === jId)
  return found ? found.dist : null
}

const keyOf = (id: string): 'em-01' | 'em-02' => (id === 'em-02' ? 'em-02' : 'em-01')

const modeKey = (m: Mode): 'FIXED_TIME' | 'GREENWAVE' => (m === 'greenwave' ? 'GREENWAVE' : 'FIXED_TIME')

/* ------------------------------------------------------------------ */
export default function App() {
  const [mode, setMode] = useState<Mode>('fixed')
  const [view, setView] = useState<'command' | 'emergencies' | 'corridors' | 'traffic' | 'analytics' | 'digital-twin' | 'system' | 'ops'>('command')
  /* Step: emergency coordination network — demo role routing (never auth) */
  const [opsRole, setOpsRole] = useState<DemoRole>('AMBULANCE_DRIVER')
  /* Step 14: Digital Twin selection + view-layer filter (visualization only) */
  const [twinJunction, setTwinJunction] = useState<string | null>(null)
  const [twinLayers, setTwinLayers] = useState<TwinLayers>(ALL_TWIN_LAYERS)
  const [units, setUnits] = useState<EmergencyRuntime[]>([mkRuntime(BASE['em-01'], NOMINAL['em-01'].plan)])
  const [selectedId, setSelectedId] = useState('em-01')
  const [incident, setIncident] = useState<IncidentState | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({ 'em-01': NOMINAL['em-01'].plan.etaSec })
  const [activatingId, setActivatingId] = useState<string | null>(null)

  /* Step 16: controlled A/B impact proof — worker-isolated, live sim untouched */
  const [abPhase, setABPhase] = useState<ABPhase>('IDLE')
  const [abResult, setABResult] = useState<ABResult | null>(null)
  const [abError, setABError] = useState<string | null>(null)
  const abWorkerRef = useRef<Worker | null>(null)

  /* Responsive viewport state & PWA prompt */
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const [isTablet, setIsTablet] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 && window.innerWidth < 1024 : false)
  const [installPromptOpen, setInstallPromptOpen] = useState(false)
  const [tabletView, setTabletView] = useState<'both' | 'map' | 'panel'>('both')

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      setIsMobile(w < 768)
      setIsTablet(w >= 768 && w < 1024)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  /* ---- Step 6: operator session + persistent ops backend ---- */
  const [session, setSession] = useState<OperatorSession | null>(null)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [booted, setBooted] = useState(false)
  /* role-aware landing (feature: role-specific UI / minimum-necessary info):
     an authenticated field role opens directly in its Emergency Ops portal.
     Applied once per sign-in so it never fights later manual navigation. */
  const fieldRoleAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    const r = session?.role
    if (r === 'AMBULANCE_DRIVER' || r === 'HOSPITAL') {
      const key = `${session?.operator ?? ''}:${r}`
      if (fieldRoleAppliedRef.current !== key) {
        fieldRoleAppliedRef.current = key
        setView('ops')
        setOpsRole(r) // OpRole field values align 1:1 with the ops DemoRole
      }
    } else {
      fieldRoleAppliedRef.current = null
    }
  }, [session])
  const [logOpen, setLogOpen] = useState(false)
  const [opsTotal, setOpsTotal] = useState(0)
  const sessionRecId = useRef<string | null>(null)
  /** repo ids + display refs of persisted emergencies per unit */
  const emMeta = useRef<Record<string, { id: string; ref: string; simT0?: number }>>({})
  /* ArogyaOS: the ONE emergency case (created at dispatch, cleared at reset) */
  const [arogyaCase, setArogyaCase] = useState<EmergencyCase | null>(null)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const caseEventsRef = useRef<{ arriving: boolean; handoff: boolean }>({ arriving: false, handoff: false })
  const incidentRepoId = useRef<string | null>(null)
  /** drains: engine decision cursor + corridor wave status transitions */
  const lastDecCount = useRef(0)
  const lastCorr = useRef<Record<string, Record<string, string>>>({})

  const toastId = useRef(1)
  const armTimer = useRef<number | null>(null)
  const timers = useRef<number[]>([])
  const dispatchDone = useRef<Set<string>>(new Set())
  /** ids whose dispatch side-effects already fired — makes dispatch idempotent
   *  against rapid / cross-path double clicks (one action per click) */
  const dispatchedRef = useRef<Set<string>>(new Set())
  /** unit id currently arming a corridor (per-unit, so a click on another
   *  unit is never silently dropped) */
  const armingId = useRef<string | null>(null)

  /* ---- live simulation metrics (read from the traffic engine) ---- */
  const [sim, setSim] = useState<SimMetrics>(() => trafficMetrics())
  const [simHist, setSimHist] = useState<number[]>(() => [...trafficHistory()])
  useEffect(() => {
    const t = window.setInterval(() => {
      setSim(trafficMetrics())
      setSimHist([...trafficHistory()])
    }, 800)
    return () => window.clearInterval(t)
  }, [])

  /* live corridor waves (panel chip states) — read from the corridor engine */
  const [corrWaves, setCorrWaves] = useState<Record<string, CorridorJunction[]>>({})
  const wavesRef = useRef<Record<string, CorridorJunction[]>>({})
  useEffect(() => {
    const t = window.setInterval(() => {
      const next: Record<string, CorridorJunction[]> = {}
      for (const u of unitsRef.current) {
        next[u.id] = u.corridorOpen && !u.arrived ? [...corridorWaveFor(u.id)] : []
      }
      setCorrWaves(next)
      wavesRef.current = next
      drainCorridorEvents(next)
    }, 450)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ================= Step 6 · operator session + operational backend ===== */
  const modeRef = useRef<Mode>('fixed')
  const countsRef = useRef(counts)
  const liveRef = useRef<{
    mode: Mode
    incident: IncidentState | null
    corrWaves: Record<string, CorridorJunction[]>
    units: EmergencyRuntime[]
  }>({ mode: 'fixed', incident: null, corrWaves: {}, units: [] })

  const bumpOps = useCallback(() => setOpsTotal((n) => n + 1), [])

  /** fire a decision-record into the ops store (local or Supabase) and the
      Convex live stream (meaningful decisions only) */
  const opsDecision = useCallback(
    (d: Omit<DecisionRecord, 'id' | 'createdAt'>) => {
      bumpOps()
      void repository().logDecision(d)
      if (convexConfigured() && d.decisionType !== 'NORMAL_ADAPTIVE') {
        publishDecision(CONVEX_DEMO_ORG, d)
      }
    },
    [bumpOps],
  )

  /** corridor release events for junctions still held (close / arrival) */
  const emitCorridorReleases = useCallback(
    (unitId: string, via: 'close' | 'arrival') => {
      const prevMap = lastCorr.current[unitId]
      if (!prevMap) return
      const meta = emMeta.current[unitId]
      for (const [jid, st] of Object.entries(prevMap)) {
        if (st === 'PASSED') continue
        opsDecision({
          simT: trafficSimT(),
          junctionId: jid,
          mode: modeKey(modeRef.current),
          decisionType: 'CORRIDOR_RELEASE',
          selectedPhase: 'MAIN',
          pressure: 0,
          otherPressure: 0,
          queue: 0,
          approaching: 0,
          reason:
            via === 'arrival'
              ? 'Ambulance arrived — corridor released, adaptive control resumes'
              : 'Corridor closed — adaptive control resumes',
          emergencyRef: meta?.ref,
        })
      }
      lastCorr.current[unitId] = {}
    },
    [opsDecision],
  )

  /** drain corridor wave transitions into the decision log (450 ms poll) */
  const drainCorridorEvents = useCallback(
    (waves: Record<string, CorridorJunction[]>) => {
      for (const u of unitsRef.current) {
        if (!u.corridorOpen || u.arrived) continue
        const curWave = waves[u.id] ?? []
        const prevMap = lastCorr.current[u.id] ?? {}
        const curMap: Record<string, string> = {}
        const meta = emMeta.current[u.id]
        for (const c of curWave) {
          curMap[c.id] = c.status
          const prev = prevMap[c.id]
          if (!prev || prev === c.status) continue
          const base = {
            simT: trafficSimT(),
            mode: modeKey(modeRef.current),
            pressure: 0,
            otherPressure: 0,
            queue: 0,
            approaching: 0,
            emergencyRef: meta?.ref,
          }
          if (c.status === 'PREPARING') {
            opsDecision({ ...base, junctionId: c.id, decisionType: 'CORRIDOR_PREPARATION', selectedPhase: 'MAIN', reason: `Preparing ${c.id} for ambulance arrival · ${Math.max(1, Math.round(c.etaSec))}s ETA` })
          } else if (c.status === 'ACTIVE') {
            opsDecision({ ...base, junctionId: c.id, decisionType: 'CORRIDOR_ACTIVE', selectedPhase: 'MAIN', reason: 'Holding green — ambulance entering intersection' })
          } else if (c.status === 'PASSED') {
            opsDecision({ ...base, junctionId: c.id, decisionType: 'CORRIDOR_RELEASE', selectedPhase: 'MAIN', reason: 'Ambulance cleared intersection — adaptive control resumes' })
          }
        }
        lastCorr.current[u.id] = curMap
      }
    },
    [opsDecision],
  )

  /** drain pressure-engine decisions into the persistent decision log */
  const drainSignalDecisions = useCallback(() => {
    const decs = signalDecisions()
    if (decs.length < lastDecCount.current) lastDecCount.current = 0 // engine log cleared (reset)
    const corridorOn = unitsRef.current.some((u) => u.corridorOpen && !u.arrived)
    const primary = unitsRef.current.find((u) => u.status === 'ACTIVE' && !u.arrived)
    const meta = primary ? emMeta.current[primary.id] : undefined
    let i = lastDecCount.current
    while (i < decs.length) {
      const d = decs[i]
      i += 1
      opsDecision({
        simT: d.t,
        junctionId: d.junctionId,
        mode: modeKey(modeRef.current),
        decisionType: classifyDecision(d.reason, corridorOn),
        selectedPhase: d.phase,
        pressure: Math.round(d.pressure * 10) / 10,
        otherPressure: Math.round(d.otherPressure * 10) / 10,
        queue: d.queue,
        approaching: d.approaching,
        reason: d.reason,
        emergencyRef: meta?.ref,
      })
    }
    lastDecCount.current = i
  }, [opsDecision])

  /* periodic operational snapshot + decision drain (throttled, never per-frame) */
  useEffect(() => {
    const t = window.setInterval(() => {
      drainSignalDecisions()
      const L = liveRef.current
      const sim = trafficMetrics()
      const amb = L.units.find((x) => x.status === 'ACTIVE' && !x.arrived) ?? null
      const corridorJunctions: { id: string; status: string; eta: number }[] = []
      for (const u of L.units) {
        if (!u.corridorOpen || u.arrived) continue
        for (const c of L.corrWaves[u.id] ?? []) {
          corridorJunctions.push({ id: c.id, status: c.status, eta: Math.max(1, Math.round(c.etaSec)) })
        }
      }
      const ambEta = amb ? (countsRef.current[amb.id] ?? amb.etaSec) : undefined
      const snap: Omit<OpsSnapshot, 'seq' | 'source' | 'ts'> = {
        simT: trafficSimT(),
        traffic: {
          activeVehicles: sim.active,
          avgSpeedKmh: sim.avgSpeedKmh,
          avgWaitSec: sim.avgWaitSec,
          queueM: sim.queueM,
          congestion: sim.loadPct,
          throughput: sim.throughput,
          ratePerHour: sim.ratePerHour,
        },
        incidentActive: L.incident !== null,
        incidentJunction: L.incident?.junctionId,
        mode: modeKey(L.mode),
        corridorOpen: corridorJunctions.length > 0,
        ambulance: amb
          ? {
              unit: amb.unit,
              active: true,
              corridorOpen: amb.corridorOpen && !amb.arrived,
              arrived: false,
              etaSec: ambEta ?? 0,
              savedSec: amb.savedSec,
              routeKey: amb.junctionIds.length > 1 ? `${amb.junctionIds[0]}→${amb.junctionIds[amb.junctionIds.length - 1]}` : '—',
            }
          : null,
        corridorJunctions: corridorJunctions.slice(0, 10),
      }
      liveBus().publish(snap)
      if (convexConfigured()) publishSnapshot(CONVEX_DEMO_ORG, snap)
    }, 2000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drainSignalDecisions])

  /* boot: start the Convex bridge, resolve the operator session, then
     establish any usable cloud identity (Supabase repo + Convex JWT) */
  useEffect(() => {
    let on = true
    initConvex()
    void (async () => {
      const s = await resolveBootSession()
      // bind the cloud repository first so the operator's simulation session
      // (started by the session effect) is written to the right store
      await ensureCloudSession()
      attachSupabaseIdentity()
      if (on) {
        setSession(s)
        setBooted(true)
      }
    })()
    return () => {
      on = false
    }
  }, [])

  /* auth lifecycle: expired / revoked / signed-out sessions return to the gate */
  useEffect(() => {
    const sb = supabaseClient()
    if (!sb) return
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        releaseCloudSession()
        if (convexConfigured()) clearLiveState(CONVEX_DEMO_ORG)
        sessionRecId.current = null
        setSession(null)
        setSessionOpen(false)
      }
    })
    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  /* session changes: keep the cloud repo bound (or stay fully local) and
     start an audited simulation session for the operator */
  useEffect(() => {
    const s = session
    if (!s) {
      sessionRecId.current = null
      return
    }    if (s.provider === 'supabase') {
      void ensureCloudSession()
      attachSupabaseIdentity()
    } else if (!cloudSessionActive()) {
      setActiveRepository(localRepository())
      liveBus().detachRealtime()
    }
    void repository()
      .startSession('FIXED_TIME', s.operator, s.role)
      .then((rid) => {
        sessionRecId.current = rid
      })
  }, [session])

  /* periodic DB health ping while the cloud repository is bound */
  useEffect(() => {
    const t = window.setInterval(() => {
      if (cloudSessionActive()) void repository().ping()
    }, 10000)
    return () => window.clearInterval(t)
  }, [])

  const handleSignInDemo = useCallback((operator: string, role: OpRole) => {
    const s = signInDemo(operator, role)
    if (s) {
      setSession(s)
      setSessionOpen(false)
    }
  }, [])

  /* one-click demo entry — env-gated local session only (see config.demoEntryEnabled).
     Never mints or downgrades a Supabase session: if a real cloud session is
     already active, this is a no-op, and the local demo session is used only
     while the gate is open. */
  const handleEnterDemo = useCallback(() => {
    if (!demoEntryEnabled) return
    if (session) return // a real session is already active — nothing to enter
    setSession(defaultDemoOperator())
    setSessionOpen(false)
  }, [session])

  const handleSignInSupabase = useCallback(async (email: string, password: string): Promise<string | null> => {
    const res = await signInSupabase(email, password)
    if (!res.ok || !res.session) return res.error ?? 'Sign-in failed.'
    setSession(res.session)
    setSessionOpen(false)
    await ensureCloudSession()
    return null
  }, [])

  const handleSignUpSupabase = useCallback(
    async (email: string, password: string, displayName: string) => {
      return signUpOperator(email, password, displayName)
    },
    [],
  )

  const handleSignOut = useCallback(async () => {
    if (sessionRecId.current) {
      void repository().endSession(sessionRecId.current)
      sessionRecId.current = null
    }
    await signOutSession()
    releaseCloudSession()
    setSession(null)
    setSessionOpen(false)
  }, [])

  /* ---- incident-aware plans ---- */
  const congested = useMemo<Record<'em-01' | 'em-02', Pair> | null>(() => {
    if (!incident) return null
    return {
      'em-01': planPair(NETWORK, BASE['em-01'].originIntersectionId, BASE['em-01'].destinationIntersectionId, incidentOverride(), BASE['em-01'].speedOpen)!,
      'em-02': planPair(NETWORK, BASE['em-02'].originIntersectionId, BASE['em-02'].destinationIntersectionId, incidentOverride(), BASE['em-02'].speedOpen)!,
    }
  }, [incident])

  /** geometry the unit is currently travelling on */
  const activePlanFor = useCallback(
    (u: EmergencyRuntime): Plan | null => {
      if (incident && u.variant === 'detour') return congested?.[keyOf(u.id)]?.plan ?? null
      return NOMINAL[keyOf(u.id)].plan
    },
    [incident, congested],
  )

  /* ---- toasts ---- */
  const pushToast = useCallback((kind: Toast['kind'], title: string, body?: string) => {
    const id = toastId.current++
    setToasts((ts) => [...ts.slice(-3), { id, kind, title, body, ts: Date.now() }])
    const t = window.setTimeout(() => {
      setToasts((ts) => ts.filter((x) => x.id !== id))
    }, 6500)
    timers.current.push(t)
  }, [])

  const closeToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((x) => x.id !== id))
  }, [])

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  /* ---- dispatch ---- */
  const dispatch = useCallback(
    (id: string) => {
      const def = BASE[keyOf(id)]
      const k = keyOf(id)
      const existing = units.find((x) => x.id === id)
      if (!existing || existing.status !== 'PENDING') return
      // idempotent: one dispatch per unit per scenario — a second click in the
      // same tick (or a cross-path dispatch, e.g. via OPEN GREEN CORRIDOR on a
      // pending unit) must not re-run toasts / ops events / persistence
      if (dispatchedRef.current.has(id)) return
      dispatchedRef.current.add(id)
      // the geometry this unit will actually travel (incident detour aware)
      let plan = NOMINAL[k].plan
      if (incident) {
        const cp = congested?.[k]?.plan
        if (cp && cp.key !== plan.key) plan = cp
      }
      setUnits((us) =>
        us.map((u) => {
          if (u.id !== id || u.status !== 'PENDING') return u
          let nu: EmergencyRuntime = { ...u, status: 'ACTIVE', dist: 0 }
          const cp = congested?.[k]?.plan
          if (incident && cp && cp.key !== NOMINAL[k].plan.key) {
            nu = { ...applyPlanFields(nu, cp), variant: 'detour', dist: 0, len: pathLen(cp.pts) }
          }
          return nu
        }),
      )
      setEpoch((e) => e + 1)
      pushToast('info', 'UNIT DISPATCHED', `${def.tac} en route · ${def.origin} → ${def.destination}`)
      // ArogyaOS: create the ONE emergency case bound to this existing unit +
      // the existing route destination (no second ambulance, no second route)
      setArogyaCase(
        createEmergencyCase({
          greenwaveEmergencyId: k,
          ambulanceUnitId: def.unit,
          priority: def.priority as CasePriority,
          emergencyType: def.incident,
          destination: def.destination,
          routeLabel: plan.intersectionIds.join(' → '),
        }),
      )
      // coordination network: the destination hospital is notified through the
      // shared case the moment the unit is dispatched (internal event only)
      hospitalNotify(k)
      setArogyaCase(emergencyCaseOf(k))
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: null,
        kind: 'coordination',
        label: `HOSPITAL NOTIFIED · ${def.destination.toUpperCase()}`,
      })
      caseEventsRef.current = { arriving: false, handoff: false }
      // Step 10: real timeline transitions — dispatch + route calculation
      const tDispatch = trafficSimT()
      pushOpsEvent({
        t: tDispatch,
        junctionId: def.originIntersectionId,
        kind: 'dispatch',
        label: `${def.tac} DISPATCHED`,
      })
      pushOpsEvent({
        t: tDispatch,
        junctionId: null,
        kind: 'route',
        label: `ROUTE CALCULATED · ${plan.intersectionIds[0]} → ${plan.intersectionIds[plan.intersectionIds.length - 1]}`,
      })
      // persist an emergency record (machine-readable route + real route stats)
      const simT0 = trafficSimT()
      bumpOps()
      void repository()
        .createEmergency({
          emergencyRef: repository().nextEmergencyRef(),
          unit: def.unit,
          code: def.code,
          priority: def.priority,
          incident: def.incident,
          origin: def.origin,
          destination: def.destination,
          originIntersectionId: def.originIntersectionId,
          destinationIntersectionId: def.destinationIntersectionId,
          routeIntersectionIds: plan.intersectionIds,
          routeRoadIds: plan.roadIds,
          distanceKm: plan.distanceKm,
          baselineSec: plan.baselineSec,
          corridorActive: false,
          dispatchedAt: Date.now(),
          signalWaitSec: 0,
          savedSec: plan.savedSec,
        })
        .then((eid) => {
          if (eid) {
            emMeta.current[k] = { id: eid, ref: def.unit, simT0 }
            if (convexConfigured()) {
              void repository()
                .snapshot()
                .then((snap) => {
                  const rec = snap.emergencies.find((x) => x.id === eid)
                  if (rec) publishEmergency(CONVEX_DEMO_ORG, rec)
                })
            }
          }
        })
    },
    [incident, congested, units, pushToast, bumpOps],
  )

  /* ---- corridor actions ---- */
  const clearArm = useCallback(() => {
    if (armTimer.current != null) {
      window.clearTimeout(armTimer.current)
      armTimer.current = null
    }
    armingId.current = null
    setActivatingId(null)
  }, [])

  const openCorridor = useCallback(
    (id: string) => {
      const u = units.find((x) => x.id === id)
      if (!u || u.arrived || u.corridorOpen) return
      if (u.status === 'PENDING') dispatch(id)
      // idempotent: a repeat click while THIS corridor is already arming is a
      // no-op (the arm completes). A click for a DIFFERENT unit cancels the
      // pending arm and re-arms — a click is never silently dropped.
      if (armingId.current === id) return
      if (armingId.current !== null) clearArm()
      armingId.current = id
      setActivatingId(id)
      armTimer.current = window.setTimeout(() => {
        armTimer.current = null
        armingId.current = null
        setActivatingId(null)
        setUnits((us) => us.map((x) => (x.id === id ? { ...x, corridorOpen: true } : x)))
        setMode('greenwave')
        setCounts((c) => ({ ...c, [id]: u.etaSec }))
        pushOpsEvent({
          t: trafficSimT(),
          junctionId: null,
          kind: 'corridor',
          label: `${u.corridorLabel} ACTIVE · ${u.intersections} SIGNALS COORDINATED`,
        })
        pushToast(
          'success',
          'GREEN CORRIDOR ACTIVE',
          `${u.intersections} signals coordinated · ${fmtClock(u.etaSec)} ETA · ${fmtClock(u.savedSec)} saved`,
        )
        // audit: corridor activation on the persisted emergency record
        const meta = emMeta.current[id]
        if (meta) {
          bumpOps()
          void repository().updateEmergency(meta.id, { corridorActive: true })
        }
        if (convexConfigured()) {
          // live corridor state — coordinated junctions stream below via drain
          publishCorridor(CONVEX_DEMO_ORG, {
            emergencyId: id,
            status: 'ACTIVE',
            ambulanceEta: u.etaSec,
            intersections: [],
          })
          void repository()
            .snapshot()
            .then((snap) => {
              const rec = snap.emergencies.find((x) => x.id === meta?.id)
              if (rec) publishEmergency(CONVEX_DEMO_ORG, rec)
            })
        }
      }, 1250)
    },
    [units, dispatch, pushToast, bumpOps, clearArm],
  )

  const closeCorridor = useCallback(
    (id: string) => {
      clearArm()
      setUnits((us) => us.map((x) => (x.id === id ? { ...x, corridorOpen: false } : x)))
      const meta = emMeta.current[id]
      if (meta) {
        bumpOps()
        void repository().updateEmergency(meta.id, { corridorActive: false })
      }
      if (convexConfigured()) {
        publishCorridor(CONVEX_DEMO_ORG, {
          emergencyId: id,
          status: 'RELEASED',
          ambulanceEta: 0,
          intersections: [],
        })
      }
      const heldUnit = unitsRef.current.find((x) => x.id === id)
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: null,
        kind: 'corridor',
        label: `${heldUnit?.corridorLabel ?? 'CORRIDOR'} RELEASED`,
      })
      emitCorridorReleases(id, 'close')
    },
    [clearArm, emitCorridorReleases, bumpOps],
  )

  /* GREENWAVE is the adaptive controller — it does NOT open a corridor.
     A corridor is armed explicitly (OPEN GREEN CORRIDOR) and implies
     greenwave; switching to FIXED TIME releases any active corridor. */
  const handleMode = useCallback(
    (m: Mode) => {
      setMode(m)
      /* Step 15: real control-mode transitions feed the System operations log */
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: null,
        kind: 'system',
        label: m === 'greenwave' ? 'SIGNAL → GREENWAVE ENABLED' : 'SIGNAL → FIXED TIMING ENABLED',
      })
      if (m === 'fixed') {
        const opened = unitsRef.current.filter((u) => u.corridorOpen && !u.arrived)
        let had = false
        setUnits((us) =>
          us.map((u) => {
            if (u.corridorOpen && !u.arrived) had = true
            return u.corridorOpen && !u.arrived ? { ...u, corridorOpen: false } : u
          }),
        )
        for (const u of opened) {
          const meta = emMeta.current[u.id]
          pushOpsEvent({
            t: trafficSimT(),
            junctionId: null,
            kind: 'corridor',
            label: `${u.corridorLabel} RELEASED · FIXED TIME RESTORED`,
          })
          if (meta) {
            bumpOps()
            void repository().updateEmergency(meta.id, { corridorActive: false })
          }
          emitCorridorReleases(u.id, 'close')
        }
        pushToast(
          had ? 'info' : 'info',
          had ? 'CORRIDOR HELD' : 'FIXED TIME',
          had
            ? 'Green corridor released · baseline fixed-time cycles restored'
            : 'Baseline fixed-time signal cycles active',
        )
      } else {
        pushToast('info', 'GREENWAVE ADAPTIVE', 'Demand-responsive signal control active')
      }
      if (sessionRecId.current) void repository().touchSessionMode(sessionRecId.current, modeKey(m))
    },
    [pushToast, emitCorridorReleases, bumpOps],
  )

  /* ---- incident ---- */
  const handleIncident = useCallback(() => {
    const next = incident === null
    if (!INCIDENT_JUNCTION) return
    const cpairs: Record<'em-01' | 'em-02', Pair> | null = next
      ? {
          'em-01': planPair(NETWORK, BASE['em-01'].originIntersectionId, BASE['em-01'].destinationIntersectionId, incidentOverride(), BASE['em-01'].speedOpen)!,
          'em-02': planPair(NETWORK, BASE['em-02'].originIntersectionId, BASE['em-02'].destinationIntersectionId, incidentOverride(), BASE['em-02'].speedOpen)!,
        }
      : congested
    let geoChanged = false
    let countdownReset: { id: string; etaSec: number } | null = null
    const nextUnits = units.map((u): EmergencyRuntime => {
      if (u.arrived) return u
      const key = keyOf(u.id)
      const target = next ? cpairs?.[key]?.plan : NOMINAL[key].plan
      if (!target) return u
      const curPair = u.variant === 'detour' && incident ? cpairs?.[key]?.plan : NOMINAL[key].plan
      const curKey = curPair?.key ?? NOMINAL[key].plan.key
      // geometry unchanged for this unit — its plan fields already match
      if (target.key === curKey) return u
      // the unit's *current* geometry + intersection sequence
      const curPts = curPair?.pts ?? target.pts
      const curIds = curPair?.intersectionIds ?? target.intersectionIds
      const fork = forkDistance(curIds, target.intersectionIds, curPts)
      const canSwitch = fork == null || u.dist < fork + 14
      // unit is committed past the divergence point: it cannot re-plan its
      // geometry, so it finishes the route it is physically on. Do NOT stamp
      // the other plan's labels/ETA on it — the corridor + signal priority
      // carry it through the affected zone instead.
      if (!canSwitch) return u
      const d = remapDist(target.pts, pointAtDist(curPts, u.dist))
      const variant: 'detour' | 'normal' = next ? 'detour' : 'normal'
      const nu = {
        ...applyPlanFields(u, target),
        variant,
        dist: d,
        len: pathLen(target.pts),
        junctionIds: target.junctionIds,
      }
      geoChanged = true
      if (nu.corridorOpen && !nu.arrived) countdownReset = { id: u.id, etaSec: target.etaSec }
      return nu
    })
    setUnits(nextUnits)
    if (countdownReset) setCounts((c) => ({ ...c, [countdownReset!.id]: countdownReset!.etaSec }))
    if (next) {
      const p = jPt(INCIDENT_JUNCTION)
      setIncident({
        id: 'inc-01',
        junctionId: INCIDENT_JUNCTION,
        x: p.x,
        y: p.y,
        label: `${INCIDENT_JUNCTION} · CONGESTION`,
        severity: 'critical',
      })
      pushToast('warning', 'TRAFFIC INCIDENT', `Heavy congestion detected at ${INCIDENT_JUNCTION} · rerouting units`)
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: INCIDENT_JUNCTION,
        kind: 'incident',
        label: 'INCIDENT DETECTED · CONGESTION',
      })
      // persist incident + audit decision
      bumpOps()
      void repository()
        .logIncident({
          junctionId: INCIDENT_JUNCTION,
          label: `Congestion event · ${INCIDENT_JUNCTION} corridor`,
          severity: 'CRITICAL',
          startedAt: Date.now(),
        })
        .then((iid) => {
          if (iid) {
            incidentRepoId.current = iid
            if (convexConfigured()) {
              void repository()
                .snapshot()
                .then((snap) => {
                  const rec = snap.incidents.find((x) => x.id === iid)
                  if (rec) publishIncident(CONVEX_DEMO_ORG, rec)
                })
            }
          }
        })
      opsDecision({
        simT: trafficSimT(),
        junctionId: INCIDENT_JUNCTION,
        mode: modeKey(modeRef.current),
        decisionType: 'INCIDENT_RESPONSE',
        selectedPhase: 'ALL',
        pressure: 0,
        otherPressure: 0,
        queue: 0,
        approaching: 0,
        reason: `Congestion at ${INCIDENT_JUNCTION} — route costs updated, units re-planned`,
      })
    } else {
      setIncident(null)
      pushToast('info', 'INCIDENT CLEARED', `${INCIDENT_JUNCTION} congestion resolved · routes restored`)
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: INCIDENT_JUNCTION,
        kind: 'incident',
        label: 'INCIDENT CLEARED · ROUTES RESTORED',
      })
      bumpOps()
      if (incidentRepoId.current) {
        const rid = incidentRepoId.current
        void repository().resolveIncident(rid)
        if (convexConfigured()) resolveIncident(CONVEX_DEMO_ORG, rid)
        incidentRepoId.current = null
      }
      opsDecision({
        simT: trafficSimT(),
        junctionId: INCIDENT_JUNCTION,
        mode: modeKey(modeRef.current),
        decisionType: 'INCIDENT_RESPONSE',
        selectedPhase: 'ALL',
        pressure: 0,
        otherPressure: 0,
        queue: 0,
        approaching: 0,
        reason: `Congestion at ${INCIDENT_JUNCTION} cleared — nominal routes restored`,
      })
    }
    if (geoChanged) setEpoch((e) => e + 1)
  }, [incident, congested, units, pushToast, bumpOps, opsDecision])

  /* ---- add second emergency ---- */
  const canAdd = ORIGIN_EM2_ID !== null && !units.some((u) => u.id === 'em-02')
  const handleAdd = useCallback(() => {
    setUnits((us) => [...us, mkRuntime(BASE['em-02'], NOMINAL['em-02'].plan)])
    setCounts((c) => ({ ...c, 'em-02': NOMINAL['em-02'].plan.etaSec }))
    setSelectedId('em-02')
    // the unit is added as PENDING — never claim it is dispatched here
    pushToast('info', 'UNIT B-212 STAGED', 'Trauma unit added · awaiting dispatch')
  }, [pushToast])

  /* ---- reset ---- */
  const handleReset = useCallback(() => {
    clearArm()
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    dispatchDone.current.clear()
    dispatchedRef.current.clear()
    // session boundary: close the current simulation session, open a fresh one
    const rid = sessionRecId.current
    sessionRecId.current = null
    if (rid) void repository().endSession(rid)
    const s = session
    if (s) {
      void repository()
        .startSession('FIXED_TIME', s.operator, s.role)
        .then((r) => {
          sessionRecId.current = r
        })
    }
    // Step 9: prediction history + event log reset with the demo
    resetPrediction()
    // Step 10: emergency-operations timeline reset with the demo
    clearOpsTimeline()
    // Step 12: live-traffic rolling chart reset with the demo
    clearFlowHistory()
    // Step 13: analytics session recorder reset with the demo
    clearAnalytics()
    // Step 14: Digital Twin selection + layer filter reset with the demo
    setTwinJunction(null)
    setTwinLayers(ALL_TWIN_LAYERS)
    // history persists; only the live record mappings reset
    emMeta.current = {}
    incidentRepoId.current = null
    lastCorr.current = {}
    if (convexConfigured()) clearLiveState(CONVEX_DEMO_ORG)
    setUnits([mkRuntime(BASE['em-01'], NOMINAL['em-01'].plan)])
    setSelectedId('em-01')
    setIncident(null)
    setMode('fixed')
    setCounts({ 'em-01': NOMINAL['em-01'].plan.etaSec })
    setEpoch((e) => e + 1)
    setResetKey((k) => k + 1) // replays the deterministic traffic + signals
    // Step 16: A/B comparison state resets with the demo
    setABPhase('IDLE')
    setABResult(null)
    setABError(null)
    setABLastResult(null)
    // ArogyaOS: clear the emergency case + handoff with the demo reset
    closeAllCases()
    setArogyaCase(null)
    setHandoffOpen(false)
    caseEventsRef.current = { arriving: false, handoff: false }
    pushToast('info', 'SIMULATION RESET', 'Demo state restored to nominal')
  }, [clearArm, pushToast, session])

  /* ---- Step 16: run the controlled A/B test in the isolated worker ---- */
  const runAB = useCallback(() => {
    const key = keyOf(selectedId)
    const plan = NOMINAL[key].plan
    setABPhase('CAPTURING')
    setABResult(null)
    setABError(null)
    const w =
      abWorkerRef.current ??
      (() => {
        const wk = new ABWorker()
        abWorkerRef.current = wk
        return wk
      })()
    w.onmessage = (e: MessageEvent<{ ok: boolean; progress?: 'RUNNING_FIXED' | 'RUNNING_GREENWAVE'; result?: ABResult; error?: string }>) => {
      const m = e.data
      if (m.progress) setABPhase(m.progress)
      else if (m.ok && m.result) {
        setABResult(m.result)
        setABPhase('COMPLETE')
        setABLastResult(m.result)
        pushToast(
          'success',
          'IMPACT TEST COMPLETE',
          `${m.result.routeKey} · emergency ETA delta ${m.result.delta.emergencyEtaSec.pct === null ? '—' : (m.result.delta.emergencyEtaSec.pct > 0 ? '−' : '+') + Math.abs(m.result.delta.emergencyEtaSec.pct).toFixed(0) + '%'} · signal wait ${fmtClock(m.result.greenWave.signalWaitSec)} vs ${fmtClock(m.result.fixed.signalWaitSec)}`,
        )
      } else {
        setABError(m.error ?? 'A/B evaluation failed')
        setABPhase('ERROR')
      }
    }
    w.postMessage({
      routeId: key,
      pts: plan.pts,
      junctionIds: plan.junctionIds,
      incidentJunctionId: incident?.junctionId ?? null,
      speedPx: BASE[key].speedOpen, // same ambulance capability on both legs
    })
  }, [selectedId, incident, pushToast])

  const resetAB = useCallback(() => {
    setABPhase('IDLE')
    setABResult(null)
    setABError(null)
    setABLastResult(null)
  }, [])

  /* ---- telemetry from CityMap ---- */
  const unitsRef = useRef(units)
  unitsRef.current = units
  /* render-time mirrors for the throttled ops readers */
  modeRef.current = mode
  countsRef.current = counts
  liveRef.current = { mode, incident, corrWaves, units: unitsRef.current }

  /* Step 13: analytics session recorder — coarse-cadence REAL measurements
     from the existing engines. Never a second simulation loop; this simply
     snapshots trafficMetrics()/observations + shared emergency/corridor
     state every 2 s and tags each sample with the active control mode. */
  useEffect(() => {
    const t = window.setInterval(() => {
      const m = trafficMetrics()
      let queueTotal = 0
      let maxQueue = 0
      for (const o of trafficObservations().values()) {
        const q = o.M.queue + o.X.queue
        queueTotal += q
        if (q > maxQueue) maxQueue = q
      }
      const lv = liveRef.current
      const unit = lv.units.find((u) => u.status === 'ACTIVE' && !u.arrived) ?? null
      recordAnalyticsSample({
        t: trafficSimT(),
        mode: lv.mode === 'greenwave' ? 'GREENWAVE' : 'FIXED',
        avgWaitSec: m.avgWaitSec,
        avgSpeedKmh: m.avgSpeedKmh,
        stoppedVehicles: m.queuedCount,
        queueTotal,
        maxQueue,
        queueM: m.queueM,
        throughput: m.throughput,
        ratePerHour: m.ratePerHour,
        vehicleCount: m.active,
        loadPct: m.loadPct,
        emergencyActive: unit != null,
        emergencyEtaSec: unit ? unit.etaSec : null,
        emergencyBaselineSec: unit ? unit.baselineSec : null,
        emergencySavedSec: unit ? unit.savedSec : null,
        corridorActive: Object.values(lv.corrWaves).some((w) => w.length > 0),
        incidentActive: lv.incident != null,
      })
    }, 2000)
    return () => window.clearInterval(t)
  }, [])

  /* Step 15: single shared camera-backend health probe (always mounted).
     TrafficCameraPanel and every read-only module consume the published
     reachability — there is deliberately no second polling loop. */
  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (!alive) return
      const h = await probeHealth().catch(() => null)
      if (!alive) return
      setCameraBackendOnline(h !== null && h.reachable && h.modelLoaded)
      setTimeout(tick, 12_000)
    }
    tick()
    return () => {
      alive = false
    }
  }, [])
  const onTelemetry = useCallback((points: TelemetryPoint[]) => {
    setUnits((us) =>
      us.map((u) => {
        const p = points.find((x) => x.id === u.id)
        if (!p) return u
        const next = { ...u, dist: p.d, len: p.len, arrived: p.arrived, signalWaitSec: p.wait }
        if (p.arrived && !u.arrived) next.corridorOpen = false
        return next
      }),
    )
    /* live ETA — derived from simulation progress, so red-light waits and
       corridor acceleration show up honestly instead of a fixed countdown */
    setCounts((c) => {
      const next = { ...c }
      let changed = false
      for (const p of points) {
        const u = unitsRef.current.find((x) => x.id === p.id)
        if (!u || u.status === 'PENDING') continue
        const remain = Math.max(0, Math.min(1, 1 - p.d / Math.max(1, p.len)))
        const eta = p.arrived ? 0 : Math.round(remain * (u.corridorOpen ? u.etaSec : u.baselineSec))
        if (next[p.id] !== eta) {
          next[p.id] = eta
          changed = true
        }
      }
      return changed ? next : c
    })
  }, [])

  /* ---- arrival side-effects ---- */
  const anyArrived = units.some((u) => u.arrived)
  useEffect(() => {
    if (!anyArrived) return
    for (const u of units) {
      if (!u.arrived || dispatchDone.current.has(u.id)) continue
      dispatchDone.current.add(u.id)
      setUnits((us) => us.map((x) => (x.id === u.id ? { ...x, status: 'COMPLETED' } : x)))
      setCounts((c) => ({ ...c, [u.id]: 0 }))
      pushToast(
        'success',
        'UNIT ARRIVED',
        `${u.tac} at ${u.destination} · ${fmtClock(u.savedSec)} saved under ${u.corridorLabel}`,
      )
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: u.destinationIntersectionId,
        kind: 'arrival',
        label: `${u.tac} ARRIVED · CORRIDOR RELEASED`,
      })
      // finalize the persisted emergency record with real simulated numbers
      const meta = emMeta.current[u.id]
      if (meta) {
        bumpOps()
        void repository().updateEmergency(meta.id, {
          status: 'ARRIVED',
          arrivedAt: Date.now(),
          corridorActive: false,
          signalWaitSec: Math.round(u.signalWaitSec),
          savedSec: u.savedSec,
        })
        // finalize the emergency_metrics row with real simulated numbers
        void repository().recordEmergencyMetrics({
          emergencyId: meta.id,
          baselineEtaSec: u.baselineSec,
          travelSec: Math.max(1, Math.round(trafficSimT() - (meta.simT0 ?? trafficSimT()))),
          signalWaitSec: Math.round(u.signalWaitSec),
          intersectionsPassed: u.junctionIds.length,
          delayAvoidedSec: u.savedSec,
        })
        if (convexConfigured()) {
          publishEmergency(CONVEX_DEMO_ORG, {
            id: meta.id,
            emergencyRef: meta.ref,
            unit: u.unit,
            code: u.code,
            priority: u.priority as 'CRITICAL' | 'HIGH',
            incident: u.incident,
            origin: u.origin,
            destination: u.destination,
            originIntersectionId: u.originIntersectionId,
            destinationIntersectionId: u.destinationIntersectionId,
            routeIntersectionIds: u.junctionIds,
            routeRoadIds: [],
            distanceKm: u.distanceKm,
            baselineSec: u.baselineSec,
            status: 'ARRIVED',
            corridorActive: false,
            arrivedAt: Date.now(),
            signalWaitSec: Math.round(u.signalWaitSec),
            savedSec: u.savedSec,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          publishCorridor(CONVEX_DEMO_ORG, {
            emergencyId: u.id,
            status: 'RELEASED',
            ambulanceEta: 0,
            intersections: [],
          })
        }
      }
      emitCorridorReleases(u.id, 'arrival')
      lastCorr.current[u.id] = {}
      const t = window.setTimeout(() => {
        dispatchDone.current.delete(u.id)
        dispatchedRef.current.delete(u.id) // unit returns to PENDING — may dispatch again
        setUnits((us) =>
          us.map((x) => (x.id === u.id ? mkRuntime(BASE[keyOf(x.id)], NOMINAL[keyOf(x.id)].plan) : x)),
        )
        setCounts((c) => ({ ...c, [u.id]: NOMINAL[keyOf(u.id)].plan.etaSec }))
        setEpoch((e) => e + 1)
      }, 6000)
      timers.current.push(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyArrived, units])



  /* ---- derived display values ---- */
  const selected = units.find((u) => u.id === selectedId) ?? units[0]

  const displayEta = useMemo(() => {
    if (!selected) return 0
    if (selected.arrived) return 0
    if (selected.status === 'PENDING') return selected.baselineSec
    return counts[selected.id] ?? selected.baselineSec
  }, [selected, counts])

  const nextIdxFor = useCallback((u: EmergencyRuntime) => {
    if (u.arrived) return u.junctionIds.length
    const pts = activePlanFor(u)?.pts ?? NOMINAL[keyOf(u.id)].plan.pts
    const proj = projectJunctionsAlong(pts).filter((j) => u.junctionIds.includes(j.id))
    for (let i = 0; i < proj.length; i++) {
      if (proj[i].dist > u.dist + 18) return i
    }
    return proj.length
  }, [activePlanFor])

  const unitT = useMemo(() => {
    const m: Record<string, { d: number; len: number; nextIdx: number; etaRemainSec: number }> = {}
    for (const u of units) {
      m[u.id] = {
        d: u.dist,
        len: u.len || 1,
        nextIdx: nextIdxFor(u),
        etaRemainSec: u.arrived ? 0 : u.status === 'PENDING' ? u.baselineSec : counts[u.id] ?? u.baselineSec,
      }
    }
    return m
  }, [units, counts, nextIdxFor])

  const corridorsOpen = units.filter((u) => u.corridorOpen && !u.arrived).length

  /* ---- ArogyaOS case projection ---- */
  /* status derives purely from the EXISTING unit lifecycle + authoritative
     remaining ETA — no timer, no duplicated movement model */
  const arogyaSelected = units.find((u) => u.id === selectedId) ?? units[0] ?? null
  const arogyaCaseStatus: CaseStatus | null =
    arogyaCase && arogyaSelected
      ? arogyaSelected.status === 'PENDING'
        ? 'CLOSED' // transport completed — unit back on standby (case closed)
        : caseStatusForUnit({
            status: arogyaSelected.status,
            arrived: arogyaSelected.arrived,
            progress:
              arogyaSelected.len > 0 ? arogyaSelected.dist / arogyaSelected.len : 0,
            etaSec: displayEta,
          })
      : null

  /* real-transition timeline events: ARRIVING (approach) + HANDOFF READY */
  useEffect(() => {
    if (!arogyaCase || !arogyaCaseStatus) return
    if (arogyaCaseStatus === 'ARRIVING' && !caseEventsRef.current.arriving) {
      caseEventsRef.current.arriving = true
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: null,
        kind: 'arrival',
        label: `AMBULANCE ARRIVING · ${arogyaCase.hospitalName.toUpperCase()}`,
      })
    }
    if (arogyaCaseStatus === 'ARRIVED' && !caseEventsRef.current.handoff) {
      caseEventsRef.current.handoff = true
      pushOpsEvent({
        t: trafficSimT(),
        junctionId: null,
        kind: 'arrival',
        label: `PATIENT ARRIVED · CLINICAL HANDOFF READY`,
      })
    }
  }, [arogyaCase, arogyaCaseStatus])

  /* ---- Emergency coordination actions (shared case) ---- */
  /* Each action mutates the ONE shared case in the ArogyaOS boundary and
     pushes a REAL timeline event at the transition. No external notification
     service is claimed — these are internal operational events. */
  const coordUnit = units.find((u) => u.id === selectedId) ?? units[0] ?? null

  /* intelligent hospital recommendation — ADVISORY. ETAs are the EXISTING
     routePlanner graph travel times from the unit origin to each hospital
     entrance; capability + bed capacity come from the demo registry. Never
     auto-redirects the ambulance (see handleHospitalDecline). */
  const hospitalRecommendation = useMemo<RecommendationResult | null>(() => {
    const u = coordUnit ?? units.find((x) => x.status === 'PENDING') ?? units[0] ?? null
    if (!u) return null
    const originId = u.originIntersectionId
    const speed = BASE[keyOf(u.id)]?.speedOpen ?? 42
    const override = incident ? incidentOverride() : undefined
    const candidates = registryCandidates((h) => {
      const pair = planPair(NETWORK, originId, h.entranceJunctionId, override, speed)
      return pair ? pair.plan.etaSec : null
    })
    return recommendHospitals({ emergencyType: arogyaCase?.emergencyType ?? u.incident, candidates })
  }, [coordUnit, units, incident, arogyaCase])

  const handleDriverNotifyCity = useCallback(() => {
    if (!arogyaCase || !coordUnit || coordUnit.status === 'PENDING') return
    const before = arogyaCase.cityNotificationStatus
    if (before !== 'NOT_SENT') return
    driverNotifyCity(arogyaCase.greenwaveEmergencyId)
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'coordination',
      label: `${coordUnit.tac} ROUTE ALERT SENT · ${arogyaCase.caseId}`,
    })
    pushToast('info', 'ROUTE ALERT SENT', `City traffic control notified · ${arogyaCase.caseId}`)
  }, [arogyaCase, coordUnit, pushToast])

  const handleCityAcknowledge = useCallback(() => {
    if (!arogyaCase || !coordUnit || coordUnit.status === 'PENDING') return
    const before = arogyaCase.cityNotificationStatus
    if (before === 'ACKNOWLEDGED') return
    cityAcknowledge(arogyaCase.greenwaveEmergencyId)
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'coordination',
      label: `CITY AUTHORITY ACKNOWLEDGED EMERGENCY ROUTE · ${arogyaCase.caseId}`,
    })
    pushToast('success', 'ROUTE ACKNOWLEDGED', `City traffic control acknowledged · ${arogyaCase.caseId}`)
    /* The acknowledgement AUTHORIZES the existing GreenWave emergency workflow:
       this calls the SAME openCorridor engine path used by the Command Center
       (arm → corridorOpen → adaptive mode → wave) — no second corridor engine. */
    if (!coordUnit.corridorOpen && !coordUnit.arrived) openCorridor(coordUnit.id)
  }, [arogyaCase, coordUnit, pushToast, openCorridor])

  const handleHospitalAcknowledge = useCallback(() => {
    if (!arogyaCase || !coordUnit || coordUnit.status === 'PENDING') return
    const before = arogyaCase.hospitalNotificationStatus
    if (before === 'ACCEPTED' || before === 'PREPARING' || before === 'READY') return
    /* ACCEPTED: hospital receives + accepts the incoming case */
    hospitalAcknowledge(arogyaCase.greenwaveEmergencyId)
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'coordination',
      label: `HOSPITAL RECEIVED INCOMING CASE · ${arogyaCase.hospitalName.toUpperCase()}`,
    })
    /* PREPARING: readiness begins for arrival */
    hospitalPrepare(arogyaCase.greenwaveEmergencyId)
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'coordination',
      label: `HOSPITAL ED PREPARING · ${arogyaCase.caseId}`,
    })
    pushToast('info', 'CASE ACCEPTED', `${arogyaCase.hospitalName} preparing for arrival`)
  }, [arogyaCase, coordUnit, pushToast])

  const handleHospitalReady = useCallback(() => {
    if (!arogyaCase || !coordUnit || coordUnit.status === 'PENDING') return
    const before = arogyaCase.hospitalNotificationStatus
    if (before === 'READY') return
    hospitalMarkReady(arogyaCase.greenwaveEmergencyId)
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'coordination',
      label: `HOSPITAL READY FOR ARRIVAL · ${arogyaCase.hospitalName.toUpperCase()}`,
    })
    pushToast('success', 'ED READY', `${arogyaCase.hospitalName} emergency department ready`)
  }, [arogyaCase, coordUnit, pushToast])

  /* hospital DECLINES the incoming case — assisted-rerouting trigger. This is
     advisory only: it never auto-redirects the ambulance (see feature: assisted
     rerouting). The operator/admin reviews the recommendation and confirms. */
  const handleHospitalDecline = useCallback(() => {
    if (!arogyaCase || !coordUnit || coordUnit.status === 'PENDING') return
    if (arogyaCase.hospitalNotificationStatus === 'DECLINED') return
    hospitalDecline(arogyaCase.greenwaveEmergencyId)
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'coordination',
      label: `HOSPITAL DECLINED CASE · ${arogyaCase.hospitalName.toUpperCase()} — REVIEW ALTERNATIVES`,
    })
    pushToast('warning', 'CASE DECLINED', `${arogyaCase.hospitalName} declined — review recommended alternatives`)
  }, [arogyaCase, coordUnit, pushToast])

  /* toggle a single readiness resource on the ONE shared case */
  const handleToggleResource = useCallback(
    (key: keyof HospitalReadiness) => {
      if (!arogyaCase || !coordUnit || coordUnit.status === 'PENDING') return
      const next = setHospitalResource(arogyaCase.greenwaveEmergencyId, key, !arogyaCase.readiness[key])
      if (!next) return
      // first resource toggle moves ACCEPTED → PREPARING (readiness begins)
      if (arogyaCase.hospitalNotificationStatus === 'ACCEPTED') hospitalPrepare(arogyaCase.greenwaveEmergencyId)
      setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    },
    [arogyaCase, coordUnit],
  )

  /* hospital confirms patient handover → mission closed + corridor released.
     Reuses the EXISTING closeCorridor engine path — no second release logic. */
  const handleHandoverComplete = useCallback(() => {
    if (!arogyaCase || !coordUnit) return
    const done = hospitalHandoverComplete(arogyaCase.greenwaveEmergencyId)
    if (!done) return
    setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
    if (coordUnit.corridorOpen && !coordUnit.arrived) closeCorridor(coordUnit.id)
    pushOpsEvent({
      t: trafficSimT(),
      junctionId: null,
      kind: 'arrival',
      label: `PATIENT HANDOVER COMPLETE · ${arogyaCase.caseId} — MISSION CLOSED`,
    })
    pushToast('success', 'HANDOVER COMPLETE', `${arogyaCase.caseId} · corridor released · mission closed`)
  }, [arogyaCase, coordUnit, closeCorridor, pushToast])

  const metrics: MetricsData = useMemo(
    () => ({
      /* every value below comes from the live simulation state */
      vehicles: sim.active,
      corridorsOpen,
      avgSpeedKmh: sim.avgSpeedKmh,
      queueAvg: sim.queueM,
      throughput: sim.ratePerHour,
      delayAvg: sim.avgWaitSec,
      loadPct: sim.loadPct,
      etaSec: displayEta,
      /* 0 only when no unit exists — MetricsStrip renders "—" via m.active
         and never displays baseline/saved in that state (no fake numbers) */
      etaBaselineSec: selected?.baselineSec ?? 0,
      etaSavedSec: selected?.savedSec ?? 0,
      corridorOpen: !!(selected && selected.corridorOpen && !selected.arrived),
      incident: incident !== null,
      active: units.some((u) => u.status === 'ACTIVE' || u.arrived),
    }),
    [corridorsOpen, incident, displayEta, selected, units, sim],
  )

  const mapUnits: UnitSim[] = units.map((u) => {
    const plan = activePlanFor(u)
    const def = BASE[keyOf(u.id)]
    return {
      id: u.id,
      pts: plan?.pts ?? NOMINAL[keyOf(u.id)].plan.pts,
      speedOpen: def.speedOpen,
      speedClosed: def.speedClosed,
      open: u.corridorOpen,
      dispatched: u.status === 'ACTIVE' || u.status === 'COMPLETED',
      arrived: u.arrived,
      d: u.dist,
      active: u.id === selectedId,
      rerouted: u.variant === 'detour',
      junctionIds: u.junctionIds,
    }
  })

  /* alternative route info for the selected unit (computed from the graph) */
  const selectedAlt = useMemo(() => {
    if (!selected) return null
    const pair = incident && selected.variant === 'detour' ? congested?.[keyOf(selected.id)] : NOMINAL[keyOf(selected.id)]
    const alt = pair?.alt
    const plan = activePlanFor(selected)
    if (!alt || !plan) return null
    const via = alt.intersectionIds.find((j) => !plan.intersectionIds.includes(j))
    return {
      label: via ? `VIA ${via}` : `${alt.intersectionIds[0]}→${alt.intersectionIds[alt.intersectionIds.length - 1]}`,
      km: alt.distanceKm,
      etaSec: alt.baselineSec,
    }
  }, [selected, incident, congested, activePlanFor])

  const anyOpen = corridorsOpen > 0
  const arming = activatingId !== null
  if (isMobile) {
    return (
      <>
        <MobileAppView
          units={units}
          mapUnits={mapUnits}
          selectedId={selectedId}
          selected={selected}
          incident={incident}
          mode={mode}
          epoch={epoch}
          resetKey={resetKey}
          corridorsOpen={corridorsOpen}
          activatingId={activatingId}
          metrics={metrics}
          sim={sim}
          arogyaCase={arogyaCase}
          arogyaCaseStatus={arogyaCaseStatus}
          displayEta={displayEta}
          corrWaves={corrWaves}
          opsRole={opsRole}
          session={session}
          logOpen={logOpen}
          toasts={toasts}
          canAdd={canAdd}
          onTelemetry={onTelemetry}
          onSelectUnit={(id) => setSelectedId(id)}
          onDispatch={dispatch}
          onOpenCorridor={openCorridor}
          onCloseCorridor={closeCorridor}
          onMode={handleMode}
          onAddEmergency={handleAdd}
          onInjectIncident={handleIncident}
          onReset={handleReset}
          onOpenHandoff={() => setHandoffOpen(true)}
          onOpenSession={() => setSessionOpen(true)}
          onToggleLog={() => setLogOpen((v) => !v)}
          onCloseToast={closeToast}
          onOpenInstall={() => setInstallPromptOpen(true)}
          setOpsRole={setOpsRole}
          hospitalRecommendation={hospitalRecommendation}
          handleDriverNotifyCity={handleDriverNotifyCity}
          handleCityAcknowledge={handleCityAcknowledge}
          handleHospitalAcknowledge={handleHospitalAcknowledge}
          handleHospitalDecline={handleHospitalDecline}
          handleHospitalReady={handleHospitalReady}
          handleToggleResource={handleToggleResource}
          handleHandoverComplete={handleHandoverComplete}
        />

        <PWAInstallPrompt
          forceOpen={installPromptOpen}
          onClose={() => setInstallPromptOpen(false)}
        />

        <ClinicalHandoffModal
          open={handoffOpen}
          emergencyCase={arogyaCase}
          etaSec={displayEta}
          arrived={!!arogyaSelected?.arrived}
          onClose={() => setHandoffOpen(false)}
          onMarkReviewed={() => {
            if (arogyaCase) {
              markHandoffReviewed(arogyaCase.greenwaveEmergencyId)
              setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
            }
          }}
        />

        <SessionModal
          open={session ? sessionOpen : true}
          session={session}
          busy={!booted}
          onClose={() => setSessionOpen(false)}
          onSignInDemo={handleSignInDemo}
          demoEntryEnabled={demoEntryEnabled}
          onEnterDemo={handleEnterDemo}
          onSignInSupabase={handleSignInSupabase}
          onSignUpSupabase={handleSignUpSupabase}
          onSignOut={() => void handleSignOut()}
        />

        <HistoryDrawer open={logOpen} onClose={() => setLogOpen(false)} />

        <AnimatePresence>
          {!booted && (
            <motion.div
              key="boot"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-night-950"
            >
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 animate-pulse rounded-full bg-ops-cyan shadow-[0_0_10px_#38c4e0]" />
                <span className="font-mono text-[11px] font-semibold tracking-[0.32em] text-slate-200">GREENWAVE</span>
              </div>
              <div className="font-mono text-[8.5px] tracking-[0.22em] text-slate-600">
                ESTABLISHING SECURE OPERATOR CHANNEL
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    )
  }

  const def = BASE[keyOf(selected.id)]
  const corridorUnit = units.find((u) => u.corridorOpen && !u.arrived) ?? null

  return (
    <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex h-screen w-screen overflow-hidden bg-night-950 text-slate-300"
    >
      <Sidebar
        active={view}
        onNavigate={(id, label) => {
          if (
            id === 'command' ||
            id === 'emergencies' ||
            id === 'corridors' ||
            id === 'traffic' ||
            id === 'analytics' ||
            id === 'digital-twin' ||
            id === 'system' ||
            id === 'ops'
          ) {
            setView(id)
            return
          }
          pushToast('info', 'MODULE OFFLINE', `${label} is scheduled for a later phase of the platform`)
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          moduleLabel={
            view === 'emergencies'
              ? 'EMERGENCIES'
              : view === 'corridors'
                ? 'ACTIVE CORRIDORS'
                : view === 'traffic'
                  ? 'LIVE TRAFFIC'
                  : view === 'analytics'
                    ? 'ANALYTICS'
                    : view === 'digital-twin'
                      ? 'DIGITAL TWIN'
                      : view === 'system'
                        ? 'SYSTEM'
                        : view === 'ops'
                          ? 'EMERGENCY OPS'
                          : 'COMMAND CENTER'
          }
          corridorActive={anyOpen}
          session={session}
          onOpenSession={() => setSessionOpen(true)}
          logOpen={logOpen}
          hasOps={opsTotal > 0}
          onToggleLog={() => setLogOpen((v) => !v)}
          onOpenInstall={() => setInstallPromptOpen(true)}
        />

        {/* Tablet view mode switcher (Map vs Panels vs Split) */}
        {isTablet && (
          <div className="flex items-center justify-between border-b border-white/[0.05] bg-night-900/90 px-3 py-1.5 backdrop-blur-sm">
            <div className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-night-950 p-0.5">
              <button
                type="button"
                onClick={() => setTabletView('both')}
                className={cn('rounded px-2.5 py-1 text-[8.5px] font-mono font-semibold uppercase tracking-wider transition-colors', tabletView === 'both' ? 'bg-ops-cyan/20 text-ops-cyan border border-ops-cyan/40' : 'text-slate-400 hover:text-slate-200')}
              >
                Split View
              </button>
              <button
                type="button"
                onClick={() => setTabletView('map')}
                className={cn('rounded px-2.5 py-1 text-[8.5px] font-mono font-semibold uppercase tracking-wider transition-colors', tabletView === 'map' ? 'bg-ops-cyan/20 text-ops-cyan border border-ops-cyan/40' : 'text-slate-400 hover:text-slate-200')}
              >
                Full Map
              </button>
              <button
                type="button"
                onClick={() => setTabletView('panel')}
                className={cn('rounded px-2.5 py-1 text-[8.5px] font-mono font-semibold uppercase tracking-wider transition-colors', tabletView === 'panel' ? 'bg-ops-cyan/20 text-ops-cyan border border-ops-cyan/40' : 'text-slate-400 hover:text-slate-200')}
              >
                Ops Panels
              </button>
            </div>
            <span className="font-mono text-[8px] text-slate-500 uppercase tracking-widest">TABLET DUAL-VIEW</span>
          </div>
        )}

        {/* module page bands — mounted for ALL views so the single CityMap
            below never unmounts (traffic + ambulance keep running); inactive
            bands collapse via CSS */}
        <div className={cn('shrink-0 px-2.5', view !== 'emergencies' && 'hidden')}>
          <EmergenciesHeader
            units={units}
            incident={incident}
            corridorsOpen={corridorsOpen}
            arming={arming}
            mode={mode}
          />
        </div>
        <div className={cn('shrink-0 px-2.5', view !== 'corridors' && 'hidden')}>
          <CorridorsHeader
            units={units}
            incident={incident}
            corridorsOpen={corridorsOpen}
            arming={arming}
            mode={mode}
            corrWaves={corrWaves}
          />
        </div>
        <div className={cn('shrink-0 px-2.5', view !== 'traffic' && 'hidden')}>
          <LiveTrafficHeader incident={incident} corridorsOpen={corridorsOpen} mode={mode} />
        </div>
        <div className={cn('shrink-0 px-2.5', view !== 'analytics' && 'hidden')}>
          <AnalyticsHeader mode={mode} incident={incident} corridorsOpen={corridorsOpen} />
        </div>
        <div className={cn('shrink-0 px-2.5', view !== 'digital-twin' && 'hidden')}>
          <DigitalTwinHeader incident={incident} corridorsOpen={corridorsOpen} mode={mode} />
        </div>
        <div className={cn('shrink-0 px-2.5', view !== 'system' && 'hidden')}>
          <SystemHeader units={units} incident={incident} corridorsOpen={corridorsOpen} mode={mode} />
        </div>

        <div className="flex min-h-0 flex-1 gap-2.5 px-2.5 pt-2.5">
          {/* Emergencies ops rail */}
          <div className={cn('w-[260px] xl:w-[300px] shrink-0', view !== 'emergencies' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <EmergenciesRail
              units={units}
              selectedId={selectedId}
              unitT={unitT}
              incident={incident}
              corridorsOpen={corridorsOpen}
              mode={mode}
              corrWave={corrWaves[selectedId] ?? null}
              emergencyCase={arogyaCase}
              caseStatus={arogyaCaseStatus}
              etaSec={displayEta}
              corridorOpen={!!(arogyaSelected && arogyaSelected.corridorOpen && !arogyaSelected.arrived)}
              corridorReleased={!!arogyaSelected?.arrived}
              onOpenHandoff={() => setHandoffOpen(true)}
            />
          </div>
          {/* Active Corridors ops rail */}
          <div className={cn('w-[260px] xl:w-[300px] shrink-0', view !== 'corridors' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <CorridorsRail
              units={units}
              selectedId={selectedId}
              unitT={unitT}
              incident={incident}
              mode={mode}
              corridorsOpen={corridorsOpen}
              arming={arming}
              activeCorridorId={activatingId}
              corrWaves={corrWaves}
              onOpenEmergencies={() => setView('emergencies')}
            />
          </div>
          {/* Live Traffic ops rail */}
          <div className={cn('w-[260px] xl:w-[300px] shrink-0', view !== 'traffic' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <LiveTrafficLeft incident={incident} />
          </div>
          {/* Analytics ops rail */}
          <div className={cn('w-[260px] xl:w-[300px] shrink-0', view !== 'analytics' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <AnalyticsLeft
              sla={
                selected && (selected.status === 'ACTIVE' || selected.arrived) && arogyaCase
                  ? {
                      caseId: arogyaCase.caseId,
                      tac: selected.tac,
                      priority: selected.priority,
                      targetSec: selected.baselineSec,
                      actualSec: displayEta > 0 ? displayEta : selected.baselineSec - selected.savedSec,
                      savedSec: selected.savedSec,
                    }
                  : null
              }
            />
          </div>
          {/* Digital Twin ops rail */}
          <div className={cn('w-[260px] xl:w-[300px] shrink-0', view !== 'digital-twin' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <DigitalTwinLeft
              junction={twinJunction}
              onSelect={setTwinJunction}
              layers={twinLayers}
            />
          </div>
          {/* System ops rail */}
          <div className={cn('w-[260px] xl:w-[300px] shrink-0', view !== 'system' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <SystemLeft
              session={session}
              units={units}
              corridorsOpen={corridorsOpen}
              mode={mode}
              corrWaves={corrWaves}
            />
          </div>
          {/* Emergency coordination network rail (role-aware ops view) */}
          <div className={cn('shrink-0', view !== 'ops' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <EmergencyOpsPage
              emergencyCase={arogyaCase}
              caseStatus={arogyaCaseStatus}
              unit={coordUnit}
              etaSec={displayEta}
              progress={coordUnit && coordUnit.len > 0 ? Math.min(1, coordUnit.dist / coordUnit.len) : 0}
              nextJunction={
                (() => {
                  const u = coordUnit
                  if (!u) return null
                  const idx = nextIdxFor(u)
                  return u.arrived || idx >= u.junctionIds.length ? null : u.junctionIds[idx]
                })()
              }
              corridorOpen={!!(coordUnit && coordUnit.corridorOpen && !coordUnit.arrived)}
              corridorReleased={!!coordUnit?.arrived}
              activating={activatingId === selectedId}
              corrWave={corrWaves[selectedId] ?? null}
              networkLoadPct={sim.loadPct}
              avgSpeedKmh={sim.avgSpeedKmh}
              role={opsRole}
              onRoleChange={setOpsRole}
              recommendation={hospitalRecommendation}
              onNotifyCity={handleDriverNotifyCity}
              onCityAcknowledge={handleCityAcknowledge}
              onHospitalAcknowledge={handleHospitalAcknowledge}
              onHospitalDecline={handleHospitalDecline}
              onHospitalReady={handleHospitalReady}
              onToggleResource={handleToggleResource}
              onHandoverComplete={handleHandoverComplete}
              onOpenHandoff={() => setHandoffOpen(true)}
              onDispatch={() => {
                /* driver-side primary action — the EXISTING dispatch flow
                   (creates the shared case, identical to Command Center) */
                const u = coordUnit ?? units.find((x) => x.status === 'PENDING')
                if (u) dispatch(u.id)
              }}
            />
          </div>

          {/* map frame */}
          <motion.main
            key="map-frame"
            initial={{ opacity: 0, scale: 0.996 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.12, ease: 'easeOut' }}
            className={cn(
              'relative min-w-0 flex-1 overflow-hidden rounded-md border border-white/[0.07] bg-night-900 shadow-[inset_0_0_60px_rgba(0,0,0,0.4)]',
              isTablet && tabletView === 'panel' && 'hidden'
            )}
          >
            <CityMap
              units={mapUnits}
              incident={incident}
              mode={mode}
              epoch={epoch}
              resetKey={resetKey}
              onTelemetry={onTelemetry}
            />

            {/* frame dressing: inset registration ring + viewport scale */}
            <div aria-hidden className="pointer-events-none absolute inset-0 z-[15]">
              <span className="absolute inset-[7px] rounded-[5px] border border-white/[0.03]" />
              <span className="absolute left-3 top-0 h-px w-10 bg-gradient-to-r from-ops-cyan/40 to-transparent" />
            </div>
            <div className="pointer-events-none absolute bottom-3 right-3 z-20 hidden flex-col items-end gap-[3px] lg:flex">
              <div className="flex items-center gap-1.5 rounded-[3px] border border-white/[0.06] bg-night-900/70 px-1.5 py-[3px] font-mono text-[7.5px] tracking-[0.22em] text-slate-500 backdrop-blur-[2px]">
                <span className="text-[8px] leading-none text-ops-cyan">▲</span>N
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-px w-9 bg-gradient-to-r from-slate-600/80 to-slate-500/70" />
                <span className="font-mono text-[7.5px] tracking-[0.08em] text-slate-600">300m</span>
              </div>
            </div>

            {/* corner header: corridor state chip */}
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-2.5 rounded-[5px] border border-white/[0.07] bg-night-900/80 px-2.5 py-2 backdrop-blur-[2px]"
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-[4px] border',
                  anyOpen ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/10 bg-white/[0.02]',
                )}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                  <path
                    d="M2 16.5 L7 16.5 L9.5 9 L13.5 20 L16.5 9 L18 13 L22 13"
                    stroke={anyOpen ? '#2fe08a' : '#64748b'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="leading-tight">
                <div className="flex max-w-[300px] items-center gap-2">
                  <MicroLabel className="truncate text-slate-500">
                    {selected.corridorLabel} · {def.originShort} → {def.destShort}
                  </MicroLabel>
                </div>
                <div className="mt-[2px] flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.18em]">
                  <Led tone={anyOpen ? 'green' : arming ? 'cyan' : 'slate'} pulse={anyOpen || arming} size={5} />
                  <span className={anyOpen ? 'text-emerald-300' : arming ? 'text-ops-cyan' : 'text-slate-400'}>
                    {anyOpen ? 'GREENWAVE ACTIVE' : arming ? 'ARMING CORRIDOR' : 'CORRIDOR STANDBY'}
                  </span>
                  <span className="text-slate-700">·</span>
                  <span className="text-slate-500">
                    {selected && selected.junctionIds.length > 0
                      ? `${selected.junctionIds[0]}–${selected.junctionIds[selected.junctionIds.length - 1]}`
                      : '—'}
                  </span>
                </div>
              </div>
            </motion.div>

            {/* alerts (top right) */}
            <IncidentAlert toasts={toasts} incidentActive={incident !== null} onClose={closeToast}>
              <motion.div
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.6 }}
                className="pointer-events-auto flex items-center gap-2 rounded-[4px] border border-white/[0.07] bg-night-900/75 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.14em] text-slate-500 backdrop-blur-[2px]"
              >
                <ShieldCheck size={11} className="text-emerald-400/80" />
                NO ACTIVE TRAFFIC INCIDENTS
              </motion.div>
            </IncidentAlert>
            {view === 'command' ? (
              <>
                <TrafficLegend />
                {mode !== null && <PredictiveTrafficPanel />}
              </>
            ) : view === 'corridors' ? (
              <CorridorsLegend />
            ) : view === 'traffic' ? (
              <LiveTrafficLegend />
            ) : view === 'digital-twin' ? (
              <>
                <DigitalTwinLegend layers={twinLayers} />
                <DigitalTwinLayers
                  layers={twinLayers}
                  onToggle={(k: TwinLayerKey) => setTwinLayers((prev) => ({ ...prev, [k]: !prev[k] }))}
                />
              </>
            ) : view === 'system' ? null : (
              <EmergenciesLegend />
            )}
            {(view === 'command' || view === 'traffic') && <TrafficCameraPanel />}

            <DemoControls 
              mode={mode}
              incidentActive={incident !== null}
              canAdd={canAdd}
              onMode={handleMode}
              onAddEmergency={handleAdd}
              onInjectIncident={handleIncident}
              onReset={handleReset}
            />

            {/* operations history / audit drawer (Step 6) */}
            <HistoryDrawer open={logOpen} onClose={() => setLogOpen(false)} />
          </motion.main>

          {/* right: emergency ops panel (hidden on Live Traffic / Analytics / Digital Twin / System / Emergency Ops) */}
          <div className={cn('flex h-full w-[280px] xl:w-[356px] shrink-0', (view === 'traffic' || view === 'analytics' || view === 'digital-twin' || view === 'system' || view === 'ops') && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <EmergencyPanel
              emergencies={units}
              selectedId={selectedId}
              incident={incident}
              unitT={unitT}
              activating={activatingId === selectedId}
              altRoute={selectedAlt}
              corrWave={corrWaves[selectedId] ?? null}
              emergencyCase={arogyaCase}
              caseStatus={arogyaCaseStatus}
              onOpenHandoff={() => setHandoffOpen(true)}
              onSelect={(id) => setSelectedId(id)}
              onDispatch={dispatch}
              onToggleCorridor={(id) => {
                const u = units.find((x) => x.id === id)
                if (u?.corridorOpen && !u.arrived) closeCorridor(id)
                else openCorridor(id)
              }}
            />
          </div>
          {/* right: live traffic rail (only on Live Traffic) */}
          <div className={cn('flex h-full w-[260px] xl:w-[300px] shrink-0', view !== 'traffic' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <LiveTrafficRight
              corridorUnit={corridorUnit}
              corridorWaves={corridorUnit ? corrWaves[corridorUnit.id] ?? [] : []}
              corridorsOpen={corridorsOpen}
            />
          </div>
          {/* right: analytics rail (only on Analytics) */}
          <div className={cn('flex h-full w-[260px] xl:w-[300px] shrink-0', view !== 'analytics' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <AnalyticsRight incident={incident} />
          </div>
          {/* right: digital twin rail (only on Digital Twin) */}
          <div className={cn('flex h-full w-[260px] xl:w-[300px] shrink-0', view !== 'digital-twin' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <DigitalTwinRight
              junction={twinJunction}
              corridorUnit={corridorUnit}
              corridorWaves={corridorUnit ? corrWaves[corridorUnit.id] ?? [] : []}
              corridorsOpen={corridorsOpen}
              incident={incident}
              unitT={unitT}
              layers={twinLayers}
            />
          </div>
          {/* right: system rail (only on System) */}
          <div className={cn('flex h-full w-[260px] xl:w-[300px] shrink-0', view !== 'system' && 'hidden', isTablet && tabletView === 'map' && 'hidden')}>
            <SystemRight incident={incident} corridorsOpen={corridorsOpen} mode={mode} />
          </div>
        </div>

        {/* Step 16: controlled A/B impact proof — compact bottom strip, never covers the map */}
        <div className={cn('px-2.5 pt-2.5', view !== 'command' && 'hidden')}>
          <ImpactComparisonPanel
            phase={abPhase}
            result={abResult}
            error={abError}
            scenarioLabel={`${BASE[keyOf(selectedId)].tac} · ${BASE[keyOf(selectedId)].originShort} → ${BASE[keyOf(selectedId)].destShort}`}
            onRun={runAB}
            onReset={resetAB}
          />
        </div>

        <div className="px-2.5 pb-2.5 overflow-x-auto scrollbar-none">
          <MetricsStrip m={metrics} history={simHist} />
        </div>
      </div>
    </motion.div>

    {/* PWA App Local Installation Prompt */}
    <PWAInstallPrompt
      forceOpen={installPromptOpen}
      onClose={() => setInstallPromptOpen(false)}
    />

    {/* ArogyaOS: Doctor Copilot pre-arrival clinical handoff (clinician-facing) */}
    <ClinicalHandoffModal
      open={handoffOpen}
      emergencyCase={arogyaCase}
      etaSec={displayEta}
      arrived={!!arogyaSelected?.arrived}
      onClose={() => setHandoffOpen(false)}
      onMarkReviewed={() => {
        if (arogyaCase) {
          markHandoffReviewed(arogyaCase.greenwaveEmergencyId)
          setArogyaCase(emergencyCaseOf(arogyaCase.greenwaveEmergencyId))
        }
      }}
    />

    {/* operator session panel / auth gate */}
    <SessionModal
      open={session ? sessionOpen : true}
      session={session}
      busy={!booted}
      onClose={() => setSessionOpen(false)}
      onSignInDemo={handleSignInDemo}
      demoEntryEnabled={demoEntryEnabled}
      onEnterDemo={handleEnterDemo}
      onSignInSupabase={handleSignInSupabase}
      onSignUpSupabase={handleSignUpSupabase}
      onSignOut={() => void handleSignOut()}
    />

    {/* secure-channel boot overlay — hides the gate flash while the session
        is being resolved / verified against Supabase */}
    <AnimatePresence>
      {!booted && (
        <motion.div
          key="boot"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-night-950"
        >
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-ops-cyan shadow-[0_0_10px_#38c4e0]" />
            <span className="font-mono text-[11px] font-semibold tracking-[0.32em] text-slate-200">GREENWAVE</span>
          </div>
          <div className="font-mono text-[8.5px] tracking-[0.22em] text-slate-600">
            ESTABLISHING SECURE OPERATOR CHANNEL
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}
