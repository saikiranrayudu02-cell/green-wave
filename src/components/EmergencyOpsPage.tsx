// ---------------------------------------------------------------------------
// AROGYAOS × GREENWAVE — EMERGENCY COORDINATION NETWORK (role-aware ops view)
//
// THREE operational roles observe the SAME shared emergency case:
//   AMBULANCE DRIVER (DriverPortal) · CITY AUTHORITY (CityAuthorityPortal) ·
//   HOSPITAL (HospitalPortal)
//
// Rules of this layer:
//  · No second ambulance, route, ETA, corridor, or simulation — every value is
//    the existing GreenWave state passed in as props (unit, displayEta,
//    corrWave, caseStatusForUnit projection).
//  · Role selection is DEMO routing inside the operator session — it is never
//    presented as real authentication (the label says DEMO ROLE).
//  · Actions mutate the ONE shared case (driverNotifyCity / cityAcknowledge /
//    hospitalAcknowledge / hospitalMarkReady) — App pushes the corresponding
//    real timeline events; nothing here fabricates events.
// ---------------------------------------------------------------------------

import { motion } from 'framer-motion'
import { Building2, Landmark, Radio, Siren, Ambulance } from 'lucide-react'
import type { EmergencyRuntime } from '../types'
import type { CorridorJunction } from '../engine/corridor'
import {
  DEMO_ROLES,
  type DemoRole,
  type EmergencyCase,
  type CaseStatus,
  type CityNotificationStatus,
  type HospitalNotificationStatus,
  type HospitalReadiness,
} from '../arogya/emergencyCase'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { Led, MicroLabel } from './ui'
import DriverPortal from './DriverPortal'
import CityAuthorityPortal from './CityAuthorityPortal'
import HospitalPortal from './HospitalPortal'
import HospitalRecommendationPanel from './HospitalRecommendationPanel'
import type { RecommendationResult } from '../arogya/hospitalRecommend'

interface Props {
  /* shared case + derived status */
  emergencyCase: EmergencyCase | null
  caseStatus: CaseStatus | null
  /* the EXISTING selected unit + live telemetry (single source) */
  unit: EmergencyRuntime | null
  etaSec: number
  progress: number
  nextJunction: string | null
  corridorOpen: boolean
  corridorReleased: boolean
  activating: boolean
  corrWave: CorridorJunction[] | null
  /* live network condition from the EXISTING simulation metrics */
  networkLoadPct: number
  avgSpeedKmh: number
  /* demo role routing (NOT authentication) */
  role: DemoRole
  onRoleChange: (r: DemoRole) => void
  /* advisory hospital recommendation (deterministic, real routePlanner ETAs) */
  recommendation: RecommendationResult | null
  /* actions — App mutates the shared case + emits real timeline events */
  onNotifyCity: () => void
  onCityAcknowledge: () => void
  onHospitalAcknowledge: () => void
  onHospitalDecline: () => void
  onHospitalReady: () => void
  onToggleResource: (key: keyof HospitalReadiness) => void
  onHandoverComplete: () => void
  onOpenHandoff: () => void
  /* driver primary action in standby — the EXISTING dispatch (creates the case) */
  onDispatch: () => void
}

function RoleRow({
  active,
  info,
  onClick,
}: {
  active: boolean
  info: (typeof DEMO_ROLES)[number]
  onClick: () => void
}) {
  const Icon = info.id === 'AMBULANCE_DRIVER' ? Ambulance : info.id === 'CITY_AUTHORITY' ? Landmark : Building2
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-[4px] border px-1 py-[7px] font-mono text-[8px] font-bold tracking-[0.14em] transition-colors',
        active
          ? 'border-ops-cyan/50 bg-ops-cyan/[0.1] text-ops-cyan'
          : 'border-white/[0.06] bg-white/[0.01] text-slate-500 hover:border-white/15 hover:text-slate-300',
      )}
    >
      <Icon size={11} />
      <span>{info.label}</span>
    </motion.button>
  )
}

