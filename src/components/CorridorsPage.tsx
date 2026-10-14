import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Siren,
  Route as RouteIcon,
  ShieldCheck,
  Navigation,
  BrainCircuit,
  Waypoints,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import type { EmergencyRuntime, IncidentState, Mode } from '../types'
import { fmtClock } from '../lib/format'
import { corridorEventsLog, type CorridorEvent, type CorridorJunction } from '../engine/corridor'
import { predict } from '../engine/trafficPrediction'
import type { CongestionRisk, PredictionResult, RiskChange } from '../types/prediction'
import { trafficSimT } from '../engine/vehicles'

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
/* header band                                                         */
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
  /** live corridor waves per unit (engine state) */
  corrWaves: Record<string, readonly CorridorJunction[]>
}

export function CorridorsHeader({ units, incident, corridorsOpen, arming, mode, corrWaves }: HeaderProps) {
  /* coordinated junctions across open corridor waves (real engine state) */
  const coordinated = useMemo(() => {
    let n = 0
    for (const u of units) {
      if (!u.corridorOpen || u.arrived) continue
      for (const c of corrWaves[u.id] ?? []) {
        if (c.status === 'PREPARING' || c.status === 'ACTIVE') n += 1
      }
    }
    return n
  }, [units, corrWaves])

  const inCorridor = units.filter((u) => u.corridorOpen && !u.arrived).length
  const preparingCount = arming ? 1 : 0
  const enRoute = units.some((u) => u.status === 'ACTIVE' && !u.arrived)
  const routing = units.some((u) => u.variant === 'detour' && !u.arrived)

  const statusWord = corridorsOpen > 0
    ? 'CORRIDOR HOLDING'
    : incident
      ? 'INCIDENT ACTIVE'
      : enRoute
        ? 'CORRIDOR STANDBY'
        : 'NO ACTIVE CORRIDORS'

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      <div className="flex h-[54px] items-center justify-between gap-4 px-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border',
                corridorsOpen > 0
                  ? 'border-emerald-400/40 bg-emerald-400/[0.09]'
                  : 'border-ops-cyan/30 bg-ops-cyan/[0.08]',
              )}
            >
              <Waypoints size={12} className={corridorsOpen > 0 ? 'text-emerald-300' : 'text-ops-cyan'} />
            </span>
            <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.28em] text-slate-100">
              Active Corridors
            </h1>
          </div>
          <div className="mt-[3px] pl-[34px] font-mono text-[8.5px] tracking-[0.16em] text-slate-600">
            DYNAMIC EMERGENCY ROUTE COORDINATION
          </div>
        </div>

        <div className="hidden min-w-0 shrink-0 grid-cols-4 gap-4 xl:grid">
          <EngineStat
            label="Corridor Engine"
            word={corridorsOpen > 0 ? 'HOLDING' : arming ? 'ARMING' : 'STANDBY'}
            sub={corridorsOpen > 0 ? `${coordinated} SIGNALS` : 'COORDINATION'}
            tone={corridorsOpen > 0 ? 'green' : arming ? 'amber' : 'slate'}
            pulse={corridorsOpen > 0 || arming}
          />
          <EngineStat
            label="Signal Control"
            word={mode === 'greenwave' ? 'ADAPTIVE' : 'FIXED TIME'}
            sub={mode === 'greenwave' ? 'GREENWAVE' : 'BASELINE CYCLES'}
            tone={mode === 'greenwave' ? 'green' : 'cyan'}
            pulse={mode === 'greenwave'}
          />
          <EngineStat
            label="Routing"
            word={routing ? 'REROUTED' : 'READY'}
            sub={routing ? 'INCIDENT DETOUR' : 'LIVE GRAPH'}
            tone={routing ? 'amber' : 'green'}
            pulse={routing}
          />
          <EngineStat
            label="Emergency Engine"
            word={enRoute ? 'RESPONDING' : 'STANDBY'}
            sub={enRoute ? 'UNIT EN ROUTE' : 'DISPATCH'}
            tone={enRoute ? 'red' : 'slate'}
            pulse={enRoute}
          />
        </div>

        <Pill
          tone={corridorsOpen > 0 ? 'green' : arming ? 'amber' : incident ? 'red' : 'slate'}
          className="hidden shrink-0 lg:inline-flex"
        >
          {statusWord}
        </Pill>
      </div>

      <div className="flex h-[42px] items-center divide-x divide-white/[0.05] border-t border-white/[0.05]">
        <SummaryCell label="Active Corridors" value={corridorsOpen} tone={corridorsOpen > 0 ? 'green' : 'slate'} />
        <SummaryCell label="Intersections Coordinated" value={coordinated} tone={coordinated > 0 ? 'cyan' : 'slate'} />
        <SummaryCell label="Units in Corridor" value={inCorridor} tone={inCorridor > 0 ? 'cyan' : 'slate'} />
        <SummaryCell label="Corridors Preparing" value={preparingCount} tone={preparingCount > 0 ? 'amber' : 'slate'} />
        <div className="ml-auto hidden items-center gap-2 pr-3 font-mono text-[8px] tracking-[0.14em] text-slate-700 xl:flex">
          <Led tone="green" pulse size={4} />
          CORRIDOR ENGINE · SINGLE SOURCE OF TRUTH
        </div>
      </div>
    </motion.section>
  )
}

