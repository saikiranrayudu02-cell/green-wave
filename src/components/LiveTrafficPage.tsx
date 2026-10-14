import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  BrainCircuit,
  Camera,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Siren,
} from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import type { EmergencyRuntime, IncidentState, Mode } from '../types'
import { fmtClock } from '../lib/format'
import { DISPLAY_SIGNAL_IDS, congestionLevel } from '../data/osmRoadNetwork'
import { trafficMetrics, trafficObservations, trafficSimT } from '../engine/vehicles'
import { signalStates, signalStateOf } from '../engine/signalState'
import type { SignalStateSnapshot } from '../engine/signalState'
import { predict, predictionEvents } from '../engine/trafficPrediction'
import type { CongestionRisk, PredictionResult, RiskChange } from '../types/prediction'
import { opsTimeline } from '../engine/emergencyTimeline'
import { corridorEventsLog, type CorridorEvent, type CorridorJunction } from '../engine/corridor'
import { flowHistory, pushFlowPoint } from '../engine/liveFlow'
import {
  cameraBackendOnline,
  getCameraMetrics,
  globalSensorSource,
  msSinceLastCameraUpdate,
} from '../engine/trafficDemand'
/* ------------------------------------------------------------------ */
/* shared                                                              */
/* ------------------------------------------------------------------ */

/** camera data is "fresh" within this window (matches panel staleness) */
const CAMERA_FRESH_MS = 6000

type FlowHealth = 'GOOD' | 'WATCH' | 'DEGRADED'

const HEALTH_TONE: Record<FlowHealth, Tone> = { GOOD: 'green', WATCH: 'amber', DEGRADED: 'red' }

const RISK_PILL: Record<CongestionRisk, 'slate' | 'amber' | 'red'> = {
  LOW: 'slate',
  MODERATE: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
}

const SOURCE_META: Record<'CAMERA' | 'FUSED' | 'SIMULATION', { word: string; desc: string; tone: Tone; pulse: boolean }> = {
  CAMERA: { word: 'CAMERA LIVE', desc: 'Traffic measurements from YOLO vehicle perception', tone: 'green', pulse: true },
  FUSED: { word: 'FUSED', desc: 'Camera observations combined with simulation state', tone: 'cyan', pulse: true },
  SIMULATION: { word: 'SIMULATION', desc: 'Local deterministic traffic model', tone: 'slate', pulse: false },
}

