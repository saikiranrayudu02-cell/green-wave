// ---------------------------------------------------------------------------
// GREENWAVE — Convex live-state bridge (Step 7)
//
// Convex carries ONLY aggregated live operational state for the command
// center. The high-frequency traffic simulation stays in the browser engine
// (src/engine/*) and is never published here — only meaningful state changes
// and snapshots (~2 s).
//
// Transport strategy:
//   Mutations  → HTTP POST to /api/mutation (always works, no WebSocket needed)
//   Queries    → HTTP POST to /api/query   (for probing)
//   Watch/Subscribe → ConvexClient WebSocket (optional — when blocked, local
//                     bus handles cross-window sync; the CONVEX chip shows
//                     LIVE for HTTP-only, LINKED for WebSocket+HTTP)
//
// This dual-transport design ensures the bridge works even when WebSocket
// connections are blocked (corporate firewalls, preview panes, file://).
//
// Organization isolation:
//   Every record is org-scoped (`orgId`). The deployment this build targets
//   is configured in demo-trust mode (bootstrap-keyed, server-side) with the
//   demo municipality the ONLY registered org — arbitrary org ids are
//   rejected by convex/functions.ts orgFor(). When a Supabase operator
//   session exists, its JWT is attached via client.setAuth so an
//   identity-verified tier (custom JWT provider + opsMembers) can be enabled
//   without any client change; the UI labels CONVEX · DEMO until then.
// ---------------------------------------------------------------------------
import { ENV } from './config'
import { supabase } from './supabase'
import type {
  DecisionRecord,
  EmergencyRecord,
  IncidentRecord,
  OpsSnapshot,
} from './types'

/** registered demo municipality on the deployed Convex project */
export const CONVEX_DEMO_ORG = 'org-demo-boston'

export type ConvexHealth =
  | { state: 'off'; label: string; since: number }
  | { state: 'connecting'; label: string; since: number }
  | { state: 'online'; label: string; since: number; demoMode: boolean; lastTx: number; lastRx: number }
  | { state: 'degraded'; label: string; since: number }

const subs = new Set<(h: ConvexHealth) => void>()

let health: ConvexHealth = { state: 'off', label: 'CONVEX OFF', since: Date.now() }

function setHealth(patch: Partial<ConvexHealth>): void {
  health = { ...health, ...patch, since: Date.now() } as ConvexHealth
  subs.forEach((cb) => {
    try {
      cb(health)
    } catch {
      /* subscriber error must never break the bridge */
    }
  })
}

export function onConvexHealth(cb: (h: ConvexHealth) => void): () => void {
  subs.add(cb)
  cb(health)
  return () => {
    subs.delete(cb)
  }
}
export function getConvexHealth(): ConvexHealth {
  return health
}
export function convexConfigured(): boolean {
  return Boolean(ENV.convexUrl)
}

// ---------------------------------------------------------------------------
// HTTP transport (primary — always works)
// ---------------------------------------------------------------------------

function httpUrl(path: 'query' | 'mutation'): string | null {
  return ENV.convexUrl ? `${ENV.convexUrl}/api/${path}` : null
}

/** fire-and-forget HTTP mutation — never blocks the simulation */
function httpMutate(path: string, args: unknown): void {
  const url = httpUrl('mutation')
  if (!url) return
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const h = getConvexHealth()
      if (h.state === 'degraded' || h.state === 'off' || h.state === 'connecting') {
        setHealth({ state: 'online', label: 'CONVEX · LIVE', lastTx: Date.now() })
      }
    })
    .catch(() => {
      const h = getConvexHealth()
      if (h.state !== 'off') {
        setHealth({ state: 'degraded', label: 'CONVEX · OFFLINE' })
      }
    })
}

/** one-shot HTTP query — used for boot probing */
async function httpQuery(path: string, args: unknown): Promise<unknown> {
  const url = httpUrl('query')
  if (!url) return null
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const json = (await res.json()) as { status: string; value?: unknown; errorMessage?: string }
  return json.status === 'success' ? json.value : null
}

// ---------------------------------------------------------------------------
// WebSocket transport (optional — for realtime subscriptions)
// ---------------------------------------------------------------------------

let wsClient: {
  close: () => Promise<void>
  setAuth: (f: () => Promise<string>) => void
  subscribeToConnectionState: (cb: (cs: { isWebSocketConnected: boolean; hasEverConnected: boolean }) => void) => () => void
  onUpdate: (query: string, args: Record<string, unknown>, cb: (v: unknown) => void, errCb: () => void) => () => void
} | null = null

