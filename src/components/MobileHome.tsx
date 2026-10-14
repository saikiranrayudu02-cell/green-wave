import { motion } from 'framer-motion'
import { ShieldCheck, Siren, Route, Activity, Clock, AlertTriangle } from 'lucide-react'
import { MicroLabel, Pill } from './ui'
import { cn } from '../lib/cn'

interface Props {
  modules: {
    emergencies: { active: number; responding: number; corridors: number }
    traffic: { vehicles: number; avgSpeed: number; queueAvg: number; loadPct: number }
    network: { throughput: number; delayAvg: number }
  }
  activeEmergencies: Array<{
    id: string
    tac: string
    incident: string
    origin: string
    destination: string
    priority: string
    status: string
    etaSec: number
    corridorOpen: boolean
  }>
}

export default function MobileHome({ modules, activeEmergencies }: Props) {

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4 pt-2">
      {/* mission strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-md border border-white/[0.06] bg-night-900 px-3.5 py-3"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[5px] border border-emerald-400/25 bg-emerald-400/[0.06]">
            <ShieldCheck size={16} className="text-emerald-300" />
          </div>
          <div className="min-w-0 leading-tight">
            <MicroLabel className="text-emerald-300">Operation Active</MicroLabel>
            <div className="mt-0.5 font-mono text-[11px] font-semibold tracking-[0.02em] text-slate-200">
              Emergency Mobility Intelligence Operations Network
            </div>
            <div className="mt-0.5 font-mono text-[7.5px] tracking-[0.18em] text-slate-600">
              Traffic monitoring · congestion prediction · corridor coordination
            </div>
          </div>
        </div>
      </motion.div>

      {/* live pulse */}
      <div className="grid grid-cols-2 gap-2.5">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-md border border-white/[0.06] bg-night-900 px-3.5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06]">
              <Siren size={14} className="text-ops-cyan" />
            </div>
            <MicroLabel className="text-slate-500">Active Emergencies</MicroLabel>
          </div>
          <div className={cn('mt-2 font-mono text-[24px] font-semibold tabular text-slate-100', modules.emergencies.active > 0 && 'text-ops-red')}>
            {modules.emergencies.active}
            <span className="ml-1.5 text-[11px] font-normal text-slate-600">now</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[7.5px] font-mono text-slate-600">
            <span>{modules.emergencies.responding} responding</span>
            <span>{modules.emergencies.corridors} corridors open</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="rounded-md border border-white/[0.06] bg-night-900 px-3.5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06]">
              <Activity size={14} className="text-ops-cyan" />
            </div>
            <MicroLabel className="text-slate-500">Traffic Now</MicroLabel>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-[24px] font-semibold tabular text-slate-100">{modules.traffic.avgSpeed.toFixed(0)}</span>
            <span className="font-mono text-[10px] font-medium text-slate-500">km/h</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[7.5px] font-mono text-slate-600">
            <span>{modules.traffic.vehicles} vehicles</span>
            <span>queue {modules.traffic.queueAvg.toFixed(0)} m</span>
            <span>load {modules.traffic.loadPct.toFixed(0)}%</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.11 }}
          className="rounded-md border border-white/[0.06] bg-night-900 px-3.5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06]">
              <Route size={14} className="text-ops-cyan" />
            </div>
            <MicroLabel className="text-slate-500">Throughput</MicroLabel>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-[24px] font-semibold tabular text-slate-100">{Math.round(modules.network.throughput)}</span>
            <span className="font-mono text-[10px] font-medium text-slate-500">veh/hr</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[7.5px] font-mono text-slate-600">
            <span>avg delay {modules.network.delayAvg.toFixed(1)} s</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          className="rounded-md border border-white/[0.06] bg-night-900 px-3.5 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06]">
              <Clock size={14} className="text-ops-cyan" />
            </div>
            <MicroLabel className="text-slate-500">Baseline Watch</MicroLabel>
          </div>
          <div className="mt-2 font-mono text-[13px] font-semibold tabular text-slate-300">Collecting</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[7.5px] font-mono text-slate-600">
            <span>fixed-timing baseline</span>
            <span>vs greenwave</span>
          </div>
        </motion.div>
      </div>

      {/* active emergencies */}
      {activeEmergencies.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-white/[0.06] bg-night-900"
        >
          <div className="border-b border-white/[0.05] px-3.5 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-ops-red/30 bg-ops-red/[0.08]">
                  <Siren size={12} className="text-ops-red" />
                </div>
                <MicroLabel className="text-slate-400">Active Emergencies</MicroLabel>
              </div>
              <span className="font-mono text-[8px] tracking-[0.18em] text-slate-600">LIVE OPS STATE</span>
            </div>
          </div>
          <div className="divide-y divide-white/[0.04] px-3.5 py-2">
            {activeEmergencies.map((e, i) => {
              const critical = e.priority === 'CRITICAL'
              const etaM = Math.round(e.etaSec / 60)
              const etaS = e.etaSec % 60
              const etaStr = `${etaM}:${String(etaS).padStart(2, '0')}`
              return (
                <div
                  key={e.id}
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[4px] border px-3 py-2 transition-colors hover:bg-white/[0.03]',
                    i > 0 && 'mt-1.5 border-t'
                  )}
                >
                  <div className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border',
                    critical ? 'border-ops-red/30 bg-ops-red/[0.08] text-ops-red' : 'border-ops-cyan/30 bg-ops-cyan/[0.08] text-ops-cyan'
                  )}>
                    <Siren size={11} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10.5px] font-semibold tracking-[0.06em] text-slate-100">{e.tac}</span>
                      <span className={cn(
                        'rounded-[2px] border px-1 py-[1px] font-mono text-[7px] font-bold tracking-[0.1em]',
                        critical ? 'border-ops-red/40 text-ops-red' : 'border-ops-cyan/40 text-ops-cyan'
                      )}>
                        {e.priority}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[9.5px] text-slate-500">
                      {e.incident} · {e.origin} → {e.destination}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {e.corridorOpen && (
                      <Pill tone="green" className="hidden sm:inline-flex">CORRIDOR ACTIVE</Pill>
                    )}
                    <span className={cn(
                      'font-mono text-[10.5px] tabular',
                      e.status === 'PENDING' ? 'text-slate-500' : e.corridorOpen ? 'text-emerald-300' : 'text-slate-200'
                    )}>
                      {e.status === 'PENDING' ? 'STANDBY' : etaStr + ' ETA'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-white/[0.05] px-3.5 py-2 text-[7.5px] font-mono text-slate-600">
            All figures are simulation telemetry from the local engine.
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-white/[0.06] bg-night-900 px-3.5 py-4"
        >
          <div className="flex items-center gap-2 text-slate-500">
            <div className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-white/10">
              <AlertTriangle size={12} className="text-slate-500" />
            </div>
            <MicroLabel className="text-slate-500">No Active Emergencies</MicroLabel>
          </div>
          <div className="mt-1 text-[9.5px] font-mono text-slate-600">
            Open Emergencies or Coordination to simulate a scenario.
          </div>
        </motion.div>
      )}
    </div>
  )
}