function TrendBadge({ trend }: { trend: RiskChange }) {
  if (trend === 'RISING') {
    return (
      <span className="flex items-center gap-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ops-red">
        <TrendingUp size={10} /> Rising
      </span>
    )
  }
  if (trend === 'FALLING') {
    return (
      <span className="flex items-center gap-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
        <TrendingDown size={10} /> Falling
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
      <Minus size={10} /> Stable
    </span>
  )
}

/* one ranked approach row — real observations + engine prediction */
interface ApproachRow {
  j: string
  g: 'M' | 'X'
  queue: number
  flow: number
  waitAvg: number
  pred: PredictionResult
}

function computeApproaches(t: number): ApproachRow[] {
  const rows: ApproachRow[] = []
  const obsMap = trafficObservations()
  for (const j of DISPLAY_SIGNAL_IDS) {
    const obs = obsMap.get(j)
    for (const g of ['M', 'X'] as const) {
      const o = obs?.[g]
      const queue = o?.queue ?? 0
      const flow = o?.approaching ?? 0
      if (queue === 0 && flow === 0) continue
      rows.push({ j, g, queue, flow, waitAvg: o?.waitAvg ?? 0, pred: predict(j, g, t) })
    }
  }
  rows.sort(
    (a, b) =>
      b.queue * 2 +
      b.flow * 0.5 +
      (b.pred.status === 'READY' ? b.pred.currentDensity * 18 : 0) -
      (a.queue * 2 + a.flow * 0.5 + (a.pred.status === 'READY' ? a.pred.currentDensity * 18 : 0)),
  )
  return rows
}

function corrLabel(c: CorridorEvent): string {
  if (c.kind === 'PREPARE') return `${c.junctionId} PREPARING`
  if (c.kind === 'ACTIVE') return `${c.junctionId} GREEN HELD`
  return `${c.junctionId} PASSED`
}

function lampLabel(s: SignalStateSnapshot | null, g: 'M' | 'X'): { text: string; tone: 'green' | 'red' | 'amber' | 'cyan' } {
  if (!s) return { text: '—', tone: 'slate' as never }
  if (s.corridorHeld && s.corridorGroup === g) return { text: 'HELD', tone: 'green' }
  const lamp = g === 'M' ? s.lampM : s.lampX
  if (lamp === 'GREEN') return { text: 'GREEN', tone: 'green' }
  if (lamp === 'YELLOW') return { text: 'YELLOW', tone: 'amber' }
  return { text: 'RED', tone: 'red' }
}

/* ------------------------------------------------------------------ */
/* engine chips                                                        */
/* ------------------------------------------------------------------ */

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
      <div className={cn('mt-[3px] truncate font-mono text-[15px] font-semibold tabular leading-none', cls || 'text-slate-100')}>
        {value}
      </div>
      {sub && <div className="mt-[3px] truncate font-mono text-[7px] tracking-[0.1em] text-slate-600">{sub}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* header band                                                         */
/* ------------------------------------------------------------------ */

interface HeaderProps {
  incident: IncidentState | null
  corridorsOpen: number
  mode: Mode
}

export function LiveTrafficHeader({ incident, corridorsOpen, mode }: HeaderProps) {
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

  const src = globalSensorSource()
  const srcMeta = SOURCE_META[src]

  /* network classification reuses the existing congestionLevel thresholds */
  const level = congestionLevel(sim.loadPct / 100)
  const banner: { word: string; tone: Tone; pulse: boolean; cls: string } = corridorsOpen
    ? { word: 'EMERGENCY PRIORITY ACTIVE', tone: 'green', pulse: true, cls: 'border-emerald-400/40 bg-emerald-400/[0.06]' }
    : incident
      ? { word: 'INCIDENT ACTIVE', tone: 'red', pulse: true, cls: 'border-ops-red/45 bg-ops-red/[0.07]' }
      : level === 'CRITICAL'
        ? { word: 'CRITICAL CONGESTION', tone: 'red', pulse: true, cls: 'border-ops-red/40 bg-ops-red/[0.06]' }
        : level === 'HEAVY'
          ? { word: 'HEAVY CONGESTION', tone: 'red', pulse: false, cls: 'border-ops-red/30 bg-ops-red/[0.04]' }
          : level === 'MODERATE'
            ? { word: 'MODERATE CONGESTION', tone: 'amber', pulse: false, cls: 'border-ops-amber/30 bg-ops-amber/[0.05]' }
            : { word: 'NORMAL FLOW', tone: 'cyan', pulse: false, cls: 'border-white/[0.06] bg-white/[0.015]' }

  /* prediction health: is the engine producing READY forecasts right now */
  const probes = ['M', 'X'] as const
  let readyCount = 0
  for (const j of DISPLAY_SIGNAL_IDS.slice(0, 8)) {
    for (const g of probes) {
      const p = predict(j, g, t)
      if (p.status === 'READY') readyCount++
    }
  }

  const camMetrics = getCameraMetrics()
  const camFresh = camMetrics != null && msSinceLastCameraUpdate() < CAMERA_FRESH_MS
  const backendUp = cameraBackendOnline()

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
              <Activity size={12} className="text-ops-cyan" />
            </span>
            <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.28em] text-slate-100">
              Live Traffic
            </h1>
          </div>
          <div className="mt-[3px] pl-[34px] font-mono text-[8.5px] tracking-[0.16em] text-slate-600">
            REAL-TIME CITY TRAFFIC INTELLIGENCE
          </div>
        </div>

        <div className="hidden min-w-0 shrink-0 grid-cols-4 gap-4 xl:grid">
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
            label="Camera Perception"
            word={!backendUp ? 'OFFLINE' : camFresh ? (src === 'CAMERA' ? 'CAMERA LIVE' : 'FUSED') : 'STANDBY'}
            sub={!backendUp ? 'SIMULATION OBSERVATIONS' : camFresh ? 'YOLO VEHICLE DETECTION' : 'BACKEND ONLINE · NO VIDEO FEED'}
            tone={!backendUp ? 'slate' : camFresh ? (src === 'CAMERA' ? 'green' : 'cyan') : 'cyan'}
            pulse={camFresh}
          />
          <EngineStat
            label="Prediction Engine"
            word={readyCount > 0 ? 'FORECASTING' : 'BUILDING'}
            sub={readyCount > 0 ? `${readyCount} APPROACHES` : 'COLLECTING HISTORY'}
            tone={readyCount > 0 ? 'green' : 'amber'}
            pulse={readyCount > 0}
          />
        </div>

        <Pill tone={corridorsOpen ? 'green' : incident ? 'red' : level === 'NORMAL' ? 'cyan' : level === 'MODERATE' ? 'amber' : 'red'} className="hidden shrink-0 lg:inline-flex">
          {banner.word}
        </Pill>
      </div>

      {/* row 2: overall status banner + source */}
      <div className={cn('flex h-[30px] items-center gap-3 border-t border-white/[0.05] px-3.5', banner.cls)}>
        <Led tone={banner.tone} pulse={banner.pulse} size={6} />
        <span
          className={cn(
            'font-mono text-[9.5px] font-bold uppercase tracking-[0.22em]',
            banner.tone === 'green' ? 'text-emerald-300' : banner.tone === 'red' ? 'text-ops-red' : banner.tone === 'amber' ? 'text-ops-amber' : banner.tone === 'cyan' ? 'text-ops-cyan' : 'text-slate-200',
          )}
        >
          {banner.word}
        </span>
        <span className="ml-1 hidden font-mono text-[7.5px] tracking-[0.1em] text-slate-500 lg:inline">
          {corridorsOpen
            ? 'TRAFFIC CONTROL TEMPORARILY PRIORITIZING THE EMERGENCY CORRIDOR'
            : incident
              ? 'REROUTING ACTIVE · UNITS AVOID THE AFFECTED CORRIDOR'
              : `NETWORK LOAD ${Math.round(sim.loadPct)}% · MEAN ${sim.avgSpeedKmh.toFixed(1)} KM/H`}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <MicroLabel className="shrink-0 text-slate-600">Source</MicroLabel>
          <Led tone={srcMeta.tone} pulse={srcMeta.pulse} size={6} />
          <span
            className={cn(
              'shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.16em]',
              srcMeta.tone === 'green' ? 'text-emerald-300' : srcMeta.tone === 'cyan' ? 'text-ops-cyan' : 'text-slate-300',
            )}
          >
            {srcMeta.word}
          </span>
          <span className="hidden truncate font-mono text-[7.5px] tracking-[0.06em] text-slate-600 2xl:inline">
            {srcMeta.desc}
          </span>
        </div>
      </div>

      {/* row 3: KPI band */}
      <div className="flex h-[46px] items-center divide-x divide-white/[0.05] border-t border-white/[0.05]">
        <KpiCell label="Vehicles Tracked" value={String(sim.active)} sub={`${sim.queuedCount} STOPPED`} />
        <KpiCell label="Active Queues" value={String(sim.queuedCount)} sub="AT REST" />
        <KpiCell label="Avg Speed" value={`${sim.avgSpeedKmh.toFixed(1)} km/h`} sub="FLEET MEAN" />
        <KpiCell
          label="Network Congestion"
          value={level}
          sub={`${Math.round(sim.loadPct)}% MEAN SCORE`}
          cls={level === 'CRITICAL' || level === 'HEAVY' ? 'text-ops-red' : level === 'MODERATE' ? 'text-ops-amber' : 'text-ops-cyan'}
        />
        <KpiCell label="Signals Optimizing" value={`${adaptiveCount} / ${totalSignals}`} sub={mode === 'greenwave' ? 'ADAPTIVE CONTROL' : 'FIXED-TIME CYCLES'} />
        <KpiCell
          label="Incidents"
          value={incident ? '1' : '0'}
          sub={incident ? `ACTIVE · ${incident.junctionId}` : 'NETWORK CLEAR'}
          cls={incident ? 'text-ops-red' : ''}
        />
        <div className="ml-auto hidden items-center gap-2 pr-3 font-mono text-[7.5px] tracking-[0.14em] text-slate-700 lg:flex">
          <Led tone="cyan" pulse size={4} /> NETWORK FLOW · CONGESTION · SIGNAL PERFORMANCE · PREDICTIVE RISK
        </div>
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/* rail left: approaches · congestion · incidents · flow chart         */
/* ------------------------------------------------------------------ */

function miniCell(label: string, value: string, cls = '') {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">{label}</span>
      <span className={cn('font-mono text-[9px] font-semibold tabular text-slate-200', cls)}>{value}</span>
    </span>
  )
}

interface LeftProps {
  incident: IncidentState | null
}

export function LiveTrafficLeft({ incident }: LeftProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  /* rolling real measurement recorder (only while this module is open) */
  useEffect(() => {
    const t = window.setInterval(() => {
      const m = trafficMetrics()
      let queueTotal = 0
      for (const o of trafficObservations().values()) queueTotal += o.M.queue + o.X.queue
      pushFlowPoint({
        t: trafficSimT(),
        active: m.active,
        queue: queueTotal,
        loadPct: m.loadPct,
        avgSpeedKmh: m.avgSpeedKmh,
      })
    }, 2000)
    return () => window.clearInterval(t)
  }, [])

  const t = trafficSimT()
  const rows = useMemo<ApproachRow[]>(() => computeApproaches(t).slice(0, 8), [t])
  const top = rows.slice(0, 5)
  const flow = flowHistory()

  return (
    <motion.aside
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* network approaches */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Network Approaches</MicroLabel>
          </div>
          <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">TOP {rows.length || '—'}</span>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03]">
          {rows.length === 0 ? (
            <div className="px-3 py-4 text-center font-mono text-[8px] leading-relaxed tracking-[0.08em] text-slate-600">
              COLLECTING APPROACH OBSERVATIONS
            </div>
          ) : (
            rows.map((r) => {
              const lamp = lampLabel(signalStateOf(r.j), r.g)
              const density = r.pred.status === 'READY' ? `${Math.round(r.pred.currentDensity * 100)}%` : '—'
              return (
                <div key={`${r.j}-${r.g}`} className="px-2.5 py-[6px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9.5px] font-bold tracking-[0.1em] text-slate-200">
                      {r.j} <span className="text-slate-600">· {r.g}</span>
                    </span>
                    <span
                      className={cn(
                        'rounded-[2px] border px-1 py-[1px] font-mono text-[7px] font-bold tracking-[0.1em]',
                        lamp.tone === 'green'
                          ? 'border-emerald-400/30 text-emerald-300'
                          : lamp.tone === 'red'
                            ? 'border-ops-red/40 text-ops-red'
                            : lamp.tone === 'amber'
                              ? 'border-ops-amber/35 text-ops-amber'
                              : 'border-white/10 text-slate-600',
                      )}
                    >
                      {lamp.text}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {r.pred.status === 'READY' ? (
                        <>
                          <Pill tone={RISK_PILL[r.pred.congestionRisk]}>{r.pred.congestionRisk}</Pill>
                        </>
                      ) : (
                        <span className="font-mono text-[7.5px] text-slate-600">— RISK</span>
                      )}
                      <TrendBadge trend={r.pred.status === 'READY' ? r.pred.riskChange : 'STABLE'} />
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {miniCell('Flow', String(r.flow))}
                    {miniCell('Queue', String(r.queue), r.queue > 0 ? 'text-ops-amber' : '')}
                    {miniCell('Density', density, r.pred.status === 'READY' && r.pred.currentDensity > 0.6 ? 'text-ops-red' : '')}
                    {miniCell('Wait', r.waitAvg > 0 ? `${r.waitAvg.toFixed(0)}s` : '—')}
                    <span className="ml-auto flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">
                      <Led
                        tone={r.pred.source === 'CAMERA' ? 'green' : r.pred.source === 'FUSED' ? 'cyan' : 'slate'}
                        pulse={r.pred.source !== 'SIMULATION'}
                        size={3.5}
                      />
                      {r.pred.source}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* top congestion areas */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={11} className="text-ops-amber/90" />
            <MicroLabel className="text-slate-400">Top Congestion Areas</MicroLabel>
          </div>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03]">
          {top.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-4 text-center">
              <Led tone="green" size={5} />
              <div className="font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                NO SIGNIFICANT CONGESTION DETECTED
              </div>
              <div className="font-mono text-[7px] tracking-[0.08em] text-slate-600">
                MEASURED FROM LIVE QUEUE OBSERVATIONS
              </div>
            </div>
          ) : (
            top.map((r, i) => (
              <div key={`${r.j}-${r.g}`} className="flex items-center gap-2.5 px-2.5 py-[6px]">
                <span className="w-4 shrink-0 font-mono text-[9px] font-bold text-slate-500">#{i + 1}</span>
                <span className="w-[52px] shrink-0 font-mono text-[9.5px] font-semibold tracking-[0.08em] text-slate-200">
                  {r.j} <span className="text-slate-600">{r.g}</span>
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {miniCell('Q', String(r.queue), r.queue > 0 ? 'text-ops-amber' : '')}
                  {miniCell('Den', r.pred.status === 'READY' ? `${Math.round(r.pred.currentDensity * 100)}%` : '—')}
                  {miniCell('+30s', r.pred.status === 'READY' ? String(r.pred.predictedQueue30s) : '—')}
                </div>
                <Pill tone={r.pred.status === 'READY' ? RISK_PILL[r.pred.congestionRisk] : 'slate'}>
                  {r.pred.status === 'READY' ? r.pred.congestionRisk : '—'}
                </Pill>
              </div>
            ))
          )}
        </div>
      </section>

      {/* traffic incidents */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={11} className="text-ops-red/90" />
            <MicroLabel className="text-slate-400">Traffic Incidents</MicroLabel>
          </div>
        </header>
        <div className="px-2.5 py-2">
          {!incident ? (
            <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
              <ShieldCheck size={11} className="text-emerald-400/80" />
              NO ACTIVE INCIDENTS
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Led tone="red" pulse size={5} />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ops-red">
                  Incident Active
                </span>
                <Pill tone="red">{incident.junctionId}</Pill>
              </div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[7.5px] tracking-[0.06em] text-slate-500">
                <span>SEVERITY · {incident.severity.toUpperCase()}</span>
                <span>CONGESTION CLOSURE</span>
              </div>
              <div className="font-mono text-[7.5px] leading-relaxed tracking-[0.06em] text-slate-600">
                ROUTING RESPONSE ACTIVE — units re-planned around the affected corridor via the existing incident
                override.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* traffic flow chart — real rolling measurements */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Traffic Flow</MicroLabel>
          </div>
          <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">{flow.length} SAMPLES</span>
        </header>
        <div className="px-2.5 py-2">
          {flow.length < 4 ? (
            <div className="flex flex-col items-center gap-1.5 py-4 text-center">
              <BrainCircuit size={14} className="text-slate-600" />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                BUILDING TRAFFIC HISTORY
              </div>
              <div className="px-2 font-mono text-[7.5px] leading-relaxed tracking-[0.06em] text-slate-600">
                Live observations will populate this view as traffic data accumulates.
              </div>
            </div>
          ) : (
            <div className="h-[74px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flow.map((p) => ({ ...p }))} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ltFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38c4e0" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#38c4e0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="active"
                    stroke="#38c4e0"
                    strokeWidth={1.3}
                    fill="url(#ltFill)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="queue"
                    stroke="#e8a13c"
                    strokeWidth={1}
                    fill="none"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] px-3 font-mono text-[7px] tracking-[0.12em] text-slate-700">
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-3 rounded-full bg-ops-cyan" /> VEHICLES
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[3px] w-3 rounded-full bg-ops-amber" /> QUEUE
          </span>
          <span>REAL MEASUREMENTS · 2s CADENCE</span>
        </footer>
      </section>
    </motion.aside>
  )
}

/* ------------------------------------------------------------------ */
/* rail right: corridor · signals · forecast · camera · health · log   */
/* ------------------------------------------------------------------ */

interface RightProps {
  corridorUnit: EmergencyRuntime | null
  corridorWaves: readonly CorridorJunction[]
  corridorsOpen: number
}

export function LiveTrafficRight({ corridorUnit, corridorWaves, corridorsOpen }: RightProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  const t = trafficSimT()
  const snaps = signalStates()
  const coordinated = corridorWaves.filter((c) => c.status === 'PREPARING' || c.status === 'ACTIVE').length

  /* signal table — prioritise corridor-held, then highest queue, then green */
  const sigRows = useMemo(() => {
    const obsMap = trafficObservations()
    const list = snaps.map((s) => {
      const obs = obsMap.get(s.junctionId)
      const q = (obs?.M.queue ?? 0) + (obs?.X.queue ?? 0)
      return { s, q }
    })
    list.sort((a, b) => {
      const pa = a.s.corridorHeld ? 1 : 0
      const pb = b.s.corridorHeld ? 1 : 0
      if (pb !== pa) return pb - pa
      if (b.q !== a.q) return b.q - a.q
      const gA = a.s.lampM === 'GREEN' || a.s.lampX === 'GREEN' ? 1 : 0
      const gB = b.s.lampM === 'GREEN' || b.s.lampX === 'GREEN' ? 1 : 0
      return gB - gA
    })
    return list.slice(0, 10)
  }, [snaps, t])

  /* highest-severity approach for the forecast card */
  const rows = useMemo<ApproachRow[]>(() => computeApproaches(t), [t])
  const focus = rows[0] ?? null
  const focusPred = focus?.pred ?? null

  /* camera — pure consumer of existing perception results */
  const cam = getCameraMetrics()
  const camFresh = cam != null && msSinceLastCameraUpdate() < CAMERA_FRESH_MS
  const backendUp = cameraBackendOnline()
  const src = globalSensorSource()
  const srcMeta = SOURCE_META[src]

  /* city traffic health (computed from real measured state) */
  const sim = trafficMetrics()
  const health: { label: string; state: FlowHealth; note: string }[] = [
    {
      label: 'Flow',
      state: sim.active > 0 && sim.avgSpeedKmh >= 18 ? 'GOOD' : sim.avgSpeedKmh >= 9 ? 'WATCH' : sim.active === 0 ? 'WATCH' : 'DEGRADED',
      note: `${sim.avgSpeedKmh.toFixed(1)} KM/H MEAN`,
    },
    {
      label: 'Congestion',
      state: sim.loadPct < 30 ? 'GOOD' : sim.loadPct < 55 ? 'WATCH' : 'DEGRADED',
      note: `${Math.round(sim.loadPct)}% MEAN`,
    },
    {
      label: 'Signals',
      state: snaps.length > 0 ? 'GOOD' : 'WATCH',
      note: `${snaps.filter((s) => s.control === 'ADAPTIVE').length} ADAPTIVE`,
    },
    {
      label: 'Prediction',
      state: focusPred?.status === 'READY' ? 'GOOD' : 'WATCH',
      note: focusPred ? `${focusPred.historySamples} SAMPLES` : 'COLLECTING',
    },
    {
      label: 'Camera',
      state: camFresh ? 'GOOD' : backendUp ? 'WATCH' : 'DEGRADED',
      note: camFresh && cam ? `CAM-01 · ${cam.inference_fps.toFixed(1)} FPS` : backendUp ? 'STANDBY · NO VIDEO FEED' : 'SIMULATION FALLBACK',
    },
  ]

  /* traffic ops log — merged real events from existing stores */
  const logRows = useMemo(() => {
    interface Lr { t: number; label: string; tone: 'cyan' | 'red' | 'green' | 'amber' | 'slate' }
    const out: Lr[] = predictionEvents().map((e) => ({
      t: e.t,
      label: `${e.intersectionId} ${e.forecast} · ${e.action}`,
      tone: 'cyan' as const,
    }))
    for (const c of corridorEventsLog()) {
      out.push({ t: c.t, label: corrLabel(c), tone: c.kind === 'ACTIVE' ? ('green' as const) : c.kind === 'PREPARE' ? ('amber' as const) : ('slate' as const) })
    }
    for (const o of opsTimeline()) {
      out.push({
        t: o.t,
        label: o.label,
        tone: o.kind === 'incident' ? 'red' : o.kind === 'corridor' ? 'green' : o.kind === 'arrival' ? 'green' : o.kind === 'dispatch' ? 'cyan' : 'slate',
      })
    }
    return out.sort((a, b) => b.t - a.t).slice(0, 16)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  return (
    <motion.aside
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* emergency corridor interaction */}
      <section
        className={cn(
          'shrink-0 rounded-md border',
          corridorUnit ? 'border-emerald-400/25 bg-night-900' : 'border-white/[0.07] bg-night-900',
        )}
      >
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Siren size={11} className={corridorUnit ? 'text-emerald-300' : 'text-slate-500'} />
            <MicroLabel className={corridorUnit ? 'text-emerald-300/90' : 'text-slate-400'}>
              Emergency Corridor
            </MicroLabel>
          </div>
          {corridorUnit ? (
            <span className="flex items-center gap-1.5 font-mono text-[7.5px] font-bold tracking-[0.14em] text-emerald-300">
              <Led tone="green" pulse size={4} /> ACTIVE
            </span>
          ) : null}
        </header>
        {corridorUnit && corridorsOpen > 0 ? (
          <div className="px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="leading-tight">
                <MicroLabel className="text-slate-600">Unit</MicroLabel>
                <div className="font-mono text-[13px] font-semibold tracking-[0.12em] text-slate-100">
                  {corridorUnit.tac} · {corridorUnit.corridorLabel}
                </div>
              </div>
              <Pill tone="green">{corridorUnit.incident}</Pill>
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[7.5px] tracking-[0.08em] text-slate-500">
              <span className="truncate">
                ROUTE {corridorUnit.junctionIds[0]} → {corridorUnit.junctionIds[corridorUnit.junctionIds.length - 1]}
              </span>
              <span className="shrink-0 tabular">{coordinated} COORDINATED</span>
            </div>
            <div className="mt-1.5 font-mono text-[7.5px] leading-relaxed tracking-[0.05em] text-slate-600">
              Traffic control is temporarily prioritizing the emergency corridor.
            </div>
          </div>
        ) : (
          <div className="px-3 py-2 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
            NO ACTIVE EMERGENCY CORRIDOR
          </div>
        )}
      </section>

      {/* signal control */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Siren size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Signal Control</MicroLabel>
          </div>
          <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">
            {snaps.filter((s) => s.control === 'ADAPTIVE').length}/{snaps.length} ADAPTIVE
          </span>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03] px-1.5 py-1">
          {sigRows.map(({ s, q }) => {
            const phaseTxt =
              s.corridorHeld ? 'HELD' : s.phase === 'MG' || s.phase === 'XG' ? 'GREEN' : s.phase === 'MY' || s.phase === 'XY' ? 'YELLOW' : 'RED'
            return (
              <div key={s.junctionId} className="grid grid-cols-[52px_44px_34px_1fr_auto] items-center gap-1.5 px-1.5 py-[5px] font-mono">
                <span className="text-[9px] font-bold tracking-[0.1em] text-slate-200">{s.junctionId}</span>
                <span
                  className={cn(
                    'text-[8px] font-semibold tracking-[0.08em]',
                    s.corridorHeld
                      ? 'text-emerald-300'
                      : phaseTxt === 'GREEN'
                        ? 'text-emerald-300/90'
                        : phaseTxt === 'YELLOW'
                          ? 'text-ops-amber'
                          : 'text-ops-red/90',
                  )}
                >
                  {phaseTxt}
                </span>
                <span className="tabular text-[8px] text-slate-500">{s.remainS}s</span>
                <span className="truncate text-[7.5px] uppercase tracking-[0.08em] text-slate-500">{s.control}</span>
                <span className="flex items-center gap-1">
                  <span className="tabular text-[8px] text-slate-400">{q}</span>
                  {s.corridorHeld && <span className="rounded-[2px] border border-emerald-400/40 px-1 text-[6.5px] font-bold tracking-[0.08em] text-emerald-300">EMERG</span>}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* traffic forecast */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <BrainCircuit size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Traffic Forecast</MicroLabel>
          </div>
          {focusPred && (
            <Pill tone={focusPred.source === 'CAMERA' ? 'green' : focusPred.source === 'FUSED' ? 'cyan' : 'slate'}>
              {focusPred.source}
            </Pill>
          )}
        </header>
        <div className="px-3 py-2">
          {!focusPred || focusPred.status !== 'READY' ? (
            <div className="flex flex-col items-center gap-1.5 py-3 text-center">
              <Led tone="slate" size={4} />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                PREDICTION BUILDING HISTORY
              </div>
              <div className="font-mono text-[7px] tracking-[0.08em] text-slate-600">
                WAITING FOR SUFFICIENT OBSERVATIONS
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="leading-tight">
                  <MicroLabel className="text-slate-600">Focus Approach</MicroLabel>
                  <div className="font-mono text-[13px] font-semibold tracking-[0.1em] text-ops-cyan">
                    {focus!.j} <span className="text-slate-600">· {focus!.g}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={RISK_PILL[focusPred.congestionRisk]}>{focusPred.congestionRisk}</Pill>
                  <TrendBadge trend={focusPred.riskChange} />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-x-3 border-y border-white/[0.05] py-1.5">
                {miniCell('Now', `${focusPred.currentQueue} Q · ${Math.round(focusPred.currentDensity * 100)}%`)}
                {miniCell('+30s', `${focusPred.predictedQueue30s} Q · ${Math.round(focusPred.predictedDensity30s * 100)}%`, focusPred.predictedQueue30s > focusPred.currentQueue ? 'text-ops-amber' : '')}
                {miniCell('+60s', `${focusPred.predictedQueue60s} Q · ${Math.round(focusPred.predictedDensity60s * 100)}%`, focusPred.predictedQueue60s > focusPred.currentQueue ? 'text-ops-amber' : '')}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MicroLabel className="text-slate-600">Vehicles</MicroLabel>
                  <span className="font-mono text-[10px] font-semibold tabular text-slate-200">{focusPred.currentVehicleCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MicroLabel className="text-slate-600">Confidence</MicroLabel>
                  <span className="font-mono text-[9px] font-semibold tabular text-slate-300">{Math.round(focusPred.confidence * 100)}%</span>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* camera intelligence — pure consumer */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Camera size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Traffic Camera · CAM-01</MicroLabel>
          </div>
          <Led tone={camFresh ? 'green' : 'slate'} pulse={camFresh} size={5} />
        </header>
        <div className="px-3 py-2">
          {camFresh && cam ? (
            <>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                  <Led tone="green" pulse size={4} /> ONLINE
                </span>
                <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-500">SOURCE · {srcMeta.word}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {miniCell('Vehicles', String(cam.total_detections))}
                {miniCell('Active Tracks', String(cam.active_tracks))}
                {miniCell('Density', `${Math.round(cam.traffic_density * 100)}%`)}
                {miniCell('Queue', String(cam.estimated_queue))}
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[7px] tracking-[0.08em] text-slate-600">
                <span>INFERENCE {cam.inference_fps.toFixed(1)} FPS</span>
                <span>FRAME {cam.frame_number}</span>
              </div>
            </>
          ) : backendUp ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-ops-cyan">
                <Led tone="cyan" size={4} /> BACKEND · ONLINE
              </div>
              <div className="font-mono text-[7.5px] tracking-[0.08em] text-slate-600">
                SOURCE · SIMULATION
              </div>
              <div className="font-mono text-[7px] leading-relaxed tracking-[0.05em] text-slate-600">
                Perception backend reachable — no video feed active. Traffic source is simulation until a live
                detection stream starts.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400">
                <Led tone="slate" size={4} /> CAMERA BACKEND OFFLINE
              </div>
              <div className="font-mono text-[7.5px] tracking-[0.08em] text-slate-600">
                TRAFFIC SOURCE FALLBACK: SIMULATION
              </div>
              <div className="font-mono text-[7px] leading-relaxed tracking-[0.05em] text-slate-600">
                The Live Traffic view consumes existing perception results — it never starts a second detection
                pipeline.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* city traffic health */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={11} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">City Traffic Health</MicroLabel>
          </div>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03] px-3 py-1">
          {health.map((h) => (
            <div key={h.label} className="flex items-center gap-2.5 py-[6px]">
              <span className="w-[86px] shrink-0 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                {h.label}
              </span>
              <Led tone={HEALTH_TONE[h.state]} pulse={h.state === 'GOOD' && (h.label === 'Camera' || h.label === 'Flow')} size={5} />
              <span
                className={cn(
                  'font-mono text-[8px] font-bold uppercase tracking-[0.12em]',
                  h.state === 'GOOD' ? 'text-emerald-300' : h.state === 'WATCH' ? 'text-ops-amber' : 'text-ops-red',
                )}
              >
                {h.state}
              </span>
              <span className="ml-auto truncate font-mono text-[7px] tracking-[0.06em] text-slate-600">{h.note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* traffic operations log */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Traffic Operations Log</MicroLabel>
          </div>
          <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">
            {logRows.length === 0 ? 'NO EVENTS' : `LAST ${logRows.length}`}
          </span>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03] px-2.5 py-1.5">
          {logRows.length === 0 ? (
            <div className="py-2 text-center font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-600">
              NO OPERATIONAL EVENTS YET
            </div>
          ) : (
            logRows.map((r, i) => (
              <div
                key={`${r.t}-${i}-${r.label}`}
                className="grid grid-cols-[38px_1fr] items-center gap-1.5 py-[3px] font-mono"
                title={r.label}
              >
                <span className="tabular text-[8px] text-slate-500">{fmtClock(r.t)}</span>
                <span
                  className={cn(
                    'truncate text-[7.5px] tracking-[0.04em]',
                    r.tone === 'red'
                      ? 'text-ops-red'
                      : r.tone === 'green'
                        ? 'text-emerald-300/90'
                        : r.tone === 'amber'
                          ? 'text-ops-amber'
                          : r.tone === 'cyan'
                            ? 'text-ops-cyan/90'
                            : 'text-slate-400',
                  )}
                >
                  {r.label}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </motion.aside>
  )
}

/* ------------------------------------------------------------------ */
/* map legend                                                          */
/* ------------------------------------------------------------------ */

const LEGEND = [
  { hex: '#5b6b85', label: 'Free Flow' },
  { hex: '#4d8fc9', label: 'Moderate' },
  { hex: '#e8a13c', label: 'Heavy' },
  { hex: '#ef3d52', label: 'Critical' },
]

export function LiveTrafficLegend({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className={cn(
        'pointer-events-none absolute bottom-2.5 left-3 z-20 flex items-center gap-4 rounded-[5px] border border-white/[0.06] bg-night-900/70 px-3 py-2 backdrop-blur-[2px]',
        className ?? '',
      )}
    >
      <MicroLabel className="text-slate-500">Congestion</MicroLabel>
      <div className="flex items-center gap-2.5">
        {LEGEND.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: l.hex, boxShadow: `0 0 5px ${l.hex}88` }} />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">{l.label}</span>
          </div>
        ))}
        <div className="h-3 w-px bg-white/[0.08]" />
        <div className="flex items-center gap-1.5">
          <span className="flex h-[8px] w-[8px] flex-col items-center justify-center gap-[1px]">
            <span className="h-[2px] w-[7px] rounded-full bg-emerald-400" />
            <span className="h-[2px] w-[7px] rounded-full bg-ops-amber" />
            <span className="h-[2px] w-[7px] rounded-full bg-ops-red" />
          </span>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Signal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-[6px] w-[6px] rounded-full bg-emerald-400 shadow-[0_0_6px_#2fe08a] animate-soft-pulse" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Corridor</span>
        </div>
      </div>
    </motion.div>
  )
}
