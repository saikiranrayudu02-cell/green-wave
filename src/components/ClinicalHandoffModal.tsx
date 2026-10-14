// ---------------------------------------------------------------------------
// AROGYAOS × GREENWAVE — Doctor Copilot pre-arrival clinical handoff
//
// Clinician-facing operational view (no chat, no diagnosis claims):
//   · ETA / unit / destination come from the EXISTING GreenWave emergency
//     runtime — the same authoritative values shown everywhere else.
//   · Clinical availability is the ArogyaOS integration boundary's honest
//     probe (DEMO = demo) from src/arogya/emergencyCase.ts.
//   · The AI pre-arrival summary is a fixed information template labelled
//     "for clinician review · not a diagnosis".
// ---------------------------------------------------------------------------

import { motion } from 'framer-motion'
import { X, Stethoscope, FileText, Activity, ClipboardList, Sparkles, TriangleAlert } from 'lucide-react'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel } from './ui'
import type { EmergencyCase } from '../arogya/emergencyCase'
import { clinicalHandoffFor } from '../arogya/emergencyCase'

interface Props {
  open: boolean
  emergencyCase: EmergencyCase | null
  /** live remaining ETA from the authoritative GreenWave model (s) */
  etaSec: number
  /** the unit has physically arrived at the destination (existing sim state) */
  arrived: boolean
  onClose: () => void
  onMarkReviewed: () => void
}

function AvailRow({
  icon,
  label,
  available,
  detail,
}: {
  icon: React.ReactNode
  label: string
  available: boolean
  detail: string
}) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-2.5">
      <div className="mt-[1px] text-ops-cyan">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold text-slate-200">{label}</span>
          <span className={cn('flex items-center gap-1.5 font-mono text-[9px] tracking-[0.18em]', available ? 'text-emerald-400' : 'text-amber-400')}>
            <Led tone={available ? 'green' : 'amber'} size={4} />
            {available ? 'AVAILABLE' : 'DEMO ONLY'}
          </span>
        </div>
        <p className="mt-[3px] text-[10.5px] leading-snug text-slate-500">{detail}</p>
      </div>
    </div>
  )
}

