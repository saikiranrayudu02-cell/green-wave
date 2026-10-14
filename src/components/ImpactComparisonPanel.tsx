// ---------------------------------------------------------------------------
// GREENWAVE — Step 16: IMPACT COMPARISON (Command Center)
//
// A compact, collapsible bottom strip proving Fixed Timing vs GreenWave on the
// SAME incident, SAME starting state, SAME ambulance — only signal control
// differs. Every number comes from the A/B runner (engine/abComparison.ts),
// which executes the real vehicles/signals/corridor/prediction engines twice
// from the identical deterministic seed. Nothing is hardcoded; if GreenWave
// measures worse on a metric, the worse number is shown.
// ---------------------------------------------------------------------------
import { motion } from 'framer-motion'
import { ChevronDown, FlaskConical, Play, RotateCcw, Siren } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import type { Tone } from './ui'
import type { ABPhase, ABResult, ABCorridorRow } from '../engine/abComparison'

/* ------------------------------ formatting ------------------------------- */

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmt1(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : '—'
}

function fmt0(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n)) : '—'
}

const deltaTone = (pct: number | null): Tone => {
  if (pct === null) return 'slate'
  return pct >= 0 ? 'green' : 'red'
}

const PHASE_WORD: Record<ABPhase, string> = {
  IDLE: 'READY',
  CAPTURING: 'CAPTURING',
  RUNNING_FIXED: 'RUNNING FIXED TIMING',
  RUNNING_GREENWAVE: 'RUNNING GREENWAVE',
  COMPARING: 'COMPARING',
  COMPLETE: 'IMPACT TEST COMPLETE',
  ERROR: 'IMPACT TEST ERROR',
}

/** pct is ALWAYS positive = GreenWave better; dir decides the displayed sign */
function dirSign(dir: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER', pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  const v = Math.abs(pct)
  const s = v.toFixed(1)
  const better = pct >= 0
  const minus = dir === 'LOWER_IS_BETTER' ? better : !better
  return `${minus ? '−' : '+'}${s}%`
}

function ResultRow({
  label,
  fixed,
  gw,
  pct,
  unit,
  dir,
}: {
  label: string
  fixed: number
  gw: number
  pct: number | null
  unit: string
  dir: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER'
}) {
  return (
    <div className="grid grid-cols-[1fr_84px_84px_110px] items-center gap-2 border-t border-white/[0.05] py-[6px]">
      <span className="truncate font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <span className="text-right font-mono text-[9.5px] font-semibold tabular text-slate-300">
        {`${fmt1(fixed)} ${unit}`}
      </span>
      <span className="text-right font-mono text-[9.5px] font-semibold tabular text-emerald-300">
        {`${fmt1(gw)} ${unit}`}
      </span>
      <span className={cn('text-right font-mono text-[8.5px] font-bold tabular tracking-[0.06em]', deltaTone(pct) === 'green' ? 'text-emerald-300' : deltaTone(pct) === 'red' ? 'text-ops-red' : 'text-slate-500')}>
        {dirSign(dir, pct)}
      </span>
    </div>
  )
}

function corridorChips(rows: ABCorridorRow[]): { junctionId: string; t: number; prepareEta: number }[] {
  // first ~3 junctions that reached GREEN HELD — attach the PREPARING forecast
  const held = new Map<string, ABCorridorRow>()
  for (const r of rows) if (r.kind === 'GREEN HELD' && !held.has(r.junctionId)) held.set(r.junctionId, r)
  const prepare = new Map<string, number>()
  for (const r of rows) if (r.kind === 'PREPARING' && !prepare.has(r.junctionId)) prepare.set(r.junctionId, r.etaSec)
  const out: { junctionId: string; t: number; prepareEta: number }[] = []
  for (const r of rows) {
    if (r.kind === 'GREEN HELD' && held.get(r.junctionId) === r) {
      out.push({ junctionId: r.junctionId, t: r.t, prepareEta: prepare.get(r.junctionId) ?? 0 })
    }
    if (out.length >= 3) break
  }
  return out
}

