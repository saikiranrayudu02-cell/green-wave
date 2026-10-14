import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus, BrainCircuit } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { cn } from '../lib/cn'
import { MicroLabel, Led, Pill } from './ui'
import type { Tone } from './ui'
import {
  pickPredictionFocus,
  predict,
  predictionEvents,
} from '../engine/trafficPrediction'
import type { CongestionRisk, PredictionResult, RiskChange } from '../types/prediction'
import { trafficSimT } from '../engine/vehicles'
import { fmtClock } from '../lib/format'

const RISK_TONE: Record<CongestionRisk, Tone> = {
  LOW: 'slate',
  MODERATE: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
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

function cell(label: string, value: string, sub?: string, valCls = '') {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="font-mono text-[8px] font-medium uppercase tracking-[0.14em] text-slate-600">{label}</div>
      <div className={cn('mt-0.5 font-mono text-[14px] font-semibold tabular text-slate-200', valCls)}>{value}</div>
      {sub && <div className="font-mono text-[7.5px] tracking-[0.1em] text-slate-600">{sub}</div>}
    </div>
  )
}

export default function PredictiveTrafficPanel() {
  const [focus, setFocus] = useState<{ intersectionId: string; group: 'M' | 'X' } | null>(null)
  const [primary, setPrimary] = useState<PredictionResult | null>(null)
  const [secondary, setSecondary] = useState<PredictionResult | null>(null)
  const [events, setEvents] = useState<ReturnType<typeof predictionEvents>>([])

  useEffect(() => {
    const t = window.setInterval(() => {
      const simT = trafficSimT()
      const f = pickPredictionFocus(simT)
      setFocus(f)
      if (!f) {
        setPrimary(null)
        setSecondary(null)
        setEvents([...predictionEvents()])
        return
      }
      const rM = predict(f.intersectionId, 'M', simT)
      const rX = predict(f.intersectionId, 'X', simT)
      setPrimary(f.group === 'M' ? rM : rX)
      setSecondary(f.group === 'M' ? rX : rM)
      setEvents([...predictionEvents()])
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  const chartData = useMemo(() => {
    if (!primary || primary.status !== 'READY') return []
    const sec = (v: number | undefined) => (v ?? 0)
    return [
      { label: 'NOW', v: primary.currentVehicleCount, v2: secondary ? sec(secondary.currentVehicleCount) : 0 },
      { label: '+15', v: primary.predictedVehicleCount15s, v2: secondary ? sec(secondary.predictedVehicleCount15s) : 0 },
      { label: '+30', v: primary.predictedVehicleCount30s, v2: secondary ? sec(secondary.predictedVehicleCount30s) : 0 },
      { label: '+45', v: primary.predictedVehicleCount45s, v2: secondary ? sec(secondary.predictedVehicleCount45s) : 0 },
      { label: '+60', v: primary.predictedVehicleCount60s, v2: secondary ? sec(secondary.predictedVehicleCount60s) : 0 },
    ]
  }, [primary, secondary])

  const ready = primary?.status === 'READY'
  const confPct = ready ? Math.round((primary?.confidence ?? 0) * 100) : 0
  const lastAction = events
    .filter((e) => !focus || e.intersectionId === focus.intersectionId)
    .slice(-1)[0]
  const recentEvents = events.slice(-4).reverse()

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.3 }}
      className="pointer-events-auto absolute bottom-[134px] left-3 z-30 w-[250px] shrink-0 rounded-md border border-white/[0.07] bg-night-850/80 backdrop-blur-[2px] shadow-[0_12px_30px_rgba(0,0,0,0.5)]"
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/[0.05] px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <BrainCircuit size={11} className="text-ops-cyan/90" />
          <MicroLabel className="text-slate-400">Predictive Traffic Intelligence</MicroLabel>
        </div>
        <Pill tone="cyan">{focus?.intersectionId ?? '—'}</Pill>
      </div>

      {!ready || !primary ? (
        /* ---- building history / insufficient data ---- */
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <Led tone="slate" pulse={false} size={5} />
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            BUILDING HISTORY
          </div>
          <div className="font-mono text-[8px] leading-relaxed tracking-[0.08em] text-slate-600">
            {primary
              ? primary.insufficientReason === 'STALE'
                ? 'OBSERVATIONS STALE — SAMPLING RESUMES'
                : 'COLLECTING TRAFFIC OBSERVATIONS'
              : 'COLLECTING TRAFFIC OBSERVATIONS'}
          </div>
          <div className="font-mono text-[7.5px] tracking-[0.1em] text-slate-600">
            {primary ? `${primary.historySamples} SAMPLES` : '— SAMPLES'}
          </div>
        </div>
      ) : (
        <>
          {/* sensor source + risk */}
          <div className="grid grid-cols-2 gap-x-3 border-b border-white/[0.05] px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <MicroLabel className="text-slate-600">Data Source</MicroLabel>
              <span className="flex items-center gap-1.5">
                <Led
                  tone={primary.source === 'CAMERA' ? 'green' : primary.source === 'FUSED' ? 'cyan' : 'slate'}
                  pulse={primary.source === 'CAMERA'}
                  size={4}
                />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                  {primary.source}
                </span>
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <MicroLabel className="text-slate-600">Risk Trend</MicroLabel>
              <TrendBadge trend={primary.riskChange} />
            </div>
          </div>

          {/* congestion risk */}
          <div className="flex items-center justify-between border-b border-white/[0.05] px-2.5 py-1.5">
            <MicroLabel className="text-slate-600">Congestion Risk</MicroLabel>
            <div className="flex items-center gap-2">
              <Led
                tone={RISK_TONE[primary.congestionRisk]}
                pulse={primary.congestionRisk === 'CRITICAL'}
                size={5}
              />
              <Pill tone={RISK_PILL[primary.congestionRisk]}>
                {primary.congestionRisk}
              </Pill>
            </div>
          </div>

          {/* current */}
          <div className="border-b border-white/[0.05] px-2.5 py-1.5">
            <MicroLabel className="mb-1 text-slate-600">Current</MicroLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {cell('Vehicles', String(primary.currentVehicleCount))}
              {cell('Queue', String(primary.currentQueue))}
              {cell('Density', `${Math.round(primary.currentDensity * 100)}%`)}
            </div>
          </div>

          {/* forecast */}
          <div className="border-b border-white/[0.05] px-2.5 py-1.5">
            <MicroLabel className="mb-1 text-slate-600">Forecast · Vehicles</MicroLabel>
            <div className="grid grid-cols-4 gap-1.5">
              {cell('+15s', String(primary.predictedVehicleCount15s), undefined, primary.predictedVehicleCount15s > primary.currentVehicleCount ? 'text-ops-amber' : '')}
              {cell('+30s', String(primary.predictedVehicleCount30s), undefined, primary.predictedVehicleCount30s > primary.currentVehicleCount ? 'text-ops-amber' : '')}
              {cell('+45s', String(primary.predictedVehicleCount45s), undefined, primary.predictedVehicleCount45s > primary.currentVehicleCount ? 'text-ops-amber' : '')}
              {cell('+60s', String(primary.predictedVehicleCount60s), undefined, primary.predictedVehicleCount60s > primary.currentVehicleCount ? 'text-ops-amber' : '')}
            </div>
            <div className="mt-1.5 h-[34px] w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="predFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38c4e0" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#38c4e0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="#38c4e0"
                      strokeWidth={1.4}
                      fill="url(#predFill)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="v2"
                      stroke="#e8a13c"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      fill="none"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>

          {/* confidence + history */}
          <div className="flex items-center justify-between border-b border-white/[0.05] px-2.5 py-1.5">
            <MicroLabel className="text-slate-600">Prediction Confidence</MicroLabel>
            <span className="font-mono text-[10px] font-semibold tabular text-slate-300">{confPct}%</span>
          </div>
          <div className="h-[3px] w-full bg-white/[0.05]">
            <div
              className="h-full bg-gradient-to-r from-ops-cyan/60 to-ops-cyan transition-all duration-700"
              style={{ width: `${confPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between border-b border-white/[0.05] px-2.5 py-1">
            <MicroLabel className="text-slate-600">History</MicroLabel>
            <span className="font-mono text-[9px] tabular text-slate-400">{primary.historySamples} SAMPLES</span>
          </div>

          {/* proactive action */}
          <div className="border-b border-white/[0.05] px-2.5 py-1.5">
            <MicroLabel className="mb-1 text-slate-600">Proactive Action</MicroLabel>
            {lastAction ? (
              <div className="rounded border border-ops-cyan/25 bg-ops-cyan/[0.06] px-2 py-1.5">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-ops-cyan">
                  {lastAction.forecast}
                </div>
                <div className="mt-0.5 font-mono text-[10px] font-semibold tracking-[0.08em] text-slate-200">
                  {lastAction.action}
                </div>
                <div className="mt-0.5 font-mono text-[7.5px] leading-relaxed tracking-[0.06em] text-slate-500">
                  {lastAction.detail}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500">
                <Minus size={10} />
                <span className="font-mono text-[8.5px] uppercase tracking-[0.1em]">
                  NO PROACTIVE CHANGE REQUIRED
                </span>
              </div>
            )}
          </div>

          {/* event log */}
          <div className="px-2.5 py-1.5">
            <MicroLabel className="mb-1 text-slate-600">Prediction Event Log</MicroLabel>
            {recentEvents.length === 0 ? (
              <div className="font-mono text-[8px] tracking-[0.1em] text-slate-600">NO PREDICTION EVENTS</div>
            ) : (
              <div className="flex flex-col gap-[3px]">
                {recentEvents.map((e, i) => (
                  <div
                    key={`${e.t}-${e.intersectionId}-${i}`}
                    className="grid grid-cols-[44px_34px_1fr] items-center gap-1 font-mono text-[7.5px] tracking-[0.06em]"
                  >
                    <span className="tabular text-slate-600">{fmtClock(e.t)}</span>
                    <span className="text-slate-400">{e.intersectionId}</span>
                    <span className="truncate text-ops-cyan/90" title={e.action}>
                      {e.forecast} · {e.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* footer */}
      <div className="flex items-center justify-between border-t border-white/[0.05] px-2.5 py-1">
        <span className="font-mono text-[7px] text-slate-600">DETERMINISTIC TREND FORECAST</span>
        <span className="font-mono text-[7px] text-slate-600">
          {primary ? `HORIZON +60s · GROUP ${primary.group}` : 'HORIZON +60s'}
        </span>
      </div>
    </motion.div>
  )
}