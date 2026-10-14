// ---------------------------------------------------------------------------
// AROGYAOS × GREENWAVE — hospital receiving status card
//
// Pure projection of EXISTING GreenWave runtime state onto the receiving
// hospital: receiving state derives from the real unit lifecycle, the ETA is
// the authoritative GreenWave ETA, and handoff/copilot readiness comes from
// the ArogyaOS case boundary. No timers, no second simulation.
// ---------------------------------------------------------------------------

import { Building2 } from 'lucide-react'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel } from './ui'
import type { EmergencyCase, CaseStatus } from '../arogya/emergencyCase'

interface Props {
  emergencyCase: EmergencyCase | null
  /** derived from the existing unit lifecycle (caseStatusForUnit) */
  caseStatus: CaseStatus | null
  /** live remaining ETA from the authoritative GreenWave model (s) */
  etaSec: number
  /** existing corridor state of the unit */
  corridorOpen: boolean
  corridorReleased: boolean
  onReviewHandoff: () => void
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  CREATED: 'STANDBY',
  DISPATCHED: 'RECEIVING',
  EN_ROUTE: 'RECEIVING',
  ARRIVING: 'ARRIVING',
  ARRIVED: 'ARRIVED',
  CLOSED: 'CLOSED',
}

function statusTone(s: CaseStatus): 'cyan' | 'amber' | 'green' | 'slate' {
  switch (s) {
    case 'ARRIVED':
      return 'green'
    case 'ARRIVING':
      return 'amber'
    case 'DISPATCHED':
    case 'EN_ROUTE':
      return 'cyan'
    default:
      return 'slate'
  }
}

export default function HospitalReceivingCard({
  emergencyCase,
  caseStatus,
  etaSec,
  corridorOpen,
  corridorReleased,
  onReviewHandoff,
}: Props) {
  if (!emergencyCase || !caseStatus) {
    return (
      <div className="overflow-hidden rounded-md border border-white/[0.07] bg-night-900">
        <div className="flex h-8 items-center gap-2 border-b border-white/[0.05] px-3">
          <Building2 size={11} className="text-slate-600" />
          <MicroLabel className="text-slate-500">Hospital Receiving</MicroLabel>
        </div>
        <div className="px-3 py-3 text-center font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-600">
          NO ACTIVE EMERGENCY CASE · STANDBY
        </div>
      </div>
    )
  }

  const arrived = caseStatus === 'ARRIVED'
  const label = STATUS_LABEL[caseStatus]
  const tone = statusTone(caseStatus)

  return (
    <div className="overflow-hidden rounded-md border border-white/[0.07] bg-night-900">
      <div className="flex h-8 items-center justify-between border-b border-white/[0.05] px-3">
        <div className="flex items-center gap-2">
          <Building2 size={11} className="text-ops-cyan" />
          <MicroLabel className="text-slate-400">Hospital Receiving</MicroLabel>
        </div>
        <span className="font-mono text-[7.5px] tracking-[0.16em] text-slate-600">
          AROGYAOS
        </span>
      </div>

      <div className="px-3 py-2.5">
        {/* hospital + receiving state */}
        <div className="flex items-center gap-2">
          <Led tone={tone} pulse={!arrived && caseStatus !== 'CREATED'} size={6} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-slate-100">
              {emergencyCase.hospitalName}
            </div>
            <div className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">
              CASE {emergencyCase.caseId} · {emergencyCase.patientRef}
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-[2px] border px-1.5 py-[2px] font-mono text-[8px] font-bold tracking-[0.14em]',
              arrived
                ? 'border-emerald-400/40 text-emerald-300'
                : caseStatus === 'ARRIVING'
                  ? 'border-ops-amber/40 text-ops-amber'
                  : 'border-ops-cyan/40 text-ops-cyan',
            )}
          >
            {label}
          </span>
        </div>

        {/* operational grid — all values from existing GreenWave state */}
        <div className="mt-2.5 grid grid-cols-3 divide-x divide-white/[0.05] rounded-[4px] border border-white/[0.05]">
          <div className="px-2.5 py-1.5">
            <MicroLabel className="text-slate-600">Incoming Unit</MicroLabel>
            <div className="mt-[2px] font-mono text-[11px] font-semibold text-slate-100">
              {emergencyCase.ambulanceUnitId}
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <MicroLabel className="text-slate-600">ETA</MicroLabel>
            <div className="mt-[2px] font-mono text-[11px] font-semibold tabular text-ops-cyan">
              {arrived ? '00:00' : fmtClock(Math.max(0, etaSec))}
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <MicroLabel className="text-slate-600">Priority</MicroLabel>
            <div
              className={cn(
                'mt-[2px] font-mono text-[10px] font-bold tracking-[0.08em]',
                emergencyCase.priority === 'CRITICAL' ? 'text-ops-red' : 'text-ops-amber',
              )}
            >
              {emergencyCase.priority}
            </div>
          </div>
        </div>

        {/* corridor + handoff readiness */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 rounded-[4px] border border-white/[0.05] px-2.5 py-1.5">
            <Led
              tone={corridorOpen ? 'green' : corridorReleased ? 'slate' : 'slate'}
              pulse={corridorOpen}
              size={4}
            />
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-slate-400">
              {corridorOpen ? 'CORRIDOR ACTIVE' : corridorReleased ? 'CORRIDOR RELEASED' : 'CORRIDOR STANDBY'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-[4px] border border-white/[0.05] px-2.5 py-1.5">
            <Led tone={emergencyCase.handoffStatus === 'NOT_READY' ? 'amber' : 'green'} size={4} />
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-slate-400">
              HANDOFF {caseStatus === 'CLOSED' ? 'COMPLETED' : emergencyCase.handoffStatus}
            </span>
          </div>
        </div>

        {/* review action */}
        <button
          type="button"
          onClick={onReviewHandoff}
          className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border border-ops-cyan/40 bg-ops-cyan/[0.06] font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-ops-cyan transition-colors hover:bg-ops-cyan/[0.12]"
        >
          Review Handoff
        </button>
      </div>
    </div>
  )
}
