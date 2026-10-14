import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Siren,
  ShieldCheck,
  Navigation,
  BrainCircuit,
  ListOrdered,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import type { EmergencyRuntime, IncidentState, Mode } from '../types'
import { fmtClock } from '../lib/format'
import { corridorEventsLog, type CorridorEvent } from '../engine/corridor'
import { opsTimeline, type OpsKind } from '../engine/emergencyTimeline'
import type { EmergencyCase, CaseStatus } from '../arogya/emergencyCase'
import HospitalReceivingCard from './HospitalReceivingCard'
import { predict } from '../engine/trafficPrediction'
import type { CongestionRisk, PredictionResult, RiskChange } from '../types/prediction'
import { trafficSimT } from '../engine/vehicles'
import type { CorridorJunction } from '../engine/corridor'

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */

interface TelemetryInfo {
  d: number
  len: number
  nextIdx: number
  etaRemainSec: number
}

const RISK_PILL: Record<CongestionRisk, 'slate' | 'amber' | 'red'> = {
  LOW: 'slate',
  MODERATE: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
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

/* ------------------------------------------------------------------ */
/* header band: title + engine state + real summary counts             */
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

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'slate' | 'green' | 'cyan' | 'red' | 'amber'
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3">
      <Led tone={tone} pulse={tone !== 'slate'} size={6} />
      <div className="min-w-0 leading-tight">
        <div className="font-mono text-[15px] font-semibold tabular leading-none text-slate-100">{value}</div>
        <div className="mt-[3px] truncate font-mono text-[7.5px] font-medium uppercase tracking-[0.14em] text-slate-600">
          {label}
        </div>
      </div>
    </div>
  )
}

interface HeaderProps {
  units: EmergencyRuntime[]
  incident: IncidentState | null
  corridorsOpen: number
  arming: boolean
  mode: Mode
}

export function EmergenciesHeader({ units, incident, corridorsOpen, arming, mode }: HeaderProps) {
  const enRoute = units.filter((u) => u.status === 'ACTIVE' && !u.arrived).length
  const arrived = units.filter((u) => u.arrived).length
  const responding = enRoute + arrived
  const criticals = incident ? 1 : 0

  const engineTone: Tone = enRoute > 0 ? 'red' : arrived > 0 ? 'green' : 'slate'
  const engineWord = enRoute > 0 ? 'RESPONDING' : arrived > 0 ? 'ARRIVED' : 'STANDBY'
  const routing = units.some((u) => u.variant === 'detour' && !u.arrived)
  const statusWord = incident ? 'INCIDENT ACTIVE' : enRoute > 0 ? 'UNIT EN ROUTE' : 'NO ACTIVE EMERGENCIES'

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      {/* row 1: title + engine state */}
      <div className="flex h-[54px] items-center justify-between gap-4 px-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-ops-red/35 bg-ops-red/[0.09]">
              <Siren size={12} className="text-ops-red" />
            </span>
            <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.28em] text-slate-100">
              Emergency Operations
            </h1>
          </div>
          <div className="mt-[3px] pl-[34px] font-mono text-[8.5px] tracking-[0.16em] text-slate-600">
            REAL-TIME INCIDENT RESPONSE &amp; MOBILITY COORDINATION
          </div>
        </div>

        <div className="hidden min-w-0 shrink-0 grid-cols-4 gap-4 xl:grid">
          <EngineStat label="Emergency Engine" word={engineWord} sub="DISPATCH" tone={engineTone} pulse={enRoute > 0} />
          <EngineStat
            label="Routing"
            word={routing ? 'REROUTED' : 'READY'}
            sub={routing ? 'INCIDENT DETOUR' : 'LIVE GRAPH'}
            tone={routing ? 'amber' : 'green'}
            pulse={routing}
          />
          <EngineStat
            label="Corridor Engine"
            word={corridorsOpen > 0 ? 'HOLDING' : arming ? 'ARMING' : 'STANDBY'}
            sub={corridorsOpen > 0 ? 'SIGNALS HELD' : 'COORDINATION'}
            tone={corridorsOpen > 0 ? 'green' : arming ? 'cyan' : 'slate'}
            pulse={corridorsOpen > 0 || arming}
          />
          <EngineStat
            label="Signal Control"
            word={mode === 'greenwave' ? 'ADAPTIVE' : 'FIXED TIME'}
            sub={mode === 'greenwave' ? 'GREENWAVE' : 'BASELINE CYCLES'}
            tone={mode === 'greenwave' ? 'green' : 'cyan'}
            pulse={mode === 'greenwave'}
          />
        </div>

        <Pill tone={incident ? 'red' : enRoute > 0 ? 'green' : 'slate'} className="hidden shrink-0 lg:inline-flex">
          {statusWord}
        </Pill>
      </div>

      {/* row 2: summary cells (real counts from shared state) */}
      <div className="flex h-[42px] items-center divide-x divide-white/[0.05] border-t border-white/[0.05]">
        <SummaryCell label="Active Emergencies" value={enRoute + arrived} tone={enRoute > 0 ? 'red' : 'slate'} />
        <SummaryCell label="Responding Units" value={responding} tone={responding > 0 ? 'cyan' : 'slate'} />
        <SummaryCell label="Active Corridors" value={corridorsOpen} tone={corridorsOpen > 0 ? 'green' : 'slate'} />
        <SummaryCell label="Critical Incidents" value={criticals} tone={criticals > 0 ? 'red' : 'slate'} />
        <div className="ml-auto hidden items-center gap-2 pr-3 font-mono text-[8px] tracking-[0.14em] text-slate-700 xl:flex">
          <Led tone="cyan" pulse size={4} />
          LIVE OPS STATE · ONE SOURCE OF TRUTH
        </div>
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/* rail: timeline · route intelligence · priority                      */
/* ------------------------------------------------------------------ */

