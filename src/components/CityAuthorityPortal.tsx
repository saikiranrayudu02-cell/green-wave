// ---------------------------------------------------------------------------
// CITY TRAFFIC AUTHORITY PORTAL — one of three role views over the SAME case.
//
// The city reviews the incoming emergency route (real route, real ETA, real
// live traffic from the existing simulation) and ACKNOWLEDGES it. The city
// implements NO traffic-control logic: acknowledgement authorizes the EXISTING
// GreenWave corridor workflow (App calls openCorridor on the shared case).
// ---------------------------------------------------------------------------

import { motion } from 'framer-motion'
import { Ambulance, CircleCheck, HeartPulse, Landmark, MapPin, Route, ShieldCheck, Timer } from 'lucide-react'
import type { EmergencyRuntime } from '../types'
import type { CorridorJunction } from '../engine/corridor'
import type { EmergencyCase, CityNotificationStatus } from '../arogya/emergencyCase'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel } from './ui'
import { Field, FileTextIcon, CITY_LABEL } from './opsPortalShared'

interface Props {
  emergencyCase: EmergencyCase
  unit: EmergencyRuntime
  etaSec: number
  cityStatus: CityNotificationStatus
  corrWave: CorridorJunction[] | null
  networkLoadPct: number
  avgSpeedKmh: number
  onCityAcknowledge: () => void
}

function WhyRow({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'red' | 'amber' | 'green' | 'slate' }) {
  const toneCls =
    tone === 'red' ? 'text-ops-red' : tone === 'amber' ? 'text-ops-amber' : tone === 'green' ? 'text-emerald-300' : 'text-slate-300'
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[8px] tracking-[0.08em] text-slate-500">{label}</span>
      <span className={cn('font-mono text-[8.5px] font-semibold tracking-[0.1em] tabular', toneCls)}>{value}</span>
    </div>
  )
}

export default function CityAuthorityPortal({
  emergencyCase,
  unit,
  etaSec,
  cityStatus,
  corrWave,
  networkLoadPct,
  avgSpeedKmh,
  onCityAcknowledge,
}: Props) {
  return (
    <div className="space-y-2.5">
      <div className="rounded-[4px] border border-white/[0.05] bg-white/[0.012] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.08] text-ops-cyan">
            <Landmark size={12} />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-100">City Traffic Control</div>
            <div className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">EMERGENCY ROUTE ALERT</div>
          </div>
        </div>
        <div className="mt-2.5 space-y-2">
          <Field icon={<FileTextIcon />} label="Case">{emergencyCase.caseId}</Field>
          <div className="grid grid-cols-2 gap-2">
            <Field icon={<Ambulance size={10} />} label="Ambulance">{unit.tac}</Field>
            <Field icon={<HeartPulse size={10} />} label="Priority">{unit.priority}</Field>
          </div>
          <Field icon={<MapPin size={10} />} label="Destination">{emergencyCase.hospitalName}</Field>
          <Field icon={<Route size={10} />} label="Route">
            <span className="font-mono text-[9px] tracking-[0.04em] text-slate-300">{emergencyCase.routeLabel}</span>
          </Field>
          <Field icon={<Timer size={10} />} label="ETA">
            <span className="font-mono text-[12px] font-semibold tabular text-ops-cyan">{fmtClock(Math.max(0, etaSec))}</span>
          </Field>
        </div>
        {/* live route condition — EXISTING simulation metrics, no new probe */}
        <div className="mt-2.5 rounded-[4px] border border-white/[0.05] bg-night-950/40 px-2.5 py-2">
          <MicroLabel className="mb-1.5 text-slate-600">Route Traffic Condition</MicroLabel>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">Network Load</div>
              <div
                className={cn(
                  'mt-[2px] font-mono text-[11px] font-semibold tabular',
                  networkLoadPct >= 70 ? 'text-ops-red' : networkLoadPct >= 40 ? 'text-ops-amber' : 'text-emerald-300',
                )}
              >
                {Math.round(networkLoadPct)}%
              </div>
            </div>
            <div>
              <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">Avg Speed</div>
              <div className="mt-[2px] font-mono text-[11px] font-semibold tabular text-slate-200">
                {avgSpeedKmh.toFixed(0)} <span className="text-[8px] text-slate-500">km/h</span>
              </div>
            </div>
            <div>
              <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-slate-600">Junctions</div>
              <div className="mt-[2px] font-mono text-[11px] font-semibold tabular text-slate-200">
                {corrWave && corrWave.length > 0 ? corrWave.length : (unit?.junctionIds.length ?? 0)}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between rounded-[4px] border border-white/[0.05] bg-night-950/40 px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-slate-400">
            <Led tone={cityStatus === 'ACKNOWLEDGED' ? 'green' : cityStatus === 'REQUESTED' ? 'cyan' : 'slate'} pulse={cityStatus === 'REQUESTED'} size={4} />
            STATUS · {CITY_LABEL[cityStatus]}
          </span>
        </div>
      </div>

      {/* WHY GREEN — decision factors behind the corridor authorization. Each
          value is real existing state (priority · route · live network), shown
          so the decision is explainable, never a black box. */}
      {cityStatus === 'ACKNOWLEDGED' && (
        <div className="rounded-[4px] border border-emerald-400/20 bg-emerald-400/[0.02] px-2.5 py-2">
          <MicroLabel className="mb-1.5 text-slate-500">Why Green Corridor</MicroLabel>
          <div className="space-y-1">
            <WhyRow label="Emergency priority" value={unit.priority} tone={unit.priority === 'CRITICAL' ? 'red' : 'amber'} />
            <WhyRow
              label="Preparing junctions"
              value={corrWave ? String(corrWave.filter((c) => c.status === 'PREPARING' || c.status === 'ACTIVE').length) : '0'}
            />
            <WhyRow
              label="Network load"
              value={`${Math.round(networkLoadPct)}%`}
              tone={networkLoadPct >= 70 ? 'red' : networkLoadPct >= 40 ? 'amber' : 'green'}
            />
            <WhyRow label="Downstream capacity" value={avgSpeedKmh >= 20 ? 'AVAILABLE' : 'CONSTRAINED'} tone={avgSpeedKmh >= 20 ? 'green' : 'amber'} />
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-white/[0.05] pt-1.5">
            <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-slate-600">Decision</span>
            <span className="font-mono text-[8.5px] font-bold tracking-[0.14em] text-emerald-300">GREEN HELD</span>
          </div>
        </div>
      )}

      <motion.button
        type="button"
        whileTap={{ scale: 0.985 }}
        onClick={onCityAcknowledge}
        disabled={cityStatus !== 'REQUESTED' && cityStatus !== 'NOT_SENT'}
        className={cn(
          'flex h-9 w-full items-center justify-center gap-2 rounded-[4px] border font-mono text-[9.5px] font-bold uppercase tracking-[0.22em] transition-colors disabled:opacity-60',
          cityStatus === 'ACKNOWLEDGED'
            ? 'border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-300'
            : 'border-ops-cyan/50 bg-ops-cyan/[0.08] text-ops-cyan hover:bg-ops-cyan/[0.16]',
        )}
      >
        {cityStatus === 'ACKNOWLEDGED' ? <ShieldCheck size={13} /> : <CircleCheck size={13} />}
        {cityStatus === 'ACKNOWLEDGED' ? 'Route Acknowledged' : 'Acknowledge Route'}
      </motion.button>
      <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-slate-700">
        INTERNAL OPERATIONAL NOTIFICATION — NO EXTERNAL SMS / EMAIL / WHATSAPP
      </p>
    </div>
  )
}