import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Siren,
  HeartPulse,
  MapPin,
  Route,
  Timer,
  Navigation,
  CircleCheck,
  Loader,
  ShieldCheck,
  Stethoscope,
  FileText,
} from 'lucide-react'
import type { EmergencyRuntime, IncidentState } from '../types'
import type { CorridorJunction } from '../engine/corridor'
import type { EmergencyCase, CaseStatus } from '../arogya/emergencyCase'
import AnimatedMetric from './AnimatedMetric'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'

interface UnitTelemetry {
  d: number
  len: number
  nextIdx: number
  etaRemainSec: number
}

interface Props {
  emergencies: EmergencyRuntime[]
  selectedId: string
  incident: IncidentState | null
  unitT: Record<string, UnitTelemetry>
  activating: boolean
  /** graph-computed alternative route for the selected unit */
  altRoute: { label: string; km: number; etaSec: number } | null
  /** live corridor wave of the selected unit (corridor engine, empty if off) */
  corrWave: CorridorJunction[] | null
  /** ArogyaOS case for the selected unit (null = no case created yet) */
  emergencyCase: EmergencyCase | null
  /** case status derived from the existing unit lifecycle */
  caseStatus: CaseStatus | null
  onOpenHandoff: () => void
  onSelect: (id: string) => void
  onDispatch: (id: string) => void
  onToggleCorridor: (id: string) => void
}

function Field({
  children,
  icon,
  label,
}: {
  children: ReactNode
  icon: ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border border-white/[0.06] bg-white/[0.02] text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <MicroLabel className="text-slate-600">{label}</MicroLabel>
        <div className="mt-[2px] truncate text-[11.5px] font-medium text-slate-100">{children}</div>
      </div>
    </div>
  )
}

type ChipState = 'passed' | 'next' | 'future' | 'held' | 'prep'

function JunctionChip({ label, state, eta }: { label: string; state: ChipState; eta?: number }) {
  return (
    <motion.div
      layout
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className={cn(
        'flex h-[22px] items-center justify-center gap-1 rounded-[3px] border font-mono text-[8.5px] font-semibold tracking-[0.06em] transition-colors duration-300',
        state === 'passed' && 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300/80',
        state === 'held' &&
          'hold-breathe border-emerald-400/70 bg-emerald-400/20 text-emerald-100',
        state === 'prep' &&
          'prep-breathe border-ops-cyan/60 bg-ops-cyan/10 text-ops-cyan',
        state === 'next' && 'border-ops-cyan/50 bg-ops-cyan/10 text-ops-cyan',
        state === 'future' && 'border-white/[0.07] bg-white/[0.015] text-slate-600',
        state === 'passed' && 'min-w-[22px] px-1',
        state !== 'passed' && 'min-w-[38px] px-1.5',
      )}
    >
      {state === 'passed' ? <CircleCheck size={8} strokeWidth={3.2} /> : <span>{label}</span>}
      {eta != null && state !== 'passed' && state !== 'future' && (
        <span className={cn('tabular', state === 'held' ? 'text-emerald-200' : 'text-ops-cyan/70')}>
          {eta}s
        </span>
      )}
    </motion.div>
  )
}