function corrLabel(c: CorridorEvent): string {
  if (c.kind === 'PREPARE') return `PREPARING · ${Math.max(1, Math.round(c.etaSec))}s ETA`
  if (c.kind === 'ACTIVE') return 'GREEN HELD FOR UNIT'
  return 'PASSED · CONTROL RESUMED'
}

const KIND_TONE: Record<OpsKind, 'cyan' | 'slate' | 'green' | 'amber' | 'red'> = {
  dispatch: 'cyan',
  route: 'slate',
  corridor: 'green',
  incident: 'red',
  arrival: 'green',
  coordination: 'cyan',
  system: 'amber',
}

interface Row {
  key: string
  t: number
  junctionId: string | null
  label: string
  tone: 'cyan' | 'slate' | 'green' | 'amber' | 'red'
}

function miniCell(label: string, value: string, cls = '') {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="font-mono text-[7.5px] font-medium uppercase tracking-[0.12em] text-slate-600">{label}</div>
      <div className={cn('mt-[2px] font-mono text-[11.5px] font-semibold tabular text-slate-200', cls)}>{value}</div>
    </div>
  )
}

interface RailProps {
  units: EmergencyRuntime[]
  selectedId: string
  unitT: Record<string, TelemetryInfo>
  incident: IncidentState | null
  corridorsOpen: number
  mode: Mode
  /** corridor wave of the selected unit (junction group drives the route intel axis) */
  corrWave: CorridorJunction[] | null
  /** ArogyaOS case + derived receiving status (null when no case exists) */
  emergencyCase: EmergencyCase | null
  caseStatus: CaseStatus | null
  etaSec: number
  corridorOpen: boolean
  corridorReleased: boolean
  onOpenHandoff: () => void
}