/* ------------------------------------------------------------------ */
/* rail: corridor timeline · signal choreography · next junction · prio */
/* ------------------------------------------------------------------ */

function corrLabel(c: CorridorEvent): string {
  if (c.kind === 'PREPARE') return `PREPARING · ${Math.max(1, Math.round(c.etaSec))}s ETA`
  if (c.kind === 'ACTIVE') return 'GREEN HELD FOR UNIT'
  return 'PASSED · CONTROL RESUMED'
}

type ChoreoState =
  | 'PASSED'
  | 'GREEN HELD'
  | 'PREPARING'
  | 'CURRENT'
  | 'UPCOMING'
  | 'STANDBY'
  | 'NORMAL'

interface ChoreoRow {
  id: string
  state: ChoreoState
  eta?: number
}

const STATE_TONE: Record<ChoreoState, { dot: Tone; text: string }> = {
  PASSED: { dot: 'slate', text: 'text-slate-500' },
  'GREEN HELD': { dot: 'green', text: 'text-emerald-300' },
  PREPARING: { dot: 'amber', text: 'text-ops-amber' },
  CURRENT: { dot: 'cyan', text: 'text-ops-cyan' },
  UPCOMING: { dot: 'slate', text: 'text-slate-600' },
  STANDBY: { dot: 'slate', text: 'text-slate-600' },
  NORMAL: { dot: 'slate', text: 'text-slate-600' },
}

function choreographyFor(
  unit: EmergencyRuntime | null,
  tel: TelemetryInfo,
  wave: readonly CorridorJunction[],
  corridorOpen: boolean,
): ChoreoRow[] {
  if (!unit) return []
  const waveById = new Map(wave.map((c) => [c.id, c]))
  const ids = unit.junctionIds ?? []
  const pending = unit.status === 'PENDING'
  return ids.map((j, i) => {
    if (corridorOpen && !unit.arrived) {
      const c = waveById.get(j)
      if (c) {
        const st: ChoreoState =
          c.status === 'PASSED' ? 'PASSED' : c.status === 'ACTIVE' ? 'GREEN HELD' : c.status === 'PREPARING' ? 'PREPARING' : 'STANDBY'
        return { id: j, state: st, eta: c.status === 'PREPARING' ? Math.max(1, Math.round(c.etaSec)) : undefined }
      }
      // outside the current coordination window (already passed or beyond plan)
      return { id: j, state: i < tel.nextIdx ? 'PASSED' : 'STANDBY' }
    }
    if (pending) return { id: j, state: 'STANDBY' }
    if (unit.arrived) return { id: j, state: 'PASSED' }
    return { id: j, state: i < tel.nextIdx ? 'PASSED' : i === tel.nextIdx ? 'CURRENT' : 'UPCOMING' }
  })
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
  mode: Mode
  corridorsOpen: number
  arming: boolean
  /** active corridor unit id (when arming this is the unit being armed) */
  activeCorridorId: string | null
  corrWaves: Record<string, readonly CorridorJunction[]>
  onOpenEmergencies: () => void
}