export default function EmergencyPanel({
  emergencies,
  selectedId,
  incident,
  unitT,
  activating,
  altRoute,
  corrWave,
  emergencyCase,
  caseStatus,
  onOpenHandoff,
  onSelect,
  onDispatch,
  onToggleCorridor,
}: Props) {
  const unit = emergencies.find((e) => e.id === selectedId) ?? emergencies[0]
  if (!unit) return null

  const t = unitT[unit.id] ?? {
    d: 0,
    len: unit.intersections,
    nextIdx: 0,
    etaRemainSec: unit.etaSec,
  }
  const tel = unit.junctionIds ?? []
  const pending = unit.status === 'PENDING'
  const progress = unit.arrived ? 1 : pending ? 0 : Math.min(1, t.d / t.len)
  const open = unit.corridorOpen && !unit.arrived
  const critical = unit.priority === 'CRITICAL'
  /* live corridor wave of this unit — engine statuses drive the junction
     chips so the coordination window visibly moves with the ambulance */
  const waveById = new Map<string, CorridorJunction>((corrWave ?? []).map((c) => [c.id, c]))
  const coordinated = (corrWave ?? []).filter((c) => c.status === 'PREPARING' || c.status === 'ACTIVE').length

  return (
    <motion.aside
      initial={{ opacity: 0, x: 26 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.55, delay: 0.35, ease: 'easeOut' }}
      className="flex w-[356px] shrink-0 flex-col overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      {/* header */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          <Led
            tone={open ? 'green' : pending ? 'slate' : critical ? 'red' : 'cyan'}
            pulse={open || activating}
            size={6}
          />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-200">
            {pending ? 'Emergency Standby' : 'Active Emergency'}
          </span>
        </div>
        <Pill tone={incident ? 'red' : 'slate'} className="px-1.5 py-[2px]">
          {incident ? 'NETWORK EVENT' : 'CLEAR NETWORK'}
        </Pill>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* responding units */}
        <div className="px-3 pt-2.5">
          <MicroLabel className="mb-1.5 text-slate-600">
            {pending ? 'Units' : 'Responding Units'}
          </MicroLabel>
          <div className="overflow-hidden rounded-[4px] border border-white/[0.05]">
            {emergencies.map((e, i) => {
              const sel = e.id === selectedId
              const eOpen = e.corridorOpen && !e.arrived
              return (
                <motion.button
                  key={e.id}
                  type="button"
                  whileHover={{ backgroundColor: 'rgba(255,255,255,0.035)' }}
                  whileTap={{ scale: 0.995 }}
                  onClick={() => onSelect(e.id)}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors',
                    i > 0 && 'border-t border-white/[0.05]',
                    sel && 'bg-white/[0.03]',
                  )}
                >
                  {sel && (
                    <motion.span
                      layoutId="unit-accent"
                      className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-ops-cyan"
                    />
                  )}
                  <span
                    className={cn(
                      'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[4px] border',
                      e.code === 'MEDICAL'
                        ? 'border-ops-red/30 bg-ops-red/[0.08] text-ops-red'
                        : 'border-ops-cyan/30 bg-ops-cyan/[0.08] text-ops-cyan',
                    )}
                  >
                    <Siren size={13} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10.5px] font-semibold tracking-[0.08em] text-slate-100">
                        {e.tac}
                      </span>
                      <span
                        className={cn(
                          'rounded-[2px] border px-1 py-[1px] font-mono text-[7.5px] font-bold tracking-[0.1em]',
                          e.priority === 'CRITICAL'
                            ? 'border-ops-red/40 text-ops-red'
                            : 'border-ops-cyan/40 text-ops-cyan',
                        )}
                      >
                        {e.priority}
                      </span>
                    </div>
                    <div className="mt-[3px] truncate text-[10px] text-slate-500">
                      {e.incident} · {e.origin}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-[5px]">
                    <Led tone={eOpen ? 'green' : 'slate'} pulse={eOpen} size={5} />
                    <span
                      className={cn(
                        'font-mono text-[9.5px] tabular leading-none',
                        eOpen ? 'text-emerald-300' : 'text-slate-400',
                      )}
                    >
                      {e.status === 'PENDING' ? '—' : fmtClock(unitT[e.id]?.etaRemainSec ?? e.etaSec)}
                    </span>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* ArogyaOS emergency case — only when a case actually exists */}
        {emergencyCase && (
          <div className="mt-3 border-y border-white/[0.05] bg-white/[0.012] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[4px] border border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-300">
                  <Stethoscope size={11} strokeWidth={2.2} />
                </span>
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-300">
                  Emergency Case
                </span>
                <span className="rounded-[2px] border border-white/[0.08] px-1 py-[1px] font-mono text-[7px] tracking-[0.14em] text-slate-500">
                  AROGYAOS
                </span>
              </div>
              <span
                className={cn(
                  'font-mono text-[8.5px] font-bold tracking-[0.14em]',
                  emergencyCase.priority === 'CRITICAL' ? 'text-ops-red' : 'text-ops-amber',
                )}
              >
                {emergencyCase.priority}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
              <Field icon={<FileText size={10} />} label="Case">{emergencyCase.caseId}</Field>
              <Field icon={<Siren size={10} />} label="Unit">{emergencyCase.ambulanceUnitId}</Field>
              <Field icon={<MapPin size={10} />} label="Destination">{emergencyCase.hospitalName}</Field>
              <Field
                icon={<Navigation size={10} />}
                label="Status"
              >
                {caseStatus === 'ARRIVED'
                  ? 'ARRIVED'
                  : caseStatus === 'ARRIVING'
                    ? 'ARRIVING'
                    : caseStatus === 'EN_ROUTE'
                      ? 'EN ROUTE'
                      : caseStatus === 'DISPATCHED'
                        ? 'DISPATCHED'
                        : caseStatus === 'CLOSED'
                          ? 'CLOSED'
                          : 'CREATED'}
              </Field>
            </div>
            {/* coordination — city + hospital status of the SAME shared case */}
            {emergencyCase.cityNotificationStatus === 'ACKNOWLEDGED' && (
              <div className="mt-2.5 flex items-center gap-1.5 rounded-[4px] border border-emerald-400/30 bg-emerald-400/[0.06] px-2.5 py-1.5">
                <ShieldCheck size={11} className="shrink-0 text-emerald-300" />
                <span className="font-mono text-[7.5px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                  EMERGENCY AUTHORIZED · GREENWAVE RESPONSE ACTIVE
                </span>
              </div>
            )}
            <div className="mt-2.5 grid grid-cols-2 divide-x divide-white/[0.05] overflow-hidden rounded-[4px] border border-white/[0.05] bg-night-950/40">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <Led
                  tone={emergencyCase.cityNotificationStatus === 'ACKNOWLEDGED' ? 'green' : emergencyCase.cityNotificationStatus === 'REQUESTED' ? 'cyan' : 'slate'}
                  pulse={emergencyCase.cityNotificationStatus === 'REQUESTED'}
                  size={4}
                />
                <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-400">
                  CITY ·{' '}
                  {emergencyCase.cityNotificationStatus === 'ACKNOWLEDGED'
                    ? 'ACKNOWLEDGED'
                    : emergencyCase.cityNotificationStatus === 'REQUESTED'
                      ? 'REQUESTED'
                      : 'NOT SENT'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <Led
                  tone={emergencyCase.hospitalNotificationStatus === 'READY' ? 'green' : emergencyCase.hospitalNotificationStatus === 'PREPARING' || emergencyCase.hospitalNotificationStatus === 'ACCEPTED' ? 'amber' : 'slate'}
                  pulse={emergencyCase.hospitalNotificationStatus === 'PREPARING' || emergencyCase.hospitalNotificationStatus === 'ACCEPTED'}
                  size={4}
                />
                <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-400">
                  HOSPITAL ·{' '}
                  {emergencyCase.hospitalNotificationStatus === 'READY'
                    ? 'READY'
                    : emergencyCase.hospitalNotificationStatus === 'PREPARING' || emergencyCase.hospitalNotificationStatus === 'ACCEPTED'
                      ? 'PREPARING'
                      : emergencyCase.hospitalNotificationStatus === 'NOTIFIED'
                        ? 'NOTIFIED'
                        : 'NOT NOTIFIED'}
                </span>
              </div>
            </div>

            {/* handoff / copilot readiness — honest availability from the boundary */}
            <div className="mt-2.5 flex items-center justify-between rounded-[4px] border border-white/[0.05] bg-night-950/40 px-2.5 py-1.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <Led
                    tone={emergencyCase.handoffStatus === 'NOT_READY' ? 'amber' : 'green'}
                    size={4}
                  />
                  <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-400">
                    CLINICAL HANDOFF · {emergencyCase.handoffStatus === 'REVIEWED' ? 'REVIEWED' : 'INFORMATION AVAILABLE'}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Led tone={emergencyCase.clinical.doctorCopilot ? 'green' : 'amber'} size={4} />
                  <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-400">
                    DOCTOR COPILOT · {emergencyCase.clinical.doctorCopilot ? 'READY' : 'OFFLINE'}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenHandoff}
                className="shrink-0 rounded-[3px] border border-ops-cyan/40 bg-ops-cyan/[0.06] px-2 py-[3px] font-mono text-[7.5px] font-bold uppercase tracking-[0.16em] text-ops-cyan transition-colors hover:bg-ops-cyan/[0.12]"
              >
                Review Handoff
              </button>
            </div>
          </div>
        )}

        {/* incident details */}
        <div className="mt-3 border-y border-white/[0.05] bg-white/[0.012] px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-[20px] w-[20px] items-center justify-center rounded-[4px] border',
                  critical ? 'border-ops-red/30 bg-ops-red/[0.09] text-ops-red' : 'border-ops-cyan/30 bg-ops-cyan/[0.09] text-ops-cyan',
                )}
              >
                <HeartPulse size={11} strokeWidth={2.2} />
              </span>
              <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-100">
                {unit.code === 'MEDICAL' ? 'Medical Emergency' : 'Trauma Incident'}
              </span>
            </div>
            <span className="font-mono text-[8.5px] tracking-[0.16em] text-slate-600">{unit.unit}</span>
          </div>

          <div className="mt-2.5 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
            <Field icon={<HeartPulse size={10} />} label="Incident">
              {unit.incident}
            </Field>
            <Field icon={<MapPin size={10} />} label="Origin">
              {unit.origin}
            </Field>
          </div>
          <div className="mt-2">
            <Field icon={<Navigation size={10} />} label="Destination">
              {unit.destination}
            </Field>
          </div>

          {/* ETA trio — real values only once the unit is actually dispatched */}
          <div className="mt-2.5 grid grid-cols-3 divide-x divide-white/[0.06] overflow-hidden rounded-[4px] border border-white/[0.06] bg-night-950/70">
            <div className="px-2 py-1.5">
              <MicroLabel className="text-[8px] text-slate-600">Baseline</MicroLabel>
              <div className="mt-[3px] font-mono text-[15px] font-medium tabular leading-none text-slate-300">
                {pending ? '—' : fmtClock(unit.baselineSec)}
              </div>
            </div>
            <div className="px-2 py-1.5">
              <MicroLabel className="text-[8px] text-slate-600">GreenWave</MicroLabel>
              {pending ? (
                <div className="mt-[3px] font-mono text-[15px] font-medium tabular leading-none text-slate-600">
                  —
                </div>
              ) : (
                <AnimatedMetric
                  value={open ? t.etaRemainSec : unit.arrived ? 0 : unit.etaSec}
                  format={fmtClock}
                  duration={open ? 1.05 : 0.55}
                  className={cn(
                    'mt-[3px] font-mono text-[15px] font-semibold tabular leading-none',
                    open ? 'text-emerald-300' : 'text-slate-100',
                  )}
                />
              )}
            </div>
            <div className="px-2 py-1.5">
              <MicroLabel className="text-[8px] text-slate-600">Saved</MicroLabel>
              <div
                className={cn(
                  'mt-[3px] font-mono text-[15px] font-semibold tabular leading-none',
                  open ? 'text-emerald-300' : 'text-slate-600',
                )}
              >
                {pending || !open ? '—' : fmtClock(unit.savedSec)}
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between font-mono text-[8.5px] tracking-[0.1em] text-slate-600">
            <span className="flex items-center gap-1.5">
              <Route size={10} className="text-slate-600" />
              {unit.distanceKm.toFixed(1)} KM · {unit.intersections} SIGNAL HOLDS
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[3px] w-[3px] rounded-full bg-slate-700" />
              {unit.corridorLabel}
            </span>
          </div>
        </div>

        {/* corridor action */}
        <div className="px-3 pt-2.5">
          <div className="mb-1.5 flex items-end justify-between">
            <div>
              <MicroLabel className="text-slate-500">Corridor Status</MicroLabel>
              {open && (
                <div className="mt-[3px] font-mono text-[8px] tracking-[0.1em] text-emerald-300/70">
                  WAVE {coordinated} JUNCTIONS · SIGNAL DELAY{' '}
                  <span className="tabular text-emerald-200">{fmtClock(unit.signalWaitSec)}</span>
                </div>
              )}
            </div>
            <span
              className={cn(
                'flex items-center gap-1.5 pb-[1px] font-mono text-[9.5px] font-semibold tracking-[0.22em]',
                open ? 'text-emerald-300' : activating ? 'text-ops-cyan' : 'text-slate-500',
              )}
            >
              <Led
                tone={open ? 'green' : activating ? 'cyan' : 'slate'}
                pulse={open || activating}
                size={5}
              />
              {open ? 'ACTIVE' : activating ? 'ARMING' : 'STANDBY'}
            </span>
          </div>

          {/* popLayout (not mode="wait"): the next action button mounts
              immediately instead of waiting for the previous one's exit
              animation — under rAF throttling (background tabs, automated
              test runners) a frozen exit used to block DISPATCH → OPEN and
              silently drop clicks. All enter/exit animations are preserved. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {unit.status === 'PENDING' ? (
              <motion.button
                key="dispatch"
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                whileHover={{ boxShadow: '0 0 24px rgba(56,196,224,0.4)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onDispatch(unit.id)}
                className="group relative flex h-9 w-full items-center justify-center gap-2 overflow-hidden rounded-[4px] bg-ops-cyan font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-night-950 transition-colors hover:bg-cyan-300"
              >
                <Siren size={14} className="transition-transform group-hover:-translate-x-0.5" />
                Dispatch Emergency
              </motion.button>
            ) : unit.arrived ? (
              <motion.div
                key="arrived"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex h-9 items-center justify-center gap-2 rounded-[4px] border border-emerald-400/35 bg-emerald-400/[0.08] font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-300"
              >
                <CircleCheck size={13} /> Unit arrived · corridor released
              </motion.div>
            ) : activating ? (
              <motion.div
                key="activating"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex h-9 items-center justify-center gap-2 rounded-[4px] border border-ops-cyan/50 bg-ops-cyan/[0.07] font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-ops-cyan"
              >
                <Loader size={12} className="animate-spin" />
                Activating Signals
              </motion.div>
            ) : open ? (
              <motion.button
                key="hold"
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => onToggleCorridor(unit.id)}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-[4px] border border-white/15 bg-white/[0.03] font-mono text-[9.5px] font-semibold uppercase tracking-[0.24em] text-slate-200 transition-colors hover:border-ops-amber/50 hover:bg-ops-amber/[0.06] hover:text-ops-amber"
              >
                <Timer size={13} /> Hold Corridor
              </motion.button>
            ) : (
              <motion.button
                key="open"
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                whileHover={{ boxShadow: '0 0 24px rgba(47,224,138,0.4)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onToggleCorridor(unit.id)}
                className="group relative flex h-9 w-full items-center justify-center gap-2 overflow-hidden rounded-[4px] bg-emerald-400 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-night-950 transition-colors hover:bg-emerald-300"
              >
                <Siren size={14} className="transition-transform group-hover:-translate-x-0.5" />
                Open Green Corridor
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* route / junction telemetry */}
        <div className="flex-1 px-3 pb-2.5 pt-3">
          <div className="flex items-center justify-between gap-1">
            <MicroLabel className="text-slate-600">
              {open && coordinated > 0 ? 'Corridor Wave' : 'Intersections'}
            </MicroLabel>
            <span className="font-mono text-[8.5px] tracking-[0.12em] text-slate-600">
              {open && coordinated > 0 ? `${coordinated} IN WINDOW` : `${unit.intersections} COORDINATED`}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {tel.map((j, i) => {
              if (open && waveById.has(j)) {
                const c = waveById.get(j)!
                const state: ChipState =
                  c.status === 'PASSED'
                    ? 'passed'
                    : c.status === 'ACTIVE'
                      ? 'held'
                      : c.status === 'PREPARING'
                        ? 'prep'
                        : 'future'
                return (
                  <JunctionChip
                    key={j}
                    label={j}
                    state={state}
                    eta={
                      c.status === 'PREPARING' ? Math.max(1, Math.round(c.etaSec)) : undefined
                    }
                  />
                )
              }
              const state: ChipState = pending
                ? 'future'
                : unit.arrived || i < t.nextIdx
                  ? 'passed'
                  : i === t.nextIdx
                    ? open
                      ? 'held'
                      : 'next'
                    : 'future'
              return <JunctionChip key={j} label={j} state={state} />
            })}
          </div>

          {/* progress */}
          <div className="mt-3">
            <div className="flex items-center justify-between font-mono text-[8px] tracking-[0.14em] text-slate-600">
              <span>Route Progress</span>
              <span className="tabular text-slate-500">
                {pending ? 'AWAITING DISPATCH' : `${Math.round(progress * 100)}%`}
              </span>
            </div>
            <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  open
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(47,224,138,0.8)]'
                    : activating
                      ? 'bg-ops-cyan/70'
                      : 'bg-slate-600',
                )}
                animate={{ width: `${progress * 100}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 26 }}
              />
            </div>
          </div>

          {/* meta grid */}
          <div className="mt-3 grid grid-cols-2 divide-x divide-white/[0.05] rounded-[4px] border border-white/[0.05]">
            <div className="px-2.5 py-2">
              <MicroLabel className="text-slate-600">Next Junction</MicroLabel>
              <div
                className={cn(
                  'mt-1 font-mono text-[13px] font-semibold tracking-[0.1em]',
                  open ? 'text-emerald-300' : 'text-slate-200',
                )}
              >
                {unit.arrived ? '—' : pending ? 'AWAITING DISPATCH' : tel[t.nextIdx] ?? 'ARRIVAL'}
              </div>
            </div>
            <div className="px-2.5 py-2">
              <MicroLabel className="text-slate-600">Corridor Traffic</MicroLabel>
              {pending ? (
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-500">
                  <Led tone="slate" size={5} />
                  STANDBY
                </div>
              ) : incident ? (
                <div className="danger-glow mt-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.1em] text-ops-red">
                  <span className="h-[5px] w-[5px] rounded-full bg-ops-red" />
                  CRITICAL · {incident.junctionId}
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-200">
                  <Led tone={open ? 'green' : 'cyan'} pulse={open} size={5} />
                  {open ? 'CLEARED' : 'MODERATE'}
                </div>
              )}
            </div>
          </div>

          {/* route options — both paths come out of the routing engine */}
          <div className="mt-2.5 overflow-hidden rounded-[4px] border border-white/[0.05]">
            <div className="flex items-center justify-between border-b border-white/[0.04] px-2.5 py-[5px]">
              <MicroLabel className="text-slate-600">Route Options</MicroLabel>
              <span className="font-mono text-[7.5px] tracking-[0.16em] text-slate-700">LIVE ROUTING</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              <div className="flex items-center justify-between gap-2 px-2.5 py-[6px]">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Pill tone="green" className="px-1 py-[1px]">
                    Fastest
                  </Pill>
                  <span className="truncate font-mono text-[9px] tracking-[0.06em] text-slate-300">
                    {unit.junctionIds.length > 0
                      ? `${unit.junctionIds[0]}→${unit.junctionIds[unit.junctionIds.length - 1]} · ${unit.distanceKm.toFixed(1)} KM`
                      : '—'}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[9.5px] font-semibold tabular text-slate-200">
                  {fmtClock(unit.baselineSec)} <span className="font-normal text-slate-600">ETA</span>
                </span>
              </div>
              {altRoute && (
                <div className="flex items-center justify-between gap-2 px-2.5 py-[6px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Pill tone="slate" className="px-1 py-[1px]">
                      Alt
                    </Pill>
                    <span className="truncate font-mono text-[9px] tracking-[0.06em] text-slate-500">
                      {altRoute.label} · {altRoute.km.toFixed(1)} KM
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[9.5px] font-semibold tabular text-slate-400">
                    {fmtClock(altRoute.etaSec)} <span className="font-normal text-slate-700">ETA</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.06] px-3">
        <span className="font-mono text-[7.5px] tracking-[0.2em] text-slate-700">
          SIGNAL PHASE SYNC · 40 MHZ
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[7.5px] tracking-[0.12em] text-slate-600">
          <Led tone="cyan" pulse size={3.5} /> T+ {Math.round(progress * unit.baselineSec)}s
        </span>
      </div>
    </motion.aside>
  )
}
