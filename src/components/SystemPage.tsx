// ---------------------------------------------------------------------------
// GREENWAVE — System module (Step 15)
//
// Platform operations & infrastructure view. This is NOT a new engine and NOT
// a monitoring backend — every value is read from the SAME stores the other
// modules read:
//
//   vehicles.ts (traffic) · signalState.ts · osmRoadNetwork (routing)
//   trafficPrediction.ts · trafficDemand.ts (camera) · corridor.ts
//   emergencyTimeline · analyticsRecorder · backend/repo · backend/convex
//   backend/session (authentication)
//
// Truthfulness rules enforced here:
//   · camera status comes from the single shared probe (App-level), never a
//     second poller
//   · cloud/database/convex states are "NOT VERIFIED" unless the existing
//     health mechanisms actually report them
//   · no uptime %, no accuracy %, no fake latency — missing data renders "—"
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  BarChart3,
  Boxes,
  BrainCircuit,
  Cpu,
  Database,
  Lock,
  Network,
  Settings,
  ShieldCheck,
  Waves,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import { useSystemStatus } from './useSystemStatus'
import { fmtClock } from '../lib/format'
import type { EmergencyRuntime, IncidentState, Mode } from '../types'
import type { OperatorSession } from '../backend/session'
import { DISPLAY_SIGNAL_IDS, NETWORK, congestionLevel } from '../data/osmRoadNetwork'
import { trafficMetrics, trafficObservations, trafficSimT } from '../engine/vehicles'
import { signalStates } from '../engine/signalState'
import { predict } from '../engine/trafficPrediction'
import type { CorridorJunction } from '../engine/corridor'
import { corridorEventsLog } from '../engine/corridor'
import { opsTimeline } from '../engine/emergencyTimeline'
import { analyticsSamples } from '../engine/analyticsRecorder'
import {
  cameraBackendOnline,
  getCameraMetrics,
  globalSensorSource,
  msSinceLastCameraUpdate,
} from '../engine/trafficDemand'

const CAMERA_FRESH_MS = 6000

const SOURCE_META: Record<'CAMERA' | 'FUSED' | 'SIMULATION', { word: string; desc: string; tone: Tone; pulse: boolean }> = {
  CAMERA: { word: 'CAMERA', desc: 'YOLO vehicle perception', tone: 'green', pulse: true },
  FUSED: { word: 'FUSED', desc: 'Camera + simulation state', tone: 'cyan', pulse: true },
  SIMULATION: { word: 'SIMULATION', desc: 'Local deterministic traffic model', tone: 'slate', pulse: false },
}

function EngineStat({
  label,
  word,
  sub,
  tone,
  pulse,
}: {
  label: string
  word: string
  sub: string
  tone: Tone
  pulse?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1.5">
        <Led tone={tone} pulse={pulse} size={5} />
        <span className="truncate font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </span>
      </div>
      <div
        className={cn(
          'mt-1 truncate font-mono text-[9.5px] font-bold uppercase tracking-[0.14em]',
          tone === 'green'
            ? 'text-emerald-300'
            : tone === 'red'
              ? 'text-ops-red'
              : tone === 'amber'
                ? 'text-ops-amber'
                : tone === 'cyan'
                  ? 'text-ops-cyan'
                  : 'text-slate-400',
        )}
      >
        {word}
      </div>
      <div className="truncate font-mono text-[7px] tracking-[0.12em] text-slate-700">{sub}</div>
    </div>
  )
}

function KpiCell({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center px-3.5">
      <div className="truncate font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className={cn('mt-[3px] truncate font-mono text-[14px] font-semibold tabular leading-none', cls || 'text-slate-100')}>
        {value}
      </div>
      {sub && <div className="mt-[3px] truncate font-mono text-[7px] tracking-[0.1em] text-slate-600">{sub}</div>}
    </div>
  )
}

