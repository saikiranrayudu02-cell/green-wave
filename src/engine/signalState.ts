// ---------------------------------------------------------------------------
// GREENWAVE — live signal-state snapshot store (Step 12)
//
// The signal controllers live inside CityMap's render host (one SigCtl per
// displayed signal). This tiny module lets that host publish a cheap per-frame
// snapshot of the REAL controller state (phase, lamps, seconds remaining,
// control mode, corridor hold) so read-only consumers — the Live Traffic
// module — never touch signals.ts or duplicate controller state.
// ---------------------------------------------------------------------------

import type { Phase, SignalState } from './signals'

export interface SignalStateSnapshot {
  junctionId: string
  /** current machine phase (MG / MY / XG / XY) */
  phase: Phase
  /** who is steering this controller right now */
  control: 'FIXED' | 'ADAPTIVE' | 'CORRIDOR'
  /** whole seconds remaining in the current phase (sim clock) */
  remainS: number
  lampM: SignalState
  lampX: SignalState
  /** true while a corridor request is actively holding this junction green */
  corridorHeld: boolean
  corridorGroup: 'M' | 'X' | null
  /** sim clock of this snapshot */
  t: number
}

const store = new Map<string, SignalStateSnapshot>()

/** host publishes the current state of one junction (called per frame) */
export function publishSignalState(s: SignalStateSnapshot): void {
  store.set(s.junctionId, s)
}

/** host clears all published states (reset / controllers re-initialised) */
export function clearSignalStates(): void {
  store.clear()
}

/** deterministic read snapshot (junction-id order), empty when not published */
export function signalStates(): readonly SignalStateSnapshot[] {
  return [...store.values()].sort((a, b) => (a.junctionId < b.junctionId ? -1 : a.junctionId > b.junctionId ? 1 : 0))
}

/** current state of one junction (null when unpublished) */
export function signalStateOf(junctionId: string): SignalStateSnapshot | null {
  return store.get(junctionId) ?? null
}
