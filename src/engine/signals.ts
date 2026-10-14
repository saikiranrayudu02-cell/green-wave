// ---------------------------------------------------------------------------
// GREENWAVE — traffic signal controller
//
// Every intersection is a two-group controller: the "main" axis (the through
// road the rendered head belongs to) and the "cross" axis. Each group gets a
// GREEN → YELLOW → RED sequence; only one group is ever green, and a switch
// always passes through yellow — never GREEN → GREEN or RED → GREEN.
//
//   FIXED TIME  – predetermined cycles: fixed main split, per-junction
//                 offsets (no global sync). Never changes with traffic — the
//                 genuine baseline.
//   GREENWAVE   – adaptive control (engine/pressure.ts): each green serves a
//                 minimum, then the optimizer compares both groups' pressure
//                 every tick and may switch early (with hysteresis) or is
//                 force-yielded at the maximum — so the busy approach gets
//                 more green, nothing starves, and no decision is instant.
//
//   CORRIDOR    – scheduled emergency priority (engine/corridor.ts). Instead
//                 of proximity preemption the corridor engine hands each
//                 junction a *window* { greenAt, releaseAt }: the required
//                 group must be green when the ambulance arrives and stays
//                 held only while it crosses. The controller choreographs the
//                 transition safely — a conflicting green is served as long
//                 as possible, truncated only so that after a normal yellow
//                 the corridor group is green at greenAt (extension when the
//                 corridor group is already serving). After releaseAt the
//                 junction returns to normal control through a full yellow.
//                 The adaptive optimizer is simply paused for the few seconds
//                 a junction is inside the corridor window.
//
// The controller is a pure state machine — the map host keeps one SigCtl per
// displayed signal and advances it every frame with the sim clock. All logic
// stays here so the future predictive controller can replace the pressure
// engine without touching the UI.
// ---------------------------------------------------------------------------
import { EMERGENCY_PRESSURE_BOOST, PRESSURE_HYSTERESIS, groupPressure, pushDecision } from './pressure'
import type { JunctionObs } from './vehicles'
import type { CorridorReq } from './corridor'
import type { PredictionBias } from '../types/prediction'
import { estimatedGreenExtensionSec, pushPredictionEvent } from './trafficPrediction'

export type SignalState = 'RED' | 'YELLOW' | 'GREEN'

export type AxisGroup = 'M' | 'X'

export type Phase = 'MG' | 'MY' | 'XG' | 'XY'

/** cycle geometry (seconds): M-GREEN + YELLOW + X-GREEN + YELLOW */
export const CYCLE_S = 40
export const YELLOW_S = 4
export const GREEN_S = 16
/** adaptive: shortest green a phase must serve before a switch is legal */
export const MIN_GREEN_S = 10
/** adaptive: longest green a phase may hold before it must yield */
export const MAX_GREEN_S = 22
/** green+red of the two groups share the non-yellow budget (fixed mode) */
export const GROUP_BUDGET_S = CYCLE_S - YELLOW_S * 2

/** corridor: hard cap on one continuous emergency hold (safety) */
export const CORRIDOR_MAX_HOLD_S = 20

export interface SigCtl {
  phase: Phase
  /** sim time the current phase ends */
  until: number
  /** decided main green split (fixed mode + corridor-release fallback) */
  mGreen: number
  /** adaptive: switching becomes legal at this sim time (Infinity = fixed) */
  flexMin: number
  /** active corridor schedule, if any */
  corr: (CorridorReq & { holdFrom?: number }) | null
}

export function phaseOffset(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % CYCLE_S
}

/** deterministic FNV-ish hash → small stagger so neighbouring signals differ */
export function jitterS(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 5) * 0.7
}

/**
 * Bootstrap a controller at sim time `t` from the fixed schedule (the offset
 * decides where in the cycle each junction starts).
 */
export function initSigCtl(id: string, t: number): SigCtl {
  const off = phaseOffset(id)
  const e = (((t + off) % CYCLE_S) + CYCLE_S) % CYCLE_S
  const base = { corr: null as SigCtl['corr'] }
  if (e < GREEN_S) return { phase: 'MG', until: t + (GREEN_S - e), mGreen: GREEN_S, flexMin: Infinity, ...base }
  if (e < GREEN_S + YELLOW_S) return { phase: 'MY', until: t + (GREEN_S + YELLOW_S - e), mGreen: GREEN_S, flexMin: Infinity, ...base }
  const xe = e - (GREEN_S + YELLOW_S)
  if (xe < GREEN_S) return { phase: 'XG', until: t + (GREEN_S - xe), mGreen: GREEN_S, flexMin: Infinity, ...base }
  return { phase: 'XY', until: t + (GREEN_S + YELLOW_S - xe), mGreen: GREEN_S, flexMin: Infinity, ...base }
}

