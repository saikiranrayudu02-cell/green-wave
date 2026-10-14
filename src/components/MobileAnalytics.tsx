import { motion } from 'framer-motion'
import { BarChart3, Activity, Gauge, Timer, Siren, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { Led, MicroLabel, Pill } from './ui'
import { cn } from '../lib/cn'
import { modeAggregates, analyticsStatus, MIN_MODE_SAMPLES, analyticsSamples, compareMetric } from '../engine/analyticsRecorder'
import { DISPLAY_SIGNAL_IDS } from '../data/osmRoadNetwork'
import { signalStates } from '../engine/signalState'
import type { Mode } from '../types'
import type { AnalyticsSample } from '../types/analytics'

function fmt(n: number | null, digits = 1): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits)
}

function fmtInt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : String(Math.round(n))
}

function DeltaMark({ c, tradeoff = false }: { c: NonNullable<ReturnType<typeof compareMetric>> | null; tradeoff?: boolean }) {
  if (!c || c.changePct == null) return <span className="text-slate-600">—</span>
  const up = c.changePct >= 0
  const tone = up ? 'text-emerald-300' : tradeoff ? 'text-ops-amber' : 'text-ops-red'
  return (
    <span className={cn('flex items-center gap-1', tone)}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {pct(c)}
    </span>
  )
}

function pct(c: NonNullable<ReturnType<typeof compareMetric>>): string {
  if (c.changePct == null || !Number.isFinite(c.changePct)) return '—'
  return `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(1)}%`
}

function ComparisonRow({
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
  tradeoff?: boolean
}) {
  const c = compareMetric(fixed, gw, dir)
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.05] px-2.5 py-2">
      <div className="flex-1 min-w-[120px]">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</div>
        <div className="text-[6.5px] uppercase tracking-[0.12em] text-slate-700">
          {dir === 'LOWER_IS_BETTER' ? '↓ lower better' : '↑ higher better'}
        </div>
      </div>
      <div className="w-14 text-right font-mono text-[10px] font-semibold tabular text-ops-cyan">{fmtFn(fixed)}</div>
      <div className="w-14 text-right font-mono text-[10px] font-semibold tabular text-emerald-300">{fmtFn(gw)}</div>
      <div className="w-20 text-right"><DeltaMark c={c} tradeoff={tradeoff} /></div>
    </div>
  )
}

function ChartRow({ title, icon, data, fixedWord, gwWord }: {
  title: string
  icon: React.ReactNode
  data: { t: number; fixed: number | null; gw: number | null }[]
  fixedWord: string
  gwWord: string
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-white/[0.06] bg-night-900 px-3 py-3 text-center">
        <div className="flex items-center justify-center gap-2 text-slate-600">
          <Led tone="slate" size={5} />
          <span className="font-mono text-[7.5px] uppercase tracking-[0.14em]">building from live observations</span>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-white/[0.06] bg-night-900 px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <MicroLabel className="text-slate-400">{title}</MicroLabel>
        </div>
        <span className="font-mono text-[6.5px] tracking-[0.12em] text-slate-600">{fixedWord} · {gwWord}</span>
      </div>
      <div className="mt-2 h-[72px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
            <Area
              type="monotone"
              dataKey="fixed"
              stroke="#38c4e0"
              strokeWidth={1.2}
              fill="rgba(56,196,224,0.12)"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="gw"
              stroke="#2fe08a"
              strokeWidth={1.2}
              fill="rgba(47,224,138,0.10)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex items-center justify-between text-[6.5px] font-mono text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 bg-ops-cyan" /> FIXED</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 bg-emerald-400" /> GREENWAVE</span>
      </div>
    </div>
  )
}

function series(sel: (s: AnalyticsSample) => number, samples: readonly AnalyticsSample[]) {
  const recent = samples.slice(-360)
  return recent.map((s) => ({
    t: s.t,
    fixed: s.mode === 'FIXED' ? sel(s) : null,
    gw: s.mode === 'GREENWAVE' ? sel(s) : null,
  }))
}

