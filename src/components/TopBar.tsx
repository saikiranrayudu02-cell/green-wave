import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Radio, ChevronRight, ScrollText } from 'lucide-react'
import { pad2 } from '../lib/format'
import { Led, type Tone } from './ui'
import { cn } from '../lib/cn'
import { useSystemStatus } from './useSystemStatus'
import type { OperatorSession } from '../backend/session'

function useClock(startSec = 9 * 3600 + 42 * 60 + 18) {
  const [sec, setSec] = useState(startSec)
  useEffect(() => {
    const t = window.setInterval(() => setSec((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  return sec
}

interface Props {
  corridorActive: boolean
  session: OperatorSession | null
  onOpenSession: () => void
  logOpen: boolean
  hasOps: boolean
  onToggleLog: () => void
  /** breadcrumb module label (COMMAND CENTER / EMERGENCIES / …) */
  moduleLabel?: string
  onOpenInstall?: () => void
}

/** compact single status: dot + primary word + sub-source label */
function Stat({ tone, pulse, word, sub }: { tone: Tone; pulse?: boolean; word: string; sub: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Led tone={tone} pulse={pulse} size={6} />
      <div className="flex items-baseline gap-1.5 leading-none">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.14em] text-slate-200">{word}</span>
        <span className="hidden font-mono text-[7.5px] tracking-[0.12em] text-slate-600 2xl:inline">{sub}</span>
      </div>
    </div>
  )
}

export default function TopBar({ corridorActive, session, onOpenSession, logOpen, hasOps, onToggleLog, moduleLabel = 'COMMAND CENTER', onOpenInstall }: Props) {
  const sec = useClock()
  const hh = pad2(sec / 3600)
  const mm = pad2((sec % 3600) / 60)
  const ss = pad2(sec % 60)
  const { db, bus, cx, peersActive } = useSystemStatus()

  const syncTone: Tone = bus.state === 'degraded' ? 'amber' : bus.state === 'off' ? 'slate' : 'green'
  const syncWord = bus.state === 'degraded' ? 'DEGRADED' : bus.state === 'off' ? 'OFFLINE' : bus.peers > 0 ? 'LINKED' : 'CONNECTED'
  const dbTone: Tone = db.state === 'degraded' ? 'amber' : db.kind === 'supabase' && db.state === 'connected' ? 'green' : db.state === 'syncing' ? 'cyan' : db.kind === 'local' ? 'green' : 'slate'
  const dbWord = db.kind === 'supabase' ? (db.state === 'connected' ? 'SYNCED' : db.state === 'syncing' ? 'SYNCING' : db.state === 'degraded' ? 'DEGRADED' : 'OFFLINE') : 'LOCAL'
  const dbSub = db.kind === 'supabase' ? 'SUPABASE' : 'STORE'
  const demo = session?.provider === 'demo'

  return (
    <header className="relative z-10 flex h-[52px] shrink-0 items-center border-b border-white/[0.06] bg-night-900/90 px-4">
      <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-slate-500">
        <Radio size={12} className="shrink-0 text-slate-600" />
        <span className="hidden text-slate-400 2xl:inline">OPERATIONS</span>
        <ChevronRight size={11} className="hidden shrink-0 text-slate-700 2xl:inline" />
        <span className="whitespace-nowrap text-slate-200">{moduleLabel}</span>
        {demo && (
          <span className="ml-2 flex items-center gap-1.5 rounded-[3px] border border-ops-amber/45 bg-ops-amber/[0.07] px-2 py-[3px] text-[8.5px] font-semibold tracking-[0.16em] text-ops-amber">
            <span className="h-[4px] w-[4px] rounded-full bg-ops-amber" />
            DEMO ENVIRONMENT
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-4">
        {/* system status: simulation · live sync · database */}
        <div className="hidden items-center gap-3 rounded-[3px] border border-white/[0.05] bg-white/[0.015] px-2.5 py-[5px] xl:flex">
          <Stat tone="cyan" pulse word="SIMULATION" sub="LOCAL ENGINE" />
          <div className="h-3 w-px bg-white/[0.08]" />
          <Stat
            tone={syncTone}
            pulse={bus.state === 'realtime' || peersActive}
            word={syncWord}
            sub={bus.state === 'realtime' ? 'REALTIME' : 'LOCAL BUS'}
          />
          <div className="h-3 w-px bg-white/[0.08]" />
          <Stat tone={dbTone} pulse={db.state === 'syncing'} word={dbWord} sub={dbSub} />
          <div className="h-3 w-px bg-white/[0.08]" />
          <Stat
            tone={cx.state === 'online' ? (cx.demoMode ? 'amber' : 'green') : cx.state === 'connecting' ? 'cyan' : 'slate'}
            pulse={cx.state === 'online' || cx.state === 'connecting'}
            word={cx.state === 'online' ? (cx.demoMode ? 'DEMO' : 'LIVE') : cx.state === 'connecting' ? 'LINKING' : 'OFFLINE'}
            sub="CONVEX"
          />
        </div>

        {/* corridor state */}
        <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} className="flex items-center gap-2">
          <Led tone={corridorActive ? 'green' : 'slate'} pulse={corridorActive} size={7} />
          <span className="font-mono text-[10px] tracking-[0.14em] text-slate-400">
            {corridorActive ? (
              <span className="text-emerald-300">GREENWAVE ACTIVE</span>
            ) : (
              <span className="hidden text-slate-500 md:inline">GREENWAVE STANDBY</span>
            )}
          </span>
        </motion.div>

        <div className="h-5 w-px bg-white/[0.07]" />

        {/* operations log toggle */}
        {onOpenInstall && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={onOpenInstall}
            title="Install GreenWave as Local App"
            className="flex h-[26px] items-center gap-1.5 rounded-[3px] border border-ops-cyan/40 bg-ops-cyan/[0.08] px-2 font-mono text-[9px] font-semibold tracking-[0.14em] text-ops-cyan hover:bg-ops-cyan/[0.16] transition-colors"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="hidden sm:inline">INSTALL</span>
          </motion.button>
        )}

        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={onToggleLog}
          title="Operations history · audit log"
          className={cn(
            'relative flex h-[26px] items-center gap-1.5 rounded-[3px] border px-2 font-mono text-[9px] font-semibold tracking-[0.16em] transition-colors',
            logOpen
              ? 'border-ops-cyan/50 bg-ops-cyan/[0.08] text-ops-cyan'
              : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200',
          )}
        >
          <ScrollText size={12} />
          <span className="hidden md:inline">LOG</span>
          {hasOps && !logOpen && (
            <span className="absolute -right-[3px] -top-[3px] h-[6px] w-[6px] rounded-full bg-emerald-400 shadow-[0_0_5px_#2fe08a]" />
          )}
        </motion.button>

        <div className="h-5 w-px bg-white/[0.07]" />

        {/* clock */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[17px] font-medium tabular leading-none tracking-[0.06em] text-slate-100">
            {hh}:{mm}
            <span className="animate-blink text-ops-cyan">:</span>
            {ss}
          </span>
          <span className="hidden font-mono text-[8.5px] tracking-[0.2em] text-slate-600 lg:inline">LOCAL</span>
        </div>

        <div className="h-5 w-px bg-white/[0.07]" />

        {/* operator — opens the session panel */}
        <motion.button
          type="button"
          whileHover={{ opacity: 0.85 }}
          whileTap={{ scale: 0.97 }}
          onClick={onOpenSession}
          title="Operator session"
          className="flex items-center gap-2.5 rounded-[3px] px-1 py-1 text-left"
        >
          <div
            className={cn(
              'flex h-[26px] w-[26px] items-center justify-center rounded-full border bg-night-800',
              demo ? 'border-ops-amber/45' : 'border-ops-cyan/40',
            )}
          >
            <span className={cn('font-mono text-[10px] font-semibold', demo ? 'text-ops-amber' : 'text-ops-cyan')}>
              {session ? session.operator.split(' ').map((w) => w[0]).join('').slice(0, 2) : '—'}
            </span>
          </div>
          <div className="hidden leading-tight 2xl:block">
            <div className="flex items-center gap-1.5 font-mono text-[8.5px] tracking-[0.12em]">
              <span className="text-slate-600">{demo ? 'DEMO OPERATOR' : 'OPERATOR'}</span>
              <span className={cn('font-semibold', demo ? 'text-ops-amber/80' : 'text-ops-cyan/80')}>{session?.role ?? ''}</span>
            </div>
            <div className="text-[11px] font-medium text-slate-300">{session?.operator ?? 'No session'}</div>
          </div>
        </motion.button>
      </div>
    </header>
  )
}