export interface AdvanceOpts {
  junctionId: string
  /** adaptive controller on? (greenwave mode) */
  mode: 'fixed' | 'adaptive'
  /** live observations for this junction (queues, approaches, waits) */
  obs: JunctionObs | null
  /** live downstream congestion for each group (pressure penalty) */
  downstream: { M: number; X: number }
  /** group an approaching ambulance needs (pressure boost), null when none */
  emergency: AxisGroup | null
  /** scheduled corridor request (null when none) */
  corr: CorridorReq | null
  /**
   * Forward-looking pressure adjustment from the prediction layer (Step 9).
   * Bounded to ±predictionBiasMax (2.2) — far below EMERGENCY_PRESSURE_BOOST
   * (9) — and ignored entirely inside corridor choreography and fixed mode,
   * so an active emergency corridor always remains dominant.
   */
  prediction?: PredictionBias | null
}

/** pressure of a group including the ambulance boost */
function boostedPressure(group: AxisGroup, opts: AdvanceOpts): number {
  const emergency = opts.emergency === group ? EMERGENCY_PRESSURE_BOOST : 0
  const bias = opts.prediction?.[group] ?? 0
  return groupPressure(group, opts.obs, opts.downstream) + emergency + bias
}

/** same pressure WITHOUT the prediction bias (attribution: did prediction act?) */
function unbiasedPressure(group: AxisGroup, opts: AdvanceOpts): number {
  const emergency = opts.emergency === group ? EMERGENCY_PRESSURE_BOOST : 0
  return groupPressure(group, opts.obs, opts.downstream) + emergency
}

const otherOf = (g: AxisGroup): AxisGroup => (g === 'M' ? 'X' : 'M')
const greenPhaseOf = (g: AxisGroup): Phase => (g === 'M' ? 'MG' : 'XG')
const yellowPhaseOf = (g: AxisGroup): Phase => (g === 'M' ? 'MY' : 'XY')

/* --------------------------------------------------------------------------
 * Corridor choreography — drives a junction while a corridor schedule is
 * active. The required group is green by `greenAt` (conflicting green served
 * until it must clear, then a full yellow), held through the arrival window
 * and released with a proper yellow at `releaseAt`.
 * ------------------------------------------------------------------------ */
function corridorChoreography(cur: SigCtl, t: number, opts: AdvanceOpts): SigCtl {
  const req = cur.corr!
  const g = req.group
  const o = otherOf(g)
  const gG = greenPhaseOf(g)
  const oG = greenPhaseOf(o)
  const gY = yellowPhaseOf(g)

  const endAt = Math.min(req.releaseAt, req.holdFrom != null ? req.holdFrom + CORRIDOR_MAX_HOLD_S : req.releaseAt)

  /* 0. window over — return to normal control (yellow on the served group) */
  if (t >= endAt) {
    cur =
      cur.phase === gG
        ? { ...cur, corr: null, phase: gY, until: t + YELLOW_S, flexMin: Infinity }
        : { ...cur, corr: null }
    return stepMachine(cur, t, opts)
  }

  /* 1. required phase is green (or green is yellowing away) — extend it and
     hold through the arrival window (emergency green extension) */
  if (cur.phase === gG || cur.phase === gY) {
    const holdFrom = req.holdFrom ?? t
    return { ...cur, corr: { ...req, holdFrom }, phase: gG, until: endAt, flexMin: Infinity }
  }

  /* 2. conflicting phase is being served — coordinate the transition so the
     required phase is green exactly at greenAt: conflicting green serves
     until clearAt = greenAt − YELLOW, then a normal yellow, then green. If
     the arrival window has already opened (or is closer than a yellow), the
     conflicting green clears immediately — never an instant RED → GREEN. */
  if (cur.phase === oG) {
    const clearAt = req.greenAt - YELLOW_S
    const trunc = Math.min(cur.until, clearAt)
    if (trunc !== cur.until) cur = { ...cur, until: trunc, flexMin: Infinity }
  }
  // conflicting yellow (oY): the machine finishes it and switches to the
  // required group's green; the re-apply below holds it through arrival.

  // step with the machine in fixed-timeline mode: transitions stay clean and
  // no adaptive decisions / pressure spam happen under a corridor window
  cur = stepMachine(cur, t, { ...opts, mode: 'fixed' })

  /* re-apply the hold if the machine just landed on the required green */
  if (cur.corr && cur.phase === gG && t < endAt) {
    const holdFrom = cur.corr.holdFrom ?? t
    cur = { ...cur, corr: { ...cur.corr, holdFrom }, phase: gG, until: endAt, flexMin: Infinity }
  }
  return cur
}