export function CorridorsRail({
  units,
  selectedId,
  unitT,
  incident,
  mode,
  corridorsOpen,
  arming,
  activeCorridorId,
  corrWaves,
  onOpenEmergencies,
}: RailProps) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 900)
    return () => window.clearInterval(t)
  }, [])

  const active = useMemo(() => {
    const open = units.find((u) => u.corridorOpen && !u.arrived)
    if (open) return open
    if (arming && activeCorridorId) {
      const a = units.find((u) => u.id === activeCorridorId)
      if (a && !a.arrived && !a.corridorOpen) return a
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, corridorsOpen, arming, activeCorridorId, tick])

  const fallback = units.find((u) => u.id === selectedId) ?? units[0]
  const unit = active ?? (fallback?.status === 'ACTIVE' && !fallback.arrived ? fallback : null)

  const corridorOpen = !!(active && active.corridorOpen && !active.arrived)
  const corridorStatus: 'STANDBY' | 'PREPARING' | 'ACTIVE' | 'RELEASED' = active
    ? active.corridorOpen && !active.arrived
      ? 'ACTIVE'
      : arming && activeCorridorId === active.id
        ? 'PREPARING'
        : active.arrived
          ? 'RELEASED'
          : 'STANDBY'
    : 'STANDBY'

  const wave = active ? corrWaves[active.id] ?? [] : []
  const tel = unit
    ? (unitT[unit.id] ?? { d: 0, len: unit.len || 1, nextIdx: 0, etaRemainSec: unit.etaSec })
    : { d: 0, len: 1, nextIdx: 0, etaRemainSec: 0 }

  const timeline = useMemo(() => {
    return corridorEventsLog()
      .slice()
      .sort((a, b) => b.t - a.t)
      .slice(0, 16)
      .map((c) => ({ key: `${c.t}-${c.junctionId}-${c.kind}`, t: c.t, id: c.junctionId, label: corrLabel(c), kind: c.kind }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, corridorsOpen, active?.id])

  const choreo = useMemo<ChoreoRow[]>(
    () => choreographyFor(active ?? unit, tel, wave, corridorOpen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, unit, tel, corridorOpen, tick, wave],
  )

  /* next junction of the corridor unit + its live forecast */
  const nextIntel = useMemo<{ j: string; group: 'M' | 'X'; pred: PredictionResult } | null>(() => {
    if (!active || active.status === 'PENDING' || active.arrived) return null
    const t0 = unitT[active.id] ?? { d: 0, len: active.len || 1, nextIdx: 0, etaRemainSec: active.etaSec }
    const ids = active.junctionIds ?? []
    const j = ids[t0.nextIdx]
    if (!j) return null
    const group = (wave.find((c) => c.id === j)?.group) ?? 'M'
    return { j, group, pred: predict(j, group, trafficSimT()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, unitT, wave, corridorsOpen, tick])

  const anyCoordinated = choreo.some((r) => r.state === 'PREPARING' || r.state === 'GREEN HELD')
  const progress = active
    ? active.arrived
      ? 1
      : active.status === 'PENDING'
        ? 0
        : Math.min(1, active.dist / Math.max(1, active.len))
    : 0
  const empty = !active && !arming

  return (
    <motion.aside
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {empty && (
        <section className="rounded-md border border-white/[0.07] bg-night-900">
          <div className="flex flex-col items-center gap-2 px-4 py-5 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-[6px] border border-white/[0.08] bg-white/[0.02]">
              <Waypoints size={16} className="text-slate-600" />
            </span>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
              NO ACTIVE CORRIDORS
            </div>
            <div className="font-mono text-[8px] tracking-[0.14em] text-slate-600">CORRIDOR ENGINE · STANDBY</div>
            <div className="font-mono text-[7.5px] tracking-[0.08em] text-slate-600">WAITING FOR EMERGENCY DISPATCH</div>
            {incident && (
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[7.5px] tracking-[0.1em] text-ops-red">
                <span className="h-[4px] w-[4px] rounded-full bg-ops-red" /> NETWORK INCIDENT · {incident.junctionId}
              </div>
            )}
            <button
              type="button"
              onClick={onOpenEmergencies}
              className="mt-1 flex h-7 items-center gap-1.5 rounded-[3px] border border-ops-cyan/45 bg-ops-cyan/[0.07] px-2.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-ops-cyan transition-colors hover:bg-ops-cyan/[0.14]"
            >
              Open Emergencies <ArrowRight size={10} />
            </button>
          </div>
        </section>
      )}

      {/* corridor card — real active unit state */}
      {active && (
        <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <div className="flex items-center gap-2">
              <Led tone={corridorStatus === 'ACTIVE' ? 'green' : corridorStatus === 'PREPARING' ? 'amber' : 'slate'} pulse={corridorStatus === 'ACTIVE' || corridorStatus === 'PREPARING'} size={5} />
              <div className="leading-tight">
                <MicroLabel className="text-slate-500">{active.corridorLabel}</MicroLabel>
                <div className="font-mono text-[10.5px] font-semibold tracking-[0.12em] text-slate-100">
                  {active.tac} · {active.incident}
                </div>
              </div>
            </div>
            <Pill tone={corridorStatus === 'ACTIVE' ? 'green' : corridorStatus === 'PREPARING' ? 'amber' : 'slate'}>
              {corridorStatus}
            </Pill>
          </div>
          <div className="px-3 py-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div className="leading-tight">
                <MicroLabel className="text-slate-600">Origin</MicroLabel>
                <div className="mt-[1px] truncate text-[10px] font-medium text-slate-300">{active.origin}</div>
              </div>
              <div className="leading-tight">
                <MicroLabel className="text-slate-600">Destination</MicroLabel>
                <div className="mt-[1px] truncate text-[10px] font-medium text-slate-300">{active.destination}</div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[7.5px] tracking-[0.1em] text-slate-600">
              <span className="truncate">
                {active.junctionIds.length > 0
                  ? `${active.junctionIds[0]} → ${active.junctionIds[active.junctionIds.length - 1]}`
                  : '—'}
              </span>
              <span className="shrink-0 tabular">
                {active.distanceKm.toFixed(1)} KM · {active.intersections} SIGNALS
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[7.5px] tracking-[0.14em] text-slate-600">
              <span>Route Progress</span>
              <span className="tabular text-slate-500">{active.arrived ? '100%' : `${Math.round(progress * 100)}%`}</span>
            </div>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  corridorStatus === 'ACTIVE'
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(47,224,138,0.8)]'
                    : corridorStatus === 'PREPARING'
                      ? 'bg-ops-amber/80'
                      : 'bg-slate-600',
                )}
                animate={{ width: `${progress * 100}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 26 }}
              />
            </div>
          </div>
        </section>
      )}

      {/* corridor timeline — engine transitions only */}
      <section className={cn('rounded-md border border-white/[0.07] bg-night-900', empty ? '' : 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        <header className={cn('flex h-8 shrink-0 items-center justify-between border-b border-white/[0.06] px-3', !empty && 'h-9')}>
          <div className="flex items-center gap-2">
            <RouteIcon size={12} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">Corridor Timeline</MicroLabel>
          </div>
          <span className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">
            {timeline.length === 0 ? 'NO EVENTS' : `LAST ${timeline.length}`}
          </span>
        </header>
        <div className={cn('px-2.5 py-2', empty ? '' : 'min-h-0 flex-1 overflow-y-auto')}>
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-4 text-center">
              <Led tone="slate" size={4} />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {empty ? 'CORRIDOR ENGINE · STANDBY' : 'BUILDING CORRIDOR'}
              </div>
              <div className="px-2 font-mono text-[7.5px] leading-relaxed tracking-[0.06em] text-slate-600">
                Junction transitions appear as the ambulance approaches — engine clock only.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[4px]">
              {timeline.map((r) => (
                <div
                  key={r.key}
                  title={`${fmtClock(r.t)} · ${r.id} · ${r.label}`}
                  className="grid grid-cols-[38px_36px_1fr] items-center gap-1.5 rounded-[3px] border border-white/[0.04] bg-white/[0.012] px-1.5 py-1 font-mono"
                >
                  <span className="tabular text-[8px] text-slate-500">{fmtClock(r.t)}</span>
                  <span
                    className={cn(
                      'truncate text-[8px] font-semibold tracking-[0.08em]',
                      r.kind === 'ACTIVE' ? 'text-emerald-300' : r.kind === 'PREPARE' ? 'text-ops-amber' : 'text-slate-500',
                    )}
                  >
                    {r.id}
                  </span>
                  <span className="truncate text-[8px] text-slate-300">{r.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* signal choreography — wave states for every route junction */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Siren size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Signal Choreography</MicroLabel>
          </div>
          <span
            className={cn(
              'flex items-center gap-1.5 font-mono text-[7.5px] font-bold tracking-[0.14em]',
              anyCoordinated ? 'text-emerald-300' : 'text-slate-600',
            )}
          >
            <Led tone={anyCoordinated ? 'green' : 'slate'} pulse={anyCoordinated} size={4} />
            {anyCoordinated ? 'COORDINATED' : 'NORMAL CONTROL'}
          </span>
        </header>
        <div className="flex flex-col divide-y divide-white/[0.03] px-1.5 py-1">
          {choreo.length === 0 ? (
            <div className="px-2 py-3 text-center font-mono text-[8px] tracking-[0.1em] text-slate-600">
              AWAITING EMERGENCY ROUTE
            </div>
          ) : (
            choreo.map((r) => {
              const t = STATE_TONE[r.state]
              return (
                <div key={r.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-2 px-1.5 py-[5px] font-mono">
                  <span
                    className={cn(
                      'text-[9px] font-bold tracking-[0.1em]',
                      r.state === 'GREEN HELD' ? 'text-emerald-300' : r.state === 'PREPARING' ? 'text-ops-amber' : r.state === 'CURRENT' ? 'text-ops-cyan' : r.state === 'PASSED' ? 'text-slate-500' : 'text-slate-300',
                    )}
                  >
                    {r.id}
                  </span>
                  <span className={cn('flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[0.12em]', t.text)}>
                    <Led tone={t.dot} pulse={r.state === 'GREEN HELD' || r.state === 'PREPARING'} size={4} />
                    {r.state}
                  </span>
                  <span className="text-[7.5px] tabular text-slate-600">{r.eta != null ? `${r.eta}s` : ''}</span>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* next junction + prediction (supporting intelligence) */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <BrainCircuit size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Next Junction</MicroLabel>
          </div>
          {!nextIntel ? (
            <span className="font-mono text-[7px] tracking-[0.12em] text-slate-600">
              {empty ? 'AWAITING DISPATCH' : 'ARRIVAL'}
            </span>
          ) : (
            <Pill tone={nextIntel.pred.source === 'CAMERA' ? 'green' : nextIntel.pred.source === 'FUSED' ? 'cyan' : 'slate'}>
              {nextIntel.pred.source}
            </Pill>
          )}
        </header>
        <div className="px-3 py-2">
          {!nextIntel ? (
            <div className="flex flex-col items-center gap-1.5 py-2 text-center">
              <Led tone="slate" size={4} />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {empty ? 'WAITING FOR EMERGENCY DISPATCH' : active ? 'DESTINATION REACHED' : 'AWAITING ROUTE'}
              </div>
            </div>
          ) : nextIntel.pred.status !== 'READY' ? (
            <div className="flex flex-col items-center gap-1.5 py-2 text-center">
              <Led tone="slate" size={4} />
              <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                PREDICTION BUILDING HISTORY
              </div>
              <div className="font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {nextIntel.pred.insufficientReason === 'STALE' ? 'OBSERVATIONS STALE' : 'COLLECTING OBSERVATIONS'}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border border-ops-cyan/30 bg-ops-cyan/[0.08]">
                    <Navigation size={9} className="text-ops-cyan" />
                  </span>
                  <div className="leading-tight">
                    <MicroLabel className="text-slate-600">Next Junction</MicroLabel>
                    <div className="font-mono text-[13px] font-semibold tracking-[0.14em] text-ops-cyan">
                      {nextIntel.j} · GROUP {nextIntel.group}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={RISK_PILL[nextIntel.pred.congestionRisk]}>{nextIntel.pred.congestionRisk}</Pill>
                  <TrendBadge trend={nextIntel.pred.riskChange} />
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 border-y border-white/[0.05] py-1.5">
                {miniCell('Queue · Now', String(nextIntel.pred.currentQueue))}
                {miniCell('+30s', String(nextIntel.pred.predictedQueue30s), nextIntel.pred.predictedQueue30s > nextIntel.pred.currentQueue ? 'text-ops-amber' : '')}
                {miniCell('+60s', String(nextIntel.pred.predictedQueue60s), nextIntel.pred.predictedQueue60s > nextIntel.pred.currentQueue ? 'text-ops-amber' : '')}
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {miniCell('Density', `${Math.round(nextIntel.pred.currentDensity * 100)}%`)}
                {miniCell('Vehicles', String(nextIntel.pred.currentVehicleCount))}
                {miniCell('History', `${nextIntel.pred.historySamples} SAMPLES`)}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <MicroLabel className="text-slate-600">Prediction Confidence</MicroLabel>
                <span className="font-mono text-[9px] font-semibold tabular text-slate-300">
                  {Math.round(nextIntel.pred.confidence * 100)}%
                </span>
              </div>
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full bg-gradient-to-r from-ops-cyan/60 to-ops-cyan transition-all duration-700"
                  style={{ width: `${Math.round(nextIntel.pred.confidence * 100)}%` }}
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* priority hierarchy */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={11} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">Emergency Priority</MicroLabel>
          </div>
          {corridorOpen && (
            <span className="flex items-center gap-1.5 font-mono text-[7.5px] font-bold tracking-[0.14em] text-emerald-300">
              <Led tone="green" pulse size={4} />
              PRIORITY ACTIVE
            </span>
          )}
        </header>
        <div className="flex flex-col divide-y divide-white/[0.04] px-3 py-1">
          <div className="flex items-center gap-2.5 py-[6px]">
            <span className="font-mono text-[8px] font-bold text-slate-600">1</span>
            <Led tone={corridorOpen ? 'green' : 'slate'} pulse={corridorOpen} size={5} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className={cn('font-mono text-[9px] font-bold uppercase tracking-[0.14em]', corridorOpen ? 'text-emerald-300' : 'text-slate-300')}>
                Corridor
              </div>
              <div className="truncate font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {corridorOpen ? 'OVERRIDES ALL OPTIMIZATION' : 'DOMINANT WHEN ACTIVE'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 py-[6px]">
            <span className="font-mono text-[8px] font-bold text-slate-600">2</span>
            <Led tone={mode === 'greenwave' && !corridorOpen ? 'cyan' : 'slate'} pulse={mode === 'greenwave' && !corridorOpen} size={5} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">
                Adaptive Signal
              </div>
              <div className="truncate font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {mode === 'greenwave' ? 'PRESSURE-BASED · GREENWAVE' : 'FIXED-TIME BASELINE'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 py-[6px]">
            <span className="font-mono text-[8px] font-bold text-slate-600">3</span>
            <Led tone="slate" size={5} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">
                Predictive Bias
              </div>
              <div className="truncate font-mono text-[7px] tracking-[0.08em] text-slate-600">
                {corridorOpen ? 'SUPPORT ONLY · CANNOT OVERRIDE' : 'BOUNDED ADJUSTMENT'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </motion.aside>
  )
}

/* ------------------------------------------------------------------ */
/* map legend (corridors view)                                         */
/* ------------------------------------------------------------------ */

const LEGEND_ROWS = [
  { dot: <span className="h-[7px] w-[7px] rounded-full border border-ops-cyan bg-ops-cyan/20 shadow-[0_0_6px_rgba(56,196,224,0.5)]" />, label: 'Unit' },
  { dot: <span className="h-[2px] w-[14px] rounded-full bg-slate-400/80" />, label: 'Route' },
  { dot: <span className="h-[7px] w-[7px] rounded-full bg-emerald-400 shadow-[0_0_6px_#2fe08a] animate-soft-pulse" />, label: 'Green Held' },
  { dot: <span className="h-[7px] w-[7px] rounded-full border border-ops-amber bg-ops-amber/20" />, label: 'Preparing' },
  { dot: <span className="h-[7px] w-[7px] rounded-full border border-white/25 bg-white/[0.04]" />, label: 'Passed' },
  { dot: <span className="flex h-[7px] w-[7px] items-center justify-center text-[6px] leading-none text-slate-400">✚</span>, label: 'Destination' },
]

export function CorridorsLegend({ className }: { className?: string }) {
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
      <MicroLabel className="text-slate-500">Corridor Wave</MicroLabel>
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
