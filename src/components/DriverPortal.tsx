// ---------------------------------------------------------------------------
// AMBULANCE DRIVER PORTAL — one of three role views over the SAME shared case.
//
// The driver only DISPATCHES the emergency and SENDS the route request to the
// city. The driver never touches signals or corridor logic — every value here
// (ETA, next junction, route, corridor wave) is the EXISTING GreenWave state
// passed in as props. Actions mutate the one shared case in App.
// ---------------------------------------------------------------------------

import { motion } from 'framer-motion'
import {
  Ambulance,
  CircleCheck,
  MapPin,
  Navigation,
  Route,
  Send,
  Siren,
  Timer,
  UserRound,
} from 'lucide-react'
import type { EmergencyRuntime } from '../types'
import type { CorridorJunction } from '../engine/corridor'
import type { EmergencyCase, CityNotificationStatus } from '../arogya/emergencyCase'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel, Pill } from './ui'
import { Field, FileTextIcon } from './opsPortalShared'

interface Props {
  emergencyCase: EmergencyCase
  unit: EmergencyRuntime
  etaSec: number
  nextJunction: string | null
  corridorOpen: boolean
  corridorReleased: boolean
  corrWave: CorridorJunction[] | null
  cityStatus: CityNotificationStatus
  onNotifyCity: () => void
}

export default function DriverPortal({
  emergencyCase,
  unit,
  etaSec,
  nextJunction,
  corridorOpen,
  corridorReleased,
  corrWave,
  cityStatus,
  onNotifyCity,
}: Props) {
  return (
    <div className="space-y-2.5">
      <div className="rounded-[4px] border border-white/[0.05] bg-white/[0.012] px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-ops-red/30 bg-ops-red/[0.08] text-ops-red">
            <Ambulance size={12} />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-[11px] font-semibold tracking-[0.1em] text-slate-100">{unit.tac}</div>
            <div className="font-mono text-[7.5px] tracking-[0.14em] text-slate-600">EMERGENCY RESPONSE</div>
          </div>
          <Pill tone={unit.priority === 'CRITICAL' ? 'red' : 'amber'} className="ml-auto px-1.5 py-[2px]">
            {unit.priority}
          </Pill>
        </div>
        <div className="mt-2.5 space-y-2">
          <Field icon={<FileTextIcon />} label="Case">{emergencyCase.caseId}</Field>
          <Field icon={<UserRound size={10} />} label="Patient (demo ref)">{emergencyCase.patientRef}</Field>
          <Field icon={<MapPin size={10} />} label="Destination">{emergencyCase.hospitalName}</Field>
          <Field icon={<Navigation size={10} />} label="Route">
            <span className="font-mono text-[9px] tracking-[0.04em] text-slate-300">{emergencyCase.routeLabel}</span>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field icon={<Timer size={10} />} label="ETA">
              <span className="font-mono text-[12px] font-semibold tabular text-ops-cyan">
                {fmtClock(Math.max(0, etaSec))}
              </span>
            </Field>
            <Field icon={<Route size={10} />} label="Next Junction">
              <span className={cn('font-mono text-[12px] font-semibold tracking-[0.08em]', corridorOpen ? 'text-emerald-300' : 'text-slate-100')}>
                {nextJunction ?? '—'}
              </span>
            </Field>
          </div>
        </div>
      </div>

      {/* corridor wave — existing engine status, communicated only */}
      {corrWave && corrWave.length > 0 && (
        <div className="rounded-[4px] border border-white/[0.05] px-2.5 py-2">
          <MicroLabel className="mb-1.5 text-slate-600">Green Corridor Wave</MicroLabel>
          <div className="flex flex-wrap gap-1">
            {corrWave.map((c) => (
              <span
                key={c.id}
                className={cn(
                  'rounded-[3px] border px-1.5 py-[2px] font-mono text-[8px] font-semibold tracking-[0.06em]',
                  c.status === 'PASSED' && 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300/80',
                  c.status === 'ACTIVE' && 'border-emerald-400/70 bg-emerald-400/20 text-emerald-100',
                  c.status === 'PREPARING' && 'border-ops-cyan/60 bg-ops-cyan/10 text-ops-cyan',
                  c.status === 'STANDBY' && 'border-white/[0.07] bg-white/[0.015] text-slate-600',
                )}
              >
                {c.id}
                {c.status === 'PREPARING' && c.etaSec != null ? ` ${Math.max(1, Math.round(c.etaSec))}s` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* green corridor — STATUS ONLY. The driver is informed, never controls
          traffic infrastructure: GreenWave creates + holds the corridor
          automatically (city acknowledgement authorizes the existing engine). */}
      <div
        className={cn(
          'flex items-center justify-between rounded-[4px] border px-2.5 py-2',
          corridorOpen
            ? 'border-emerald-400/40 bg-emerald-400/[0.06]'
            : 'border-white/[0.05] bg-white/[0.012]',
        )}
      >
        <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-slate-400">
          <Siren size={11} className={corridorOpen ? 'text-emerald-300' : 'text-slate-600'} />
          Green Corridor
        </span>
        <span
          className={cn(
            'flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.14em]',
            corridorOpen ? 'text-emerald-300' : corridorReleased ? 'text-slate-500' : 'text-ops-cyan',
          )}
        >
          <Led tone={corridorOpen ? 'green' : corridorReleased ? 'slate' : 'cyan'} pulse={corridorOpen} size={4} />
          {corridorOpen ? 'GREEN HELD' : corridorReleased ? 'RELEASED' : 'STANDBY'}
        </span>
      </div>

      {/* primary action — driver only notifies the city; never controls signals */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.985 }}
        onClick={onNotifyCity}
        disabled={cityStatus !== 'NOT_SENT'}
        className={cn(
          'flex h-8 w-full items-center justify-center gap-2 rounded-[4px] border font-mono text-[9px] font-bold uppercase tracking-[0.2em] transition-colors disabled:opacity-60',
          cityStatus === 'NOT_SENT'
            ? 'border-ops-cyan/50 bg-ops-cyan/[0.08] text-ops-cyan hover:bg-ops-cyan/[0.16]'
            : 'border-white/10 bg-white/[0.02] text-slate-500',
        )}
      >
        {cityStatus === 'NOT_SENT' ? <Send size={12} /> : <CircleCheck size={12} />}
        {cityStatus === 'NOT_SENT' ? 'Notify City' : cityStatus === 'REQUESTED' ? 'Route Request Sent' : 'City Acknowledged'}
      </motion.button>
    </div>
  )
}