/**
 * Advance a controller by wall time. `t` is the sim clock; dt is only used to
 * bound how far the machine can run in one tick (frame hitches clamp it).
 */
export function advanceSigCtl(c: SigCtl, t: number, _dt: number, opts: AdvanceOpts): SigCtl {
  let cur = c

  /* ---- corridor schedule lifecycle ---- */
  if (opts.corr) {
    const prev = cur.corr
    if (prev && prev.group === opts.corr.group) {
      // preserve the hold start across re-plans (same unit / group)
      cur = { ...cur, corr: { ...opts.corr, holdFrom: prev.holdFrom } }
    } else {
      cur = { ...cur, corr: { ...opts.corr } }
    }
  } else if (cur.corr) {
    // schedule ended — safe release through yellow when serving green
    const g = cur.corr.group
    cur =
      cur.phase === greenPhaseOf(g)
        ? { ...cur, corr: null, phase: yellowPhaseOf(g), until: t + YELLOW_S, flexMin: Infinity }
        : { ...cur, corr: null }
  }

  if (cur.corr) return corridorChoreography(cur, t, opts)

  const adaptive = opts.mode === 'adaptive'

  /* ---- adaptive decision while serving a green (min/max enforced) ---- */
  if (adaptive && (cur.phase === 'MG' || cur.phase === 'XG')) {
    const group: AxisGroup = cur.phase === 'MG' ? 'M' : 'X'
    const other = otherOf(group)
    const pCur = boostedPressure(group, opts)
    const pOther = boostedPressure(other, opts)
    const bias = opts.prediction?.[group] ?? 0
    const otherBias = opts.prediction?.[other] ?? 0
    const switching = t >= cur.flexMin && pOther > pCur + PRESSURE_HYSTERESIS
    if (switching) {
      // prediction attribution: would this switch have happened WITHOUT the
      // forecast bias? If not, the prediction caused the proactive change.
      const uCur = unbiasedPressure(group, opts)
      const uOther = unbiasedPressure(other, opts)
      const predictionCaused =
        (bias !== 0 || otherBias !== 0) && !(uOther > uCur + PRESSURE_HYSTERESIS)
      pushDecision({
        t,
        junctionId: opts.junctionId,
        group: other,
        phase: cur.phase,
        pressure: pCur,
        otherPressure: pOther,
        queue: opts.obs?.[other].queue ?? 0,
        approaching: opts.obs?.[other].approaching ?? 0,
        reason:
          opts.emergency === other
            ? `Ambulance approaching on ${other} · priority preempt`
            : predictionCaused
              ? `Switched to ${other}: predicted ${other} demand rising (forecast bias ${otherBias > 0 ? '+' : ''}${otherBias.toFixed(1)})`
              : `Switched to ${other}: pressure ${pOther.toFixed(1)} > ${pCur.toFixed(1)} (hysteresis ${PRESSURE_HYSTERESIS})`,
      })
      if (predictionCaused) {
        pushPredictionEvent({
          t,
          intersectionId: opts.junctionId,
          group: other,
          forecast: otherBias > 0 ? `PREDICTED ${other} DEMAND RISING` : `PREDICTED ${group} DEMAND FALLING`,
          action: 'SIGNAL PRIORITY ADJUSTED',
          detail: `${opts.junctionId} forecast bias ${otherBias > 0 ? '+' : ''}${otherBias.toFixed(1)} moved priority to ${other} within safety limits`,
        })
      }
      cur = { ...cur, until: t } // machine steps to yellow below
    } else if (t >= cur.until) {
      // maximum green served — fairness: yield to the competing group
      pushDecision({
        t,
        junctionId: opts.junctionId,
        group: other,
        phase: cur.phase,
        pressure: pCur,
        otherPressure: pOther,
        queue: opts.obs?.[other].queue ?? 0,
        approaching: opts.obs?.[other].approaching ?? 0,
        reason: `${group} served max ${MAX_GREEN_S}s · yielding to ${other}`,
      })
    } else if (bias !== 0 || otherBias !== 0) {
      // still serving: did the prediction bias keep the current green running
      // when the unbiased pressures would have switched away?
      const uCur = unbiasedPressure(group, opts)
      const uOther = unbiasedPressure(other, opts)
      const biasExtended = t >= cur.flexMin && uOther > uCur + PRESSURE_HYSTERESIS
      if (biasExtended) {
        const extSec = estimatedGreenExtensionSec(bias !== 0 ? bias : otherBias)
        pushPredictionEvent({
          t,
          intersectionId: opts.junctionId,
          group,
          forecast: `PREDICTED DEMAND RISING`,
          action: `GREEN EXTENDED +${extSec}s`,
          detail:
            bias > 0
              ? `${opts.junctionId} forecast raised ${group} priority (+${bias.toFixed(1)}) · current green kept within max ${MAX_GREEN_S}s`
              : `${opts.junctionId} forecast sees ${other} demand falling (${otherBias.toFixed(1)}) · current green kept within max ${MAX_GREEN_S}s`,
        })
      }
    }
  }

  return stepMachine(cur, t, opts)
}