/** per-approach forecast the operator should look at (busiest axis, highest-risk focus) */
function focusForecast(t: number) {
  const obs = trafficObservations()
  let best: { j: string; g: 'M' | 'X'; q: number } | null = null
  for (const j of DISPLAY_SIGNAL_IDS) {
    const o = obs.get(j)
    const q = (o?.M.queue ?? 0) + (o?.X.queue ?? 0)
    if (!best || q > best.q) {
      const g: 'M' | 'X' = (o?.M.queue ?? 0) >= (o?.X.queue ?? 0) ? 'M' : 'X'
      best = { j, g, q }
    }
  }
  if (!best) return null
  const pred = predict(best.j, best.g, t)
  return { j: best.j, g: best.g, pred }
}

interface CommonProps {
  incident: IncidentState | null
  corridorsOpen: number
  mode: Mode
}

/* ------------------------------------------------------------------ */
/*  Header band + overall status + health summary                      */
/* ------------------------------------------------------------------ */

export function SystemHeader({ units, incident, corridorsOpen, mode }: CommonProps & { units: EmergencyRuntime[] }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1200)
    return () => window.clearInterval(t)
  }, [])

  const t = trafficSimT()
  const sim = trafficMetrics()
  const snaps = signalStates()
  const totalSignals = DISPLAY_SIGNAL_IDS.length
  const adaptiveCount = snaps.filter((s) => s.control === 'ADAPTIVE').length
  const backendUp = cameraBackendOnline()
  const src = globalSensorSource()

  const activeUnits = units.filter((u) => u.status === 'ACTIVE' && !u.arrived)
  const emergencyActive = activeUnits.length > 0 || corridorsOpen > 0

  const probes = ['M', 'X'] as const
  let readyCount = 0
  for (const j of DISPLAY_SIGNAL_IDS.slice(0, 8)) {
    for (const g of probes) {
      if (predict(j, g, t).status === 'READY') readyCount++
    }
  }

  const cam = getCameraMetrics()
  const camFresh = cam !== null && msSinceLastCameraUpdate() < CAMERA_FRESH_MS

  /* platform status — priority: emergency > incident > degraded > operational */
  let statusWord = 'OPERATIONAL'
  let statusTone: Tone = 'green'
  let statusDetail = 'ALL SYSTEMS NOMINAL'
  if (emergencyActive) {
    statusWord = 'EMERGENCY PRIORITY ACTIVE'
    statusTone = 'red'
    statusDetail = activeUnits.length > 0 ? `${activeUnits.length} UNIT(S) EN ROUTE` : `${corridorsOpen} CORRIDOR(S) ACTIVE`
  } else if (incident) {
    statusWord = 'INCIDENT ACTIVE'
    statusTone = 'red'
    statusDetail = `${incident.junctionId} · ${incident.severity.toUpperCase()}`
  } else if (!backendUp) {
    statusWord = 'OPERATIONAL · CAMERA DEGRADED'
    statusTone = 'amber'
    statusDetail = 'SIMULATION FALLBACK ACTIVE'
  }

  const activeComp = 6 + (backendUp ? 1 : 0) // traffic · signals · routing · prediction · emergency · corridor (+camera)
  const degradedComp = backendUp ? 0 : 1

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      {/* row 1: title + engine chips */}
      <div className="flex h-[52px] items-center justify-between gap-4 px-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-ops-cyan/35 bg-ops-cyan/[0.09]">
              <Settings size={12} className="text-ops-cyan" />
            </span>
            <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.28em] text-slate-100">System</h1>
          </div>
          <div className="mt-[3px] pl-[34px] font-mono text-[8.5px] tracking-[0.16em] text-slate-600">
            PLATFORM OPERATIONS & INFRASTRUCTURE
          </div>
        </div>

        <div className="hidden min-w-0 shrink-0 grid-cols-3 gap-4 xl:grid-cols-6 xl:gap-4 lg:grid">
          <EngineStat
            label="Traffic Engine"
            word={sim.active > 0 ? 'RUNNING' : 'BOOTING'}
            sub={`${sim.active} ACTIVE VEH`}
            tone="green"
            pulse={sim.active > 0}
          />
          <EngineStat
            label="Signal Control"
            word={mode === 'greenwave' ? 'ADAPTIVE' : 'FIXED TIME'}
            sub={`${adaptiveCount}/${totalSignals} OPTIMIZING`}
            tone={mode === 'greenwave' ? 'green' : 'cyan'}
            pulse={mode === 'greenwave'}
          />
          <EngineStat
            label="Routing"
            word="READY"
            sub={`${NETWORK.intersections.length} NODES`}
            tone="green"
          />
          <EngineStat
            label="Prediction Engine"
            word={readyCount > 0 ? 'FORECASTING' : 'BUILDING'}
            sub={readyCount > 0 ? `${readyCount} APPROACHES` : 'COLLECTING HISTORY'}
            tone={readyCount > 0 ? 'green' : 'amber'}
            pulse={readyCount > 0}
          />
          <EngineStat
            label="Emergency Engine"
            word={activeUnits.length > 0 ? 'ACTIVE' : 'STANDBY'}
            sub={activeUnits.length > 0 ? `${activeUnits.length} UNIT(S)` : 'NO UNIT ACTIVE'}
            tone={activeUnits.length > 0 ? 'green' : 'slate'}
            pulse={activeUnits.length > 0}
          />
          <EngineStat
            label="Camera Perception"
            word={!backendUp ? 'OFFLINE' : camFresh ? 'LIVE' : 'ONLINE'}
            sub={!backendUp ? 'FALLBACK SIM' : camFresh ? `${cam?.total_detections ?? 0} DETECTIONS` : 'NO VIDEO FEED'}
            tone={!backendUp ? 'red' : camFresh ? 'green' : 'slate'}
            pulse={backendUp && camFresh}
          />
        </div>

        <Pill tone={SOURCE_META[src].tone} className="hidden shrink-0 lg:inline-flex">
          {src === 'CAMERA' ? 'CAMERA LIVE' : src}
        </Pill>
      </div>

      {/* row 2: overall platform status banner */}
      <div
        className={cn(
          'flex items-center gap-2.5 border-t border-white/[0.06] px-3.5 py-[7px]',
          statusTone === 'red'
            ? 'bg-ops-red/[0.06]'
            : statusTone === 'amber'
              ? 'bg-ops-amber/[0.05]'
              : 'bg-emerald-400/[0.04]',
        )}
      >
        <Led tone={statusTone} pulse={statusTone !== 'green'} size={7} />
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-600">System</span>
        <span
          className={cn(
            'font-mono text-[11px] font-bold uppercase tracking-[0.18em]',
            statusTone === 'red'
              ? 'text-ops-red'
              : statusTone === 'amber'
                ? 'text-ops-amber'
                : 'text-emerald-300',
          )}
        >
          {statusWord}
        </span>
        <span className="hidden font-mono text-[8px] tracking-[0.12em] text-slate-600 sm:inline">· {statusDetail}</span>
        <span className="ml-auto hidden font-mono text-[7.5px] tracking-[0.12em] text-slate-700 md:inline">
          ENGINE HEALTH · DATA SOURCES · CONNECTIVITY · OPERATIONAL READINESS
        </span>
      </div>

      {/* row 3: health summary band */}
      <div className="flex divide-x divide-white/[0.05] overflow-x-auto border-t border-white/[0.05] py-2">
        <KpiCell label="Platform Status" value={statusWord} sub={statusDetail} cls={statusTone === 'red' ? 'text-ops-red' : statusTone === 'amber' ? 'text-ops-amber' : 'text-emerald-300'} />
        <KpiCell label="Active Components" value={`${activeComp}`} sub={`${totalSignals} SIGNAL JUNCTIONS`} />
        <KpiCell label="Degraded" value={`${degradedComp}`} sub={degradedComp > 0 ? 'CAMERA OFFLINE' : 'NONE'} cls={degradedComp > 0 ? 'text-ops-amber' : ''} />
        <KpiCell label="Traffic Source" value={src} sub={SOURCE_META[src].desc} cls={src === 'SIMULATION' ? 'text-slate-300' : 'text-ops-cyan'} />
        <KpiCell label="Control Mode" value={mode === 'greenwave' ? 'GREENWAVE' : 'FIXED TIMING'} sub={mode === 'greenwave' ? 'ADAPTIVE OPTIMIZATION' : 'BASELINE CYCLES'} cls={mode === 'greenwave' ? 'text-emerald-300' : ''} />
        <KpiCell label="Emergencies" value={`${activeUnits.length}`} sub={activeUnits.length > 0 ? 'UNIT EN ROUTE' : 'NONE ACTIVE'} />
        <KpiCell label="Incidents" value={incident ? '1' : '0'} sub={incident ? `${incident.junctionId} ACTIVE` : 'CLEAR'} cls={incident ? 'text-ops-red' : ''} />
        <KpiCell label="Active Corridors" value={`${corridorsOpen}`} sub={corridorsOpen > 0 ? 'COORDINATING' : 'STANDBY'} cls={corridorsOpen > 0 ? 'text-emerald-300' : ''} />
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/*  Shared section chrome                                              */
/* ------------------------------------------------------------------ */