export default function EmergencyOpsPage({
  emergencyCase,
  caseStatus,
  unit,
  etaSec,
  progress,
  nextJunction,
  corridorOpen,
  corridorReleased,
  activating,
  corrWave,
  networkLoadPct,
  avgSpeedKmh,
  role,
  onRoleChange,
  recommendation,
  onNotifyCity,
  onCityAcknowledge,
  onHospitalAcknowledge,
  onHospitalDecline,
  onHospitalReady,
  onToggleResource,
  onHandoverComplete,
  onOpenHandoff,
  onDispatch,
}: Props) {
  const standby = !emergencyCase || !unit || unit.status === 'PENDING'
  const pending = !unit || unit.status === 'PENDING'
  const cityStatus: CityNotificationStatus = emergencyCase?.cityNotificationStatus ?? 'NOT_SENT'
  const hospStatus: HospitalNotificationStatus = emergencyCase?.hospitalNotificationStatus ?? 'NOT_SENT'
  const corridorState = corridorOpen ? 'ACTIVE' : corridorReleased ? 'RELEASED' : activating ? 'ARMING' : 'STANDBY'

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="flex h-full w-[356px] shrink-0 flex-col overflow-hidden rounded-md border border-white/[0.07] bg-night-900"
    >
      {/* header */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[4px] border border-ops-cyan/30 bg-ops-cyan/[0.08] text-ops-cyan">
            <Radio size={11} />
          </span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-200">
            Emergency Ops
          </span>
        </div>
        <span className="rounded-[2px] border border-ops-amber/35 px-1.5 py-[1px] font-mono text-[7px] font-semibold tracking-[0.14em] text-ops-amber">
          DEMO ROLE
        </span>
      </header>

      {/* role switcher — demo routing, clearly labelled, never auth */}
      <div className="shrink-0 px-3 pt-2.5">
        <MicroLabel className="mb-1.5 text-slate-600">Operational Role</MicroLabel>
        <div className="flex gap-1.5">
          {DEMO_ROLES.map((r) => (
            <RoleRow key={r.id} info={r} active={role === r.id} onClick={() => onRoleChange(r.id)} />
          ))}
        </div>
      </div>

      {/* shared case strip — every role sees the same case */}
      <div className="mt-2.5 shrink-0 px-3">
        <div className="rounded-[4px] border border-white/[0.05] bg-white/[0.012] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              {emergencyCase ? emergencyCase.caseId : '—'}
            </span>
            <span
              className={cn(
                'flex items-center gap-1.5 font-mono text-[8.5px] font-bold tracking-[0.14em]',
                corridorOpen ? 'text-emerald-300' : 'text-slate-500',
              )}
            >
              <Led tone={corridorOpen ? 'green' : activating ? 'cyan' : 'slate'} pulse={corridorOpen || activating} size={5} />
              CORRIDOR {corridorState}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="font-mono text-[9px] tracking-[0.08em] text-slate-400">
              {unit ? `${unit.tac} → ${emergencyCase?.hospitalName ?? unit.destination}` : 'NO ACTIVE UNIT'}
            </span>
            {!pending && (
              <span className="font-mono text-[10px] font-semibold tabular text-ops-cyan">
                {fmtClock(Math.max(0, etaSec))}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2.5">
        {standby ? (
          <div className="space-y-2.5">
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-white/[0.06] px-4 py-4 text-center">
              <Siren size={16} className="text-slate-700" />
              <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-600">
                NO ACTIVE EMERGENCY
              </div>
              {role === 'AMBULANCE_DRIVER' && onDispatch ? (
                /* driver primary action — the EXISTING dispatch flow (creates the shared case) */
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.985 }}
                  onClick={onDispatch}
                  className="mt-1 flex h-9 w-full max-w-[240px] items-center justify-center gap-2 rounded-[4px] border border-ops-red/50 bg-ops-red/[0.09] font-mono text-[9.5px] font-bold uppercase tracking-[0.22em] text-ops-red transition-colors hover:bg-ops-red/[0.18]"
                >
                  <Siren size={13} />
                  Dispatch Emergency
                </motion.button>
              ) : (
                <div className="font-mono text-[7.5px] tracking-[0.12em] text-slate-700">
                  AWAITING DRIVER DISPATCH TO BEGIN COORDINATION
                </div>
              )}
            </div>
            {/* GreenWave's recommended receiving hospital (advisory) */}
            <HospitalRecommendationPanel recommendation={recommendation} />
          </div>
        ) : role === 'AMBULANCE_DRIVER' ? (
          <DriverPortal
            emergencyCase={emergencyCase}
            unit={unit}
            etaSec={etaSec}
            nextJunction={nextJunction}
            corridorOpen={corridorOpen}
            corridorReleased={corridorReleased}
            corrWave={corrWave}
            cityStatus={cityStatus}
            onNotifyCity={onNotifyCity}
          />
        ) : role === 'CITY_AUTHORITY' ? (
          <div className="space-y-2.5">
            <CityAuthorityPortal
              emergencyCase={emergencyCase}
              unit={unit}
              etaSec={etaSec}
              cityStatus={cityStatus}
              corrWave={corrWave}
              networkLoadPct={networkLoadPct}
              avgSpeedKmh={avgSpeedKmh}
              onCityAcknowledge={onCityAcknowledge}
            />
            <HospitalRecommendationPanel
              recommendation={recommendation}
              title={hospStatus === 'DECLINED' ? 'Assisted Rerouting · Alternatives' : 'Why This Hospital'}
            />
          </div>
        ) : (
          <HospitalPortal
            emergencyCase={emergencyCase}
            unit={unit}
            etaSec={etaSec}
            caseStatus={caseStatus ?? 'EN_ROUTE'}
            hospStatus={hospStatus}
            onHospitalAcknowledge={onHospitalAcknowledge}
            onHospitalDecline={onHospitalDecline}
            onHospitalReady={onHospitalReady}
            onToggleResource={onToggleResource}
            onHandoverComplete={onHandoverComplete}
            onOpenHandoff={onOpenHandoff}
          />
        )}
      </div>

      {/* footer */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.06] px-3">
        <span className="font-mono text-[7px] tracking-[0.18em] text-slate-700">SHARED EMERGENCY CASE · ONE SOURCE OF TRUTH</span>
        <span className="flex items-center gap-1.5 font-mono text-[7px] tracking-[0.12em] text-slate-600">
          <Led tone="cyan" pulse size={3.5} /> {Math.round(progress * 100)}% ROUTE
        </span>
      </div>
    </motion.div>
  )
}