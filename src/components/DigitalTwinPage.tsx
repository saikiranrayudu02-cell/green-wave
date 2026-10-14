// ---------------------------------------------------------------------------
// GREENWAVE — Digital Twin module (Step 14)
//
// Operational visualization + inspection layer over the EXISTING city network
// engines. This module contains NO simulation, NO second map, NO second
// prediction/corridor/camera pipeline — it reads the same stores the other
// modules read:
//
//   osmRoadNetwork (topology) · vehicles.ts (traffic) · signalState.ts
//   trafficPrediction.ts · corridor.ts · trafficDemand.ts · emergencyTimeline
//
// The "NETWORK LAYERS" control is a pure VIEW FILTER — it toggles which
// inspection panels/legend rows are visible on this page and NEVER touches
// the underlying engines. The map canvas renders the live engine state via
// the shared CityMap (mounted once in App, never unmounted).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  Boxes,
  BrainCircuit,
  ChevronRight,
  Eye,
  Network,
  ShieldCheck,
  Siren,
  TrendingDown,
  TrendingUp,
  Minus,
  Route,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import type { EmergencyRuntime, IncidentState, Mode } from '../types'
import { fmtClock } from '../lib/format'
import { DISPLAY_SIGNAL_IDS, NETWORK, congestionLevel, jShortName, roadsAt } from '../data/osmRoadNetwork'
import { trafficMetrics, trafficObservations, trafficSimT, trafficCongestion } from '../engine/vehicles'
import { signalStates, signalStateOf } from '../engine/signalState'
import { predict, predictionEvents, pickPredictionFocus } from '../engine/trafficPrediction'
import type { CongestionRisk, RiskChange } from '../types/prediction'
import { corridorEventsLog, type CorridorJunction } from '../engine/corridor'
import { opsTimeline } from '../engine/emergencyTimeline'
import {
  cameraBackendOnline,
  getCameraMetrics,
  globalSensorSource,
  msSinceLastCameraUpdate,
} from '../engine/trafficDemand'

/** camera data is "fresh" within this window (matches panel staleness) */
const CAMERA_FRESH_MS = 6000

/* ----------------------------- shared bits ------------------------------ */

export type TwinLayerKey =
  | 'roads'
  | 'junctions'
  | 'vehicles'
  | 'signals'
  | 'congestion'
  | 'queues'
  | 'prediction'
  | 'incidents'
  | 'corridor'

export type TwinLayers = Record<TwinLayerKey, boolean>

export const ALL_TWIN_LAYERS: TwinLayers = {
  roads: true,
  junctions: true,
  vehicles: true,
  signals: true,
  congestion: true,
  queues: true,
  prediction: true,
  incidents: true,
  corridor: true,
}

const LAYER_LABEL: Record<TwinLayerKey, string> = {
  roads: 'Road Network',
  junctions: 'Intersections',
  vehicles: 'Vehicles',
  signals: 'Signals',
  congestion: 'Congestion',
  queues: 'Queues',
  prediction: 'Prediction',
  incidents: 'Incidents',
  corridor: 'Emergency Corridor',
}

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