/** the two-group phase machine (bounded run) with mode-aware green entries */
function stepMachine(cur: SigCtl, t: number, opts: AdvanceOpts): SigCtl {
  const adaptive = opts.mode === 'adaptive'
  let guard = 0
  while (cur.until <= t && guard++ < 4) {
    const now = cur.until
    switch (cur.phase) {
      case 'MG': {
        cur = { ...cur, phase: 'MY', until: now + YELLOW_S, flexMin: Infinity }
        break
      }
      case 'MY': {
        if (adaptive) {
          // enter the cross green with a flexible end (min…max green)
          const pM = boostedPressure('M', opts)
          const pX = boostedPressure('X', opts)
          pushDecision({
            t: now,
            junctionId: opts.junctionId,
            group: 'X',
            phase: 'XG',
            pressure: pX,
            otherPressure: pM,
            queue: opts.obs?.X.queue ?? 0,
            approaching: opts.obs?.X.approaching ?? 0,
            reason:
              opts.emergency === 'X'
                ? `Serving CROSS — ambulance priority on ${opts.obs?.X.queue ?? 0} queued`
                : `Serving CROSS: pressure ${pX.toFixed(1)} vs MAIN ${pM.toFixed(1)}`,
          })
          cur = { ...cur, phase: 'XG', until: now + MAX_GREEN_S, flexMin: now + MIN_GREEN_S }
        } else {
          const xGreen = GROUP_BUDGET_S - cur.mGreen
          cur = { ...cur, phase: 'XG', until: now + xGreen, flexMin: Infinity }
        }
        break
      }
      case 'XG': {
        cur = { ...cur, phase: 'XY', until: now + YELLOW_S, flexMin: Infinity }
        break
      }
      case 'XY': {
        if (adaptive) {
          const pM = boostedPressure('M', opts)
          const pX = boostedPressure('X', opts)
          pushDecision({
            t: now,
            junctionId: opts.junctionId,
            group: 'M',
            phase: 'MG',
            pressure: pM,
            otherPressure: pX,
            queue: opts.obs?.M.queue ?? 0,
            approaching: opts.obs?.M.approaching ?? 0,
            reason:
              opts.emergency === 'M'
                ? `Serving MAIN — ambulance priority on ${opts.obs?.M.queue ?? 0} queued`
                : `Serving MAIN: pressure ${pM.toFixed(1)} vs CROSS ${pX.toFixed(1)}`,
          })
          cur = { ...cur, phase: 'MG', until: now + MAX_GREEN_S, mGreen: MIN_GREEN_S, flexMin: now + MIN_GREEN_S }
        } else {
          // fixed schedule: predetermined split, never traffic-responsive
          cur = { ...cur, phase: 'MG', until: now + GREEN_S, mGreen: GREEN_S, flexMin: Infinity }
        }
        break
      }
    }
  }
  return cur
}

/**
 * Effective state of a group at sim time t — phases alone decide (corridor
 * choreography is encoded as phase + until, so nothing special is needed).
 */
export function groupStateOf(c: SigCtl, _t: number, g: AxisGroup): SignalState {
  switch (c.phase) {
    case 'MG':
      return g === 'M' ? 'GREEN' : 'RED'
    case 'MY':
      return g === 'M' ? 'YELLOW' : 'RED'
    case 'XG':
      return g === 'X' ? 'GREEN' : 'RED'
    case 'XY':
      return g === 'X' ? 'YELLOW' : 'RED'
  }
}

/** main-head state (what the rendered signal shows) */
export function mainStateOf(c: SigCtl, t: number): SignalState {
  return groupStateOf(c, t, 'M')
}

/** seconds until `t` reaches the end of the requested group's green, at most */
export function secondsToGreen(c: SigCtl, t: number, g: AxisGroup): number {
  const st = groupStateOf(c, t, g)
  if (st === 'GREEN') return 0
  const remain = Math.max(0, c.until - t)
  if (st === 'YELLOW') return remain
  return remain + YELLOW_S
}
