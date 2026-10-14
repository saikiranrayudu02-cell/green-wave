import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Siren,
  MapPin,
  Navigation,
  AlertTriangle,
  ChevronRight,
  Play,
  RotateCcw,
  Check,
  Info,
} from 'lucide-react'
import { Led, MicroLabel, Pill } from './ui'
import { cn } from '../lib/cn'

const SHARED = ['J15', 'J18', 'J22'] as const

const AMBULANCE_A: {
  id: string
  label: string
  code: 'MEDICAL' | 'TRAUMA'
  priority: string
  incident: string
  origin: string
  destination: string
  eta: string
  route: readonly string[]
} = {
  id: 'A',
  label: 'AMBULANCE A',
  code: 'MEDICAL',
  priority: 'CRITICAL',
  incident: 'Critical cardiac emergency',
  origin: 'Airport',
  destination: 'City General Hospital',
  eta: '8 minutes',
  route: ['J12', 'J15', 'J18', 'J22'] as const,
}

const AMBULANCE_B: {
  id: string
  label: string
  code: 'MEDICAL' | 'TRAUMA'
  priority: string
  incident: string
  origin: string
  destination: string
  eta: string
  route: readonly string[]
} = {
  id: 'B',
  label: 'AMBULANCE B',
  code: 'TRAUMA',
  priority: 'CRITICAL',
  incident: 'Critical trauma emergency',
  origin: 'City Bypass',
  destination: 'City General Hospital',
  eta: '10 minutes',
  route: ['J15', 'J18', 'J20', 'J22'] as const,
}

interface JunctionStep {
  junction: string
  shared: boolean
  aArrival: string
  bArrival: string
  note: string
  sequence: string
  safe: boolean
}

const COORD_PLAN: JunctionStep[] = [
  {
    junction: 'J15',
    shared: true,
    aArrival: '08:32',
    bArrival: '08:35',
    note: 'Both routes enter here. Ambulance A is ~3 min ahead.',
    sequence: 'AMBULANCE A FIRST',
    safe: true,
  },
  {
    junction: 'J18',
    shared: true,
    aArrival: '08:36',
    bArrival: '08:40',
    note: 'A arrives while B is still ~1–2 min away — safe to hold for A, let B clear shortly after.',
    sequence: 'A THROUGH, THEN B',
    safe: true,
  },
  {
    junction: 'J20',
    shared: false,
    aArrival: '—',
    bArrival: '08:44',
    note: 'B-only junction along its remaining route.',
    sequence: 'NO CONFLICT',
    safe: true,
  },
  {
    junction: 'J22',
    shared: true,
    aArrival: '08:41',
    bArrival: '08:48',
    note: 'Both routes terminate near the hospital zone. If B finishes transit cleanly before A’s arrival window, no hold is needed; otherwise hold briefly for the earlier arrival.',
    sequence: 'HOLD-THEN-PASS IF OVERLAP',
    safe: true,
  },
]

type ScenarioState =
  | { mode: 'ready' }
  | { mode: 'simulating'; steps: JunctionStep[] }
  | { mode: 'done'; result: ResultSummary }

interface ResultSummary {
  conflict: boolean
  sequence: string
  rationale: string
  decisionNote: string
}

const SIMULATED_RESULT: ResultSummary = {
  conflict: true,
  sequence: 'AMBULANCE A FIRST THROUGH SHARED JUNCTIONS, THEN AMBULANCE B',
  rationale:
    "Both emergencies are critical, so urgency alone does not decide priority. Ambulance A reaches the shared junctions first (J15 → J18 → J22) by roughly three minutes, and route overlap is concentrated at J15, J18, and J22. The proposed safe sequence lets Ambulance A pass through the shared junctions first, then releases Ambulance B once the shared nodes are clear. J20 is only on Ambulance B's route, so it introduces no shared-junction conflict.",
  decisionNote:
    'Because both emergencies have equal priority (CRITICAL), the final tie-break depends on dispatcher judgment, real-time cross-traffic, pedestrians, and signal timing. This demo proposes a deterministic safe sequence; it does not dispatch real ambulances or control real traffic lights.',
}