type HealthState = 'GOOD' | 'WATCH' | 'DEGRADED' | 'ACTIVE' | 'CLEAR' | 'STANDBY'
const HEALTH_TONE: Record<HealthState, Tone> = {
  GOOD: 'green',
  WATCH: 'amber',
  DEGRADED: 'red',
  ACTIVE: 'green',
  CLEAR: 'green',
  STANDBY: 'slate',
}
const HEALTH_CLS: Record<HealthState, string> = {
  GOOD: 'text-emerald-300',
  WATCH: 'text-ops-amber',
  DEGRADED: 'text-ops-red',
  ACTIVE: 'text-emerald-300',
  CLEAR: 'text-emerald-300',
  STANDBY: 'text-slate-400',
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

/** the junction the operator is inspecting: explicit selection, else the
    existing prediction engine's highest-risk focus, else the first signal. */
function focusJunction(explicit: string | null, t: number): string {
  if (explicit) return explicit
  return pickPredictionFocus(t)?.intersectionId ?? DISPLAY_SIGNAL_IDS[0]
}

/** per-junction inspection data pulled from the existing engine stores */
function inspectData(j: string, t: number) {
  const s = signalStateOf(j)
  const obs = trafficObservations().get(j)
  const queue = (obs?.M.queue ?? 0) + (obs?.X.queue ?? 0)
  const flow = (obs?.M.approaching ?? 0) + (obs?.X.approaching ?? 0)
  /* the busier axis drives the forecast shown in the inspector */
  const g = (obs?.M.queue ?? 0) >= (obs?.X.queue ?? 0) ? 'M' : 'X'
  const pred = predict(j, g, t)
  return { s, obs, queue, flow, g, pred }
}

function corrLabel(c: { kind: string; junctionId: string }): string {
  if (c.kind === 'PREPARE') return `${c.junctionId} PREPARING`
  if (c.kind === 'ACTIVE') return `${c.junctionId} GREEN HELD`
  return `${c.junctionId} PASSED`
}

/* ------------------------------------------------------------------ */
/* header band + network status                                        */
/* ------------------------------------------------------------------ */

interface HeaderProps {
  incident: IncidentState | null
  corridorsOpen: number
  mode: Mode
}

export function DigitalTwinHeader({ incident, corridorsOpen, mode }: HeaderProps) {
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

  /* engine readiness — real state only */
  const level = congestionLevel(sim.loadPct / 100)
  const probes = ['M', 'X'] as const
  let readyCount = 0
  for (const j of DISPLAY_SIGNAL_IDS.slice(0, 8)) {
    for (const g of probes) {
      if (predict(j, g, t).status === 'READY') readyCount++
    }
  }

  /* congested approaches: real queues measured by the traffic engine */
  let congested = 0
  for (const j of DISPLAY_SIGNAL_IDS) {
    const o = trafficObservations().get(j)
    if ((o?.M.queue ?? 0) > 0 || (o?.X.queue ?? 0) > 0) congested++
  }

  const twinWord = src === 'SIMULATION' ? 'LIVE · SIMULATION' : src === 'FUSED' ? 'LIVE · FUSED' : 'LIVE · CAMERA'

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
              <Boxes size={12} className="text-ops-cyan" />
            </span>
            <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.28em] text-slate-100">
              Digital Twin
            </h1>
          </div>
          <div className="mt-[3px] pl-[34px] font-mono text-[8.5px] tracking-[0.16em] text-slate-600">
            LIVE CITY NETWORK MODEL
          </div>
        </div>

        <div className="hidden min-w-0 shrink-0 grid-cols-5 gap-4 xl:grid">
          <EngineStat
            label="Network Model"
            word="LOADED"
            sub={`${NETWORK.intersections.length} NODES`}
            tone="green"
            pulse
          />
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
            label="Prediction Engine"
            word={readyCount > 0 ? 'FORECASTING' : 'BUILDING'}
            sub={readyCount > 0 ? `${readyCount} APPROACHES` : 'COLLECTING HISTORY'}
            tone={readyCount > 0 ? 'green' : 'amber'}
            pulse={readyCount > 0}
          />
          <EngineStat
            label="Emergency Engine"
            word={corridorsOpen > 0 ? 'CORRIDOR ACTIVE' : 'STANDBY'}
            sub={corridorsOpen > 0 ? `${corridorsOpen} CORRIDOR(S)` : 'NO UNIT ACTIVE'}
            tone={corridorsOpen > 0 ? 'green' : 'slate'}
            pulse={corridorsOpen > 0}
          />
        </div>

        <Pill tone={srcMeta.tone} className="hidden shrink-0 lg:inline-flex">
          {twinWord}
        </Pill>
      </div>

      {/* row 2: network status band + data source */}
      <div className="flex h-[30px] items-center gap-3 border-t border-white/[0.05] px-3.5">
        <Led tone="cyan" size={5} />
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-ops-cyan">
          NETWORK MODEL LIVE
        </span>
        <span className="hidden font-mono text-[7.5px] tracking-[0.1em] text-slate-500 lg:inline">
          NETWORK TOPOLOGY · TRAFFIC STATE · SIGNAL CONTROL · OPERATIONAL SCENARIOS
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <MicroLabel className="shrink-0 text-slate-600">Data Source</MicroLabel>
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

      {/* row 3: network status KPI band */}
      <div className="flex h-[46px] items-center divide-x divide-white/[0.05] border-t border-white/[0.05]">
        <KpiCell label="Network Nodes" value={String(NETWORK.intersections.length)} sub="OSM GRAPH" />
        <KpiCell label="Road Segments" value={String(NETWORK.roads.length)} sub="DIRECTED LINKS" />
        <KpiCell label="Active Vehicles" value={String(sim.active)} sub={`${sim.queuedCount} STOPPED`} />
        <KpiCell label="Active Signals" value={String(totalSignals)} sub={`${adaptiveCount} ADAPTIVE`} />
        <KpiCell
          label="Congested Approaches"
          value={String(congested)}
          sub={`${Math.round(sim.loadPct)}% NET LOAD`}
          cls={congested > 6 ? 'text-ops-amber' : ''}
        />
        <KpiCell
          label="Active Corridors"
          value={String(corridorsOpen)}
          sub={corridorsOpen > 0 ? 'EMERGENCY PRIORITY' : 'STANDBY'}
          cls={corridorsOpen > 0 ? 'text-emerald-300' : ''}
        />
        <div className="ml-auto hidden items-center gap-2 pr-3 font-mono text-[7.5px] tracking-[0.14em] text-slate-700 lg:flex">
          <Led
            tone={corridorsOpen > 0 ? 'green' : incident ? 'red' : level === 'NORMAL' ? 'cyan' : level === 'MODERATE' ? 'amber' : 'red'}
            pulse={corridorsOpen > 0 || !!incident}
            size={4}
          />
          {corridorsOpen > 0 ? 'EMERGENCY PRIORITY ACTIVE' : incident ? 'INCIDENT ACTIVE' : `${level} FLOW`}
        </div>
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/* left rail: overview · inspector · intersections · segments          */
/* ------------------------------------------------------------------ */

interface LeftProps {
  junction: string | null
  onSelect: (j: string) => void
  layers: TwinLayers
}

export function DigitalTwinLeft({ junction, onSelect, layers }: LeftProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  const t = trafficSimT()
  const sim = trafficMetrics()
  const focus = focusJunction(junction, t)
  const data = inspectData(focus, t)
  const pred = data.pred

  /* intersections ranked by real measured pressure (queue/density/risk) */
  const rows = useMemo(() => {
    const list = DISPLAY_SIGNAL_IDS.map((j) => {
      const o = trafficObservations().get(j)
      const q = (o?.M.queue ?? 0) + (o?.X.queue ?? 0)
      const g = (o?.M.queue ?? 0) >= (o?.X.queue ?? 0) ? 'M' : 'X'
      const p = predict(j, g, t)
      const s = signalStateOf(j)
      const riskScore = p.status === 'READY' ? { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 }[p.congestionRisk] : 0
      return { j, q, g, p, s, riskScore }
    })
    list.sort((a, b) => b.q * 2 + b.riskScore * 12 + (b.p.status === 'READY' ? b.p.currentDensity * 8 : 0) - (a.q * 2 + a.riskScore * 12 + (a.p.status === 'READY' ? a.p.currentDensity * 8 : 0)))
    return list
  }, [t])

  const segCong = trafficCongestion()

  return (
    <motion.aside
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* network overview */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Network size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Network Overview</MicroLabel>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 font-mono">
          <div className="flex items-baseline justify-between">
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-slate-600">Intersections</span>
            <span className="text-[10px] font-semibold tabular text-slate-200">{NETWORK.intersections.length}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-slate-600">Road Segments</span>
            <span className="text-[10px] font-semibold tabular text-slate-200">{NETWORK.roads.length}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-slate-600">Active Vehicles</span>
            <span className="text-[10px] font-semibold tabular text-slate-200">{sim.active}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-slate-600">Traffic Source</span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-300">
              {globalSensorSource()}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-slate-600">Control</span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-300">
              {data.s?.control ?? '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[7.5px] uppercase tracking-[0.1em] text-slate-600">Network Condition</span>
            <span
              className={cn(
                'text-[9px] font-semibold uppercase tracking-[0.08em]',
                congestionLevel(sim.loadPct / 100) === 'CRITICAL' || congestionLevel(sim.loadPct / 100) === 'HEAVY'
                  ? 'text-ops-red'
                  : congestionLevel(sim.loadPct / 100) === 'MODERATE'
                    ? 'text-ops-amber'
                    : 'text-ops-cyan',
              )}
            >
              {congestionLevel(sim.loadPct / 100)}
            </span>
          </div>
        </div>
      </section>

      {/* intersection inspector */}
      <section className="shrink-0 rounded-md border border-ops-cyan/20 bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Eye size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Intersection Inspector</MicroLabel>
          </div>
          <Pill tone="cyan">{focus}</Pill>
        </header>
        <div className="px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[13px] font-semibold tracking-[0.12em] text-slate-100">{focus}</span>
            <span className="truncate font-mono text-[7px] tracking-[0.06em] text-slate-600">
              {jShortName(focus).toUpperCase()}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-y border-white/[0.05] py-2 font-mono">
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Signal</span>
              <span
                className={cn(
                  'text-[9px] font-bold tracking-[0.08em]',
                  data.s?.corridorHeld
                    ? 'text-emerald-300'
                    : data.s?.phase === 'MG' || data.s?.phase === 'XG'
                      ? 'text-emerald-300/90'
                      : data.s?.phase === 'MY' || data.s?.phase === 'XY'
                        ? 'text-ops-amber'
                        : data.s
                          ? 'text-ops-red/90'
                          : 'text-slate-600',
                )}
              >
                {data.s?.corridorHeld
                  ? 'HELD'
                  : data.s
                    ? data.s.phase === 'MG' || data.s.phase === 'XG'
                      ? 'GREEN'
                      : data.s.phase === 'MY' || data.s.phase === 'XY'
                        ? 'YELLOW'
                        : 'RED'
                    : '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Phase</span>
              <span className="text-[9px] font-semibold tabular text-slate-300">{data.s?.phase ?? '—'}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Control</span>
              <span
                className={cn(
                  'text-[9px] font-semibold uppercase tracking-[0.08em]',
                  data.s?.control === 'CORRIDOR' ? 'text-emerald-300' : data.s?.control === 'ADAPTIVE' ? 'text-ops-cyan' : 'text-slate-300',
                )}
              >
                {data.s?.control ?? '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Phase Time</span>
              <span className="text-[9px] font-semibold tabular text-slate-300">
                {data.s ? `${data.s.remainS}s` : '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Approach Queue</span>
              <span className={cn('text-[9px] font-semibold tabular', data.queue > 0 ? 'text-ops-amber' : 'text-slate-300')}>
                {data.queue}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Approach Flow</span>
              <span className="text-[9px] font-semibold tabular text-slate-300">{data.flow}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Density</span>
              <span className="text-[9px] font-semibold tabular text-slate-300">
                {pred.status === 'READY' ? `${Math.round(pred.currentDensity * 100)}%` : '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[7px] uppercase tracking-[0.1em] text-slate-600">Source</span>
              <span
                className={cn(
                  'text-[9px] font-semibold uppercase tracking-[0.08em]',
                  pred.source === 'CAMERA' ? 'text-emerald-300' : pred.source === 'FUSED' ? 'text-ops-cyan' : 'text-slate-400',
                )}
              >
                {pred.source}
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <MicroLabel className="text-slate-600">Predicted Risk</MicroLabel>
            <div className="flex items-center gap-2">
              {pred.status === 'READY' ? (
                <>
                  <Pill tone={RISK_PILL[pred.congestionRisk]}>{pred.congestionRisk}</Pill>
                  <TrendBadge trend={pred.riskChange} />
                </>
              ) : (
                <span className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-slate-600">
                  {pred.status === 'INSUFFICIENT_HISTORY' ? 'BUILDING HISTORY' : '—'}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* network intersections — real junction list, clickable to inspect */}
      {layers.junctions && (
        <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
          <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <Network size={11} className="text-ops-cyan/90" />
              <MicroLabel className="text-slate-400">Network Intersections</MicroLabel>
            </div>
            <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">SELECT TO INSPECT</span>
          </header>
          <div className="flex flex-col divide-y divide-white/[0.03]">
            {rows.map(({ j, q, p, s }) => (
              <button
                key={j}
                type="button"
                onClick={() => onSelect(j)}
                className={cn(
                  'grid grid-cols-[46px_52px_44px_1fr_auto] items-center gap-1.5 px-2.5 py-[5px] text-left font-mono transition-colors',
                  j === focus ? 'bg-ops-cyan/[0.07]' : 'hover:bg-white/[0.02]',
                )}
              >
                <span className={cn('text-[9px] font-bold tracking-[0.1em]', j === focus ? 'text-ops-cyan' : 'text-slate-200')}>
                  {j}
                </span>
                <span
                  className={cn(
                    'text-[8px] font-semibold tracking-[0.06em]',
                    s?.corridorHeld
                      ? 'text-emerald-300'
                      : s?.phase === 'MG' || s?.phase === 'XG'
                        ? 'text-emerald-300/90'
                        : s?.phase === 'MY' || s?.phase === 'XY'
                          ? 'text-ops-amber'
                          : 'text-ops-red/90',
                  )}
                >
                  {s?.corridorHeld
                    ? 'HELD'
                    : s
                      ? s.phase === 'MG' || s.phase === 'XG'
                        ? 'GREEN'
                        : s.phase === 'MY' || s.phase === 'XY'
                          ? 'YELLOW'
                          : 'RED'
                      : '—'}
                </span>
                <span className={cn('tabular text-[8px]', q > 0 ? 'text-ops-amber' : 'text-slate-500')}>{q}</span>
                <span className="tabular text-[8px] text-slate-500">
                  {p.status === 'READY' ? `${Math.round(p.currentDensity * 100)}%` : '—'}
                </span>
                {p.status === 'READY' ? (
                  <Pill tone={RISK_PILL[p.congestionRisk]}>{p.congestionRisk}</Pill>
                ) : (
                  <span className="font-mono text-[7px] text-slate-600">—</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* road segment inspector — real graph segments touching the junction */}
      {layers.roads && (
        <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
          <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <Route size={11} className="text-ops-cyan/90" />
              <MicroLabel className="text-slate-400">Segments at {focus}</MicroLabel>
            </div>
          </header>
          <div className="flex flex-col divide-y divide-white/[0.03] px-2.5 py-1">
            {roadsAt(focus).length === 0 ? (
              <div className="py-2 text-center font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-600">
                NO GRAPH SEGMENTS
              </div>
            ) : (
              roadsAt(focus).map((r) => {
                const cong = segCong.get(r.id)
                const lvl = cong != null ? congestionLevel(cong) : null
                return (
                  <div key={r.id} className="py-[5px] font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold tracking-[0.08em] text-slate-200">{r.id}</span>
                      <span className="truncate text-[7.5px] tracking-[0.04em] text-slate-500">
                        {r.from} → {r.to}
                      </span>
                      <span
                        className={cn(
                          'ml-auto text-[7.5px] font-bold uppercase tracking-[0.1em]',
                          lvl === 'CRITICAL' || lvl === 'HEAVY'
                            ? 'text-ops-red'
                            : lvl === 'MODERATE'
                              ? 'text-ops-amber'
                              : 'text-slate-500',
                        )}
                      >
                        {lvl ?? '—'}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[7px] tracking-[0.08em] text-slate-600">
                      <span>{r.length.toFixed(0)} M</span>
                      <span>{r.speedLimit} KM/H LIMIT</span>
                      <span>{r.lanes} LANE{r.lanes === 1 ? '' : 'S'}</span>
                      <span className="ml-auto uppercase">{r.roadType}</span>
                    </div>
                  </div>
                )
              })
            )}
            <div className="border-t border-white/[0.04] py-1.5 text-center font-mono text-[6.5px] tracking-[0.1em] text-slate-700">
              SEGMENT-LEVEL VEHICLE/FLOW NOT EXPOSED BY ENGINE — SHOWN AS —
            </div>
          </div>
        </section>
      )}
    </motion.aside>
  )
}

/* ------------------------------------------------------------------ */
/* right rail: signals · prediction · health · corridor · incidents    */
/* ------------------------------------------------------------------ */

interface RightProps {
  junction: string | null
  corridorUnit: EmergencyRuntime | null
  corridorWaves: readonly CorridorJunction[]
  corridorsOpen: number
  incident: IncidentState | null
  unitT: Record<string, { d: number; len: number; nextIdx: number; etaRemainSec: number }>
  layers: TwinLayers
}

export function DigitalTwinRight({
  junction,
  corridorUnit,
  corridorWaves,
  corridorsOpen,
  incident,
  unitT,
  layers,
}: RightProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  const t = trafficSimT()
  const focus = focusJunction(junction, t)
  const data = inspectData(focus, t)
  const pred = data.pred

  const snaps = signalStates()
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
      return 0
    })
    return list.slice(0, 10)
  }, [snaps, t])

  const sim = trafficMetrics()
  const cam = getCameraMetrics()
  const camFresh = cam != null && msSinceLastCameraUpdate() < CAMERA_FRESH_MS
  const backendUp = cameraBackendOnline()

  /* coordinated junctions: corridor PREPARING + ACTIVE */
  const coordinated = corridorWaves.filter((c) => c.status === 'PREPARING' || c.status === 'ACTIVE').length
  const nextWave = corridorWaves.find((c) => c.status === 'PREPARING' || c.status === 'ACTIVE') ?? null
  const ut = corridorUnit ? unitT[corridorUnit.id] ?? { d: 0, len: 1, nextIdx: 0, etaRemainSec: corridorUnit.etaSec } : null
  const progressPct = ut && ut.len > 0 ? Math.min(100, Math.max(0, (ut.d / ut.len) * 100)) : 0

  /* network health — computed from real engine state (same vocabulary as Live Traffic) */
  const health: { label: string; state: HealthState; note: string }[] = [
    {
      label: 'Traffic',
      state: sim.active > 0 && sim.avgSpeedKmh >= 18 ? 'GOOD' : sim.avgSpeedKmh >= 9 ? 'WATCH' : sim.active === 0 ? 'WATCH' : 'DEGRADED',
      note: `${sim.avgSpeedKmh.toFixed(1)} KM/H MEAN`,
    },
    {
      label: 'Signals',
      state: snaps.length > 0 ? 'GOOD' : 'WATCH',
      note: `${snaps.filter((s) => s.control === 'ADAPTIVE').length} ADAPTIVE`,
    },
    {
      label: 'Prediction',
      state: pred.status === 'READY' ? 'GOOD' : 'WATCH',
      note: pred.status === 'READY' ? `${pred.historySamples} SAMPLES` : 'COLLECTING',
    },
    {
      label: 'Camera',
      state: camFresh ? 'GOOD' : backendUp ? 'WATCH' : 'DEGRADED',
      note: camFresh && cam ? `CAM-01 · ${cam.inference_fps.toFixed(1)} FPS` : backendUp ? 'STANDBY · NO VIDEO FEED' : 'SIMULATION FALLBACK',
    },
    {
      label: 'Emergency',
      state: corridorsOpen > 0 ? 'ACTIVE' : 'STANDBY',
      note: corridorsOpen > 0 ? `${corridorUnit?.tac ?? ''} EN ROUTE` : 'AWAITING DISPATCH',
    },
    {
      label: 'Incidents',
      state: incident ? 'ACTIVE' : 'CLEAR',
      note: incident ? incident.junctionId : 'NETWORK CLEAR',
    },
  ]

  /* network event timeline — merged REAL events from existing stores */
  const logRows = useMemo(() => {
    interface Lr { t: number; label: string; tone: 'cyan' | 'red' | 'green' | 'amber' | 'slate' }
    const out: Lr[] = predictionEvents().map((e) => ({
      t: e.t,
      label: `${e.intersectionId} ${e.forecast} · ${e.action}`,
      tone: 'cyan' as const,
    }))
    for (const c of corridorEventsLog()) {
      out.push({
        t: c.t,
        label: corrLabel(c),
        tone: c.kind === 'ACTIVE' ? ('green' as const) : c.kind === 'PREPARE' ? ('amber' as const) : ('slate' as const),
      })
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
      {/* signal network */}
      {layers.signals && (
        <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
          <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <Siren size={11} className="text-ops-cyan/90" />
              <MicroLabel className="text-slate-400">Signal Network</MicroLabel>
            </div>
            <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">
              {snaps.filter((s) => s.control === 'ADAPTIVE').length}/{snaps.length} ADAPTIVE
            </span>
          </header>
          <div className="flex flex-col divide-y divide-white/[0.03] px-1.5 py-1">
            {sigRows.map(({ s, q }) => {
              const phaseTxt = s.corridorHeld
                ? 'HELD'
                : s.phase === 'MG' || s.phase === 'XG'
                  ? 'GREEN'
                  : s.phase === 'MY' || s.phase === 'XY'
                    ? 'YELLOW'
                    : 'RED'
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
                    {s.corridorHeld && (
                      <span className="rounded-[2px] border border-emerald-400/40 px-1 text-[6.5px] font-bold tracking-[0.08em] text-emerald-300">
                        EMERG
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* predictive traffic — existing prediction engine for the inspected junction */}
      {layers.prediction && (
        <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
          <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <BrainCircuit size={11} className="text-ops-cyan/90" />
              <MicroLabel className="text-slate-400">Predictive Traffic</MicroLabel>
            </div>
            <Pill tone={pred.source === 'CAMERA' ? 'green' : pred.source === 'FUSED' ? 'cyan' : 'slate'}>
              {pred.source}
            </Pill>
          </header>
          <div className="px-3 py-2">
            {pred.status !== 'READY' ? (
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
                    <MicroLabel className="text-slate-600">Inspected Approach</MicroLabel>
                    <div className="font-mono text-[13px] font-semibold tracking-[0.1em] text-ops-cyan">
                      {focus} <span className="text-slate-600">· {data.g}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Pill tone={RISK_PILL[pred.congestionRisk]}>{pred.congestionRisk}</Pill>
                    <TrendBadge trend={pred.riskChange} />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-x-3 border-y border-white/[0.05] py-1.5">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">Now</span>
                    <span className="font-mono text-[9px] font-semibold tabular text-slate-200">
                      {pred.currentQueue} Q · {Math.round(pred.currentDensity * 100)}%
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">+30s</span>
                    <span className={cn('font-mono text-[9px] font-semibold tabular', pred.predictedQueue30s > pred.currentQueue ? 'text-ops-amber' : 'text-slate-200')}>
                      {pred.predictedQueue30s} Q · {Math.round(pred.predictedDensity30s * 100)}%
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">+60s</span>
                    <span className={cn('font-mono text-[9px] font-semibold tabular', pred.predictedQueue60s > pred.currentQueue ? 'text-ops-amber' : 'text-slate-200')}>
                      {pred.predictedQueue60s} Q · {Math.round(pred.predictedDensity60s * 100)}%
                    </span>
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MicroLabel className="text-slate-600">Vehicles</MicroLabel>
                    <span className="font-mono text-[10px] font-semibold tabular text-slate-200">
                      {pred.currentVehicleCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MicroLabel className="text-slate-600">Confidence</MicroLabel>
                    <span className="font-mono text-[9px] font-semibold tabular text-slate-300">
                      {Math.round(pred.confidence * 100)}%
                    </span>
                  </div>
                  <MicroLabel className="text-slate-600">HISTORY {pred.historySamples}</MicroLabel>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* network health */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={11} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">Network Health</MicroLabel>
          </div>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03] px-3 py-1">
          {health.map((h) => (
            <div key={h.label} className="flex items-center gap-2.5 py-[6px]">
              <span className="w-[86px] shrink-0 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                {h.label}
              </span>
              <Led tone={HEALTH_TONE[h.state]} pulse={h.state === 'ACTIVE'} size={5} />
              <span className={cn('font-mono text-[8px] font-bold uppercase tracking-[0.12em]', HEALTH_CLS[h.state])}>
                {h.state}
              </span>
              <span className="ml-auto truncate font-mono text-[7px] tracking-[0.06em] text-slate-600">{h.note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* emergency corridor layer */}
      {layers.corridor && (
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
              <div className="mt-2">
                <div className="flex items-center justify-between font-mono text-[7px] tracking-[0.1em] text-slate-600">
                  <span>ROUTE PROGRESS</span>
                  <span className="tabular text-slate-400">{progressPct.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[7.5px] tracking-[0.08em] text-slate-500">
                <span>
                  NEXT JUNCTION ·{' '}
                  <span className="font-bold text-emerald-300">
                    {nextWave ? nextWave.id : '—'}
                  </span>
                </span>
                <span className="uppercase">{corridorUnit.status}</span>
              </div>
              {corridorWaves.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {corridorWaves.slice(0, 8).map((w) => (
                    <span
                      key={w.id}
                      className={cn(
                        'rounded-[2px] border px-1 py-[1px] font-mono text-[6.5px] font-bold tracking-[0.08em]',
                        w.status === 'ACTIVE'
                          ? 'border-emerald-400/50 text-emerald-300'
                          : w.status === 'PREPARING'
                            ? 'border-ops-amber/40 text-ops-amber'
                            : 'border-white/10 text-slate-600',
                      )}
                    >
                      {w.id} · {w.status}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-500">
              NO ACTIVE EMERGENCY CORRIDOR
            </div>
          )}
        </section>
      )}

      {/* incident layer */}
      {layers.incidents && (
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
                  AFFECTED APPROACH {incident.junctionId} · routing response active via the existing incident override.
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* network event timeline */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Network Event Timeline</MicroLabel>
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
/* map overlay: legend + layer view filter                             */
/* ------------------------------------------------------------------ */

export function DigitalTwinLegend({ layers }: { layers: TwinLayers }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="pointer-events-none absolute bottom-2.5 left-3 z-20 flex items-center gap-4 rounded-[5px] border border-white/[0.06] bg-night-900/70 px-3 py-2 backdrop-blur-[2px]"
    >
      <MicroLabel className="text-slate-500">Network</MicroLabel>
      <div className="flex items-center gap-2.5">
        {layers.roads && (
          <div className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full bg-slate-500/80" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Roads</span>
          </div>
        )}
        {layers.junctions && (
          <div className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-[2px] border border-slate-400/70" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Junction</span>
          </div>
        )}
        {layers.vehicles && (
          <div className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full bg-ops-cyan shadow-[0_0_5px_#38c4e088]" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Vehicle</span>
          </div>
        )}
        {layers.signals && (
          <div className="flex items-center gap-1.5">
            <span className="flex h-[8px] w-[8px] flex-col items-center justify-center gap-[1px]">
              <span className="h-[2px] w-[7px] rounded-full bg-emerald-400" />
              <span className="h-[2px] w-[7px] rounded-full bg-ops-amber" />
              <span className="h-[2px] w-[7px] rounded-full bg-ops-red" />
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Signal</span>
          </div>
        )}
        {layers.congestion && (
          <div className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full bg-ops-amber" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Congestion</span>
          </div>
        )}
        {layers.queues && (
          <div className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full bg-ops-red/80" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Queue</span>
          </div>
        )}
        {layers.prediction && (
          <div className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full bg-ops-cyan/80" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Prediction</span>
          </div>
        )}
        {layers.incidents && (
          <div className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full bg-ops-red shadow-[0_0_6px_#ef3d52]" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Incident</span>
          </div>
        )}
        {layers.corridor && (
          <div className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full bg-emerald-400 shadow-[0_0_6px_#2fe08a] animate-soft-pulse" />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Corridor</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** NETWORK LAYERS — pure visualization filter. Toggles which inspection
    layers are visible on THIS page; the engines are never modified. */
export function DigitalTwinLayers({
  layers,
  onToggle,
}: {
  layers: TwinLayers
  onToggle: (k: TwinLayerKey) => void
}) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(ALL_TWIN_LAYERS) as TwinLayerKey[]
  const onCount = keys.filter((k) => layers[k]).length
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.55 }}
      className="absolute right-3 top-[58px] z-20 w-[168px]"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-[5px] border border-white/[0.07] bg-night-900/80 px-2.5 py-2 backdrop-blur-[2px] transition-colors hover:border-white/15"
      >
        <Eye size={11} className="text-ops-cyan" />
        <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.16em] text-slate-300">
          Network Layers
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="rounded-[2px] border border-white/10 px-1 py-[1px] font-mono text-[7px] tabular text-slate-500">
            {onCount}/9
          </span>
          <ChevronRight size={10} className={cn('text-slate-500 transition-transform', open && 'rotate-90')} />
        </span>
      </button>
      {open && (
        <div className="mt-1 rounded-[5px] border border-white/[0.07] bg-night-900/95 p-1.5 backdrop-blur-[2px]">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onToggle(k)}
              className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-[4px] text-left font-mono text-[8px] tracking-[0.08em] text-slate-400 transition-colors hover:bg-white/[0.03] hover:text-slate-200"
            >
              <span
                className={cn(
                  'flex h-[10px] w-[10px] items-center justify-center rounded-[2px] border',
                  layers[k] ? 'border-ops-cyan/60 bg-ops-cyan/20' : 'border-white/15',
                )}
              >
                {layers[k] && <span className="h-[4px] w-[4px] rounded-full bg-ops-cyan" />}
              </span>
              <span className="flex-1 uppercase tracking-[0.1em]">{LAYER_LABEL[k]}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-white/[0.05] px-1.5 pt-1 font-mono text-[6.5px] leading-relaxed tracking-[0.08em] text-slate-600">
            VIEW FILTER · VISUALIZATION ONLY — THE SIMULATION AND SIGNAL ENGINES ARE NEVER MODIFIED
          </div>
        </div>
      )}
    </motion.div>
  )
}