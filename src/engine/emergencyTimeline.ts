// ---------------------------------------------------------------------------
// GREENWAVE — bounded emergency-operations timeline (Step 10 Emergencies module)
//
// Records REAL state transitions pushed from the app dispatch/corridor/incident
// handlers (corridor engine junction transitions live in engine/corridor.ts and
// are merged at read time by the UI). Nothing here fabricates timestamps or
// events — every entry is pushed when the corresponding transition happens.
// ---------------------------------------------------------------------------

export type OpsKind = 'dispatch' | 'route' | 'corridor' | 'incident' | 'arrival' | 'coordination' | 'system'

export interface OpsEvent {
  /** simulation clock when the transition occurred (s) */
  t: number
  /** associated signalised junction, when the event is junction-local */
  junctionId: string | null
  kind: OpsKind
  /** short operational action, e.g. 'EMERGENCY DISPATCHED' */
  label: string
}

const CAP = 30
const log: OpsEvent[] = []

export function pushOpsEvent(e: OpsEvent): void {
  log.push(e)
  if (log.length > CAP) log.splice(0, log.length - CAP)
}

export function opsTimeline(): readonly OpsEvent[] {
  return log
}

export function clearOpsTimeline(): void {
  log.length = 0
}
