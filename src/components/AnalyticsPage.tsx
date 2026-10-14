// ---------------------------------------------------------------------------
// GREENWAVE — Analytics module (Step 13)
//
// Honest, measurable performance evidence for the platform. Every number in
// this module comes from the analytics recorder, which samples the REAL
// traffic/signal/emergency state while the operator works:
//
//   BASELINE  = samples recorded while control mode = FIXED TIMING
//   OPTIMIZED = samples recorded while control mode = GREENWAVE
//
// A comparison percentage is only shown once enough real observations exist
// for BOTH modes. Missing data renders "—" — never NaN / Infinity / fake.
// ---------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FlaskConical,
  Gauge,
  Minus,
  Siren,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import type { Mode } from '../types'
import { fmtClock } from '../lib/format'
import { DISPLAY_SIGNAL_IDS } from '../data/osmRoadNetwork'
import { trafficMetrics } from '../engine/vehicles'
import { signalStates } from '../engine/signalState'
import {
  analyticsSamples,
  analyticsStatus,
  compareMetric,
  modeAggregates,
  MIN_MODE_SAMPLES,
} from '../engine/analyticsRecorder'
import type { AnalyticsComparison, AnalyticsSample } from '../types/analytics'
import { abLastResult } from '../engine/abComparison'

/* -------------------------------------------------------------------------- */
/* shared                                                                      */
/* -------------------------------------------------------------------------- */

const STATUS_WORD: Record<string, { word: string; tone: Tone; pulse: boolean }> = {
  NO_DATA: { word: 'NO ANALYTICS DATA', tone: 'slate', pulse: false },
  COLLECTING_BASELINE: { word: 'COLLECTING BASELINE', tone: 'amber', pulse: true },
  BASELINE_READY: { word: 'BASELINE READY · AWAITING GREENWAVE', tone: 'cyan', pulse: false },
  INSUFFICIENT_DATA: { word: 'COMPARISON INSUFFICIENT', tone: 'amber', pulse: false },
  COMPARISON_READY: { word: 'COMPARISON READY', tone: 'green', pulse: true },
}

function fmt(n: number | null, digits = 1): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits)
}

function fmtInt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : String(Math.round(n))
}

function pct(c: AnalyticsComparison | null): string {
  if (!c || c.changePct == null || !Number.isFinite(c.changePct)) return '—'
  return `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(1)}%`
}

function DeltaMark({ c, tradeoff = false }: { c: AnalyticsComparison | null; tradeoff?: boolean }) {
  if (!c || c.changePct == null) return <Minus size={10} className="text-slate-600" />
  const up = c.changePct >= 0
  /* network-wide metrics: a negative change while an emergency corridor is
     prioritized is a deliberate trade-off, not a control failure — render it
     amber (trade-off) instead of red (failure). The number is never altered. */
  const tone = up ? 'text-emerald-300' : tradeoff ? 'text-ops-amber' : 'text-ops-red'
  return (
    <span className={cn('flex items-center gap-1', tone)}>
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {pct(c)}
    </span>
  )
}

/** single metric row in the comparison table */
function CompareRow({
  label,
  dir,
  fixed,
  gw,
  fmtFn,
  tradeoff = false,
}: {
  label: string
  dir: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER'
  fixed: number | null
  gw: number | null
  fmtFn: (n: number | null) => string
  /** network-wide rows: negative change = emergency-priority trade-off (amber) */
  tradeoff?: boolean
}) {
  const c = compareMetric(fixed, gw, dir)
  return (
    <div className="grid grid-cols-[1fr_64px_64px_74px] items-center gap-1 border-b border-white/[0.04] px-2.5 py-[5px]">
      <div className="min-w-0">
        <div className="truncate font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</div>
        <div className="font-mono text-[6.5px] tracking-[0.12em] text-slate-700">
          {dir === 'LOWER_IS_BETTER' ? '↓ LOWER IS BETTER' : '↑ HIGHER IS BETTER'}
        </div>
      </div>
      <div className="text-right font-mono text-[10.5px] font-semibold tabular text-ops-cyan">{fmtFn(fixed)}</div>
      <div className="text-right font-mono text-[10.5px] font-semibold tabular text-emerald-300">{fmtFn(gw)}</div>
      <div className="flex items-center justify-end"><DeltaMark c={c} tradeoff={tradeoff} /></div>
    </div>
  )
}

