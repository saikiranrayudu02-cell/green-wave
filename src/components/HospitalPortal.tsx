// ---------------------------------------------------------------------------
// HOSPITAL RECEIVING PORTAL — one of the role views over the SAME case.
//
// The hospital receives the incoming patient through the shared case, ACCEPTS
// or DECLINES it, prepares the ED (operational readiness checklist — NOT real
// IoT equipment control), and confirms patient handover on arrival. Every
// value derives from the ONE shared case + the authoritative GreenWave ETA.
// Clinical handoff / Doctor Copilot are the existing ArogyaOS demo boundary
// (clearly labelled, non-diagnostic).
// ---------------------------------------------------------------------------

import { motion } from 'framer-motion'
import { Ambulance, Building2, CircleCheck, HeartPulse, Navigation, ShieldCheck, Stethoscope, Timer, XCircle, BedDouble, DoorOpen } from 'lucide-react'
import type { EmergencyRuntime } from '../types'
import {
  readinessScore,
  READINESS_KEYS,
  READINESS_LABELS,
  type EmergencyCase,
  type CaseStatus,
  type HospitalNotificationStatus,
  type HospitalReadiness,
} from '../arogya/emergencyCase'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel } from './ui'
import { Field, FileTextIcon, CheckRow } from './opsPortalShared'

interface Props {
  emergencyCase: EmergencyCase
  unit: EmergencyRuntime
  etaSec: number
  caseStatus: CaseStatus
  hospStatus: HospitalNotificationStatus
  onHospitalAcknowledge: () => void
  onHospitalDecline: () => void
  onHospitalReady: () => void
  onToggleResource: (key: keyof HospitalReadiness) => void
  onHandoverComplete: () => void
  onOpenHandoff: () => void
}

function tierTone(tier: ReturnType<typeof readinessScore>['tier']): { text: string; ring: string; label: string } {
  switch (tier) {
    case 'READY':
      return { text: 'text-emerald-300', ring: 'stroke-emerald-400', label: 'READY TO RECEIVE' }
    case 'PARTIALLY_READY':
      return { text: 'text-ops-amber', ring: 'stroke-ops-amber', label: 'PARTIALLY READY' }
    default:
      return { text: 'text-ops-red', ring: 'stroke-ops-red', label: 'NOT READY' }
  }
}

