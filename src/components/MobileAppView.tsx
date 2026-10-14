import { useState } from 'react'
import {
  Map,
  Siren,
  Route,
  Activity,
  AlertTriangle,
  RotateCcw,
  HeartPulse,
  ChevronRight,
  Sparkles,
} from 'lucide-react'
import { cn } from '../lib/cn'
import MobileHeader from './MobileHeader'
import MobileTabs from './MobileTabs'
import MobileHome from './MobileHome'
import MobileEmergencyControl from './MobileEmergencyControl'
import MobileCoordination from './MobileCoordination'
import MobileTrafficAndTwin from './MobileTrafficAndTwin'
import MobileAnalytics from './MobileAnalytics'
import EmergencyOpsPage from './EmergencyOpsPage'
import CityMap, { type UnitSim } from './CityMap'
import IncidentAlert from './IncidentAlert'
import { Pill } from './ui'
import { fmtClock } from '../lib/format'
import type { EmergencyRuntime, IncidentState, Mode, Toast } from '../types'
import type { EmergencyCase, CaseStatus, DemoRole, HospitalReadiness } from '../arogya/emergencyCase'
import type { RecommendationResult } from '../arogya/hospitalRecommend'
import type { OperatorSession } from '../backend/session'
import type { CorridorJunction } from '../engine/corridor'
import type { SimMetrics } from '../engine/vehicles'
import type { MetricsData } from './MetricsStrip'

interface MobileAppViewProps {
  units: EmergencyRuntime[]
  mapUnits: UnitSim[]
  selectedId: string
  selected: EmergencyRuntime
  incident: IncidentState | null
  mode: Mode
  epoch: number
  resetKey: number
  corridorsOpen: number
  activatingId: string | null
  metrics: MetricsData
  sim: SimMetrics
  arogyaCase: EmergencyCase | null
  arogyaCaseStatus: CaseStatus | null
  displayEta: number
  corrWaves: Record<string, CorridorJunction[]>
  opsRole: DemoRole
  session: OperatorSession | null
  logOpen: boolean
  toasts: Toast[]
  canAdd: boolean
  onTelemetry: (data: Array<{ id: string; d: number; len: number; arrived: boolean; wait: number }>) => void
  onSelectUnit: (id: string) => void
  onDispatch: (id: string) => void
  onOpenCorridor: (id: string) => void
  onCloseCorridor: (id: string) => void
  onMode: (m: Mode) => void
  onAddEmergency: () => void
  onInjectIncident: () => void
  onReset: () => void
  onOpenHandoff: () => void
  onOpenSession: () => void
  onToggleLog: () => void
  onCloseToast: (id: number) => void
  onOpenInstall: () => void
  setOpsRole: (r: DemoRole) => void
  hospitalRecommendation: RecommendationResult | null
  handleDriverNotifyCity: () => void
  handleCityAcknowledge: () => void
  handleHospitalAcknowledge: () => void
  handleHospitalDecline: () => void
  handleHospitalReady: () => void
  handleToggleResource: (key: keyof HospitalReadiness) => void
  handleHandoverComplete: () => void
}

