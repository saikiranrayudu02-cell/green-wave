import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Siren, AlertTriangle, GitCommitHorizontal, Clock3, Trash2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { MicroLabel, Led } from './ui'
import { repository } from '../backend/repo'
import { getDbHealth } from '../backend/repo'
import type {
  DecisionRecord,
  DecisionType,
  EmergencyRecord,
  IncidentRecord,
  SessionRecord,
} from '../backend/types'
import { pad2 } from '../lib/format'

interface Snapshot {
  emergencies: EmergencyRecord[]
  incidents: IncidentRecord[]
  decisions: DecisionRecord[]
  sessions: SessionRecord[]
}

const emptySnap: Snapshot = { emergencies: [], incidents: [], decisions: [], sessions: [] }

function wallTime(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const DECISION_LABEL: Record<DecisionType, string> = {
  NORMAL_ADAPTIVE: 'ADAPTIVE',
  PHASE_EXTENSION: 'PHASE EXTENDED',
  PHASE_CHANGE: 'PHASE CHANGE',
  EMERGENCY_PRIORITY: 'EMERGENCY PRIORITY',
  CORRIDOR_PREPARATION: 'CORRIDOR PREP',
  CORRIDOR_ACTIVE: 'CORRIDOR ACTIVE',
  CORRIDOR_RELEASE: 'CORRIDOR RELEASED',
  INCIDENT_RESPONSE: 'INCIDENT RESPONSE',
}

function EmerRow({ e }: { e: EmergencyRecord }) {
  const done = e.status === 'ARRIVED' || e.status === 'COMPLETED'
  return (
    <div className="flex items-center gap-2 px-2.5 py-[7px]">
      <span
        className={cn(
          'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border',
          e.code === 'MEDICAL'
            ? 'border-ops-red/30 bg-ops-red/[0.08] text-ops-red'
            : 'border-ops-cyan/30 bg-ops-cyan/[0.08] text-ops-cyan',
        )}
      >
        <Siren size={11} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] font-semibold tracking-[0.1em] text-slate-200">{e.emergencyRef}</span>
          <span className={cn('font-mono text-[7.5px] font-bold tracking-[0.12em]', done ? 'text-emerald-400/90' : e.corridorActive ? 'text-emerald-300' : 'text-ops-cyan/90')}>
            {done ? 'ARRIVED' : e.corridorActive ? 'CORRIDOR' : 'EN ROUTE'}
          </span>
        </div>
        <div className="mt-[2px] truncate font-mono text-[8px] tracking-[0.06em] text-slate-500">
          {e.unit} · {e.origin.split(' · ')[0]} → {e.destination.split(' · ')[0]}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-[3px]">
        <span className="font-mono text-[8px] tabular text-slate-500">{wallTime(e.dispatchedAt ?? e.createdAt)}</span>
        {done ? (
          <span className="font-mono text-[7.5px] font-semibold text-emerald-400/80">−{e.savedSec}s</span>
        ) : (
          <Led tone={e.corridorActive ? 'green' : 'cyan'} pulse={e.corridorActive} size={4} />
        )}
      </div>
    </div>
  )
}

function IncRow({ i }: { i: IncidentRecord }) {
  const active = i.status === 'ACTIVE'
  return (
    <div className="flex items-center gap-2 px-2.5 py-[7px]">
      <span
        className={cn(
          'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border',
          active ? 'border-ops-red/35 bg-ops-red/[0.09] text-ops-red' : 'border-white/[0.07] bg-white/[0.02] text-slate-500',
        )}
      >
        <AlertTriangle size={11} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.08em] text-slate-200">{i.junctionId}</span>
          <span className={cn('font-mono text-[7.5px] font-bold tracking-[0.1em]', active ? 'danger-glow text-ops-red' : 'text-slate-600')}>
            {active ? 'ACTIVE' : 'RESOLVED'}
          </span>
        </div>
        <div className="mt-[2px] truncate font-mono text-[8px] tracking-[0.04em] text-slate-500">{i.label}</div>
      </div>
      <span className="shrink-0 font-mono text-[8px] tabular text-slate-500">
        {wallTime(active ? i.startedAt : i.resolvedAt ?? i.startedAt)}
      </span>
    </div>
  )
}

function DecRow({ d }: { d: DecisionRecord }) {
  const type = d.decisionType
  const tone = type === 'CORRIDOR_ACTIVE' || type === 'CORRIDOR_PREPARATION' || type === 'EMERGENCY_PRIORITY'
    ? 'text-emerald-300'
    : type === 'INCIDENT_RESPONSE'
      ? 'text-ops-red'
      : type === 'PHASE_CHANGE'
        ? 'text-ops-cyan'
        : 'text-slate-400'
  return (
    <div className="flex items-center gap-2 px-2.5 py-[7px]">
      <GitCommitHorizontal size={11} className="shrink-0 text-slate-600" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9.5px] font-semibold tracking-[0.1em] text-slate-200">{d.junctionId}</span>
          <span className={cn('font-mono text-[7.5px] font-bold tracking-[0.1em]', tone)}>{DECISION_LABEL[type]}</span>
        </div>
        <div className="mt-[2px] truncate font-mono text-[8px] tracking-[0.03em] text-slate-600">
          {d.selectedPhase} · {d.reason ? d.reason.split('·')[0].trim().slice(0, 44) : 'signal decision'}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[8px] tabular text-slate-600">{wallTime(d.createdAt)}</span>
    </div>
  )
}