/** attempt WebSocket connection — optional, failures are non-blocking */
function initWebSocket(): void {
  if (!ENV.convexUrl || wsClient) return
  import('convex/browser')
    .then(({ ConvexClient }) => {
      try {
        const cx = new ConvexClient(ENV.convexUrl!)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wsClient = cx as any
        cx.subscribeToConnectionState((cs: { isWebSocketConnected: boolean; hasEverConnected: boolean }) => {
          if (cs.isWebSocketConnected) {
            setHealth({ state: 'online', label: 'CONVEX · LIVE', lastRx: Date.now() })
          } else if (cs.hasEverConnected) {
            setHealth({ state: 'degraded', label: 'CONVEX · RECONNECTING' })
          }
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(cx as any).onUpdate(
          'functions:deploymentStatus',
          {},
          (status: { demoMode?: boolean } | null) => {
            setHealth({
              state: 'online',
              label: 'CONVEX · LIVE',
              demoMode: Boolean(status?.demoMode),
              lastRx: Date.now(),
            })
          },
          () => {
            /* subscription error — HTTP still works, not critical */
          },
        )
      } catch {
        /* WebSocket unavailable — HTTP mutations still work */
      }
    })
    .catch(() => {
      /* dynamic import failed — HTTP still works */
    })
}

/**
 * Attach the Supabase JWT to the Convex channel. Safe when the deployment
 * has no auth provider configured — Convex simply treats the caller as
 * unauthenticated and the demo-trust org gate applies.
 */
export function attachSupabaseIdentity(): void {
  if (!wsClient) return
  const sb = supabase()
  if (!sb) return
  try {
    void sb.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token ?? null
      if (token) wsClient!.setAuth(async () => token)
    })
  } catch {
    /* identity attach is best-effort; demo gate still applies */
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initConvex(): void {
  if (!ENV.convexUrl) return
  // probe the deployment via HTTP to confirm connectivity
  setHealth({ state: 'connecting', label: 'CONVEX · CONNECTING' })
  httpQuery('functions:deploymentStatus', {})
    .then((res) => {
      const status = res as { demoMode?: boolean; configured?: boolean } | null
      setHealth({
        state: 'online',
        label: 'CONVEX · LIVE',
        demoMode: Boolean(status?.demoMode),
        lastTx: Date.now(),
        lastRx: Date.now(),
      })
      // also try WebSocket for realtime subscriptions (optional)
      initWebSocket()
    })
    .catch(() => {
      setHealth({ state: 'degraded', label: 'CONVEX · OFFLINE' })
    })
}

// ---------------------------------------------------------------------------
// Publishing functions — fire-and-forget via HTTP
// ---------------------------------------------------------------------------

export function publishSnapshot(
  orgId: string,
  snap: Omit<OpsSnapshot, 'seq' | 'source' | 'ts'>,
): void {
  httpMutate('functions:publishSnapshot', { orgId, sourceId: 'gw-demo-1', snapshot: snap })
}

export function publishEmergency(orgId: string, em: EmergencyRecord): void {
  httpMutate('functions:publishEmergency', {
    orgId,
    emergency: {
      emergencyId: em.id,
      ref: em.emergencyRef,
      unit: em.unit,
      code: em.code,
      priority: em.priority,
      status: em.status,
      origin: em.origin,
      destination: em.destination,
      routeIntersectionIds: em.routeIntersectionIds,
      routeRoadIds: em.routeRoadIds,
      distanceKm: em.distanceKm,
      baselineSec: em.baselineSec,
      etaSec: em.baselineSec,
      savedSec: em.savedSec,
      signalWaitSec: em.signalWaitSec,
      corridorOpen: em.corridorActive,
    },
  })
}

export function clearEmergency(orgId: string, emergencyId: string): void {
  httpMutate('functions:clearEmergency', { orgId, emergencyId })
}

export function publishIncident(orgId: string, inc: IncidentRecord): void {
  httpMutate('functions:publishIncident', {
    orgId,
    incident: {
      incidentId: inc.id,
      junctionId: inc.junctionId,
      label: inc.label,
      severity: (inc.severity ?? 'HIGH') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    },
  })
}

export function resolveIncident(orgId: string, incidentId: string): void {
  httpMutate('functions:resolveIncident', { orgId, incidentId })
}

export function publishCorridor(
  orgId: string,
  corridor: {
    emergencyId: string
    status: 'INACTIVE' | 'PREPARING' | 'ACTIVE' | 'RELEASED'
    ambulanceEta: number
    activeIntersectionId?: string
    intersections: { intersectionId: string; status: string; eta: number; requiredPhase: string }[]
  },
): void {
  httpMutate('functions:publishCorridor', { orgId, corridor })
}

export function clearCorridor(orgId: string, emergencyId: string): void {
  httpMutate('functions:clearCorridor', { orgId, emergencyId })
}

export function publishDecision(orgId: string, d: Omit<DecisionRecord, 'id' | 'createdAt'>): void {
  httpMutate('functions:publishDecision', {
    orgId,
    decision: {
      simT: d.simT,
      junctionId: d.junctionId,
      decisionType: d.decisionType,
      selectedPhase: d.selectedPhase,
      pressure: d.pressure,
      otherPressure: d.otherPressure,
      queue: d.queue,
      approaching: d.approaching,
      reason: d.reason,
      emergencyRef: d.emergencyRef,
    },
  })
}

/** demo RESET — clear this org's live operational state (history persists) */
export function clearLiveState(orgId: string): void {
  httpMutate('functions:clearOrgLiveState', { orgId })
}
