import React, { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Map,
  Siren,
  Route,
  Activity,
  BarChart3,
  RadioTower,
  Settings,
} from 'lucide-react'
import { cn } from '../lib/cn'

export interface NavItem {
  id: string
  label: string
  icon: React.ElementType
}

export const MOBILE_NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'map', label: 'Live Map', icon: Map },
  { id: 'emergencies', label: 'Emergencies', icon: Siren },
  { id: 'corridors', label: 'Corridors', icon: Route },
  { id: 'traffic', label: 'Traffic & Twin', icon: Activity },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'ops', label: 'Hospital Ops', icon: RadioTower },
  { id: 'system', label: 'System', icon: Settings },
]

interface Props {
  active: string
  onNavigate: (id: string) => void
}

export default function MobileTabs({ active, onNavigate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Scroll active tab into view smoothly
  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.querySelector('[data-active="true"]') as HTMLElement | null
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [active])

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.08] bg-night-900/98 backdrop-blur-xl shadow-[0_-8px_25px_rgba(0,0,0,0.6)]" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}>
      <div
        ref={containerRef}
        className="flex h-[58px] items-center gap-1 overflow-x-auto px-2 py-1 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon
          const isActive = item.id === active
          return (
            <button
              key={item.id}
              type="button"
              data-active={isActive ? 'true' : 'false'}
              onClick={() => onNavigate(item.id)}
              className={cn(
                'relative flex h-full min-w-[70px] flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-1 transition-all duration-150 active:scale-95',
                isActive
                  ? 'bg-ops-cyan/[0.1] text-ops-cyan font-semibold'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="mobile-tab-indicator"
                  className="absolute inset-x-2 top-0 h-[2.5px] rounded-full bg-ops-cyan shadow-[0_0_8px_#38c4e0]"
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                />
              )}
              <Icon size={18} strokeWidth={isActive ? 2.4 : 1.8} className={cn(isActive && 'text-ops-cyan drop-shadow-[0_0_6px_rgba(56,196,224,0.6)]')} />
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] whitespace-nowrap leading-none">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