function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.04] px-2.5 py-[6px]">
      <MicroLabel className="text-slate-600">{children}</MicroLabel>
      {right}
    </div>
  )
}

export default function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [snap, setSnap] = useState<Snapshot>(emptySnap)
  const [confirmClear, setConfirmClear] = useState(false)
  const clearTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    const poll = async () => {
      const s = await repository().snapshot()
      if (live) setSnap(s)
    }
    void poll()
    const t = window.setInterval(() => void poll(), 3000)
    return () => {
      live = false
      window.clearInterval(t)
      if (clearTimer.current) window.clearTimeout(clearTimer.current)
    }
  }, [open])

  const db = getDbHealth()
  const running = snap.sessions.find((s) => s.status === 'RUNNING')
  const cloud = db.kind === 'supabase'

  const clearLocal = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      if (clearTimer.current) window.clearTimeout(clearTimer.current)
      clearTimer.current = window.setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    setConfirmClear(false)
    void repository().clearAll().then(() => setSnap(emptySnap))
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="history"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          className="pointer-events-auto absolute bottom-14 right-2 top-2 z-40 flex w-[318px] flex-col overflow-hidden rounded-md border border-white/[0.09] bg-night-900/95 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-[4px]"
        >
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
            <div className="flex items-center gap-2">
              <Clock3 size={13} className="text-ops-cyan" />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-100">
                Operations History
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clearLocal}
                title="Clear local demo history"
                className={cn(
                  'flex h-6 items-center gap-1 rounded-[3px] border px-1.5 font-mono text-[7.5px] font-semibold tracking-[0.1em] transition-colors',
                  confirmClear
                    ? 'border-ops-red/60 bg-ops-red/10 text-ops-red'
                    : 'border-white/10 text-slate-600 hover:border-white/25 hover:text-slate-300',
                )}
              >
                <Trash2 size={9} />
                {confirmClear ? 'CONFIRM' : ''}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-[3px] p-1 text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          </header>

          {/* source line */}
          <div className="flex items-center justify-between border-b border-white/[0.05] bg-white/[0.015] px-3 py-[6px]">
            <span className="flex items-center gap-1.5 font-mono text-[7.5px] tracking-[0.16em] text-slate-500">
              <Led tone={cloud ? 'green' : 'cyan'} size={4} pulse={!cloud} />
              {cloud ? 'SYSTEM OF RECORD · SUPABASE' : 'PERSISTENT · LOCAL STORE'}
            </span>
            <span className="font-mono text-[7.5px] tracking-[0.12em] text-slate-700">AUDIT TRAIL</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* session */}
            {running && (
              <div className="px-2.5 py-2">
                <div className="flex items-center justify-between rounded-[4px] border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1.5">
                  <span className="font-mono text-[8.5px] tracking-[0.12em] text-emerald-300/90">
                    SESSION {running.id.slice(0, 6).toUpperCase()}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[8px] tracking-[0.1em] text-slate-500">
                    <Led tone="green" pulse size={4} />
                    {running.mode.replace('_', ' ')}
                  </span>
                </div>
              </div>
            )}

            {/* emergencies */}
            <SectionTitle
              right={
                <span className="font-mono text-[7.5px] tabular text-slate-700">{snap.emergencies.length} TOTAL</span>
              }
            >
              Recent Emergencies
            </SectionTitle>
            {snap.emergencies.length === 0 ? (
              <p className="px-3 py-3 font-mono text-[8.5px] leading-relaxed tracking-[0.04em] text-slate-700">
                No recorded emergencies yet. Dispatched units are audited here automatically.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {snap.emergencies.slice(0, 5).map((e) => (
                  <EmerRow key={e.id} e={e} />
                ))}
              </div>
            )}

            {/* incidents */}
            <SectionTitle
              right={
                <span className="font-mono text-[7.5px] tabular text-slate-700">{snap.incidents.length} TOTAL</span>
              }
            >
              Network Incidents
            </SectionTitle>
            {snap.incidents.length === 0 ? (
              <p className="px-3 py-3 font-mono text-[8.5px] tracking-[0.04em] text-slate-700">No incidents logged.</p>
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {snap.incidents.slice(0, 4).map((i) => (
                  <IncRow key={i.id} i={i} />
                ))}
              </div>
            )}

            {/* decisions */}
            <SectionTitle
              right={
                <span className="font-mono text-[7.5px] tabular text-slate-700">{snap.decisions.length} LOGGED</span>
              }
            >
              Signal Decisions
            </SectionTitle>
            {snap.decisions.length === 0 ? (
              <p className="px-3 py-3 font-mono text-[8.5px] leading-relaxed tracking-[0.04em] text-slate-700">
                Adaptive signal decisions will stream here as GreenWave optimizes the network.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {snap.decisions.slice(0, 9).map((d) => (
                  <DecRow key={d.id} d={d} />
                ))}
              </div>
            )}
          </div>

          <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.06] px-3">
            <span className="font-mono text-[7px] tracking-[0.18em] text-slate-700">SIM-OP · RECORD KEEPING</span>
            <span className="font-mono text-[7px] tracking-[0.12em] text-slate-700">
              {snap.emergencies.length + snap.decisions.length} ENTRIES
            </span>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