export default function HospitalPortal({
  emergencyCase,
  unit,
  etaSec,
  caseStatus,
  hospStatus,
  onHospitalAcknowledge,
  onHospitalDecline,
  onHospitalReady,
  onToggleResource,
  onHandoverComplete,
  onOpenHandoff,
}: Props) {
  const accepted = hospStatus === 'ACCEPTED' || hospStatus === 'PREPARING' || hospStatus === 'READY'
  const declined = hospStatus === 'DECLINED'
  const arrived = caseStatus === 'ARRIVED'
  const handedOver = emergencyCase.handoffStatus === 'COMPLETED'
  const score = readinessScore(emergencyCase.readiness)
  const tone = tierTone(score.tier)
  // pre-arrival countdown ring (0..1) — bounded by a nominal 6-min approach
  const countdownFrac = Math.max(0, Math.min(1, etaSec / 360))

  return (
    <div className="space-y-2.5">
      <div className="rounded-[4px] border border-white/[0.05] bg-white/[0.012] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300">
            <Building2 size={12} />
          </span>
          <div className="leading-tight">
            <div className="truncate font-mono text-[10.5px] font-semibold tracking-[0.08em] text-slate-100">
              {emergencyCase.hospitalName}
            </div>
            <div className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">EMERGENCY RECEIVING</div>
          </div>
        </div>
        <div className="mt-2.5 space-y-2">
          <Field icon={<FileTextIcon />} label="Case">{emergencyCase.caseId}</Field>
          <div className="grid grid-cols-2 gap-2">
            <Field icon={<Ambulance size={10} />} label="Ambulance">{unit.tac}</Field>
            <Field icon={<HeartPulse size={10} />} label="Priority">{unit.priority}</Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field icon={<Timer size={10} />} label="ETA">
              <span className="font-mono text-[12px] font-semibold tabular text-ops-cyan">{fmtClock(Math.max(0, etaSec))}</span>
            </Field>
            <Field icon={<Navigation size={10} />} label="Status">
              {arrived ? 'ARRIVED' : caseStatus === 'ARRIVING' ? 'ARRIVING' : 'EN ROUTE'}
            </Field>
          </div>
          {accepted && (emergencyCase.bedAssignment || emergencyCase.gate) && (
            <div className="grid grid-cols-2 gap-2">
              <Field icon={<BedDouble size={10} />} label="Bed">{emergencyCase.bedAssignment ?? '—'}</Field>
              <Field icon={<DoorOpen size={10} />} label="Gate">{emergencyCase.gate ?? '—'}</Field>
            </div>
          )}
        </div>
      </div>

      {/* pre-arrival countdown — authoritative GreenWave ETA, no new clock */}
      {accepted && !arrived && (
        <div className="rounded-[4px] border border-ops-cyan/20 bg-ops-cyan/[0.03] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-ops-cyan">
              <Led tone="cyan" pulse size={4} /> Incoming · Arrival Countdown
            </span>
            <span className="font-mono text-[15px] font-bold tabular text-ops-cyan">{fmtClock(Math.max(0, etaSec))}</span>
          </div>
          <div className="mt-2 h-[6px] w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-ops-cyan/60 to-emerald-400/70 transition-[width] duration-500"
              style={{ width: `${Math.round((1 - countdownFrac) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[7px] tracking-[0.12em] text-slate-600">
            <span>{unit.tac}</span>
            <span className={cn(unit.corridorOpen && !unit.arrived ? 'text-emerald-300' : 'text-slate-600')}>
              {unit.corridorOpen && !unit.arrived ? 'GREEN CORRIDOR HELD ✓' : 'CORRIDOR STANDBY'}
            </span>
          </div>
        </div>
      )}

      {/* hospital readiness score — pure projection of the resource toggles */}
      {accepted && (
        <div className="rounded-[4px] border border-white/[0.05] px-2.5 py-2">
          <div className="flex items-center gap-3">
            <div className="relative h-[52px] w-[52px] shrink-0">
              <svg viewBox="0 0 52 52" className="h-full w-full -rotate-90">
                <circle cx="26" cy="26" r="22" className="fill-none stroke-white/[0.06]" strokeWidth="5" />
                <circle
                  cx="26"
                  cy="26"
                  r="22"
                  className={cn('fill-none transition-[stroke-dashoffset] duration-500', tone.ring)}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 22}
                  strokeDashoffset={2 * Math.PI * 22 * (1 - score.pct / 100)}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn('font-mono text-[13px] font-bold tabular', tone.text)}>{score.pct}%</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <MicroLabel className="text-slate-600">Hospital Readiness</MicroLabel>
              <div className={cn('mt-0.5 font-mono text-[10px] font-bold tracking-[0.12em]', tone.text)}>{tone.label}</div>
              <div className="mt-0.5 font-mono text-[7.5px] tracking-[0.1em] text-slate-600">
                {score.ready}/{score.total} RESOURCES CONFIRMED
              </div>
            </div>
          </div>
          {/* resource toggles — real state on the shared case */}
          <div className="mt-2 grid grid-cols-1 gap-1">
            {READINESS_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                disabled={hospStatus === 'READY'}
                onClick={() => onToggleResource(k)}
                className="flex w-full items-center justify-between rounded-[3px] px-0.5 py-[3px] text-left transition-colors hover:bg-white/[0.02] disabled:cursor-default"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'flex h-[13px] w-[13px] items-center justify-center rounded-[2px] border',
                      emergencyCase.readiness[k]
                        ? 'border-emerald-400/40 bg-emerald-400/[0.12] text-emerald-300'
                        : 'border-white/[0.08] bg-white/[0.01] text-transparent',
                    )}
                  >
                    <CircleCheck size={9} />
                  </span>
                  <span className={cn('font-mono text-[8.5px] tracking-[0.08em]', emergencyCase.readiness[k] ? 'text-slate-300' : 'text-slate-600')}>
                    {READINESS_LABELS[k]}
                  </span>
                </span>
                <span className={cn('font-mono text-[7.5px] font-bold tracking-[0.12em]', emergencyCase.readiness[k] ? 'text-emerald-300' : 'text-slate-700')}>
                  {emergencyCase.readiness[k] ? 'READY' : 'PENDING'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* pre-arrival checklist — every row derives from REAL shared state */}
      <div className="rounded-[4px] border border-white/[0.05] px-2.5 py-2">
        <MicroLabel className="mb-1.5 text-slate-600">Pre-Arrival Checklist</MicroLabel>
        <div className="space-y-1.5">
          <CheckRow done label="Case information received" />
          <CheckRow done={accepted} label="Emergency department notified" />
          <CheckRow done={emergencyCase.handoffStatus !== 'NOT_READY'} label="Clinical handoff available" />
          <CheckRow done={emergencyCase.clinical.doctorCopilot} label="Doctor Copilot available" />
          <CheckRow
            done={arrived}
            label="Patient arrival"
            tail={
              hospStatus === 'READY' && !arrived ? (
                <span className="flex items-center gap-1.5 font-mono text-[8px] font-bold tracking-[0.12em] text-emerald-300">
                  <Led tone="green" pulse size={4} /> ED READY
                </span>
              ) : arrived ? (
                <span className="font-mono text-[8px] font-bold tracking-[0.12em] text-emerald-300">ARRIVED</span>
              ) : null
            }
          />
        </div>
      </div>

      {/* clinical handoff + doctor copilot (existing ArogyaOS demo boundary) */}
      <div className="rounded-[4px] border border-white/[0.05] bg-white/[0.012] px-2.5 py-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-slate-400">
            <Stethoscope size={10} className="text-emerald-300" />
            Clinical Handoff
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[8px] font-bold tracking-[0.12em] text-slate-300">
            <Led tone="green" size={4} />
            {emergencyCase.handoffStatus === 'COMPLETED' ? 'COMPLETED' : emergencyCase.handoffStatus === 'REVIEWED' ? 'REVIEWED' : 'READY'}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenHandoff}
          className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border border-ops-cyan/40 bg-ops-cyan/[0.06] font-mono text-[8.5px] font-bold uppercase tracking-[0.18em] text-ops-cyan transition-colors hover:bg-ops-cyan/[0.12]"
        >
          Open Doctor Copilot
        </button>
      </div>

      {/* hospital actions */}
      <div className="space-y-1.5">
        {declined ? (
          <div className="flex h-8 w-full items-center justify-center gap-2 rounded-[4px] border border-ops-red/40 bg-ops-red/[0.08] font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-ops-red">
            <XCircle size={12} /> Case Declined · Awaiting Reroute
          </div>
        ) : !accepted ? (
          <div className="grid grid-cols-2 gap-1.5">
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={onHospitalAcknowledge}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[4px] border border-emerald-400/50 bg-emerald-400/[0.08] font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300 transition-colors hover:bg-emerald-400/[0.16]"
            >
              <CircleCheck size={12} /> Accept
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={onHospitalDecline}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[4px] border border-ops-red/40 bg-ops-red/[0.05] font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ops-red/90 transition-colors hover:bg-ops-red/[0.12]"
            >
              <XCircle size={12} /> Decline
            </motion.button>
          </div>
        ) : arrived ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={onHandoverComplete}
            disabled={handedOver}
            className={cn(
              'flex h-9 w-full items-center justify-center gap-2 rounded-[4px] border font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] transition-colors disabled:opacity-70',
              handedOver
                ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-300'
                : 'border-emerald-400/60 bg-emerald-400/[0.12] text-emerald-200 hover:bg-emerald-400/[0.2]',
            )}
          >
            <ShieldCheck size={13} />
            {handedOver ? 'Handover Complete · Mission Closed' : 'Confirm Patient Handover'}
          </motion.button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={onHospitalReady}
            disabled={hospStatus === 'READY'}
            className={cn(
              'flex h-8 w-full items-center justify-center gap-2 rounded-[4px] border font-mono text-[9px] font-bold uppercase tracking-[0.2em] transition-colors disabled:opacity-60',
              hospStatus === 'READY'
                ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-300'
                : 'border-emerald-400/40 bg-emerald-400/[0.06] text-emerald-300 hover:bg-emerald-400/[0.12]',
            )}
          >
            {hospStatus === 'READY' ? <ShieldCheck size={12} /> : <Timer size={12} />}
            {hospStatus === 'READY' ? 'ED Ready' : 'Mark ED Ready'}
          </motion.button>
        )}
      </div>
    </div>
  )
}
