import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertTriangle, Siren, Info, X } from 'lucide-react'
import type { Toast } from '../types'
import { cn } from '../lib/cn'
import { Led } from './ui'
import type { Tone } from './ui'

const KIND: Record<
  Toast['kind'],
  { icon: typeof Info; tone: Tone; label: string }
> = {
  info: { icon: Info, tone: 'cyan', label: 'INFO' },
  success: { icon: CheckCircle2, tone: 'green', label: 'CONFIRMED' },
  warning: { icon: AlertTriangle, tone: 'amber', label: 'ALERT' },
  critical: { icon: Siren, tone: 'red', label: 'CRITICAL' },
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const cfg = KIND[toast.kind]
  const Icon = cfg.icon
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 46, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 30, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className={cn(
        'pointer-events-auto relative flex w-[320px] items-start gap-2.5 overflow-hidden rounded-[5px] border bg-night-850/95 px-3 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-[3px]',
        toast.kind === 'critical' && 'border-ops-red/40',
        toast.kind === 'warning' && 'border-ops-amber/35',
        toast.kind === 'success' && 'border-emerald-400/35',
        toast.kind === 'info' && 'border-ops-cyan/30',
      )}
    >
      <div
        className={cn(
          'absolute left-0 top-0 h-full w-[2px]',
          toast.kind === 'critical' && 'bg-ops-red',
          toast.kind === 'warning' && 'bg-ops-amber',
          toast.kind === 'success' && 'bg-emerald-400',
          toast.kind === 'info' && 'bg-ops-cyan',
        )}
      />
      <div className="mt-[1px]">
        <Icon
          size={15}
          className={cn(
            toast.kind === 'critical' && 'text-ops-red',
            toast.kind === 'warning' && 'text-ops-amber',
            toast.kind === 'success' && 'text-emerald-400',
            toast.kind === 'info' && 'text-ops-cyan',
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-200">
            {toast.title}
          </span>
          <Led tone={cfg.tone} pulse size={5} />
        </div>
        {toast.body && (
          <div className="mt-[3px] font-mono text-[9.5px] leading-[1.5] tracking-[0.04em] text-slate-400">
            {toast.body}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        className="mt-0.5 shrink-0 text-slate-600 transition-colors hover:text-slate-300"
      >
        <X size={11} />
      </button>
    </motion.div>
  )
}

export default function IncidentAlert({
  toasts,
  incidentActive,
  onClose,
  children,
}: {
  toasts: Toast[]
  incidentActive: boolean
  onClose: (id: number) => void
  children?: ReactNode
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-40 flex w-[330px] flex-col items-end gap-2">
      {!incidentActive && toasts.length === 0 && children}
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={onClose} />
        ))}
      </AnimatePresence>
    </div>
  )
}
