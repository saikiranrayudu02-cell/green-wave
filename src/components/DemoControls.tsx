import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Plus, AlertTriangle, RotateCcw, Siren, CircleDot } from 'lucide-react'
import { cn } from '../lib/cn'
import { MicroLabel } from './ui'
import type { Mode } from '../types'

interface Props {
  mode: Mode
  incidentActive: boolean
  canAdd: boolean
  onMode: (m: Mode) => void
  onAddEmergency: () => void
  onInjectIncident: () => void
  onReset: () => void
}

function Seg({
  active,
  children,
  onClick,
  danger,
}: {
  active: boolean
  danger?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'relative rounded-[3px] px-3 py-[5px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] transition-colors',
        active
          ? danger
            ? 'text-ops-red'
            : 'text-ops-cyan'
          : 'text-slate-500 hover:text-slate-300',
      )}
    >
      {active && (
        <motion.span
          layoutId="seg-active"
          transition={{ type: 'spring', stiffness: 450, damping: 34 }}
          className={cn(
            'absolute inset-0 rounded-[3px] border',
            danger
              ? 'border-ops-red/50 bg-ops-red/[0.08]'
              : 'border-ops-cyan/50 bg-ops-cyan/[0.08]',
          )}
        />
      )}
      <span className="relative flex items-center gap-1.5">{children}</span>
    </motion.button>
  )
}

export default function DemoControls({
  mode,
  incidentActive,
  canAdd,
  onMode,
  onAddEmergency,
  onInjectIncident,
  onReset,
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.75, ease: 'easeOut' }}
      style={{ x: '-50%' }}
      className="pointer-events-auto absolute bottom-3 sm:bottom-6 left-1/2 z-30 flex max-w-[95vw] overflow-x-auto scrollbar-none h-[38px] sm:h-[40px] items-center gap-2 sm:gap-3 rounded-md border border-white/[0.08] bg-night-900/90 px-2 sm:px-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <div className="flex items-center gap-2.5">
        <MicroLabel className="text-slate-600">Mode</MicroLabel>
        <div className="flex items-center rounded-[4px] border border-white/[0.07] bg-night-950 p-[2px]">
          <Seg active={mode === 'fixed'} onClick={() => onMode('fixed')}>
            <CircleDot size={10} />
            Fixed Timing
          </Seg>
          <Seg active={mode === 'greenwave'} onClick={() => onMode('greenwave')}>
            <Siren size={10} />
            GreenWave
          </Seg>
        </div>
      </div>

      <div className="h-5 w-px bg-white/[0.08]" />

      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onAddEmergency}
          disabled={!canAdd}
          title={canAdd ? 'Dispatch a second unit' : 'Unit B already en route'}
          className={cn(
            'flex items-center gap-1.5 rounded-[3px] border px-2.5 py-[5px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] transition-colors',
            canAdd
              ? 'border-white/10 text-slate-300 hover:border-ops-cyan/50 hover:bg-ops-cyan/[0.06] hover:text-ops-cyan'
              : 'cursor-not-allowed border-white/[0.05] text-slate-600',
          )}
        >
          <Plus size={11} />
          Add Emergency
        </motion.button>

        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onInjectIncident}
          className={cn(
            'flex items-center gap-1.5 rounded-[3px] border px-2.5 py-[5px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] transition-colors',
            incidentActive
              ? 'border-ops-red/40 bg-ops-red/[0.08] text-ops-red'
              : 'border-white/10 text-slate-300 hover:border-ops-red/50 hover:bg-ops-red/[0.07] hover:text-ops-red',
          )}
        >
          <AlertTriangle size={11} />
          {incidentActive ? 'Incident Active' : 'Inject Incident'}
        </motion.button>

        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onReset}
          title="Reset demo state"
          className="flex items-center gap-1.5 rounded-[3px] border border-white/10 px-2 py-[5px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-slate-500 transition-colors hover:border-white/25 hover:text-slate-200"
        >
          <RotateCcw size={11} />
          Reset
        </motion.button>
      </div>
    </motion.div>
  )
}
