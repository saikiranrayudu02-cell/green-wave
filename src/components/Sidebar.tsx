import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Siren,
  Route,
  Activity,
  Boxes,
  BarChart3,
  Settings,
  RadioTower,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { Led, MicroLabel } from './ui'
import { useSystemStatus } from './useSystemStatus'
import { cameraBackendOnline } from '../engine/trafficDemand'

interface Item {
  id: string
  label: string
  icon: typeof LayoutDashboard
  phase2?: boolean
}

const NAV: Item[] = [
  { id: 'command', label: 'Command Center', icon: LayoutDashboard },
  { id: 'emergencies', label: 'Emergencies', icon: Siren },
  { id: 'corridors', label: 'Active Corridors', icon: Route },
  { id: 'traffic', label: 'Live Traffic', icon: Activity },
  { id: 'digital-twin', label: 'Digital Twin', icon: Boxes },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'system', label: 'System', icon: Settings },
  { id: 'ops', label: 'Emergency Ops', icon: RadioTower },
]

function BrandMark() {
  return (
    <div className="flex items-center justify-center lg:justify-start gap-2.5">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-ops-cyan/30 bg-gradient-to-b from-night-700/80 to-night-850 shadow-[0_0_18px_rgba(56,196,224,0.14)]">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none">
          <path
            d="M2 16.5 L7 16.5 L9.5 9 L13.5 20 L16.5 9 L18 13 L22 13"
            stroke="#38c4e0"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="absolute -bottom-[3px] -right-[3px] h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#2fe08a]" />
      </div>
      <div className="leading-none hidden lg:block">
        <div className="font-mono text-[13px] font-semibold tracking-[0.32em] text-slate-100">
          GREENWAVE
        </div>
        <div className="mt-1 text-[8.5px] font-medium uppercase tracking-[0.16em] text-slate-500">
          Emergency Mobility
        </div>
      </div>
    </div>
  )
}

export default function Sidebar({
  active,
  onNavigate,
}: {
  /** currently open module id */
  active: string
  onNavigate: (id: string, label: string) => void
}) {
  return (
    <aside className="relative z-20 hidden md:flex md:w-[64px] lg:w-[218px] shrink-0 flex-col border-r border-white/[0.06] bg-night-900 transition-all duration-200">
      {/* brand */}
      <div className="border-b border-white/[0.05] p-3 lg:px-4 lg:pb-4 lg:pt-[18px]">
        <BrandMark />
        <div className="mt-4 hidden lg:flex items-center gap-2 px-0.5">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <MicroLabel className="text-slate-600">OPS NETWORK 01</MicroLabel>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-2 lg:px-2.5 py-4">
        <MicroLabel className="mb-2 hidden lg:block px-2 text-slate-600">Modules</MicroLabel>
        <ul className="space-y-[3px]">
          {NAV.map((item) => {
            const Icon = item.icon
            const isActive = item.id === active
            return (
              <li key={item.id}>
                <motion.button
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                  onClick={() => onNavigate(item.id, item.label)}
                  title={item.label}
                  className={cn(
                    'group relative flex w-full items-center justify-center lg:justify-start gap-2.5 rounded-[4px] px-2.5 py-[8px] text-left text-[11.5px]',
                    isActive
                      ? 'bg-white/[0.045] text-slate-100'
                      : 'text-slate-500 hover:bg-white/[0.025] hover:text-slate-300',
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute left-0 top-[5px] h-[calc(100%-10px)] w-[2px] rounded-full bg-ops-cyan shadow-[0_0_8px_rgba(56,196,224,0.8)]"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon
                    size={16}
                    strokeWidth={isActive ? 2 : 1.6}
                    className={cn(
                      'transition-colors shrink-0',
                      isActive ? 'text-ops-cyan' : 'text-slate-600 group-hover:text-slate-400',
                    )}
                  />
                  <span className="flex-1 font-medium tracking-[0.02em] hidden lg:inline truncate">{item.label}</span>
                </motion.button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* system health */}
      <SystemHealthFootnote />
    </aside>
  )
}

function SystemHealthFootnote() {
  const { db, cx } = useSystemStatus()
  const cameraUp = cameraBackendOnline()
  const issues: string[] = []
  if (!cameraUp) issues.push('CAMERA')
  if (db.kind === 'supabase' && (db.state === 'degraded' || db.state === 'offline')) issues.push('PERSISTENCE')
  if (cx.state === 'degraded') issues.push('LIVE STATE')
  const degraded = issues.length > 0

  return (
    <div className="border-t border-white/[0.05] p-2.5 lg:p-3">
      {/* compact for tablet */}
      <div className="flex lg:hidden items-center justify-center py-2">
        <Led tone={degraded ? 'amber' : 'green'} pulse size={7} />
      </div>

      {/* full for desktop */}
      <div className="hidden lg:block">
        <div className="rounded-[5px] border border-white/[0.06] bg-night-850/70 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <MicroLabel className="text-slate-500">System Health</MicroLabel>
            <Led tone={degraded ? 'amber' : 'green'} pulse size={6} />
          </div>
          <div
            className={cn(
              'mt-1.5 font-mono text-[9.5px] tracking-[0.08em]',
              degraded ? 'text-ops-amber' : 'text-slate-400',
            )}
          >
            {degraded ? `OPERATIONAL · ${issues.join(' + ')} DEGRADED` : 'ALL SYSTEMS OPERATIONAL'}
          </div>
        </div>
        <div className="mt-2.5 text-center font-mono text-[8px] tracking-[0.16em] text-slate-700">
          GREENWAVE v0.2
        </div>
      </div>
    </div>
  )
}