function Section({
  icon,
  title,
  right,
  children,
}: {
  icon: ReactNode
  title: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
      <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          {icon}
          <MicroLabel className="text-slate-400">{title}</MicroLabel>
        </div>
        {right}
      </header>
      <div className="px-3 py-2">{children}</div>
    </section>
  )
}

function Row({
  label,
  word,
  detail,
  tone = 'green',
  pulse,
}: {
  label: string
  word: string
  detail?: string
  tone?: Tone
  pulse?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-[5px]">
      <div className="min-w-0">
        <div className="truncate font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
        {detail && <div className="mt-[2px] truncate font-mono text-[7.5px] tracking-[0.08em] text-slate-600">{detail}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Led tone={tone} pulse={pulse} size={5} />
        <span
          className={cn(
            'font-mono text-[8.5px] font-bold uppercase tracking-[0.12em]',
            tone === 'red' ? 'text-ops-red' : tone === 'amber' ? 'text-ops-amber' : tone === 'cyan' ? 'text-ops-cyan' : tone === 'slate' ? 'text-slate-500' : 'text-emerald-300',
          )}
        >
          {word}
        </span>
      </div>
    </div>
  )
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-[5px]">
      <span className="shrink-0 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="truncate text-right font-mono text-[9.5px] font-semibold tracking-[0.08em] text-slate-200">
        {value}
        {sub && <span className="ml-1.5 font-normal text-slate-600">{sub}</span>}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Left rail — core engines + infrastructure + auth + sources         */
/* ------------------------------------------------------------------ */

export function SystemLeft({
  session,
  units,
  corridorsOpen,
  mode,
  corrWaves,
}: Omit<CommonProps, 'incident'> & {
  session: OperatorSession | null
  units: EmergencyRuntime[]
  corrWaves?: Record<string, readonly CorridorJunction[]>
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1200)
    return () => window.clearInterval(t)
  }, [])
  const { db, cx } = useSystemStatus()

  const t = trafficSimT()
  const sim = trafficMetrics()
  const snaps = signalStates()
  const totalSignals = DISPLAY_SIGNAL_IDS.length
  const adaptiveCount = snaps.filter((s) => s.control === 'ADAPTIVE').length
  const activeUnits = units.filter((u) => u.status === 'ACTIVE' && !u.arrived)
  const unit = activeUnits[0] ?? null

  const probes = ['M', 'X'] as const
  let readyCount = 0
  for (const j of DISPLAY_SIGNAL_IDS.slice(0, 8)) {
    for (const g of probes) {
      if (predict(j, g, t).status === 'READY') readyCount++
    }
  }
  const fc = focusForecast(t)

  /* corridor engine details */
  let coordinated = 0
  let passed = 0
  let preparing = 0
  if (unit && corrWaves) {
    for (const j of corrWaves[unit.id] ?? []) {
      coordinated++
      if (j.status === 'PASSED') passed++
      else if (j.status === 'PREPARING' || j.status === 'ACTIVE') preparing++
    }
  }
  const corrStatus: 'ACTIVE' | 'PREPARING' | 'STANDBY' = corridorsOpen > 0 ? (preparing > 0 || passed > 0 ? 'ACTIVE' : 'PREPARING') : 'STANDBY'

  const dbWord = db.kind === 'supabase' ? (db.state === 'connected' ? 'CONNECTED' : db.state === 'syncing' ? 'SYNCING' : db.state === 'degraded' ? 'DEGRADED' : 'OFFLINE') : 'LOCAL STORE'

  return (
    <motion.aside
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* core engines */}
      <Section
        icon={<Cpu size={11} className="text-ops-cyan/90" />}
        title="Core Engines"
        right={<span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">REAL ENGINE STATE</span>}
      >
        <Row
          label="Traffic Engine"
          word="ACTIVE"
          detail={`SIM T+${fmtClock(t)} · ${sim.active} VEHICLES`}
          tone="green"
          pulse
        />
        <Row
          label="Signal Control"
          word={mode === 'greenwave' ? 'ADAPTIVE' : 'FIXED'}
          detail={`${adaptiveCount}/${totalSignals} ADAPTIVE`}
          tone={mode === 'greenwave' ? 'green' : 'cyan'}
          pulse={mode === 'greenwave'}
        />
        <Row
          label="Routing Engine"
          word="READY"
          detail={`OSM · ${NETWORK.intersections.length} NODES · ${NETWORK.roads.length} SEGMENTS`}
          tone="green"
        />
        <Row
          label="Prediction Engine"
          word={readyCount > 0 ? 'ACTIVE' : 'BUILDING'}
          detail={`${fc?.pred.historySamples ?? 0} SAMPLES · ${fc?.pred.congestionRisk ?? '—'}`}
          tone={readyCount > 0 ? 'green' : 'amber'}
          pulse={readyCount > 0}
        />
        <Row
          label="Emergency Engine"
          word={unit ? 'ACTIVE' : 'STANDBY'}
          detail={unit ? `${unit.id} · ETA ${fmtClock(unit.etaSec)}` : 'NO ACTIVE EMERGENCY'}
          tone={unit ? 'green' : 'slate'}
          pulse={!!unit}
        />
        <Row
          label="Corridor Engine"
          word={corrStatus}
          detail={corridorsOpen > 0 ? `${coordinated} SIGNALS COORDINATED` : 'NO ACTIVE CORRIDOR'}
          tone={corrStatus === 'STANDBY' ? 'slate' : 'green'}
          pulse={corrStatus !== 'STANDBY'}
        />
      </Section>

      {/* supabase */}
      <Section
        icon={<Database size={11} className="text-ops-cyan/90" />}
        title="Supabase"
        right={<span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">{db.kind === 'supabase' ? 'CLOUD' : 'NOT CONFIGURED'}</span>}
      >
        <Info label="Status" value={dbWord} />
        <Info label="Database" value={db.kind === 'supabase' ? db.label : 'LOCAL STORE'} sub={db.kind === 'supabase' ? 'ACTIVE' : 'NO CLOUD CLAIM'} />
        <Info label="Authentication" value={session?.provider === 'supabase' ? 'AUTHENTICATED' : session ? 'DEMO SESSION' : 'SIGNED OUT'} />
        <Info label="Storage" value="NOT VERIFIED" />
        <Info label="Organization" value={session?.orgLabel ?? '—'} />
      </Section>

      {/* convex */}
      <Section
        icon={<Waves size={11} className="text-ops-cyan/90" />}
        title="Convex"
        right={<span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">LIVE STATE</span>}
      >
        <Info
          label="Live State"
          value={cx.state === 'online' ? (cx.demoMode ? 'DEMO BRIDGE' : 'CONNECTED') : cx.state === 'connecting' ? 'CONNECTING' : cx.state === 'degraded' ? 'DEGRADED' : 'NOT VERIFIED'}
          sub={cx.state === 'online' && !cx.demoMode ? 'REALTIME' : undefined}
        />
        <Info label="Realtime" value={cx.state === 'online' ? 'ACTIVE' : cx.state === 'connecting' ? 'LINKING' : '—'} />
        <Info label="Last Tx/Rx" value={cx.state === 'online' ? `${cx.lastTx} / ${cx.lastRx}` : '—'} />
      </Section>

      {/* authentication */}
      <Section icon={<Lock size={11} className="text-ops-cyan/90" />} title="Authentication">
        <Info label="Session" value={session ? 'AUTHENTICATED' : 'SIGNED OUT'} />
        <Info label="Operator" value={session?.operator ?? '—'} />
        <Info label="Role" value={session?.role ?? '—'} />
        <Info label="Auth Mode" value={session?.provider === 'supabase' ? 'SUPABASE AUTH' : 'DEMO SESSION'} />
      </Section>

      {/* data sources */}
      <Section icon={<Network size={11} className="text-ops-cyan/90" />} title="Data Sources">
        <Info label="Traffic" value={globalSensorSource()} />
        <Info label="Network" value="OSM" sub="ROAD GRAPH" />
        <Info label="Signals" value="LOCAL SIGNAL ENGINE" />
        <Info label="Prediction" value="DETERMINISTIC TREND" />
        <Info label="Emergency" value="CORRIDOR ENGINE" />
        <Info label="Persistence" value={db.kind === 'supabase' ? 'SUPABASE' : 'LOCAL STORE'} />
        <Info label="Live State" value={cx.state === 'online' ? 'CONVEX' : 'LOCAL BUS'} />
      </Section>

      {/* security */}
      <Section icon={<ShieldCheck size={11} className="text-ops-cyan/90" />} title="Security">
        <Info label="Authentication" value="SUPABASE AUTH" />
        <Info label="Data Access" value="ORG-SCOPED" />
        <Info label="Database" value="RLS ENABLED" sub="ARCHITECTURE DEFINED" />
        <Info label="Secrets" value="ENV-MANAGED" sub="SERVER-SIDE" />
      </Section>
    </motion.aside>
  )
}

/* ------------------------------------------------------------------ */
/*  Right rail — current operation + camera + degraded + runtime + log */
/* ------------------------------------------------------------------ */

export function SystemRight({ incident, corridorsOpen, mode }: CommonProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1200)
    return () => window.clearInterval(t)
  }, [])
  const { db, cx } = useSystemStatus()

  const t = trafficSimT()
  const sim = trafficMetrics()
  const backendUp = cameraBackendOnline()
  const cam = getCameraMetrics()
  const camFresh = cam !== null && msSinceLastCameraUpdate() < CAMERA_FRESH_MS
  const src = globalSensorSource()
  const level = congestionLevel(sim.loadPct / 100)

  const fc = focusForecast(t)
  const predReady = fc !== null && fc.pred.status === 'READY'

  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true'

  /* system operations log — merged REAL events from existing stores */
  const logRows = (() => {
    interface Lr { t: number; label: string; tone: Tone }
    const out: Lr[] = []
    for (const o of opsTimeline()) {
      out.push({
        t: o.t,
        label: o.label,
        tone: o.kind === 'incident' ? 'red' : o.kind === 'corridor' ? 'green' : o.kind === 'arrival' ? 'green' : o.kind === 'dispatch' ? 'cyan' : o.kind === 'system' ? 'amber' : 'slate',
      })
    }
    for (const c of corridorEventsLog()) {
      out.push({
        t: c.t,
        label: c.kind === 'PREPARE' ? `${c.junctionId} PREPARING` : c.kind === 'ACTIVE' ? `${c.junctionId} GREEN HELD` : `${c.junctionId} PASSED`,
        tone: c.kind === 'ACTIVE' ? 'green' : c.kind === 'PREPARE' ? 'amber' : 'slate',
      })
    }
    return out.sort((a, b) => b.t - a.t).slice(0, 16)
  })()

  return (
    <motion.aside
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* current operation */}
      <Section icon={<Activity size={11} className="text-ops-cyan/90" />} title="Current Operation">
        <Info label="Control Mode" value={mode === 'greenwave' ? 'GREENWAVE' : 'FIXED TIMING'} />
        <Info label="Traffic Source" value={src} />
        <Info label="Network Condition" value={level} sub={`${Math.round(sim.loadPct)}% LOAD`} />
        <Info label="Emergency" value={corridorsOpen > 0 ? 'ACTIVE' : 'STANDBY'} />
        <Info label="Corridor" value={corridorsOpen > 0 ? 'ACTIVE' : 'STANDBY'} />
        <Info label="Incident" value={incident ? 'ACTIVE' : 'CLEAR'} />
      </Section>

      {/* camera perception */}
      <Section
        icon={<Boxes size={11} className="text-ops-cyan/90" />}
        title="Camera Perception"
        right={<Pill tone={!backendUp ? 'red' : camFresh ? 'green' : 'slate'}>{!backendUp ? 'OFFLINE' : camFresh ? 'LIVE' : 'ONLINE'}</Pill>}
      >
        <Info label="Backend" value={backendUp ? 'ONLINE' : 'OFFLINE'} sub={backendUp ? 'LOCAL PROBE' : 'UNREACHABLE'} />
        <Info label="Source" value={src} sub={camFresh ? 'FRESH OBSERVATIONS' : backendUp ? 'NO VIDEO FEED' : 'SIMULATION FALLBACK'} />
        <Info label="Model" value="YOLO11n" />
        {camFresh && cam ? (
          <>
            <Info label="Detections" value={`${cam.total_detections}`} sub={`${cam.active_tracks} TRACKS`} />
            <Info label="Density" value={`${Math.round(cam.traffic_density * 100)}%`} sub={`Q ${cam.estimated_queue}`} />
            <Info label="Inference" value={`${cam.inference_fps.toFixed(1)} FPS`} />
          </>
        ) : backendUp ? (
          <div className="mt-1 rounded-[3px] border border-white/[0.06] bg-night-850/60 px-2 py-1.5 font-mono text-[8px] tracking-[0.12em] text-slate-500">
            BACKEND · ONLINE — NO VIDEO FEED
          </div>
        ) : (
          <div className="mt-1 rounded-[3px] border border-ops-red/25 bg-ops-red/[0.05] px-2 py-1.5 font-mono text-[8px] tracking-[0.12em] text-ops-red/90">
            BACKEND · OFFLINE — FALLBACK · SIMULATION
          </div>
        )}
      </Section>

      {/* degraded operation */}
      <Section icon={<ShieldCheck size={11} className="text-ops-cyan/90" />} title="Degraded Operation">
        {!backendUp ? (
          <div className="rounded-[3px] border border-ops-red/30 bg-ops-red/[0.06] px-2.5 py-2">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ops-red">Camera Backend Offline</div>
            <div className="mt-1 font-mono text-[8px] leading-relaxed tracking-[0.08em] text-slate-400">
              Traffic perception unavailable.
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 font-mono text-[8px] tracking-[0.1em]">
              <div className="rounded-[2px] border border-white/[0.06] bg-night-850/70 px-1.5 py-1 text-slate-500">
                FALLBACK
                <div className="text-[9px] font-bold text-ops-amber">SIMULATION</div>
              </div>
              <div className="rounded-[2px] border border-white/[0.06] bg-night-850/70 px-1.5 py-1 text-slate-500">
                TRAFFIC CONTROL
                <div className="text-[9px] font-bold text-emerald-300">CONTINUING</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 font-mono text-[8.5px] tracking-[0.12em] text-slate-500">
            <Led tone="green" size={5} />
            NO DEGRADED SERVICES
          </div>
        )}
        {cx.state === 'degraded' && (
          <div className="mt-2 rounded-[3px] border border-ops-amber/30 bg-ops-amber/[0.05] px-2.5 py-1.5 font-mono text-[8px] tracking-[0.1em] text-ops-amber">
            CONVEX · DEGRADED — LIVE STATE ON LOCAL BUS
          </div>
        )}
      </Section>

      {/* operational readiness */}
      <Section icon={<BarChart3 size={11} className="text-ops-cyan/90" />} title="Operational Readiness">
        <Row label="Traffic" word="ACTIVE" detail="SIMULATION RUNNING" tone="green" pulse />
        <Row label="Signal Control" word={mode === 'greenwave' ? 'ACTIVE' : 'READY'} detail={mode === 'greenwave' ? 'ADAPTIVE OPTIMIZATION' : 'FIXED CYCLES'} tone={mode === 'greenwave' ? 'green' : 'cyan'} />
        <Row label="Routing" word="READY" detail="OSM GRAPH LOADED" tone="green" />
        <Row label="Prediction" word={predReady ? 'ACTIVE' : 'BUILDING'} detail={predReady ? `${fc?.pred.historySamples ?? 0} SAMPLES` : 'COLLECTING HISTORY'} tone={predReady ? 'green' : 'amber'} />
        <Row label="Emergency Response" word={corridorsOpen > 0 ? 'ACTIVE' : 'READY'} detail={corridorsOpen > 0 ? 'CORRIDOR COORDINATING' : 'STANDBY'} tone={corridorsOpen > 0 ? 'green' : 'slate'} />
        <Row label="Camera" word={backendUp ? 'READY' : 'DEGRADED'} detail={backendUp ? 'BACKEND REACHABLE' : 'SIMULATION FALLBACK'} tone={backendUp ? 'green' : 'amber'} />
        <Row label="Persistence" word={dbWordShort(db)} detail="LOCAL DEGRADE ON FAILURE" tone={dbWordShort(db) === 'LOCAL' ? 'slate' : 'green'} />
        <Row label="Realtime State" word={cx.state === 'online' ? 'READY' : cx.state === 'connecting' ? 'LINKING' : 'NOT VERIFIED'} detail="CONVEX BRIDGE" tone={cx.state === 'online' ? 'green' : 'slate'} />
      </Section>

      {/* runtime */}
      <Section icon={<Cpu size={11} className="text-ops-cyan/90" />} title="Runtime">
        <Info label="Simulation Time" value={`T+${fmtClock(t)}`} />
        <Info label="Active Vehicles" value={`${sim.active}`} />
        <Info label="Network Nodes" value={`${NETWORK.intersections.length}`} />
        <Info label="Road Segments" value={`${NETWORK.roads.length}`} />
        <Info label="Analytics Samples" value={`${analyticsSamples().length}`} sub="SESSION" />
        <Info label="Prediction Samples" value={`${fc?.pred.historySamples ?? 0}`} sub="FOCUS APPROACH" />
      </Section>

      {/* system operations log */}
      <Section
        icon={<BrainCircuit size={11} className="text-ops-cyan/90" />}
        title="System Operations Log"
        right={<span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">LAST {logRows.length}/16</span>}
      >
        {logRows.length === 0 ? (
          <div className="py-2 text-center font-mono text-[8px] tracking-[0.14em] text-slate-600">NO OPERATIONAL EVENTS</div>
        ) : (
          <div className="flex flex-col">
            {logRows.map((r, i) => (
              <div key={i} className="flex items-baseline gap-2 py-[3px] font-mono">
                <span className="shrink-0 text-[7.5px] tabular tracking-[0.08em] text-slate-600">{fmtClock(r.t)}</span>
                <span
                  className={cn(
                    'truncate text-[8.5px] tracking-[0.08em]',
                    r.tone === 'red'
                      ? 'text-ops-red'
                      : r.tone === 'amber'
                        ? 'text-ops-amber'
                        : r.tone === 'green'
                          ? 'text-emerald-300/90'
                          : r.tone === 'cyan'
                            ? 'text-ops-cyan/90'
                            : 'text-slate-400',
                  )}
                >
                  {r.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* build / deployment */}
      <Section icon={<Settings size={11} className="text-ops-cyan/90" />} title="Build">
        <Info label="Application" value="GREENWAVE AI" />
        <Info label="Environment" value={demoMode ? 'DEMO' : 'PRODUCTION'} />
        <Info label="Build" value="v0.2 · PHASE 2" />
      </Section>
    </motion.aside>
  )
}

function dbWordShort(db: { kind: 'local' | 'supabase' }): string {
  return db.kind === 'supabase' ? 'READY' : 'LOCAL'
}