function AmbulanceCard({
  a,
  checked,
}: {
  a: typeof AMBULANCE_A | typeof AMBULANCE_B
  checked?: boolean
}) {
  const isA = a.id === 'A'
  return (
    <div
      className={cn(
        'rounded-md border bg-night-900 px-3.5 py-3',
        isA ? 'border-ops-cyan/35' : 'border-ops-red/35'
      )}
    >
      {/* top identity */}
      <div className="flex items-center gap-2.5">
        <div className={cn(
          'flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[5px] border',
          isA ? 'border-ops-cyan/35 bg-ops-cyan/[0.1] text-ops-cyan' : 'border-ops-red/35 bg-ops-red/[0.1] text-ops-red'
        )}>
          <Siren size={16} strokeWidth={2} className={cn('beacon-a', isA ? 'beacon-a' : 'beacon-b')} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-100">{a.label}</span>
            <Pill tone="red">{a.priority}</Pill>
          </div>
          <div className="mt-0.5 font-mono text-[8.5px] tracking-[0.12em] text-slate-600">
            {a.code === 'MEDICAL' ? 'Medical Emergency' : 'Trauma Incident'}
          </div>
        </div>
        {checked && <Check size={14} className="ml-auto text-emerald-300" />}
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <MicroLabel className="text-slate-500">Incident</MicroLabel>
          <div className="mt-0.5 truncate font-mono text-[10.5px] font-medium text-slate-200">{a.incident}</div>
        </div>
        <div>
          <MicroLabel className="text-slate-500">Origin</MicroLabel>
          <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10.5px] text-slate-200">
            <MapPin size={10} className="shrink-0 text-slate-500" />
            {a.origin}
          </div>
        </div>
        <div className="col-span-2">
          <MicroLabel className="text-slate-500">Destination</MicroLabel>
          <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10.5px] text-slate-200">
            <Navigation size={10} className="shrink-0 text-slate-500" />
            {a.destination}
          </div>
        </div>
      </div>

      {/* route */}
      <div className="mt-2.5 rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <MicroLabel className="text-slate-500">Route</MicroLabel>
          <span className="ml-auto font-mono text-[8.5px] tracking-[0.14em] text-slate-600">ETA {a.eta}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {a.route.map((j, i) => {
            const shared = SHARED.includes(j as typeof SHARED[number])
            return (
              <span
                key={j}
                className={cn(
                  'inline-flex items-center gap-1 rounded-[3px] border font-mono text-[9px] font-semibold tracking-[0.06em]',
                  shared
                    ? 'border-ops-amber/50 bg-ops-amber/[0.08] text-ops-amber'
                    : i < a.route.length - 1
                      ? 'border-white/[0.08] bg-white/[0.02] text-slate-300'
                      : 'border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300'
                )}
              >
                {j}
                {i < a.route.length - 1 && (
                  <ChevronRight
                    size={9}
                    className={cn(shared ? 'text-ops-amber/60' : 'text-slate-500')}
                  />
                )}
              </span>
            )
          })}
        </div>
        {SHARED.some((j) => a.route.includes(j)) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[7.5px] font-mono uppercase tracking-[0.14em] text-ops-amber">
            <AlertTriangle size={8} className="shrink-0 text-ops-amber" />
            Shared junction: {SHARED.filter((j) => a.route.includes(j)).join(', ')}
          </div>
        )}
      </div>

      {/* ETA strip */}
      <div className="mt-2 flex items-center justify-between rounded-[4px] border border-white/[0.05] bg-night-850/60 px-2.5 py-1.5">
        <MicroLabel className="text-slate-600">Estimated Arrival</MicroLabel>
        <span className="font-mono text-[12px] font-semibold tabular text-slate-100">{a.eta}</span>
      </div>

      {/* origin-to-dest path summary */}
      <div className="mt-2 flex items-center gap-2 text-[7.5px] font-mono uppercase tracking-[0.14em] text-slate-600">
        <span className="text-slate-500">From</span>
        <span className="text-slate-400">{a.origin}</span>
        <span className="text-slate-700">→</span>
        <span className="text-slate-400">{a.destination}</span>
      </div>
    </div>
  )
}

