import { motion } from 'framer-motion'
import { MicroLabel } from './ui'

const ROWS = [
  { label: 'Normal', hex: '#5b6b85' },
  { label: 'Moderate', hex: '#4d8fc9' },
  { label: 'Heavy', hex: '#e8a13c' },
  { label: 'Critical', hex: '#ef3d52' },
]

export default function TrafficLegend({ className }: { className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.9 }}
      className={`pointer-events-none absolute bottom-2.5 left-3 z-20 flex items-center gap-4 rounded-[5px] border border-white/[0.06] bg-night-900/70 px-3 py-2 backdrop-blur-[2px] ${className ?? ''}`}
    >
      <MicroLabel className="text-slate-500">Traffic Conditions</MicroLabel>
      <div className="flex items-center gap-3">
        {ROWS.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5">
            <span
              className="h-[6px] w-[6px] rounded-full"
              style={{ backgroundColor: r.hex, boxShadow: `0 0 5px ${r.hex}88` }}
            />
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">
              {r.label}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