export default function MobileAppView(props: MobileAppViewProps) {
  const [activeTab, setActiveTab] = useState<'home' | 'map' | 'emergencies' | 'corridors' | 'traffic' | 'analytics' | 'ops' | 'system'>('home')

  const {
    units,
    mapUnits,
    selectedId,
    selected,
    incident,
    mode,
    epoch,
    resetKey,
    corridorsOpen,
    activatingId,
    metrics,
    sim,
    arogyaCase,
    arogyaCaseStatus,
    displayEta,
    corrWaves,
    opsRole,
    session,
    logOpen,
    toasts,
    onTelemetry,
    onSelectUnit,
    onDispatch,
    onOpenCorridor,
    onCloseCorridor,
    onMode,
    onInjectIncident,
    onReset,
    onOpenHandoff,
    onOpenSession,
    onToggleLog,
    onCloseToast,
    onOpenInstall,
    setOpsRole,
    hospitalRecommendation,
    handleDriverNotifyCity,
    handleCityAcknowledge,
    handleHospitalAcknowledge,
    handleHospitalDecline,
    handleHospitalReady,
    handleToggleResource,
    handleHandoverComplete,
  } = props

  const anyOpen = corridorsOpen > 0
  const isCorridorActive = selected?.corridorOpen && !selected?.arrived
  const coordUnit = units.find((u) => u.id === selectedId) ?? units[0]

  const nextJunction = (() => {
    if (!coordUnit || coordUnit.arrived) return null
    const idx = coordUnit.len > 0 ? Math.floor((coordUnit.dist / coordUnit.len) * coordUnit.junctionIds.length) : 0
    return idx < coordUnit.junctionIds.length ? coordUnit.junctionIds[idx] : null
  })()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-night-950 text-slate-300 select-none">
      {/* Top Mobile Header */}
      <MobileHeader
        moduleLabel={activeTab.toUpperCase()}
        corridorActive={anyOpen}
        onOpenSession={onOpenSession}
        logOpen={logOpen}
        onToggleLog={onToggleLog}
        onOpenInstall={onOpenInstall}
      />

      {/* Main viewport with bottom padding for fixed mobile tabs */}
      <main className="relative flex-1 overflow-hidden">
        {/* PERSISTENT CITYMAP: Always mounted in DOM so simulation loop never halts */}
        <div
          className={cn(
            'absolute inset-0 z-10 transition-opacity duration-200',
            activeTab === 'map' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          )}
        >
          <CityMap
            units={mapUnits}
            incident={incident}
            mode={mode}
            epoch={epoch}
            resetKey={resetKey}
            onTelemetry={onTelemetry}
          />

          {/* Floating corridor banner */}
          <div className="pointer-events-none absolute left-3 top-3 right-3 z-20 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-night-900/90 px-2.5 py-1.5 backdrop-blur-md shadow-lg">
              <span className={cn('h-2 w-2 rounded-full', isCorridorActive ? 'bg-emerald-400 shadow-[0_0_8px_#2fe08a]' : 'bg-slate-500')} />
              <div className="leading-tight">
                <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-200">
                  {selected?.tac ?? 'EM-01'} · {isCorridorActive ? 'CORRIDOR OPEN' : selected?.status ?? 'STANDBY'}
                </div>
                <div className="font-mono text-[8px] text-slate-400">
                  ETA: <span className="text-emerald-300 font-semibold">{selected?.status === 'PENDING' ? '—' : fmtClock(displayEta)}</span>
                  {selected?.savedSec > 0 && <span className="ml-1 text-ops-cyan">(-{fmtClock(selected.savedSec)})</span>}
                </div>
              </div>
            </div>

            {/* Quick mode badge */}
            <button
              type="button"
              onClick={() => onMode(mode === 'greenwave' ? 'fixed' : 'greenwave')}
              className={cn(
                'pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-wider backdrop-blur-md shadow-lg transition-transform active:scale-95',
                mode === 'greenwave'
                  ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
                  : 'border-ops-cyan/40 bg-night-900/90 text-ops-cyan'
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              {mode === 'greenwave' ? 'ADAPTIVE' : 'FIXED'}
            </button>
          </div>

          {/* Floating incident alert */}
          <div className="absolute right-3 top-14 z-20 max-w-[280px]">
            <IncidentAlert toasts={toasts} incidentActive={incident !== null} onClose={onCloseToast} />
          </div>

          {/* Floating bottom map controls bar */}
          <div className="pointer-events-auto absolute bottom-4 left-3 right-3 z-30 flex flex-col gap-2 rounded-xl border border-white/[0.1] bg-night-900/92 p-2.5 shadow-2xl backdrop-blur-lg">
            {/* Unit switch & Status row */}
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
              <div className="flex items-center gap-1">
                {units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onSelectUnit(u.id)}
                    className={cn(
                      'rounded px-2 py-1 font-mono text-[9px] font-bold tracking-wider transition-colors',
                      selectedId === u.id
                        ? 'border border-ops-cyan/50 bg-ops-cyan/20 text-ops-cyan'
                        : 'border border-white/5 bg-white/[0.02] text-slate-400'
                    )}
                  >
                    {u.tac}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 text-[8.5px] font-mono text-slate-400">
                <span>Speed: <strong className="text-slate-200">{sim.avgSpeedKmh.toFixed(0)} km/h</strong></span>
                <span>·</span>
                <span>Load: <strong className="text-slate-200">{sim.loadPct.toFixed(0)}%</strong></span>
              </div>
            </div>

            {/* Primary actions row */}
            <div className="flex items-center gap-2">
              {selected?.status === 'PENDING' ? (
                <button
                  type="button"
                  onClick={() => onDispatch(selected.id)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ops-red px-3 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-white shadow-[0_0_15px_rgba(239,68,68,0.4)] active:scale-[0.98] transition-transform"
                >
                  <Siren size={13} /> DISPATCH {selected.tac}
                </button>
              ) : selected?.arrived ? (
                <button
                  type="button"
                  onClick={onReset}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-3 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wider text-emerald-300"
                >
                  <RotateCcw size={13} /> {selected.tac} ARRIVED · RESET
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (selected.corridorOpen) onCloseCorridor(selected.id)
                    else onOpenCorridor(selected.id)
                  }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-mono text-[10.5px] font-bold uppercase tracking-wider transition-all active:scale-[0.98]',
                    selected.corridorOpen
                      ? 'bg-ops-amber/20 border border-ops-amber/40 text-ops-amber'
                      : 'bg-emerald-500 text-night-950 font-extrabold shadow-[0_0_15px_rgba(47,224,138,0.4)]'
                  )}
                >
                  <Route size={13} />
                  {selected.corridorOpen ? 'RELEASE CORRIDOR' : 'OPEN GREEN CORRIDOR'}
                </button>
              )}

              {/* Quick incident button */}
              <button
                type="button"
                onClick={onInjectIncident}
                title={incident ? 'Incident Active' : 'Inject Incident'}
                className={cn(
                  'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border transition-colors',
                  incident
                    ? 'border-ops-red/50 bg-ops-red/20 text-ops-red animate-pulse'
                    : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200'
                )}
              >
                <AlertTriangle size={14} />
              </button>

              {/* Reset button */}
              <button
                type="button"
                onClick={onReset}
                title="Reset Simulation"
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200 transition-colors"
              >
                <RotateCcw size={14} />
              </button>

              {/* Arogya Clinical Handoff */}
              <button
                type="button"
                onClick={onOpenHandoff}
                title="Open Doctor Clinical Handoff"
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-ops-cyan/40 bg-ops-cyan/15 text-ops-cyan hover:bg-ops-cyan/25 transition-colors"
              >
                <HeartPulse size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* TAB 1: HOME */}
        {activeTab === 'home' && (
          <div className="h-full overflow-y-auto pb-[76px] p-3 space-y-3">
            {/* Hero Quick Launch Map Banner */}
            <div
              onClick={() => setActiveTab('map')}
              className="group relative cursor-pointer overflow-hidden rounded-xl border border-ops-cyan/35 bg-gradient-to-r from-ops-cyan/[0.12] via-night-900 to-night-850 p-4 shadow-[0_0_20px_rgba(56,196,224,0.12)] transition-all active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ops-cyan/40 bg-night-800 text-ops-cyan shadow-[0_0_12px_rgba(56,196,224,0.3)]">
                    <Map size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-ops-cyan">
                        LIVE SIMULATION
                      </span>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    </div>
                    <h2 className="text-[15px] font-bold text-slate-100">
                      Open City Traffic Map
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-1 font-mono text-[10px] font-semibold text-ops-cyan group-hover:translate-x-1 transition-transform">
                  <span>WATCH</span>
                  <ChevronRight size={14} />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[9px] font-mono text-slate-400">
                <span>{sim.active} vehicles in motion</span>
                <span className="text-emerald-300 font-semibold">{corridorsOpen} active corridors</span>
              </div>
            </div>

            {/* Quick Demo Controls */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const pending = units.find((u) => u.status === 'PENDING')
                  if (pending) onDispatch(pending.id)
                  setActiveTab('map')
                }}
                className="flex items-center justify-center gap-2 rounded-lg bg-ops-red/15 border border-ops-red/35 p-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ops-red active:scale-95 transition-transform"
              >
                <Siren size={14} /> Dispatch EMS
              </button>

              <button
                type="button"
                onClick={() => onMode(mode === 'greenwave' ? 'fixed' : 'greenwave')}
                className="flex items-center justify-center gap-2 rounded-lg bg-ops-cyan/15 border border-ops-cyan/35 p-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ops-cyan active:scale-95 transition-transform"
              >
                <Activity size={14} /> Mode: {mode.toUpperCase()}
              </button>
            </div>

            {/* MobileHome Overview */}
            <MobileHome
              modules={{
                emergencies: {
                  active: units.filter((u) => u.status === 'ACTIVE').length,
                  responding: units.filter((u) => u.status === 'ACTIVE' && !u.arrived).length,
                  corridors: corridorsOpen,
                },
                traffic: {
                  vehicles: sim.active,
                  avgSpeed: sim.avgSpeedKmh,
                  queueAvg: sim.queueM,
                  loadPct: sim.loadPct,
                },
                network: {
                  throughput: sim.throughput,
                  delayAvg: sim.avgWaitSec,
                },
              }}
              activeEmergencies={units.map((u) => ({
                id: u.id,
                tac: u.tac,
                incident: u.incident,
                origin: u.origin,
                destination: u.destination,
                priority: u.priority,
                status: u.status,
                etaSec: u.etaSec,
                corridorOpen: u.corridorOpen,
              }))}
            />
          </div>
        )}

        {/* TAB 2: EMERGENCIES */}
        {activeTab === 'emergencies' && (
          <div className="h-full overflow-y-auto pb-[90px] p-3 space-y-3">
            <MobileEmergencyControl
              emergencies={units}
              selectedId={selectedId}
              incident={incident}
              onSelect={(id) => onSelectUnit(id)}
            />

            {/* Sticky bottom dispatch actions */}
            <div className="rounded-xl border border-white/[0.08] bg-night-900/95 p-3 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-400">Selected Unit: <strong className="text-slate-100">{selected.tac}</strong></span>
                <span className={cn('font-semibold', selected.corridorOpen ? 'text-emerald-300' : 'text-slate-500')}>
                  {selected.corridorOpen ? 'CORRIDOR OPEN' : selected.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {selected.status === 'PENDING' ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDispatch(selected.id)
                      setActiveTab('map')
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-ops-red p-2 font-mono text-[10.5px] font-bold uppercase text-white shadow-lg active:scale-95"
                  >
                    <Siren size={13} /> Dispatch
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (selected.corridorOpen) onCloseCorridor(selected.id)
                      else onOpenCorridor(selected.id)
                    }}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-lg p-2 font-mono text-[10.5px] font-bold uppercase active:scale-95 transition-colors',
                      selected.corridorOpen
                        ? 'border border-ops-amber/40 bg-ops-amber/15 text-ops-amber'
                        : 'border border-emerald-400/40 bg-emerald-500 text-night-950 font-extrabold'
                    )}
                  >
                    <Route size={13} />
                    {selected.corridorOpen ? 'Release Wave' : 'Open Corridor'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveTab('map')}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-ops-cyan/40 bg-ops-cyan/15 p-2 font-mono text-[10.5px] font-bold uppercase text-ops-cyan active:scale-95"
                >
                  <Map size={13} /> Track On Map
                </button>
              </div>

              <button
                type="button"
                onClick={onOpenHandoff}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] p-2 font-mono text-[10px] font-medium text-slate-300 hover:bg-white/[0.08]"
              >
                <HeartPulse size={12} className="text-emerald-400" />
                Doctor Pre-Arrival Clinical Triage
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: CORRIDORS / COORDINATION */}
        {activeTab === 'corridors' && (
          <div className="h-full overflow-y-auto pb-[76px] p-2">
            <MobileCoordination />
          </div>
        )}

        {/* TAB 4: TRAFFIC & DIGITAL TWIN */}
        {activeTab === 'traffic' && (
          <div className="h-full overflow-y-auto pb-[76px]">
            <MobileTrafficAndTwin
              mode={mode}
              incident={incident ? { id: 'inc', junctionId: incident.junctionId, label: incident.label } : null}
            />
          </div>
        )}

        {/* TAB 5: ANALYTICS */}
        {activeTab === 'analytics' && (
          <div className="h-full overflow-y-auto pb-[76px]">
            <MobileAnalytics
              mode={mode}
              incident={incident ? { junctionId: incident.junctionId, severity: 'HIGH' } : null}
            />
          </div>
        )}

        {/* TAB 6: HOSPITAL OPS (CLINICAL TRIAGE) */}
        {activeTab === 'ops' && (
          <div className="h-full overflow-y-auto pb-[76px] p-2">
            <EmergencyOpsPage
              emergencyCase={arogyaCase}
              caseStatus={arogyaCaseStatus}
              unit={coordUnit}
              etaSec={displayEta}
              progress={coordUnit && coordUnit.len > 0 ? Math.min(1, coordUnit.dist / coordUnit.len) : 0}
              nextJunction={nextJunction}
              corridorOpen={!!(coordUnit && coordUnit.corridorOpen && !coordUnit.arrived)}
              corridorReleased={!!coordUnit?.arrived}
              activating={activatingId === selectedId}
              corrWave={corrWaves[selectedId] ?? null}
              networkLoadPct={sim.loadPct}
              avgSpeedKmh={sim.avgSpeedKmh}
              role={opsRole}
              onRoleChange={setOpsRole}
              recommendation={hospitalRecommendation}
              onNotifyCity={handleDriverNotifyCity}
              onCityAcknowledge={handleCityAcknowledge}
              onHospitalAcknowledge={handleHospitalAcknowledge}
              onHospitalDecline={handleHospitalDecline}
              onHospitalReady={handleHospitalReady}
              onToggleResource={handleToggleResource}
              onHandoverComplete={handleHandoverComplete}
              onOpenHandoff={onOpenHandoff}
              onDispatch={() => {
                const u = coordUnit ?? units.find((x) => x.status === 'PENDING')
                if (u) onDispatch(u.id)
              }}
            />
          </div>
        )}

        {/* TAB 7: SYSTEM */}
        {activeTab === 'system' && (
          <div className="h-full overflow-y-auto pb-[76px] p-4 space-y-3">
            <div className="rounded-xl border border-white/[0.08] bg-night-900 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <div>
                  <h3 className="font-mono text-[13px] font-bold text-slate-100">SYSTEM ARCHITECTURE</h3>
                  <p className="text-[10px] text-slate-500 font-mono">GreenWave Operational Status</p>
                </div>
                <Pill tone="green">v0.2 LIVE</Pill>
              </div>

              <div className="space-y-2 text-[11px] font-mono">
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <span className="text-slate-400">Simulation Engine</span>
                  <span className="text-emerald-300 font-semibold">LOCAL BROWSER RUNTIME</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <span className="text-slate-400">Persistence Store</span>
                  <span className="text-ops-cyan font-semibold">SUPABASE POSTGREST</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <span className="text-slate-400">Live State Bridge</span>
                  <span className="text-ops-cyan font-semibold">CONVEX HTTP</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <span className="text-slate-400">Local Tab Sync</span>
                  <span className="text-emerald-300 font-semibold">BROADCAST CHANNEL</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <span className="text-slate-400">Active Operator</span>
                  <span className="text-ops-cyan font-semibold">{session?.operator ?? 'Demo Operator'}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <span className="text-slate-400">Tracked Vehicles</span>
                  <span className="text-emerald-300 font-semibold">{metrics.vehicles} active</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={onOpenInstall}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-ops-cyan/40 bg-ops-cyan/15 p-2.5 font-mono text-[11px] font-bold uppercase text-ops-cyan hover:bg-ops-cyan/25 transition-colors"
                >
                  <Sparkles size={14} /> Install GreenWave PWA App
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-2.5 font-mono text-[11px] font-bold uppercase text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <RotateCcw size={14} /> Full Simulation Reset
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Fixed Bottom Mobile Tabs Navigation */}
      <MobileTabs active={activeTab} onNavigate={(id) => setActiveTab(id as typeof activeTab)} />
    </div>
  )
}