export default function ClinicalHandoffModal({
  open,
  emergencyCase,
  etaSec,
  arrived,
  onClose,
  onMarkReviewed,
}: Props) {
  const bundle = emergencyCase ? clinicalHandoffFor(emergencyCase.greenwaveEmergencyId) : null

  return (
    /* The scrim is a PLAIN div OUTSIDE AnimatePresence so its pointer-events
       always follow the CURRENT `open` value. A child inside AnimatePresence
       replays stale `open=true` props during exit — if that exit frame is ever
       throttled, an invisible full-screen overlay would swallow app clicks.
       The scrim fade is CSS-driven for the same reason. */
    <div
      /* Inline styles, not classes/transitions: deterministic in throttled
         webviews where CSS transitions may freeze mid-flight. */
      style={{ pointerEvents: open ? 'auto' : 'none', opacity: open ? 1 : 0 }}
      className="fixed inset-0 z-[68] flex items-center justify-center bg-night-950/85 backdrop-blur-[3px]"
      onClick={onClose}
    >
      {/* No AnimatePresence / exit animation: an rAF-throttled exit freezes
          the panel on screen (observed live). Mount animation only — unmount
          is instant and deterministic. */}
      {open && emergencyCase && bundle && (
          <motion.div
            key="handoff"
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-[460px] overflow-hidden rounded-md border border-white/[0.09] bg-night-900 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
          >
            {/* header */}
            <header className="flex h-11 items-center justify-between border-b border-white/[0.06] px-4">
              <div className="flex items-center gap-2">
                <Stethoscope size={14} className="text-ops-cyan" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-100">
                  Doctor Copilot · Pre-Arrival Handoff
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-[3px] p-1 text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </header>

            {/* incoming emergency — real GreenWave operational state */}
            <div className="grid grid-cols-4 divide-x divide-white/[0.05] border-b border-white/[0.05] bg-night-950/40">
              <div className="px-3 py-2">
                <MicroLabel className="text-slate-600">Incoming ETA</MicroLabel>
                <div className="mt-[3px] font-mono text-[13px] font-semibold tabular text-ops-cyan">
                  {arrived ? '00:00' : fmtClock(Math.max(0, etaSec))}
                </div>
              </div>
              <div className="px-3 py-2">
                <MicroLabel className="text-slate-600">Unit</MicroLabel>
                <div className="mt-[3px] truncate font-mono text-[11px] font-semibold text-slate-100">
                  {emergencyCase.ambulanceUnitId}
                </div>
              </div>
              <div className="px-3 py-2">
                <MicroLabel className="text-slate-600">Priority</MicroLabel>
                <div className="mt-[3px] font-mono text-[11px] font-semibold text-red-400">
                  {emergencyCase.priority}
                </div>
              </div>
              <div className="px-3 py-2">
                <MicroLabel className="text-slate-600">Case</MicroLabel>
                <div className="mt-[3px] font-mono text-[11px] font-semibold text-slate-100">
                  {emergencyCase.caseId}
                </div>
              </div>
            </div>

            {/* receiving context */}
            <div className="flex items-center gap-2 border-b border-white/[0.05] bg-night-950/20 px-4 py-2">
              <TriangleAlert size={12} className="text-amber-400" />
              <span className="font-mono text-[10px] tracking-[0.14em] text-amber-300/90">
                RECEIVING HOSPITAL · {emergencyCase.hospitalName.toUpperCase()}
              </span>
            </div>

            {/* ArogyaOS clinical availability — honest integration probes */}
            <div className="divide-y divide-white/[0.04] border-b border-white/[0.05]">
              <AvailRow
                icon={<FileText size={13} />}
                label="Medical Report (OCR)"
                available={bundle.medicalReport.available}
                detail="DEMO DATA AVAILABLE — no OCR engine connected in this build"
              />
              <AvailRow
                icon={<Activity size={13} />}
                label="Report Analysis"
                available={bundle.reportAnalysis.available}
                detail="DEMO ANALYSIS AVAILABLE — simulated report summary for review"
              />
              <AvailRow
                icon={<ClipboardList size={13} />}
                label="Health Baseline"
                available={bundle.healthBaseline.available}
                detail="DEMO BASELINE AVAILABLE — simulated observations for review"
              />
            </div>

            {/* AI pre-arrival summary — fixed template, clearly labelled */}
            <div className="px-4 py-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkles size={12} className="text-ops-cyan" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                  AI Pre-Arrival Summary
                </span>
              </div>
              <div className="space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                <p>
                  Pre-arrival context assembled for case {emergencyCase.caseId} ({emergencyCase.priority} ·{' '}
                  {emergencyCase.emergencyType}).
                </p>
                <p>Patient reference is synthetic demo data — no real patient record is connected.</p>
                <p>
                  Availability flags above state exactly which ArogyaOS subsystems are attached to this build.
                </p>
                <p className="text-slate-600">AI-generated clinical summary for clinician review. Not a diagnosis.</p>
              </div>
            </div>

            {/* footer */}
            <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-night-950/60 px-4 py-2.5">
              <span className="font-mono text-[9px] leading-snug tracking-[0.1em] text-slate-600">
                DEMO / SIMULATED CLINICAL INFORMATION · AI-GENERATED SUMMARY FOR CLINICIAN REVIEW · NOT A DIAGNOSIS
              </span>
              <button
                type="button"
                onClick={() => {
                  onMarkReviewed()
                  onClose()
                }}
                className="shrink-0 rounded-[4px] border border-ops-cyan/40 bg-ops-cyan/10 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-ops-cyan transition-colors hover:bg-ops-cyan/20"
              >
                REVIEW CLINICAL INFORMATION
              </button>
            </footer>
          </motion.div>
      )}
    </div>
  )
}