export default function MobileAnalytics({ mode, incident }: { mode: Mode; incident: { junctionId: string; severity: string } | null }) {


  const agg = modeAggregates()
  const status = analyticsStatus()
  const samples = analyticsSamples()

  const waitSeries = series((s) => s.avgWaitSec, samples)
  const speedSeries = series((s) => s.avgSpeedKmh, samples)
  const queueSeries = series((s) => s.queueTotal, samples)
  const tpSeries = series((s) => s.ratePerHour, samples)

  const st: Record<string, string> = {
    NO_DATA: 'NO ANALYTICS DATA',
    COLLECTING_BASELINE: 'COLLECTING BASELINE',
    BASELINE_READY: 'BASELINE READY',
    COLLECTING_GREENWAVE: 'COLLECTING GREENWAVE',
    INSUFFICIENT_DATA: 'COMPARISON INSUFFICIENT',
    COMPARISON_READY: 'COMPARISON READY',
  }
  const statusLabel = st[status] ?? status

  const stTone: 'green' | 'cyan' | 'amber' | 'slate' =
    status === 'COMPARISON_READY' ? 'green' :
    status === 'NO_DATA' ? 'slate' :
    status === 'INSUFFICIENT_DATA' ? 'amber' :
    status === 'COLLECTING_BASELINE' || status === 'BASELINE_READY' || status === 'COLLECTING_GREENWAVE' ? 'cyan' :
    'slate'
  const adaptive = signalStates().filter((s) => s.control === 'ADAPTIVE').length

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4 pt-2 pb-[76px]">
      {/* header strip */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-white/[0.05] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06]">
              <BarChart3 size={12} className="text-ops-cyan" />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-100">Traffic Analytics</div>
              <div className="mt-0.5 font-mono text-[7px] uppercase tracking-[0.16em] text-slate-600">performance & operational intelligence</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Led tone={stTone} pulse={stTone !== 'slate'} size={5} />
            <span className={cn(
              'font-mono text-[8px] font-bold uppercase tracking-[0.14em]',
              stTone === 'green' ? 'text-emerald-300' : stTone === 'amber' ? 'text-ops-amber' : stTone === 'cyan' ? 'text-ops-cyan' : 'text-slate-300'
            )}>
              {statusLabel}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 text-[7px] font-mono text-slate-600">
          <span>session samples: {fmtInt(samples.length)}</span>
          <span>min samples per mode: {MIN_MODE_SAMPLES}</span>
          <span>control: {mode === 'greenwave' ? 'GREENWAVE' : 'FIXED TIMING'}</span>
          <span>adaptive signals: {adaptive}/{DISPLAY_SIGNAL_IDS.length}</span>
        </div>
      </motion.div>

      {/* comparison table */}
      <div className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden">
        <div className="border-b border-white/[0.05] px-3.5 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={11} className="text-ops-cyan/90" />
              <MicroLabel className="text-slate-400">Performance Comparison</MicroLabel>
            </div>
            <Pill tone={status === 'COMPARISON_READY' ? 'green' : status === 'NO_DATA' ? 'slate' : 'amber'}>
              {status === 'COMPARISON_READY' ? 'COMPARISON' : status === 'NO_DATA' ? 'NO DATA' : 'COLLECTING'}
            </Pill>
          </div>
        </div>
        <div className="px-3 py-3">
          <div className="grid grid-cols-3 gap-2 px-2 py-1.5 font-mono text-[6.5px] uppercase tracking-[0.14em] text-slate-600 border-b border-white/[0.06] bg-white/[0.015]">
            <span>Metric</span>
            <span className="text-right">Fixed</span>
            <span className="text-right">GreenWave</span>
          </div>
          <ComparisonRow label="Average Wait" dir="LOWER_IS_BETTER" fixed={agg.fixed.avgWaitSec} gw={agg.greenwave.avgWaitSec} fmtFn={(n) => `${fmt(n)} s`} tradeoff />
          <ComparisonRow label="Avg Speed" dir="HIGHER_IS_BETTER" fixed={agg.fixed.avgSpeedKmh} gw={agg.greenwave.avgSpeedKmh} fmtFn={(n) => `${fmt(n)} km/h`} tradeoff />
          <ComparisonRow label="Stopped Vehicles" dir="LOWER_IS_BETTER" fixed={agg.fixed.stoppedVehicles} gw={agg.greenwave.stoppedVehicles} fmtFn={fmtInt} tradeoff />
          <ComparisonRow label="Avg Queue" dir="LOWER_IS_BETTER" fixed={agg.fixed.queueTotal} gw={agg.greenwave.queueTotal} fmtFn={fmtInt} tradeoff />
          <ComparisonRow label="Max Queue" dir="LOWER_IS_BETTER" fixed={agg.fixed.maxQueue} gw={agg.greenwave.maxQueue} fmtFn={fmtInt} tradeoff />
          <ComparisonRow label="Throughput" dir="HIGHER_IS_BETTER" fixed={agg.fixed.ratePerHour} gw={agg.greenwave.ratePerHour} fmtFn={(n) => `${fmtInt(n)}/hr`} tradeoff />
          <div className="mt-2 px-1 text-[6.5px] leading-relaxed font-mono text-slate-600">
            SESSION COMPARISON — baseline and optimized samples were recorded while each control mode was actually running. A change is only shown once {MIN_MODE_SAMPLES}+ real samples exist for both modes. Network-wide rows may temporarily rise while an emergency corridor is prioritized; an amber Δ marks that deliberate trade-off.
          </div>
        </div>
      </div>

      {/* charts */}
      <div className="flex flex-col gap-3">
        <ChartRow
          title="Wait Time"
          icon={<Timer size={11} className="text-ops-cyan/90" />}
          data={waitSeries}
          fixedWord={`FIXED ${fmt(agg.fixed.avgWaitSec)}s`}
          gwWord={`GREENWAVE ${fmt(agg.greenwave.avgWaitSec)}s`}
        />
        <ChartRow
          title="Network Speed"
          icon={<Gauge size={11} className="text-ops-cyan/90" />}
          data={speedSeries}
          fixedWord={`FIXED ${fmt(agg.fixed.avgSpeedKmh)} km/h`}
          gwWord={`GREENWAVE ${fmt(agg.greenwave.avgSpeedKmh)} km/h`}
        />
        <ChartRow
          title="Queue Length"
          icon={<Activity size={11} className="text-ops-cyan/90" />}
          data={queueSeries}
          fixedWord={`FIXED ${fmtInt(agg.fixed.queueTotal)}`}
          gwWord={`GREENWAVE ${fmtInt(agg.greenwave.queueTotal)}`}
        />
        <ChartRow
          title="Throughput"
          icon={<BarChart3 size={11} className="text-ops-cyan/90" />}
          data={tpSeries}
          fixedWord={`FIXED ${fmtInt(agg.fixed.ratePerHour)}/hr`}
          gwWord={`GREENWAVE ${fmtInt(agg.greenwave.ratePerHour)}/hr`}
        />
      </div>

      {/* emergency SLA + incident */}
      <div className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden">
        <div className="border-b border-white/[0.05] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <Siren size={11} className="text-emerald-400/90" />
            <MicroLabel className="text-slate-400">Emergency Analytics</MicroLabel>
          </div>
        </div>
        <div className="px-3.5 py-3">
          {agg.fixed.emergencyEtaSec == null && agg.greenwave.emergencyEtaSec == null ? (
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-slate-500">
                <AlertTriangle size={12} />
                <span className="font-mono text-[8px] uppercase tracking-[0.14em]">no emergency measurements</span>
              </div>
              <div className="mt-1 text-[7.5px] font-mono text-slate-600">Dispatch a unit while the recorder is sampling to capture real baseline / GreenWave ETA comparisons.</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
                <MicroLabel className="text-slate-600">Baseline ETA</MicroLabel>
                <div className="mt-0.5 font-mono text-[13px] font-semibold tabular text-ops-cyan">{fmt(agg.fixed.emergencyEtaSec)} s</div>
              </div>
              <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
                <MicroLabel className="text-slate-600">GreenWave ETA</MicroLabel>
                <div className="mt-0.5 font-mono text-[13px] font-semibold tabular text-emerald-300">{fmt(agg.greenwave.emergencyEtaSec)} s</div>
              </div>
              <div className="rounded-[4px] border border-emerald-400/25 bg-emerald-400/[0.04] px-2.5 py-2">
                <MicroLabel className="text-emerald-300">Saved</MicroLabel>
                <div className="mt-0.5 font-mono text-[13px] font-semibold tabular text-emerald-300">
                  {agg.fixed.emergencySavedSec != null && agg.fixed.emergencySavedSec > 0
                    ? `-${fmt(agg.fixed.emergencySavedSec)} s`
                    : '—'}
                </div>
              </div>
            </div>
          )}
          <div className="mt-2 rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
            <div className="font-mono text-[8.5px] text-slate-600">
              Real per-run corridor measurements (baselineSec / etaSec / savedSec) averaged over samples recorded while a unit was en route.
            </div>
          </div>
        </div>
      </div>

      {/* incident intelligence */}
      {incident && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-ops-red/30 bg-ops-red/[0.06] px-3.5 py-3"
        >
          <div className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-ops-red/30 bg-ops-red/[0.08] text-ops-red">
              <AlertTriangle size={13} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-ops-red">Incident Active</div>
              <div className="mt-0.5 font-mono text-[10.5px] font-medium text-slate-200">{incident.severity.toUpperCase()}</div>
              <div className="mt-1 text-[8px] font-mono text-slate-600">Location: {incident.junctionId}</div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="flex flex-wrap gap-2 text-[6.5px] font-mono uppercase tracking-[0.14em] text-slate-600">
        <span className="flex items-center gap-1">FIXED TIMING</span>
        <span className="text-slate-700">/</span>
        <span className="flex items-center gap-1">GREENWAVE</span>
        <span className="text-slate-700">·</span>
        <span>samples are recorded live; no invented performance claims.</span>
      </div>
    </div>
  )
}