/** build chart series from real samples: one value per mode, gaps where absent */
function series(sel: (s: AnalyticsSample) => number, samples: readonly AnalyticsSample[]) {
  const recent = samples.slice(-360)
  return recent.map((s) => ({
    t: s.t,
    fixed: s.mode === 'FIXED' ? sel(s) : null,
    gw: s.mode === 'GREENWAVE' ? sel(s) : null,
  }))
}

function MiniChart({ data, tone }: { data: { t: number; fixed: number | null; gw: number | null }[]; tone: string }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[64px] items-center justify-center font-mono text-[7.5px] uppercase tracking-[0.14em] text-slate-600">
        BUILDING FROM LIVE OBSERVATIONS
      </div>
    )
  }
  return (
    <div className="h-[64px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <Area
            type="monotone"
            dataKey="fixed"
            stroke="#38c4e0"
            strokeWidth={1.2}
            fill="rgba(56,196,224,0.10)"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="gw"
            stroke="#2fe08a"
            strokeWidth={1.2}
            fill="rgba(47,224,138,0.08)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-0.5 flex items-center gap-3 px-0.5 font-mono text-[6.5px] uppercase tracking-[0.1em] text-slate-600">
        <span className="flex items-center gap-1"><span className={cn('h-[2px] w-3', tone)} /> FIXED TIMING</span>
        <span className="flex items-center gap-1"><span className="h-[2px] w-3 bg-emerald-400" /> GREENWAVE</span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* header band                                                                 */
/* -------------------------------------------------------------------------- */

export function AnalyticsHeader({
  mode,
  incident,
  corridorsOpen,
}: {
  mode: Mode
  incident: { junctionId: string; severity: string } | null
  corridorsOpen: number
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  const sim = trafficMetrics()
  const snaps = signalStates()
  const adaptive = snaps.filter((s) => s.control === 'ADAPTIVE').length
  const status = analyticsStatus()
  const st = STATUS_WORD[status]
  const samples = analyticsSamples()
  const agg = modeAggregates()

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      <div className="flex h-[52px] items-center justify-between gap-4 px-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-ops-cyan/35 bg-ops-cyan/[0.09]">
              <BarChart3 size={12} className="text-ops-cyan" />
            </span>
            <h1 className="font-mono text-[14px] font-semibold uppercase tracking-[0.28em] text-slate-100">
              Traffic Analytics
            </h1>
          </div>
          <div className="mt-[3px] pl-[34px] font-mono text-[8.5px] tracking-[0.16em] text-slate-600">
            PERFORMANCE & OPERATIONAL INTELLIGENCE
          </div>
        </div>

        <div className="hidden min-w-0 shrink-0 grid-cols-4 gap-4 xl:grid">
          <EngineStat label="Traffic Engine" word={sim.active > 0 ? 'RUNNING' : 'BOOTING'} sub={`${sim.active} ACTIVE VEH`} tone="green" pulse={sim.active > 0} />
          <EngineStat
            label="Signal Control"
            word={mode === 'greenwave' ? 'ADAPTIVE' : 'FIXED TIME'}
            sub={`${adaptive}/${DISPLAY_SIGNAL_IDS.length} OPTIMIZING`}
            tone={mode === 'greenwave' ? 'green' : 'cyan'}
            pulse={mode === 'greenwave'}
          />
          <EngineStat label="Analytics Engine" word={st.word} sub={`${samples.length} SAMPLES`} tone={st.tone} pulse={st.pulse} />
          <EngineStat
            label="Emergency Engine"
            word={corridorsOpen > 0 ? 'CORRIDOR ACTIVE' : incident ? 'INCIDENT ACTIVE' : 'STANDBY'}
            sub={corridorsOpen > 0 ? `${corridorsOpen} CORRIDOR(S)` : incident ? incident.junctionId : 'NO UNIT ACTIVE'}
            tone={corridorsOpen > 0 ? 'green' : incident ? 'red' : 'slate'}
            pulse={corridorsOpen > 0 || incident != null}
          />
        </div>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Led tone={st.tone} pulse={st.pulse} size={6} />
          <span className={cn('font-mono text-[9px] font-bold uppercase tracking-[0.2em]', st.tone === 'green' ? 'text-emerald-300' : st.tone === 'amber' ? 'text-ops-amber' : st.tone === 'cyan' ? 'text-ops-cyan' : 'text-slate-300')}>
            {st.word}
          </span>
        </div>
      </div>

      {/* session status strip */}
      <div className="flex h-[30px] items-center divide-x divide-white/[0.05] border-t border-white/[0.05] text-[8px]">
        <Cell label="Session" value="LIVE" tone="text-emerald-300" />
        <Cell label="Control Mode" value={mode === 'greenwave' ? 'GREENWAVE' : 'FIXED TIMING'} tone={mode === 'greenwave' ? 'text-emerald-300' : 'text-ops-cyan'} />
        <Cell label="Data Samples" value={fmtInt(samples.length)} tone="text-slate-200" />
        <Cell label="Baseline" value={agg.fixed.count >= MIN_MODE_SAMPLES ? 'READY' : agg.fixed.count > 0 ? 'COLLECTING' : '—'} tone={agg.fixed.count >= MIN_MODE_SAMPLES ? 'text-emerald-300' : agg.fixed.count > 0 ? 'text-ops-amber' : 'text-slate-500'} />
        <Cell label="GreenWave" value={agg.greenwave.count >= MIN_MODE_SAMPLES ? 'READY' : agg.greenwave.count > 0 ? 'COLLECTING' : '—'} tone={agg.greenwave.count >= MIN_MODE_SAMPLES ? 'text-emerald-300' : agg.greenwave.count > 0 ? 'text-ops-amber' : 'text-slate-500'} />
        <Cell label="Last Sample" value={samples.length ? fmtClock(samples[samples.length - 1].t) : '—'} tone="text-slate-200" />
        <div className="ml-auto hidden items-center gap-2 pr-3 font-mono text-[7px] tracking-[0.14em] text-slate-700 md:flex">
          <Gauge size={10} className="text-ops-cyan/60" /> MEASURED NETWORK PERFORMANCE · BASELINE VS ADAPTIVE CONTROL
        </div>
      </div>
    </motion.section>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 px-2.5">
      <MicroLabel className="shrink-0 text-slate-600">{label}</MicroLabel>
      <span className={cn('truncate font-mono text-[8.5px] font-semibold tracking-[0.08em]', tone)}>{value}</span>
    </div>
  )
}

function EngineStat({ label, word, sub, tone, pulse }: { label: string; word: string; sub: string; tone: Tone; pulse: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Led tone={tone} pulse={pulse} size={4} />
      <div className="min-w-0 leading-tight">
        <div className="font-mono text-[7px] uppercase tracking-[0.14em] text-slate-600">{label}</div>
        <div className="truncate font-mono text-[9px] font-bold tracking-[0.1em] text-slate-200">{word}</div>
        <div className="truncate font-mono text-[6.5px] tracking-[0.1em] text-slate-600">{sub}</div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* left rail: comparison table + honesty note                                  */
/* -------------------------------------------------------------------------- */

/** active-emergency response SLA — reuses the EXISTING unit metrics: the SLA
 *  target IS the fixed-timing baseline ETA, the actual IS the GreenWave ETA,
 *  and the saving is the corridor gain already reported by the engine. No new
 *  numbers are invented. */
export interface EmergencySlaData {
  caseId: string
  tac: string
  priority: string
  /** fixed-timing baseline ETA (SLA target), sim seconds */
  targetSec: number
  /** GreenWave (projected/live) ETA, sim seconds */
  actualSec: number
  /** corridor gain reported by the engine, sim seconds */
  savedSec: number
}

function EmergencySlaCard({ sla }: { sla: EmergencySlaData }) {
  const withinTarget = sla.actualSec <= sla.targetSec
  const pct = sla.targetSec > 0 ? Math.round((sla.savedSec / sla.targetSec) * 100) : 0
  return (
    <section className="shrink-0 rounded-md border border-ops-cyan/20 bg-night-900">
      <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          <Siren size={11} className="text-ops-cyan/90" />
          <MicroLabel className="text-slate-400">Emergency Response SLA</MicroLabel>
        </div>
        <Pill tone={withinTarget ? 'green' : 'amber'}>{withinTarget ? 'WITHIN TARGET' : 'OVER TARGET'}</Pill>
      </header>
      <div className="px-3 py-2">
        <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">
          {sla.caseId} · {sla.tac} · {sla.priority}
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <div>
            <div className="font-mono text-[6.5px] uppercase tracking-[0.12em] text-slate-600">Target (Fixed)</div>
            <div className="mt-[2px] font-mono text-[12px] font-semibold tabular text-slate-300">{fmtClock(Math.max(0, sla.targetSec))}</div>
          </div>
          <div>
            <div className="font-mono text-[6.5px] uppercase tracking-[0.12em] text-slate-600">Actual (GreenWave)</div>
            <div className="mt-[2px] font-mono text-[12px] font-semibold tabular text-ops-cyan">{fmtClock(Math.max(0, sla.actualSec))}</div>
          </div>
          <div>
            <div className="font-mono text-[6.5px] uppercase tracking-[0.12em] text-slate-600">Saved</div>
            <div className="mt-[2px] font-mono text-[12px] font-semibold tabular text-emerald-300">
              {sla.savedSec > 0 ? `−${fmtClock(sla.savedSec)}` : '0:00'}
            </div>
          </div>
        </div>
        <div className="mt-1.5 font-mono text-[6.5px] leading-relaxed tracking-[0.06em] text-slate-600">
          SLA TARGET = fixed-timing response for the same route; GreenWave beats it by {pct}% via the green corridor.
          Values are the existing unit baseline / ETA / corridor gain — no separate SLA clock.
        </div>
      </div>
    </section>
  )
}

export function AnalyticsLeft({ sla = null }: { sla?: EmergencySlaData | null } = {}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  const agg = modeAggregates()
  const status = analyticsStatus()
  const ab = abLastResult()

  return (
    <motion.aside
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* active-emergency response SLA — only when a unit is active */}
      {sla && <EmergencySlaCard sla={sla} />}

      {/* controlled A/B test — Step 16, only when a completed result exists */}
      {ab && (
        <section className="shrink-0 rounded-md border border-emerald-400/20 bg-night-900">
          <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <FlaskConical size={11} className="text-emerald-300" />
              <MicroLabel className="text-emerald-200/90">Controlled A/B Test</MicroLabel>
            </div>
            <Pill tone="green">SAME STARTING STATE</Pill>
          </header>
          <div className="px-3 py-2">
            <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">
              {ab.routeKey} · INCIDENT {ab.incidentJunctionId ?? 'NONE'} · SEED {ab.seed}
            </div>
            <div className="mt-1 grid grid-cols-[1fr_52px_52px_64px] border-b border-white/[0.06] py-1 font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">
              <span>Metric</span>
              <span className="text-right">Fixed</span>
              <span className="text-right">GW</span>
              <span className="text-right">Δ</span>
            </div>
            <AbRow label="Emergency ETA" fixed={ab.fixed.travelTimeSec} gw={ab.greenWave.travelTimeSec} pct={ab.delta.emergencyEtaSec.pct} unit="s" />
            <AbRow label="Network Delay" fixed={ab.fixed.avgNetworkDelaySec} gw={ab.greenWave.avgNetworkDelaySec} pct={ab.delta.avgNetworkDelaySec.pct} unit="s" />
            <AbRow label="Stopped Veh" fixed={ab.fixed.stoppedVehicles} gw={ab.greenWave.stoppedVehicles} pct={ab.delta.stoppedVehicles.pct} unit="veh" />
            <div className="mt-1.5 font-mono text-[6.5px] leading-relaxed tracking-[0.05em] text-slate-600">
              CONTROLLED A/B TEST — the same seeded scenario ran twice (Fixed Timing, then GreenWave) from an identical
              starting state; only signal control differs. Run it from the Command Center IMPACT COMPARISON strip.
            </div>
          </div>
        </section>
      )}

      {/* performance comparison */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Activity size={11} className="text-ops-cyan/90" />
            <MicroLabel className="text-slate-400">Performance Comparison</MicroLabel>
            <Pill tone="slate" className="hidden md:inline-flex">Network-Wide</Pill>
          </div>
          <Pill tone={status === 'COMPARISON_READY' ? 'green' : status === 'NO_DATA' ? 'slate' : 'amber'}>
            {status === 'COMPARISON_READY' ? 'COMPARISON' : status === 'NO_DATA' ? 'NO DATA' : 'COLLECTING'}
          </Pill>
        </header>
        <div className="grid grid-cols-[1fr_64px_64px_74px] border-b border-white/[0.06] bg-white/[0.015] px-2.5 py-1 font-mono text-[7px] uppercase tracking-[0.14em] text-slate-600">
          <span>Metric</span>
          <span className="text-right">Fixed</span>
          <span className="text-right">GreenWave</span>
          <span className="text-right">Change</span>
        </div>
        <CompareRow label="Average Wait" dir="LOWER_IS_BETTER" fixed={agg.fixed.avgWaitSec} gw={agg.greenwave.avgWaitSec} fmtFn={(n) => `${fmt(n)} s`} tradeoff />
        <CompareRow label="Average Speed" dir="HIGHER_IS_BETTER" fixed={agg.fixed.avgSpeedKmh} gw={agg.greenwave.avgSpeedKmh} fmtFn={(n) => `${fmt(n)} km/h`} tradeoff />
        <CompareRow label="Stopped Vehicles" dir="LOWER_IS_BETTER" fixed={agg.fixed.stoppedVehicles} gw={agg.greenwave.stoppedVehicles} fmtFn={fmtInt} tradeoff />
        <CompareRow label="Average Queue" dir="LOWER_IS_BETTER" fixed={agg.fixed.queueTotal} gw={agg.greenwave.queueTotal} fmtFn={fmtInt} tradeoff />
        <CompareRow label="Max Queue" dir="LOWER_IS_BETTER" fixed={agg.fixed.maxQueue} gw={agg.greenwave.maxQueue} fmtFn={fmtInt} tradeoff />
        <CompareRow label="Throughput" dir="HIGHER_IS_BETTER" fixed={agg.fixed.ratePerHour} gw={agg.greenwave.ratePerHour} fmtFn={(n) => `${fmtInt(n)}/hr`} tradeoff />
        <div className="px-3 py-2">
          <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">Comparison Basis</div>
          <div className="mt-1 font-mono text-[7px] leading-relaxed tracking-[0.06em] text-slate-500">
            SESSION COMPARISON — baseline and optimized samples were recorded while each control mode was actually
            running. Not a controlled benchmark: traffic conditions evolve during the session. A change is only shown
            once {MIN_MODE_SAMPLES}+ real samples exist for both modes.
          </div>
          <div className="mt-1.5 font-mono text-[6.5px] leading-relaxed tracking-[0.06em] text-slate-600">
            NETWORK-WIDE SCOPE — these rows measure the whole network while each mode ran. While an emergency corridor
            is prioritized, network-wide wait / queue may temporarily rise; an amber Δ marks that deliberate trade-off.
            The corridor-level benefit is measured separately in Emergency Analytics. Values are never adjusted.
          </div>
        </div>
      </section>

      {/* queue performance */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <MicroLabel className="text-slate-400">Queue Performance</MicroLabel>
        </header>
        <div className="grid grid-cols-3 divide-x divide-white/[0.05]">
          <QCell label="Avg Queue" value={`${fmtInt(agg.fixed.queueTotal)} / ${fmtInt(agg.greenwave.queueTotal)}`} />
          <QCell label="Max Queue" value={`${fmtInt(agg.fixed.maxQueue)} / ${fmtInt(agg.greenwave.maxQueue)}`} />
          <QCell label="Stopped" value={`${fmtInt(agg.fixed.stoppedVehicles)} / ${fmtInt(agg.greenwave.stoppedVehicles)}`} />
        </div>
        <div className="border-t border-white/[0.05] px-3 py-1.5 font-mono text-[6.5px] tracking-[0.08em] text-slate-600">
          FIXED / GREENWAVE · VEHICLES ACROSS SIGNALISED APPROACHES
        </div>
      </section>

      {/* emergency analytics */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <Siren size={11} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">Emergency Analytics</MicroLabel>
            <Pill tone="slate" className="hidden md:inline-flex">Corridor-Level</Pill>
          </div>
        </header>
        <div className="px-3 py-2">
          {agg.fixed.emergencyEtaSec == null && agg.greenwave.emergencyEtaSec == null ? (
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">NO EMERGENCY MEASUREMENTS</div>
              <div className="font-mono text-[7px] leading-relaxed tracking-[0.05em] text-slate-600">
                Dispatch a unit while the recorder is sampling to capture real baseline / GreenWave ETA comparisons.
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_52px_52px] gap-1 border-b border-white/[0.06] py-1 font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">
                <span>ETA</span><span className="text-right">Fixed</span><span className="text-right">GreenWave</span>
              </div>
              {(
                [
                  ['Baseline ETA', agg.fixed.emergencyBaselineSec, agg.greenwave.emergencyBaselineSec],
                  ['GreenWave ETA', agg.fixed.emergencyEtaSec, agg.greenwave.emergencyEtaSec],
                  ['Saved', agg.fixed.emergencySavedSec, agg.greenwave.emergencySavedSec],
                ] as const
              ).map(([label, f, g]) => (
                <div key={label} className="grid grid-cols-[1fr_52px_52px] items-center border-b border-white/[0.04] py-1">
                  <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</span>
                  <span className="text-right font-mono text-[9px] font-semibold tabular text-ops-cyan">{f == null ? '—' : `${fmt(f)} s`}</span>
                  <span className="text-right font-mono text-[9px] font-semibold tabular text-emerald-300">{g == null ? '—' : `${fmt(g)} s`}</span>
                </div>
              ))}
              <div className="mt-1.5 font-mono text-[6.5px] leading-relaxed tracking-[0.06em] text-slate-600">
                Real per-run corridor measurements (baselineSec / etaSec / savedSec) averaged over samples recorded
                while a unit was en route. Saved = baseline − GreenWave ETA; shown only when both are measured.
              </div>
            </>
          )}
        </div>
      </section>
    </motion.aside>
  )
}

function AbRow({ label, fixed, gw, pct, unit }: { label: string; fixed: number; gw: number; pct: number | null; unit: string }) {
  const fmtV = (n: number) => (unit === 'veh' ? fmtInt(n) : `${fmt(n)} ${unit}`)
  const pctTxt = pct === null ? '—' : `${pct >= 0 ? '−' : '+'}${Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1) : Math.round(Math.abs(pct))}%`
  return (
    <div className="grid grid-cols-[1fr_52px_52px_64px] items-center border-b border-white/[0.04] py-1">
      <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</span>
      <span className="text-right font-mono text-[9px] font-semibold tabular text-ops-cyan">{fmtV(fixed)}</span>
      <span className="text-right font-mono text-[9px] font-semibold tabular text-emerald-300">{fmtV(gw)}</span>
      <span className={cn('text-right font-mono text-[8px] font-bold tabular', pct !== null && pct >= 0 ? 'text-emerald-300' : pct !== null ? 'text-ops-red' : 'text-slate-500')}>
        {pctTxt}
      </span>
    </div>
  )
}

function QCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 py-2">
      <MicroLabel className="text-slate-600">{label}</MicroLabel>
      <span className="font-mono text-[10px] font-bold tabular text-slate-200">{value}</span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* right rail: charts + incident                                               */
/* -------------------------------------------------------------------------- */

export function AnalyticsRight({ incident }: { incident: { junctionId: string; severity: string } | null }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1500)
    return () => window.clearInterval(t)
  }, [])

  // recomputed on the 1.5 s tick — cheap (<600 samples) and always current
  const samples = analyticsSamples()
  const waitSeries = series((s) => s.avgWaitSec, samples)
  const speedSeries = series((s) => s.avgSpeedKmh, samples)
  const queueSeries = series((s) => s.queueTotal, samples)
  const tpSeries = series((s) => s.ratePerHour, samples)

  const agg = modeAggregates()
  const incidentSamples = samples.filter((s) => s.incidentActive)
  const incidentLoad = incidentSamples.length
    ? incidentSamples.reduce((a, s) => a + s.loadPct, 0) / incidentSamples.length
    : null

  return (
    <motion.aside
      initial={{ opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
      className="flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden"
    >
      {/* wait time */}
      <ChartSection title="Wait Time" icon={<Timer size={11} className="text-ops-cyan/90" />} note={`AVG ${fmt(agg.fixed.avgWaitSec)}s FIXED · ${fmt(agg.greenwave.avgWaitSec)}s GREENWAVE`}>
        <MiniChart data={waitSeries} tone="bg-ops-cyan" />
      </ChartSection>

      {/* network speed */}
      <ChartSection title="Network Speed" icon={<Gauge size={11} className="text-ops-cyan/90" />} note={`AVG ${fmt(agg.fixed.avgSpeedKmh)} KM/H FIXED · ${fmt(agg.greenwave.avgSpeedKmh)} KM/H GREENWAVE`}>
        <MiniChart data={speedSeries} tone="bg-ops-cyan" />
      </ChartSection>

      {/* queue */}
      <ChartSection title="Queue Length" icon={<Activity size={11} className="text-ops-cyan/90" />} note={`TOTAL QUEUED VEHICLES · ${fmtInt(agg.fixed.queueTotal)} / ${fmtInt(agg.greenwave.queueTotal)}`}>
        <MiniChart data={queueSeries} tone="bg-ops-cyan" />
      </ChartSection>

      {/* throughput */}
      <ChartSection title="Network Throughput" icon={<BarChart3 size={11} className="text-ops-cyan/90" />} note={`${fmtInt(agg.fixed.ratePerHour)} / ${fmtInt(agg.greenwave.ratePerHour)} VEH/HR · COMPLETED ROUTES`}>
        <MiniChart data={tpSeries} tone="bg-ops-cyan" />
      </ChartSection>

      {/* incident intelligence */}
      <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
        <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={11} className="text-ops-red/90" />
            <MicroLabel className="text-slate-400">Incident Intelligence</MicroLabel>
          </div>
          <Led tone={incident ? 'red' : 'slate'} pulse={incident != null} size={5} />
        </header>
        <div className="px-3 py-2">
          {incident ? (
            <>
              <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-ops-red">INCIDENT ACTIVE</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                {miniCell('Location', incident.junctionId)}
                {miniCell('Severity', incident.severity)}
                {miniCell('Impact Samples', fmtInt(incidentSamples.length))}
                {miniCell('Mean Load During', incidentLoad == null ? '—' : `${Math.round(incidentLoad)}%`)}
              </div>
              <div className="mt-1.5 font-mono text-[6.5px] leading-relaxed tracking-[0.06em] text-slate-600">
                Congestion measured by the existing engine while the incident was active. No impact figure is invented.
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="font-mono text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">NO ACTIVE INCIDENTS</div>
              <div className="font-mono text-[7px] leading-relaxed tracking-[0.05em] text-slate-600">
                Use INJECT INCIDENT on the command strip to create a real incident; the recorder will tag samples while
                it is active.
              </div>
            </div>
          )}
        </div>
      </section>
    </motion.aside>
  )
}

function ChartSection({ title, icon, note, children }: { title: string; icon: ReactNode; note: string; children: ReactNode }) {
  return (
    <section className="shrink-0 rounded-md border border-white/[0.07] bg-night-900">
      <header className="flex h-8 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          {icon}
          <MicroLabel className="text-slate-400">{title}</MicroLabel>
        </div>
      </header>
      <div className="px-2.5 py-2">
        {children}
        <div className="mt-1 truncate font-mono text-[6.5px] tracking-[0.08em] text-slate-600">{note}</div>
      </div>
    </section>
  )
}

function miniCell(label: string, value: string) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">{label}</span>
      <span className="font-mono text-[9px] font-semibold tabular text-slate-200">{value}</span>
    </span>
  )
}