import { motion } from 'framer-motion'
import { Led } from './ui'
import { useSystemStatus } from './useSystemStatus'
import { cameraBackendOnline } from '../engine/trafficDemand'
import { cn } from '../lib/cn'
import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'

interface Props {
  moduleLabel: string
  corridorActive: boolean
  onOpenSession: () => void
  logOpen: boolean
  onToggleLog: () => void
  onOpenInstall?: () => void
}

function ClockCompact() {
  const [sec, setSec] = useState<number>(() => 9 * 3600 + 42 * 60 + 18)
  useEffect(() => {
    const t = window.setInterval(() => setSec((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return (
    <span className="font-mono text-[11px] font-medium tabular text-slate-200">
      {hh}:{mm}
      <span className="animate-blink text-ops-cyan">:</span>
      {ss}
    </span>
  )
}

export default function MobileHeader({
  moduleLabel,
  corridorActive,
  onOpenSession,
  logOpen,
  onToggleLog,
  onOpenInstall,
}: Props) {
  const { db, bus, cx, peersActive } = useSystemStatus()
  const cameraUp = cameraBackendOnline()
  const issues: string[] = []
  if (!cameraUp) issues.push('CAM')
  if (db.kind === 'supabase' && (db.state === 'degraded' || db.state === 'offline')) issues.push('DB')
  if (cx.state === 'degraded') issues.push('CX')
  const degraded = issues.length > 0

  const syncTone: 'green' | 'cyan' | 'amber' | 'slate' =
    bus.state === 'degraded' ? 'amber' : bus.state === 'off' ? 'slate' : 'green'
  const syncWord =
    bus.state === 'degraded' ? 'DEGRADED' : bus.state === 'off' ? 'OFFLINE' : bus.peers > 0 ? 'LINKED' : 'LIVE'

  return (
    <header className="relative z-30 flex h-[54px] shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] bg-night-900/95 px-3 backdrop-blur-md">
      {/* brand */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-[6px] border border-ops-cyan/40 bg-night-800 shadow-[0_0_12px_rgba(56,196,224,0.25)]">
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
            <path
              d="M2 16.5 L7 16.5 L9.5 9 L13.5 20 L16.5 9 L18 13 L22 13"
              stroke="#38c4e0"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="absolute -bottom-[2px] -right-[2px] h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#2fe08a]" />
        </div>
        <div className="leading-tight">
          <div className="font-mono text-[11px] font-bold tracking-[0.25em] text-slate-100">GREENWAVE</div>
          <div className="flex items-center gap-1.5 font-mono text-[8px] text-slate-500">
            <ClockCompact />
            <span>·</span>
            <span className={cn('font-semibold uppercase tracking-wider', corridorActive ? 'text-emerald-300' : 'text-slate-500')}>
              {corridorActive ? 'CORRIDOR' : 'STANDBY'}
            </span>
          </div>
        </div>
      </div>

      {/* center badge */}
      <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 truncate">{moduleLabel}</span>
        {degraded && (
          <span className="rounded bg-ops-amber/15 px-1.5 py-0.5 font-mono text-[7.5px] font-semibold uppercase text-ops-amber">
            {issues.join('+')}
          </span>
        )}
      </div>

      {/* right status & actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* INSTALL APP BUTTON */}
        {onOpenInstall && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={onOpenInstall}
            title="Install GreenWave as Local App"
            className="flex h-7 items-center gap-1 rounded-md border border-ops-cyan/40 bg-ops-cyan/[0.08] px-2 text-[9px] font-mono font-semibold uppercase tracking-wider text-ops-cyan hover:bg-ops-cyan/[0.16] transition-colors"
          >
            <Download size={12} strokeWidth={2.4} />
            <span className="hidden xs:inline">INSTALL</span>
          </motion.button>
        )}

        {/* SYNC & DB DOTS */}
        <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-1">
          <Led tone={syncTone} pulse={bus.state === 'realtime' || peersActive} size={5} />
          <span className="font-mono text-[7.5px] font-medium text-slate-400 hidden xs:inline">{syncWord}</span>
        </div>

        {/* LOG */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onToggleLog}
          title="Operations history"
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md border text-[11px] transition-colors',
            logOpen
              ? 'border-ops-cyan/50 bg-ops-cyan/[0.15] text-ops-cyan'
              : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
          )}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M3 6h12M6 10h8M4 14h5M4 18h7" />
          </svg>
        </motion.button>

        {/* OPERATOR SESSION */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.95 }}
          onClick={onOpenSession}
          title="Operator session"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-night-800 text-ops-cyan hover:border-ops-cyan/40 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="3" />
            <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </motion.button>
      </div>
    </header>
  )
}
