import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import AnimatedMetric from './AnimatedMetric'
import { fmtClock, pad2 } from '../lib/format'
import { MicroLabel } from './ui'

export interface MetricsData {
  vehicles: number
  corridorsOpen: number
  avgSpeedKmh: number
  queueAvg: number
  throughput: number
  delayAvg: number
  loadPct: number
  etaSec: number
  etaBaselineSec: number
  etaSavedSec: number
  corridorOpen: boolean
  incident: boolean
  /** an emergency has actually been dispatched (vs. all units on standby) */
  active: boolean
}

function cell(
  label: string,
  value: ReactNode,
  sub?: ReactNode,
  valueCls = '',
) {
  return (
    <div className="flex min-w-0 flex-col justify-center px-3.5 py-2.5">
      <div className="truncate font-mono text-[8.5px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`font-mono text-[22px] font-semibold leading-none tracking-tight ${valueCls || 'text-slate-100'}`}
        >
          {value}
        </span>
      </div>
      {sub && <div className="mt-1.5 truncate font-mono text-[8.5px] tracking-[0.12em] text-slate-600">{sub}</div>}
    </div>
  )
}

export default function MetricsStrip({
  m,
  history,
}: {
  m: MetricsData
  /** rolling simulation history (throughput rate samples) for the sparkline */
  history: readonly number[]
}) {
  const spark = useMemo(() => {
    const src = history.length >= 2 ? history : [0, 0]
    return src.map((v) => ({ v }))
  }, [history])

  const saved = m.corridorOpen ? fmtClock(m.etaSavedSec) : '00:00'

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.5, ease: 'easeOut' }}
      className="flex h-[92px] shrink-0 items-stretch overflow-hidden rounded-md border border-white/[0.07] bg-night-850/80"
    >
      <div className="grid flex-1 grid-cols-6 divide-x divide-white/[0.05]">
        {cell(
          'Vehicles Tracked',
          <AnimatedMetric value={m.vehicles} duration={1.2} />,
          m.incident ? `LOAD ${Math.round(m.loadPct)}% · INCIDENT` : `NETWORK LOAD ${Math.round(m.loadPct)}%`,
        )}
        {cell(
          'Active Corridors',
          <AnimatedMetric
            value={m.corridorsOpen}
            format={(v) => pad2(Math.round(v))}
            className={m.corridorsOpen > 0 ? 'text-emerald-300' : ''}
          />,
          m.corridorOpen ? 'GREENWAVE ENGAGED' : 'ALL STANDBY',
          m.corridorsOpen > 0 ? 'text-emerald-300' : '',
        )}
        {cell(
          'Avg Speed',
          <AnimatedMetric value={m.avgSpeedKmh} format={(v) => `${v.toFixed(0)} km/h`} duration={1.2} />,
          m.incident ? 'DEGRADED FLOW' : 'FLEET AVERAGE',
          m.incident ? 'text-ops-amber' : '',
        )}
        {cell(
          'Avg Queue',
          <AnimatedMetric value={m.queueAvg} format={(v) => `${v.toFixed(0)} m`} />,
          m.incident ? 'INCIDENT BACKLOG' : 'AT SIGNALS',
          m.incident ? 'text-ops-amber' : '',
        )}
        {cell(
          'Network Throughput',
          <AnimatedMetric value={m.throughput} format={(v) => Math.round(v).toLocaleString('en-US')} />,
          m.incident ? 'DEGRADED FLOW' : 'VEH / HR · LIVE',
        )}
        {cell(
          'Avg Delay',
          <AnimatedMetric value={m.delayAvg} format={(v) => `${v.toFixed(1)} sec`} />,
          m.incident ? 'DELAY ELEVATED' : 'WITHIN BAND',
          m.incident ? 'text-ops-amber' : '',
        )}
      </div>

      {/* right block: emergency ETA + sparkline */}
      <div className="flex w-[224px] shrink-0 items-center gap-3 border-l border-white/[0.06] bg-night-850 pr-4 pl-3">
        <div className="flex min-w-0 flex-col justify-center">
          <MicroLabel>Emergency ETA</MicroLabel>
          {m.active ? (
            <AnimatedMetric
              value={m.etaSec}
              format={fmtClock}
              duration={m.corridorOpen ? 1.1 : 0.35}
              className={
                m.corridorOpen
                  ? 'mt-1 font-mono text-[22px] font-semibold leading-none tracking-tight text-emerald-300'
                  : 'mt-1 font-mono text-[22px] font-semibold leading-none tracking-tight text-slate-200'
              }
            />
          ) : (
            <div className="mt-1 font-mono text-[22px] font-semibold leading-none tracking-tight text-slate-600">
              —
            </div>
          )}
          <div className="mt-1.5 font-mono text-[8.5px] tracking-[0.1em] text-slate-600">
            {m.active
              ? m.corridorOpen
                ? `SAVED ${saved} vs ${fmtClock(m.etaBaselineSec)}`
                : `BASELINE ${fmtClock(m.etaBaselineSec)}`
              : 'STANDBY · NO UNIT ACTIVE'}
          </div>
        </div>
        <div className="ml-auto h-[52px] w-[92px] shrink-0 opacity-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38c4e0" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38c4e0" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#38c4e0"
                strokeWidth={1.4}
                fill="url(#sparkFill)"
                isAnimationActive={true}
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  )
}