export function EmergenciesRail({
  units,
  selectedId,
  unitT,
  incident,
  corridorsOpen,
  mode,
  corrWave,
  emergencyCase,
  caseStatus,
  etaSec,
  corridorOpen,
  corridorReleased,
  onOpenHandoff,
}: RailProps) {
  /* refresh cadence — timeline + prediction are cheap, module-backed reads */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 900)
    return () => window.clearInterval(t)
  }, [])

  const unit = units.find((u) => u.id === selectedId) ?? units[0]

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = opsTimeline().map((e, i) => ({
      key: `o${i}`,
      t: e.t,
      junctionId: e.junctionId,
      label: e.label,
      tone: KIND_TONE[e.kind],
    }))
    corridorEventsLog().forEach((c, i) => {
      out.push({
        key: `c${i}`,
        t: c.t,
        junctionId: c.junctionId,
        label: corrLabel(c),
        tone: c.kind === 'PREPARE' ? 'cyan' : 'green',
      })
    })
    return out.sort((a, b) => b.t - a.t).slice(0, 16)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident, corridorsOpen, unit?.status, tick])

  /* route intelligence — next junction of the selected unit + its forecast */
  const pred = useMemo<PredictionResult | null>(() => {
    if (!unit) return null
    const t = unitT[unit.id] ?? { d: 0, len: unit.len || 1, nextIdx: 0, etaRemainSec: unit.etaSec }
    const tel = unit.junctionIds ?? []
    const pending = unit.status === 'PENDING'
    const nextJ = unit.arrived || pending ? null : tel[t.nextIdx] ?? null
    if (!nextJ) return null
    const group = (corrWave?.find((c) => c.id === nextJ)?.group) ?? 'M'
    return predict(nextJ, group, trafficSimT())
  }, [unit, unitT, corrWave, incident, corridorsOpen, tick])

  const rowsEmpty = rows.length === 0
  const corridorActive = corridorsOpen > 0

  return (
    <motion.aside
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-hidden"
    >
      {/* timeline */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <ListOrdered size={12} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Live Emergency Timeline</MicroLabel>
          </div>
          <span className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">
            {rowsEmpty ? 'NO EVENTS' : `LAST ${rows.length}`}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          {rowsEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Led tone="slate" size={5} />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                SYSTEM STANDBY
              </div>
              <div className="px-3 font-mono text-[7.5px] leading-relaxed tracking-[0.06em] text-slate-600">
                Timeline records real dispatch, corridor, incident and arrival transitions.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[5px]">
              {rows.map((r, i) => (
                <motion.div
                  key={`${r.key}-${r.t}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(0.25, i * 0.04) }}
                  title={`${fmtClock(r.t)} · ${r.junctionId ?? '—'} · ${r.label}`}
                  className="grid grid-cols-[40px_38px_1fr] items-center gap-1.5 rounded-[3px] border border-white/[0.04] bg-white/[0.012] px-1.5 py-1 font-mono"
                >
                  <span className="tabular text-[8px] text-slate-500">{fmtClock(r.t)}</span>
                  <span
                    className={cn(
                      'truncate text-[8px] font-semibold tracking-[0.08em]',
                      r.junctionId
                        ? r.tone === 'red'
                          ? 'text-ops-red'
                          : r.tone === 'green'
                            ? 'text-emerald-300'
                            : r.tone === 'amber'
                              ? 'text-ops-amber'
                              : 'text-ops-cyan'
                        : 'text-slate-700',
                    )}
                  >
                    {r.junctionId ?? '—'}
                  </span>
                  <span className="truncate text-[8px] text-slate-300" title={r.label}>
                    {r.label}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.05] px-3">
          <span className="font-mono text-[7px] tracking-[0.16em] text-slate-700">ACTUAL TRANSITIONS ONLY</span>
          <span className="font-mono text-[7px] tracking-[0.1em] text-slate-700">SIM CLOCK</span>
        </footer>
      </section>

      {/* route intelligence */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <BrainCircuit size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Route Intelligence</MicroLabel>
          </div>
          {!pred ? (
            <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">AWAITING UNIT</span>
          ) : (
            <Pill tone={pred.source === 'CAMERA' ? 'green' : pred.source === 'FUSED' ? 'cyan' : 'slate'}>
              {pred.source}
            </Pill>
          )}
        </header>

        <div className="px-3 py-2">
          {!unit ? null : pred && pred.status === 'READY' ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border border-ops-cyan/30 bg-ops-cyan/[0.08]">
                    <Navigation size={9} className="text-ops-cyan" />
                  </span>
                  <div className="leading-tight">
                    <MicroLabel className="text-slate-600">Next Junction</MicroLabel>
                    <div className="font-mono text-[13px] font-semibold tracking-[0.14em] text-ops-cyan">
                      {pred.intersectionId} · GROUP {pred.group}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={RISK_PILL[pred.congestionRisk]}>{pred.congestionRisk}</Pill>
                  <TrendBadge trend={pred.riskChange} />
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2 border-y border-white/[0.05] py-1.5">
                {miniCell('Queue · Now', String(pred.currentQueue))}
                {miniCell('+30s', String(pred.predictedQueue30s), pred.predictedQueue30s > pred.currentQueue ? 'text-ops-amber' : '')}
                {miniCell('+60s', String(pred.predictedQueue60s), pred.predictedQueue60s > pred.currentQueue ? 'text-ops-amber' : '')}
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {miniCell('Density', `${Math.round(pred.currentDensity * 100)}%`)}
                {miniCell('Vehicles', String(pred.currentVehicleCount))}
                {miniCell('History', `${pred.historySamples} SAMPLES`)}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <MicroLabel className="text-slate-600">Prediction Confidence</MicroLabel>
                <span className="font-mono text-[9px] font-semibold tabular text-slate-300">
                  {Math.round(pred.confidence * 100)}%
                </span>
              </div>
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full bg-gradient-to-r from-ops-cyan/60 to-ops-cyan transition-all duration-700"
                  style={{ width: `${Math.round(pred.confidence * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-3 text-center">
              <Led tone="slate" size={4} />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                PREDICTION BUILDING HISTORY
              </div>
              <div className="font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {unit.status === 'PENDING'
                  ? 'DISPATCH THE UNIT TO ENABLE ROUTE FORECAST'
                  : unit.arrived
                    ? 'UNIT AT DESTINATION'
                    : 'COLLECTING OBSERVATIONS FOR NEXT JUNCTION'}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ArogyaOS hospital receiving — real unit state, no duplicated ETA */}
      <HospitalReceivingCard
        emergencyCase={emergencyCase}
        caseStatus={caseStatus}
        etaSec={etaSec}
        corridorOpen={corridorOpen}
        corridorReleased={corridorReleased}
        onReviewHandoff={onOpenHandoff}
      />

      {/* priority hierarchy */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={11} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">Priority Hierarchy</MicroLabel>
          </div>
          {corridorActive && (
            <span className="flex items-center gap-1.5 font-mono text-[7.5px] font-bold tracking-[0.14em] text-emerald-300">
              <Led tone="green" pulse size={4} />
              EMERGENCY PRIORITY ACTIVE
            </span>
          )}
        </header>
        <div className="flex flex-col divide-y divide-white/[0.04] px-3 py-1">
          <div className="flex items-center gap-2.5 py-[7px]">
            <span className="font-mono text-[8px] font-bold text-slate-600">1</span>
            <Led tone={corridorActive ? 'green' : 'slate'} pulse={corridorActive} size={5} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className={cn('font-mono text-[9px] font-bold uppercase tracking-[0.14em]', corridorActive ? 'text-emerald-300' : 'text-slate-300')}>
                Emergency Corridor
              </div>
              <div className="truncate font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {corridorActive ? 'OVERRIDES ALL OPTIMIZATION' : 'STANDBY · HIGHEST PRIORITY WHEN ACTIVE'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 py-[7px]">
            <span className="font-mono text-[8px] font-bold text-slate-600">2</span>
            <Led
              tone={mode === 'greenwave' && !corridorActive ? 'cyan' : 'slate'}
              pulse={mode === 'greenwave' && !corridorActive}
              size={5}
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">
                Adaptive Optimization
              </div>
              <div className="truncate font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {mode === 'greenwave' ? 'PRESSURE-BASED · GREENWAVE' : 'FIXED-TIME BASELINE'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 py-[7px]">
            <span className="font-mono text-[8px] font-bold text-slate-600">3</span>
            <Led
              tone={corridorActive ? 'amber' : 'slate'}
              pulse={false}
              size={5}
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">
                Predictive Bias
              </div>
              <div className="truncate font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {corridorActive ? 'RUNNING IN SUPPORT MODE · CANNOT OVERRIDE CORRIDOR' : 'BOUNDED FORWARD-LOOKING ADJUSTMENT'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </motion.aside>
  )
}

/* ------------------------------------------------------------------ */
/* map legend (emergencies view)                                       */
/* ------------------------------------------------------------------ */

const LEGEND_ROWS = [
  { dot: <span className="h-[7px] w-[7px] rounded-full border border-ops-cyan bg-ops-cyan/20 shadow-[0_0_6px_rgba(56,196,224,0.5)]" />, label: 'Unit' },
  { dot: <span className="h-[2px] w-[14px] rounded-full bg-slate-400/80" />, label: 'Route' },
  { dot: <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-ops-cyan" />, label: 'Next Junction' },
  { dot: <span className="h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-[0_0_6px_#2fe08a] animate-soft-pulse" />, label: 'Corridor Active' },
  { dot: <span className="flex h-[7px] w-[7px] items-center justify-center text-[6px] leading-none text-slate-400">✚</span>, label: 'Destination' },
]

export function EmergenciesLegend({ className }: { className?: string }) {
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
      <MicroLabel className="text-slate-500">Emergency Route</MicroLabel>
      <div className="flex items-center gap-3">
        {LEGEND_ROWS.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5">
            {r.dot}
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">{r.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