export default function MobileCoordination() {
  const [scenario, setScenario] = useState<ScenarioState>({ mode: 'ready' })
  const [simulating, setSimulating] = useState(false)
  const timerRef = useRef<number | null>(null)

  const startSimulation = useCallback(() => {
    setSimulating(true)
    setScenario({ mode: 'ready' })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setScenario({ mode: 'simulating', steps: COORD_PLAN })
      timerRef.current = window.setTimeout(() => {
        setScenario({ mode: 'done', result: SIMULATED_RESULT })
        setSimulating(false)
      }, 900)
    }, 350)
  }, [])

  const resetScenario = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSimulating(false)
    setScenario({ mode: 'ready' })
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4 pt-2 pb-[76px]">
      {/* scenario badge */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 rounded-md border border-ops-amber/30 bg-ops-amber/[0.06] px-3 py-2"
      >
        <Info size={13} className="shrink-0 text-ops-amber" />
        <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-ops-amber">
          SIMULATED SCENARIO
        </span>
        <span className="ml-auto flex items-center gap-1 text-[7.5px] font-mono uppercase tracking-[0.14em] text-slate-500">
          <span>Demo data</span>
          <span className="text-slate-600">·</span>
          <span>Fictional vehicles & routes</span>
        </span>
      </motion.div>

      {/* status line */}
      <div className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-night-900 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Led tone={scenario.mode === 'done' ? 'green' : scenario.mode === 'simulating' ? 'cyan' : 'slate'} pulse={scenario.mode === 'simulating'} size={5} />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">Coordination Status</span>
        </div>
        <span className="ml-auto font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]">
          {scenario.mode === 'ready' && 'DEMO PLAN READY'}
          {scenario.mode === 'simulating' && 'SIMULATING COORDINATION'}
          {scenario.mode === 'done' && 'PLAN COMPUTED'}
        </span>
      </div>

      {/* two ambulance cards */}
      <div className="grid gap-3">
        <AmbulanceCard a={AMBULANCE_A} checked={scenario.mode === 'done'} />
        <AmbulanceCard a={AMBULANCE_B} checked={scenario.mode === 'done'} />
      </div>

      {/* shared-junction conflict alert */}
      <AnimatePresence mode="popLayout" initial={false}>
        {scenario.mode === 'ready' && (
          <motion.div
            key="alert-ready"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-start gap-2.5 rounded-md border border-ops-amber/40 bg-ops-amber/[0.07] px-3.5 py-3"
          >
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-ops-amber" />
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-ops-amber">
                Shared-Junction Conflict Identified
              </div>
              <div className="mt-1 text-[9.5px] font-mono text-slate-300 leading-relaxed">
                J15, J18, and J22 appear on both routes. Each ambulance may reach a shared intersection at a different time, so the signals must be sequenced safely rather than simply favoring whichever vehicle arrives first.
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-mono uppercase tracking-[0.14em] text-slate-500">
                <span>Share: {SHARED.join(', ')}</span>
                <span>AMBULANCE A: J12 → J15 → J18 → J22</span>
                <span>AMBULANCE B: J15 → J18 → J20 → J22</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* route overlap visualization */}
      <div className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden">
        <div className="border-b border-white/[0.05] px-3.5 py-2">
          <div className="flex items-center gap-2">
            <MicroLabel className="text-slate-500">Route Overlap</MicroLabel>
            <span className="font-mono text-[8px] tracking-[0.14em] text-slate-600">SHARED NODES</span>
          </div>
        </div>
        <div className="px-3.5 py-3">
          <div className="flex flex-col gap-2">
            {/* lane A */}
            <div className="flex items-center gap-2 rounded-[3px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-ops-cyan/35 bg-ops-cyan/[0.08] text-ops-cyan text-[9px] font-bold">A</span>
              <div className="flex flex-1 items-center gap-1 overflow-hidden text-[8.5px] font-mono tracking-[0.04em]">
                {AMBULANCE_A.route.map((j, i) => (
                  <span
                    key={j}
                    className={cn(
                      'inline-flex h-6 min-w-0 items-center justify-center rounded-[2px] border text-[8.5px] font-semibold',
                      SHARED.includes(j as typeof SHARED[number])
                        ? 'border-ops-amber/50 bg-ops-amber/[0.1] text-ops-amber'
                        : i < AMBULANCE_A.route.length - 1
                          ? 'border-white/[0.08] bg-white/[0.02] text-slate-300'
                          : 'border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-300'
                    )}
                  >
                    {j}
                  </span>
                ))}
              </div>
            </div>
            {/* lane B */}
            <div className="flex items-center gap-2 rounded-[3px] border border-white/[0.05] bg-night-850/60 px-2.5 py-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-ops-red/35 bg-ops-red/[0.08] text-ops-red text-[9px] font-bold">B</span>
              <div className="flex flex-1 items-center gap-1 overflow-hidden text-[8.5px] font-mono tracking-[0.04em]">
                {AMBULANCE_B.route.map((j, i) => (
                  <span
                    key={j}
                    className={cn(
                      'inline-flex h-6 min-w-0 items-center justify-center rounded-[2px] border text-[8.5px] font-semibold',
                      SHARED.includes(j as typeof SHARED[number])
                        ? 'border-ops-amber/50 bg-ops-amber/[0.1] text-ops-amber'
                        : i < AMBULANCE_B.route.length - 1
                          ? 'border-white/[0.08] bg-white/[0.02] text-slate-300'
                          : 'border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-300'
                    )}
                  >
                    {j}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[7.5px] font-mono uppercase tracking-[0.14em] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400/60" />
              Shared
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400/70" />
              Destination
            </span>
            <span className="text-slate-600">J20 is unique to Ambulance B</span>
          </div>
        </div>
      </div>

      {/* junction-by-junction coordination plan */}
      <AnimatePresence mode="popLayout" initial={false}>
        {scenario.mode === 'simulating' && (
          <motion.div
            key="plan-sim"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-md border border-white/[0.06] bg-night-900 overflow-hidden"
          >
            <div className="border-b border-white/[0.05] px-3.5 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MicroLabel className="text-slate-500">Coordination Plan</MicroLabel>
                  <span className="font-mono text-[7.5px] tracking-[0.14em] text-ops-cyan">RUNNING</span>
                </div>
                <span className="flex items-center gap-1 font-mono text-[7.5px] tracking-[0.14em] text-slate-500">
                  <Play size={8} className="text-ops-cyan" />
                  Computing safe sequence
                </span>
              </div>
            </div>
            <div className="px-3.5 py-3">
              <p className="mb-3 text-[9px] font-mono leading-relaxed tracking-[0.02em] text-slate-500">
                This demo uses simple timing, route overlap, and shared-junction checks. Real coordination also weighs cross-traffic, pedestrians, signal phase timing, and live dispatcher judgment.
              </p>
              <ul className="flex flex-col gap-2">
                {COORD_PLAN.map((step, i) => (
                  <motion.div
                    key={step.junction}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 * i }}
                    className={cn(
                      'flex items-start gap-2.5 rounded-[4px] border px-3 py-2.5',
                      step.shared
                        ? 'border-ops-amber/35 bg-ops-amber/[0.05]'
                        : 'border-white/[0.05] bg-night-850/60'
                    )}
                  >
                    <div className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] font-mono text-[8.5px] font-bold tracking-[0.08em]',
                      step.shared ? 'border border-ops-amber/50 bg-ops-amber/[0.1] text-ops-amber' : 'border border-white/[0.06] bg-night-800 text-slate-400'
                    )}>
                      {step.junction}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'font-mono text-[9.5px] font-semibold tracking-[0.06em]',
                          step.shared ? 'text-ops-amber' : 'text-slate-400'
                        )}>
                          {step.shared ? 'SHARED' : 'UNIQUE'}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-[9.5px] text-slate-400">A {step.aArrival}</span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-[9.5px] text-slate-400">B {step.bArrival}</span>
                      </div>
                      <p className="mt-0.5 text-[8.5px] font-mono leading-relaxed text-slate-500">{step.note}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="font-mono text-[7.5px] uppercase tracking-[0.14em] text-slate-500">Safe sequence</span>
                        <Pill tone={step.safe ? 'green' : 'amber'}>{step.sequence}</Pill>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* result panel */}
      <AnimatePresence mode="popLayout" initial={false}>
        {scenario.mode === 'done' && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-md border border-emerald-400/30 bg-night-900 overflow-hidden"
          >
            <div className="border-b border-emerald-400/20 px-3.5 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-emerald-300" />
                  <MicroLabel className="text-emerald-300">Proposed Safe Sequence</MicroLabel>
                </div>
                <Pill tone="green">COORDINATION COMPLETE</Pill>
              </div>
            </div>
            <div className="px-3.5 py-3 space-y-3">
              <div className="rounded-[4px] border border-emerald-400/20 bg-emerald-400/[0.04] px-3 py-2.5">
                <MicroLabel className="text-emerald-300">Sequence</MicroLabel>
                <div className="mt-1 font-mono text-[10.5px] font-semibold tracking-[0.04em] text-emerald-200 leading-relaxed">
                  {scenario.result.sequence}
                </div>
              </div>

              <div className="rounded-[4px] border border-white/[0.05] bg-night-850/60 px-3 py-2.5">
                <MicroLabel className="text-slate-500">Why this order</MicroLabel>
                <p className="mt-1 text-[9px] font-mono leading-relaxed text-slate-300">
                  {scenario.result.rationale}
                </p>
              </div>

              <div className="rounded-[4px] border border-ops-amber/30 bg-ops-amber/[0.06] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={11} className="text-ops-amber" />
                  <MicroLabel className="text-ops-amber">Equal-Urgency Note</MicroLabel>
                </div>
                <p className="mt-1 text-[8.5px] font-mono leading-relaxed text-slate-300">
                  {scenario.result.decisionNote}
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-[4px] border border-white/[0.05] bg-night-850/60 px-3 py-2 text-[7.5px] font-mono uppercase tracking-[0.14em] text-slate-600">
                <Info size={9} className="text-slate-600" />
                DEMO · NOT REAL DISPATCH OR SIGNAL CONTROL
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* action buttons */}
      <div className="flex gap-2.5">
        <motion.button
          type="button"
          disabled={simulating || scenario.mode === 'simulating'}
          whileTap={{ scale: 0.98 }}
          onClick={startSimulation}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 rounded-[4px] border px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition-colors',
            scenario.mode === 'done'
              ? 'border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300'
              : scenario.mode === 'ready'
                ? 'border-ops-cyan/40 bg-ops-cyan/[0.06] text-ops-cyan hover:bg-ops-cyan/[0.1]'
                : 'border-white/10 bg-white/[0.03] text-slate-500 cursor-not-allowed'
          )}
        >
          <Play size={13} className="fill-ops-cyan text-night-950" />
          Simulate Coordination
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={resetScenario}
          className="flex-1 flex items-center justify-center gap-2 rounded-[4px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 transition-colors hover:bg-white/[0.06] hover:border-white/15"
        >
          <RotateCcw size={13} />
          Reset Scenario
        </motion.button>
      </div>

      <div className="flex flex-wrap gap-2 text-[7.5px] font-mono uppercase tracking-[0.14em] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400/60" />
          Safe
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-ops-amber/60" />
          Shared junction
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-op-0 text-white/30" />
          Unique junction
        </span>
      </div>
    </div>
  )
}