/* -------------------------------- panel ---------------------------------- */

export default function ImpactComparisonPanel({
  phase,
  result,
  error,
  scenarioLabel,
  onRun,
  onReset,
}: {
  phase: ABPhase
  result: ABResult | null
  error: string | null
  scenarioLabel: string
  onRun: () => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(true)
  const busy = phase === 'CAPTURING' || phase === 'RUNNING_FIXED' || phase === 'RUNNING_GREENWAVE' || phase === 'COMPARING'
  const done = phase === 'COMPLETE' && result !== null

  /* impact statement — generated from measured deltas, never pre-written */
  const statement = (() => {
    if (!result) return null
    const d = result.delta
    const parts: { label: string; pct: number | null; abs: number; lower: boolean }[] = [
      { label: 'EMERGENCY ETA', pct: d.emergencyEtaSec.pct, abs: d.emergencyEtaSec.abs, lower: true },
      { label: 'NETWORK DELAY', pct: d.avgNetworkDelaySec.pct, abs: d.avgNetworkDelaySec.abs, lower: true },
      { label: 'STOPPED VEHICLES', pct: d.stoppedVehicles.pct, abs: d.stoppedVehicles.abs, lower: true },
    ]
    const nonNull = parts.filter((p) => p.pct !== null && Number.isFinite(p.pct))
    if (nonNull.length === 0) return { word: 'INSUFFICIENT MEASUREMENT', detail: 'No comparable baseline measured' }
    const lines = nonNull
      .map((p) => {
        const v = Math.abs(p.pct!)
        const s = v < 10 ? v.toFixed(1) : String(Math.round(v))
        const sign = p.pct! >= 0 ? '−' : '+'
        const absLine = p.lower ? (p.abs !== 0 ? ` · ${sign === '−' ? 'saved' : 'extra'} ${fmt1(Math.abs(p.abs))} ${p.label === 'EMERGENCY ETA' ? 's' : p.label === 'STOPPED VEHICLES' ? 'veh' : 's'}` : '') : ''
        return `${p.label} ${sign}${s}%${absLine}`
      })
      .join('  ·  ')
    const etaBetter = (d.emergencyEtaSec.pct ?? 0) > 0
    return { word: etaBetter ? 'GREENWAVE ADVANTAGE' : 'GREENWAVE RESULT', detail: lines }
  })()

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.15 }}
      className="overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      {/* header row — always visible */}
      <div className="flex h-[34px] items-center gap-2.5 px-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-ops-cyan/35 bg-ops-cyan/[0.09]">
          <FlaskConical size={11} className="text-ops-cyan" />
        </span>
        <MicroLabel className="text-slate-300">Impact Comparison</MicroLabel>
        <span className="hidden font-mono text-[7px] tracking-[0.14em] text-slate-600 sm:inline">
          FIXED TIMING vs GREENWAVE · SAME INCIDENT · SAME STARTING CONDITIONS
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Pill tone={busy ? 'amber' : done ? 'green' : phase === 'ERROR' ? 'red' : 'slate'} className="hidden md:inline-flex">
            {PHASE_WORD[phase]}
          </Pill>
          {busy && <Led tone="amber" pulse size={5} />}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-[3px] border border-white/10 px-1.5 py-[3px] text-slate-500 transition-colors hover:border-white/20 hover:text-slate-200"
            aria-label={open ? 'Collapse impact comparison' : 'Expand impact comparison'}
          >
            <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          {/* actions / running state */}
          {!done && phase !== 'ERROR' && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={onRun}
                className={cn(
                  'flex items-center gap-1.5 rounded-[3px] border px-2.5 py-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em] transition-colors',
                  busy
                    ? 'cursor-not-allowed border-white/[0.06] text-slate-600'
                    : 'border-ops-cyan/45 bg-ops-cyan/[0.08] text-ops-cyan hover:bg-ops-cyan/[0.14]',
                )}
              >
                <Play size={10} />
                {busy ? PHASE_WORD[phase] : 'Run Impact Test'}
              </button>
              {busy && (
                <span className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.12em] text-slate-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ops-amber" />
                  {scenarioLabel}
                </span>
              )}
              {phase !== 'IDLE' && (
                <button
                  type="button"
                  onClick={onReset}
                  className="flex items-center gap-1.5 rounded-[3px] border border-white/10 px-2.5 py-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:border-white/25 hover:text-slate-200"
                >
                  <RotateCcw size={10} />
                  Reset A/B
                </button>
              )}
              {!busy && phase === 'IDLE' && (
                <span className="font-mono text-[8px] tracking-[0.1em] text-slate-600">
                  SEED {result?.seed ?? 13579246} · SAME UNIT · SAME CRUISE SPEED — ONLY SIGNAL CONTROL DIFFERS
                </span>
              )}
            </div>
          )}

          {phase === 'ERROR' && (
            <div className="rounded-[3px] border border-ops-red/30 bg-ops-red/[0.05] px-2.5 py-2 font-mono text-[8.5px] tracking-[0.1em] text-ops-red">
              {error ?? 'A/B evaluation failed'} — <button type="button" onClick={onRun} className="underline">retry</button>
            </div>
          )}

          {/* results */}
          {done && result && (
            <div className="grid gap-2.5 lg:grid-cols-[1fr_1.35fr_1fr]">
              {/* scenario identity */}
              <div className="min-w-0 rounded-[3px] border border-white/[0.06] bg-night-850/50 px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <Siren size={10} className="text-ops-cyan" />
                  <MicroLabel className="text-slate-500">Same Scenario</MicroLabel>
                </div>
                <div className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-slate-200">{scenarioLabel}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-[3px] font-mono text-[7.5px] tracking-[0.1em] text-slate-500">
                  <span>ROUTE</span>
                  <span className="text-right text-slate-400">{result.routeKey}</span>
                  <span>INCIDENT</span>
                  <span className={cn('text-right', result.incidentJunctionId ? 'text-ops-red' : 'text-slate-400')}>
                    {result.incidentJunctionId ?? 'NONE'}
                  </span>
                  <span>SEED</span>
                  <span className="text-right text-slate-400">{result.seed}</span>
                  <span>START STATE</span>
                  <span className="text-right text-emerald-300">IDENTICAL</span>
                </div>
              </div>

              {/* metric table */}
              <div className="min-w-0 rounded-[3px] border border-white/[0.06] bg-night-850/50 px-2.5 py-2">
                <div className="grid grid-cols-[1fr_84px_84px_110px] items-center gap-2">
                  <MicroLabel className="text-slate-500">Metric</MicroLabel>
                  <span className="text-right font-mono text-[7.5px] tracking-[0.14em] text-slate-500">Fixed</span>
                  <span className="text-right font-mono text-[7.5px] tracking-[0.14em] text-emerald-400/80">GreenWave</span>
                  <span className="text-right font-mono text-[7.5px] tracking-[0.14em] text-slate-500">Δ (+ = Better)</span>
                </div>
                <ResultRow label="Emergency ETA" fixed={result.fixed.travelTimeSec} gw={result.greenWave.travelTimeSec} pct={result.delta.emergencyEtaSec.pct} unit="s" dir="LOWER_IS_BETTER" />
                <ResultRow label="Signal Wait" fixed={result.fixed.signalWaitSec} gw={result.greenWave.signalWaitSec} pct={result.delta.signalWaitSec.pct} unit="s" dir="LOWER_IS_BETTER" />
                <div className="mt-1 font-mono text-[6.5px] leading-relaxed tracking-[0.05em] text-slate-600">
                  SIGNAL WAIT = TRAVEL TIME VS FREE-FLOW CRUISE (SAME ENGINE PHYSICS, SAME INCIDENT ZONES, BOTH LEGS) — THE
                  LAUNCH/INCIDENT FLOOR IS IDENTICAL IN BOTH NUMBERS, SO THE Δ ISOLATES SIGNAL CONTROL. A SMALL GREENWAVE
                  RESIDUAL MEANS THE CORRIDOR HELD GREEN FOR THE ROUTE.
                </div>
                <ResultRow label="Network Delay" fixed={result.fixed.avgNetworkDelaySec} gw={result.greenWave.avgNetworkDelaySec} pct={result.delta.avgNetworkDelaySec.pct} unit="s" dir="LOWER_IS_BETTER" />
                <ResultRow label="Stopped Veh" fixed={result.fixed.stoppedVehicles} gw={result.greenWave.stoppedVehicles} pct={result.delta.stoppedVehicles.pct} unit="veh" dir="LOWER_IS_BETTER" />
                <ResultRow label="Avg Speed" fixed={result.fixed.avgSpeedKmh} gw={result.greenWave.avgSpeedKmh} pct={result.delta.avgSpeedKmh.pct} unit="km/h" dir="HIGHER_IS_BETTER" />
                <ResultRow label="Throughput" fixed={result.fixed.ratePerHour} gw={result.greenWave.ratePerHour} pct={result.delta.ratePerHour.pct} unit="veh/hr" dir="HIGHER_IS_BETTER" />
              </div>

              {/* corridor preparation proof + statement */}
              <div className="flex min-w-0 flex-col gap-2">
                <div className="rounded-[3px] border border-emerald-400/20 bg-emerald-400/[0.04] px-2.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <Led tone="green" pulse size={5} />
                    <MicroLabel className="text-emerald-300/90">{statement?.word ?? 'GREENWAVE RESULT'}</MicroLabel>
                  </div>
                  <div className="mt-1.5 font-mono text-[8px] leading-relaxed tracking-[0.08em] text-slate-300">
                    {statement?.detail}
                  </div>
                </div>
                <div className="min-h-[38px] rounded-[3px] border border-white/[0.06] bg-night-850/50 px-2.5 py-2">
                  <MicroLabel className="text-slate-500">Predictive Corridor Proof · GreenWave Leg</MicroLabel>
                  {result.greenWave.corridor.length > 0 ? (
                    <div className="mt-1.5 flex flex-col gap-[3px]">
                      {corridorChips(result.greenWave.corridor).map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5 font-mono text-[7.5px] tracking-[0.1em]">
                          <span className="text-slate-600">{fmtClock(c.t)}</span>
                          <span className="text-slate-300">{c.junctionId}</span>
                          <span className="text-ops-amber">PREPARING</span>
                          <span className="text-slate-600">ETA {fmt0(c.prepareEta)}s</span>
                          <span className="text-emerald-300">→ GREEN HELD</span>
                          <span className="text-slate-600">→ PASSED</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 font-mono text-[7.5px] tracking-[0.1em] text-slate-600">NO CORRIDOR EVENTS RECORDED</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {done && result && (
            <div className="mt-2 flex items-center justify-between border-t border-white/[0.05] pt-2">
              <span className="font-mono text-[7.5px] tracking-[0.12em] text-slate-600">
                MEASURED END-TO-END · SAME SEED {result.seed} · SAME ROUTE · SAME AMBULANCE · ONLY SIGNAL CONTROL DIFFERS
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRun}
                  className="flex items-center gap-1.5 rounded-[3px] border border-ops-cyan/45 bg-ops-cyan/[0.08] px-2.5 py-[5px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ops-cyan transition-colors hover:bg-ops-cyan/[0.14]"
                >
                  <RotateCcw size={10} />
                  Run Again
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="flex items-center gap-1.5 rounded-[3px] border border-white/10 px-2.5 py-[5px] font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:border-white/25 hover:text-slate-200"
                >
                  <RotateCcw size={10} />
                  Reset A/B
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </motion.section>
  )
}