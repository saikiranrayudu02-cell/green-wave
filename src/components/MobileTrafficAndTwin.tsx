import { Led, MicroLabel, Pill } from './ui'
import { cn } from '../lib/cn'
import { signalStates, signalStateOf } from '../engine/signalState'
import { trafficMetrics } from '../engine/vehicles'
import { DISPLAY_SIGNAL_IDS } from '../data/osmRoadNetwork'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  mode: 'fixed' | 'greenwave'
  incident: { id: string; junctionId: string; label: string } | null
}

function SignalChip({ id, state, group }: { id: string; state: string; group: string }) {
  const tone = state === 'GREEN' ? 'text-emerald-300' : state === 'YELLOW' ? 'text-ops-amber' : 'text-ops-red'
  return (
    <span className={cn('flex items-center gap-1 rounded-[2px] border border-white/[0.08] bg-night-850/70 px-1.5 py-[2px] font-mono text-[8px]', tone)}>
      <span>{id}</span>
      <span>·</span>
      <span>{state}</span>
      <span className="text-slate-600">({group})</span>
    </span>
  )
}

export default function MobileTrafficAndTwin({ mode, incident }: Props) {
  const [groupInfo, setGroupInfo] = useState('')
  const metrics = trafficMetrics()
  const { loadPct, avgSpeedKmh, queueM, throughput, active } = metrics

  const toggleGroup = (gid: string) => {
    if (groupInfo === gid) setGroupInfo('')
    else setGroupInfo(gid)
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4 pt-2 pb-[76px]">
      {/* header summary */}
      <div className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden">
        <div className="border-b border-white/[0.05] px-3.5 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06]">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12l3 3 7-7 4 4 8-8" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </div>
              <MicroLabel className="text-slate-400">Traffic Conditions</MicroLabel>
            </div>
            <Pill tone={loadPct > 85 ? 'amber' : loadPct > 60 ? 'cyan' : 'slate'}>
              LOAD {loadPct.toFixed(0)}%
            </Pill>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 px-3.5 py-3">
          <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-3 py-2.5">
            <MicroLabel className="text-slate-600">Vehicles Tracked</MicroLabel>
            <div className="mt-1.5 font-mono text-[18px] font-semibold tabular text-slate-100">{active}</div>
          </div>
          <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-3 py-2.5">
            <MicroLabel className="text-slate-600">Avg Speed</MicroLabel>
            <div className="mt-1.5 font-mono text-[18px] font-semibold tabular text-slate-100">{avgSpeedKmh.toFixed(0)} <span className="text-[10px] font-normal text-slate-500">km/h</span></div>
          </div>
          <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-3 py-2.5">
            <MicroLabel className="text-slate-600">Queue at Signals</MicroLabel>
            <div className="mt-1.5 font-mono text-[18px] font-semibold tabular text-slate-100">{queueM.toFixed(0)} <span className="text-[10px] font-normal text-slate-500">m</span></div>
          </div>
          <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-3 py-2.5">
            <MicroLabel className="text-slate-600">Throughput</MicroLabel>
            <div className="mt-1.5 font-mono text-[18px] font-semibold tabular text-slate-100">{Math.round(throughput)} <span className="text-[10px] font-normal text-slate-500">veh/hr</span></div>
          </div>
        </div>
        <div className="border-t border-white/[0.05] px-3.5 py-2 text-[7.5px] font-mono text-slate-600">
          Simulated local engine telemetry. Not real-time camera or sensor data.
        </div>
      </div>

      {/* incident banner */}
      {incident && (
        <div className="rounded-md border border-ops-red/35 bg-ops-red/[0.06] px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-ops-red/30 bg-ops-red/[0.08] text-ops-red">
              <AlertTriangle size={13} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-ops-red">Incident Active</div>
              <div className="mt-0.5 font-mono text-[10.5px] font-medium text-slate-200">{incident.label}</div>
              <div className="mt-1 flex items-center gap-2 text-[8px] font-mono text-slate-600">
                <span>Location: {incident.junctionId}</span>
                <span>·</span>
                <span>Re-routing active</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* signal state */}
      <div className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden">
        <div className="border-b border-white/[0.05] px-3.5 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-emerald-400/25 bg-emerald-400/[0.06]">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="7" />
                </svg>
              </div>
              <MicroLabel className="text-slate-400">Signal Control</MicroLabel>
            </div>
            <span className={cn(
              'font-mono text-[8.5px] font-bold uppercase tracking-[0.14em]',
              mode === 'greenwave' ? 'text-emerald-300' : 'text-ops-cyan'
            )}>
              {mode === 'greenwave' ? 'ADAPTIVE · GREENWAVE' : 'FIXED TIME'}
            </span>
          </div>
        </div>
        <div className="px-3.5 py-3">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {DISPLAY_SIGNAL_IDS.slice(0, 8).map((id) => {
              const snap = signalStateOf(id)
              if (!snap) return null
              const g = snap.corridorGroup ?? 'X'
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleGroup(String(g))}
                  className={cn(
                    'rounded-[3px] border text-[8.5px] font-mono font-semibold transition-colors px-2 py-1',
                    groupInfo === String(g)
                      ? 'border-ops-cyan/50 bg-ops-cyan/[0.1] text-ops-cyan'
                      : 'border-white/10 bg-night-850/60 text-slate-400 hover:bg-white/[0.04]'
                  )}
                >
                  {id.slice(1)}
                </button>
              )
            })}
          </div>
          {groupInfo ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[7px] font-mono uppercase tracking-[0.14em] text-slate-600">Selected group detail</span>
              {DISPLAY_SIGNAL_IDS.filter((id) => {
                const snap = signalStateOf(id)
                if (!snap) return false
                const g = snap.corridorGroup ?? 'X'
                return String(g) === groupInfo && snap.lampM !== 'RED'
              }).map((id) => {
                const snap = signalStateOf(id)!
                return <SignalChip key={id} id={id} state={snap.lampM} group={String(snap.corridorGroup ?? 'X')} />
              })}
            </div>
          ) : (
            <p className="text-[8.5px] font-mono text-slate-600">
              Tap a signal ID to inspect its group state.
            </p>
          )}
        </div>
      </div>

      {/* junction status */}
      <div className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden">
        <div className="border-b border-white/[0.05] px-3.5 py-2.5">
          <MicroLabel className="text-slate-400">Junction Status</MicroLabel>
        </div>
        <div className="px-3.5 py-3">
          <div className="flex flex-col gap-2">
            {signalStates().slice(0, 10).map((s) => (
              <div key={s.junctionId} className="flex items-center justify-between rounded-[3px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-semibold tracking-[0.06em] text-slate-300">{s.junctionId.slice(1)}</span>
                  <Led
                    tone={s.control === 'ADAPTIVE' ? 'cyan' : s.control === 'CORRIDOR' ? 'green' : 'slate'}
                    size={4}
                  />
                  <span className="text-[7px] font-mono text-slate-600">{s.control}</span>
                </div>
                <span className={cn(
                  'font-mono text-[7px] font-semibold uppercase tracking-[0.12em]',
                  s.lampM === 'GREEN' ? 'text-emerald-300' : s.lampM === 'YELLOW' ? 'text-ops-amber' : 'text-ops-red'
                )}>
                  {s.lampM} · {s.corridorGroup ?? '—'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[7.5px] font-mono text-slate-600">
            Adaptive control optimizes pressure-based groups. GreenWave mode enables it.
          </p>
        </div>
      </div>

      {/* digital twin note */}
      <div className="rounded-md border border-ops-cyan/20 bg-night-900 px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.06] text-ops-cyan">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 0 1 10 10c0 5.5-4.5 10-10 10A10 10 0 0 1 2 12a10 10 0 0 1 10-10c4.5-5.5 10-10 10-10z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div>
            <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-ops-cyan">Digital Twin</div>
            <p className="mt-1 text-[8.5px] font-mono text-slate-400 leading-relaxed">
              The digital twin visualizes the same simulated network used by the traffic engine. Select a junction to inspect state. Twin data is simulation, not live telemetry.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[7px] font-mono uppercase tracking-[0.14em] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400/60" />
          Vehicle
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-ops-cyan/60" />
          Signal
        </span>
        <span className="text-slate-700">·</span>
        <span>All figures are simulation outputs.</span>
      </div>
    </div>
  )
}