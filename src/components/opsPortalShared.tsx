// ---------------------------------------------------------------------------
// EMERGENCY OPS — shared presentational helpers for the three role portals.
// Small, pure UI primitives only: no state, no engines, no events.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import { MicroLabel } from './ui'
import { cn } from '../lib/cn'
import type { CityNotificationStatus } from '../arogya/emergencyCase'

export function Field({
  icon,
  label,
  children,
  valueClass,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
  valueClass?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border border-white/[0.06] bg-white/[0.02] text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <MicroLabel className="text-slate-600">{label}</MicroLabel>
        <div className={cn('mt-[2px] truncate text-[11px] font-medium text-slate-100', valueClass)}>{children}</div>
      </div>
    </div>
  )
}

export function FileTextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[10px] w-[10px]" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

/** pre-arrival checklist row — done state derives from REAL shared case state */
export function CheckRow({ done, label, tail }: { done: boolean; label: string; tail?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'flex h-[13px] w-[13px] items-center justify-center rounded-[2px] border',
            done ? 'border-emerald-400/40 bg-emerald-400/[0.12] text-emerald-300' : 'border-white/[0.08] bg-white/[0.01] text-transparent',
          )}
        >
          <CircleCheck size={9} />
        </span>
        <span className={cn('font-mono text-[8.5px] tracking-[0.08em]', done ? 'text-slate-300' : 'text-slate-600')}>
          {label}
        </span>
      </span>
      {tail}
    </div>
  )
}

export const CITY_LABEL: Record<CityNotificationStatus, string> = {
  NOT_SENT: 'ALERT NOT SENT',
  REQUESTED: 'ROUTE REQUEST RECEIVED',
  ACKNOWLEDGED: 'ROUTE ACKNOWLEDGED',
}