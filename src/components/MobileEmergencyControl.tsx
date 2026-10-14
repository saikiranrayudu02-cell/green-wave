import { AnimatePresence, motion } from 'framer-motion'
import {
  Siren,
  HeartPulse,
  MapPin,
  Route,
  Navigation,
  ShieldCheck,
  CircleCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader,
} from 'lucide-react'
import { Led, MicroLabel, Pill } from './ui'
import { cn } from '../lib/cn'
import type { EmergencyRuntime } from '../types'
import { fmtClock } from '../lib/format'

interface Card {
  id: string
  tac: string
  unit: string
  code: 'MEDICAL' | 'TRAUMA'
  priority: string
  incident: string
  origin: string
  destination: string
  route: string
  junctions: string[]
  corridorId: string
  corridorLabel: string
  status: string
  etaSec: number
  savedSec: number
  corridorOpen: boolean
  arrived: boolean
  junctionIds: string[]
}

interface Props {
  emergencies: EmergencyRuntime[]
  selectedId: string
  incident: { junctionId: string; label: string } | null
  onSelect: (id: string) => void
}

function OpenableCard({ card, selected, onSelect, incident }: { card: Card; selected: boolean; onSelect: () => void; incident?: { junctionId: string; label: string } | null }) {
  const etaM = Math.floor(card.etaSec / 60)
  const etaS = card.etaSec % 60
  const etaStr = card.status === 'PENDING' ? '—' : `${etaM}:${String(etaS).padStart(2, '0')}`
  const critical = card.priority === 'CRITICAL'
  const trafficWord = card.corridorOpen && !card.arrived ? 'CORRIDOR OPEN' : card.status === 'PENDING' ? 'STANDBY' : 'EN ROUTE'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        'rounded-md border bg-night-900 px-3.5 py-3 transition-colors',
        selected ? 'border-ops-cyan/40 bg-white/[0.03]' : 'border-white/[0.06] hover:border-white/10',
        card.priority === 'CRITICAL' && !selected && 'border-ops-red/30'
      )}
    >
      {/* header */}
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            'flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[4px] border',
            critical
              ? 'border-ops-red/30 bg-ops-red/[0.1] text-ops-red'
              : 'border-ops-cyan/30 bg-ops-cyan/[0.1] text-ops-cyan'
          )}>
            <Siren size={13} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-slate-100">{card.tac}</span>
              <span className={cn(
                'rounded-[2px] border px-1 py-[1px] font-mono text-[7px] font-bold tracking-[0.1em]',
                critical ? 'border-ops-red/40 text-ops-red' : 'border-ops-cyan/40 text-ops-cyan'
              )}>
                {card.priority}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[9.5px] text-slate-500">
              {card.incident} · {card.origin} → {card.destination}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('font-mono text-[10.5px] tabular', card.status === 'PENDING' ? 'text-slate-500' : 'text-slate-200')}>
            {trafficWord}
          </span>
          <Pill tone={card.corridorOpen && !card.arrived ? 'green' : 'slate'}>
            {card.corridorOpen && !card.arrived ? 'ACTIVE' : 'STANDBY'}
          </Pill>
          {selected ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid gap-x-3 gap-y-2.5">
              <Row icon={<HeartPulse size={11} />} label="Incident" value={card.incident} />
              <Row icon={<MapPin size={11} />} label="Origin" value={card.origin} />
              <Row icon={<Navigation size={11} />} label="Destination" value={card.destination} />
              <Row icon={<Route size={11} />} label="Route" value={card.route} />

              <div className="grid gap-x-3 gap-y-2.5 pt-1">
                <div className="flex items-center gap-2.5">
                  <MicroLabel className="shrink-0 text-slate-500">Junctions</MicroLabel>
                  <div className="flex flex-wrap gap-1">
                    {card.junctionIds.map((j) => (
                      <span
                        key={j}
                        className="rounded-[2px] border border-white/10 bg-white/[0.03] font-mono text-[8.5px] text-slate-400"
                      >
                        {j}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <MicroLabel className="shrink-0 text-slate-500">Corridor</MicroLabel>
                  <span className="font-mono text-[10px] text-slate-300">{card.corridorLabel} · {card.corridorId}</span>
                </div>
              </div>

              {/* timing trio */}
              <div className="mt-1.5 grid grid-cols-3 gap-2.5 rounded-[4px] border border-white/[0.05] bg-night-850/60 divide-x divide-white/[0.05] px-2.5 py-2">
                <div className="min-w-0">
                  <MicroLabel className="text-slate-600">Baseline</MicroLabel>
                  <div className="mt-0.5 truncate font-mono text-[12px] font-semibold tabular text-slate-300">
                    {card.status === 'PENDING' ? '—' : fmtClock(card.etaSec + card.savedSec)}
                  </div>
                </div>
                <div className="min-w-0">
                  <MicroLabel className="text-slate-600">GreenWave ETA</MicroLabel>
                  <div className="mt-0.5 truncate font-mono text-[12px] font-semibold tabular text-slate-100">
                    {card.status === 'PENDING' ? '—' : etaStr + ' ETA'}
                  </div>
                </div>
                <div className="min-w-0">
                  <MicroLabel className="text-slate-600">Saved</MicroLabel>
                  <div className="mt-0.5 truncate font-mono text-[12px] font-semibold tabular text-emerald-300">
                    {card.status === 'PENDING' || card.arrived ? '—' : fmtClock(card.savedSec)}
                  </div>
                </div>
              </div>

              {/* corridor readiness + alert line */}
              <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
                <span className="flex items-center gap-1.5">
                  <Led tone={card.corridorOpen && !card.arrived ? 'green' : 'slate'} pulse={card.corridorOpen && !card.arrived} size={4.5} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">Corridor Readiness</span>
                  {card.corridorOpen && !card.arrived ? (
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300">OPEN · ACTIVE</span>
                  ) : (
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">CLOSED · STANDBY</span>
                  )}
                </span>
                {incident && (
                  <span className="flex items-center gap-1.5 rounded-[2px] border border-ops-red/30 bg-ops-red/[0.07] px-2 py-[1px]">
                    <AlertTriangle size={10} className="text-ops-red" />
                    <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ops-red">{incident.label}</span>
                  </span>
                )}
              </div>

              {/* coordination context */}
              {card.corridorOpen && !card.arrived && (
                <div className="mt-0.5 flex items-center gap-2 rounded-[4px] border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-2">
                  <ShieldCheck size={11} className="text-emerald-300" />
                  <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                    EMERGENCY PRIORITY · GREENWAVE ACTIVE
                  </span>
                  <span className="ml-auto font-mono text-[8px] text-emerald-200/70">SIGNAL DELAY PLANNED</span>
                </div>
              )}
              {card.arrived && (
                <div className="flex items-center gap-2 rounded-[4px] border border-emerald-400/35 bg-emerald-400/[0.08] px-2.5 py-2">
                  <CircleCheck size={12} className="text-emerald-300" />
                  <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-emerald-300">UNIT ARRIVED · CORRIDOR RELEASED</span>
                </div>
              )}
              {card.status === 'PENDING' && (
                <div className="flex items-center gap-2 rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2 text-slate-500">
                  <Loader size={11} className="animate-spin" />
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.14em]">AWAITING DISPATCH</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 mt-px flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border border-white/[0.06] bg-white/[0.02] text-slate-500">
        {icon}
      </span>
      <div className="min-w-0">
        <MicroLabel className="text-slate-600">{label}</MicroLabel>
        <div className="mt-0.5 truncate font-mono text-[10.5px] font-medium text-slate-200">{value}</div>
      </div>
    </div>
  )
}

export default function MobileEmergencyControl({ emergencies, selectedId, incident, onSelect }: Props) {
  const cards: Card[] = emergencies.map((e) => {
    const route = e.junctionIds.length >= 2
      ? e.junctionIds.slice(0, -1).join(' → ') + ' → ' + e.junctionIds[e.junctionIds.length - 1]
      : (e.junctionIds[0] ?? '—')
    return {
      id: e.id,
      tac: e.tac,
      unit: e.unit,
      code: e.code,
      priority: e.priority,
      incident: e.incident,
      origin: e.origin,
      destination: e.destination,
      route,
      junctions: e.junctionIds,
      corridorId: e.corridorId,
      corridorLabel: e.corridorLabel,
      status: e.status,
      etaSec: e.etaSec,
      savedSec: e.savedSec,
      corridorOpen: e.corridorOpen,
      arrived: e.arrived,
      junctionIds: conflctHighlight(e.junctionIds),
    }
  })

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4 pt-2">
      <div className="space-y-2">
        {cards.map((c) => (
          <OpenableCard
            key={c.id}
            card={c}
            selected={c.id === selectedId}
            incident={incident}
            onSelect={() => onSelect(c.id)}
          />
        ))}
      </div>
    </div>
  )
}

function conflctHighlight(js: string[]): string[] {
  const shared = new Set(['J15', 'J18', 'J22'])
  return js.map((j) => shared.has(j) ? `⚠ ${j}` : j)
}
