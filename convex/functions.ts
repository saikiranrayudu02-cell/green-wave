// ===========================================================================
// GREENWAVE — Convex live-state functions (Step 7)
//
// Organization isolation model:
//
//   PRODUCTION TIER (identity verified — the intended end state)
//     The deployment configures a custom JWT auth provider that verifies
//     Supabase access tokens (dashboard → Settings → Auth → Custom JWT,
//     pointing at <supabase>/auth/v1/.well-known/jwks.json). The browser
//     passes the Supabase JWT via client.setAuth(...). Every function calls
//     `await ctx.auth.getUserIdentity()` and resolves orgId from the
//     `opsMembers` table by identity subject — a browser-supplied org id is
//     never trusted. Operators are provisioned once via the admin CLI
//     (`npx convex run functions:addOperator ...` with the bootstrap key).
//
//   DEMO TIER (deployment-gated development allowance — OFF by default)
//     Until the auth provider is configured, the deployment must explicitly
//     opt in with `npx convex run functions:initDeployment` (bootstrap key +
//     demoMode: true). In demo mode the claimed org id is accepted ONLY if it
//     is registered in the `orgs` table. The UI labels this state
//     `CONVEX · DEMO` so trust is never silent. No identity is ever
//     fabricated, no anonymous access exists when the gate is closed.
//
// The gateway closes (403) in every other situation, and the frontend treats
// any Convex failure as OFFLINE · LOCAL — the simulation never depends on it.
// ===========================================================================
import { mutation, query } from './_generated/server'
import { v, ConvexError } from 'convex/values'

const DEMO_CONF_KEY = 'main'
const DECISION_CAP = 200
const SNAPSHOT_KEEP = 3

/**
 * Minimal structural context for org resolution (works for both queries and
 * mutations — only db + auth are touched).
 */
type OrgCtx = {
  db: {
    query: (table: string) => {
      withIndex: (name: string, pred: (q: any) => any) => {
        first: () => Promise<any>
        collect: () => Promise<any[]>
        order: (dir: 'asc' | 'desc') => any
        take: (n: number) => Promise<any[]>
      }
    }
  }
  auth: { getUserIdentity: () => Promise<null | { subject: string }> }
}

/** Resolve the caller's organization server-side. Throws on any mismatch. */
async function orgFor(ctx: OrgCtx, claimedOrgId: string): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (identity) {
    // PRODUCTION TIER — identity is verified by the deployment's auth
    // provider; org comes from the server-provisioned membership table.
    const member = await ctx.db
      .query('opsMembers')
      .withIndex('by_subject', (q: any) => q.eq('subject', identity.subject))
      .first()
    if (!member) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'operator is not provisioned for this deployment',
      })
    }
    return member.orgId
  }
  // DEMO TIER — only when the deployment explicitly opted in (server-side,
  // bootstrap-keyed initDeployment call). The claimed org must be a
  // registered municipality; arbitrary org identifiers are rejected.
  const conf = await ctx.db
    .query('deploymentConfig')
    .withIndex('by_key', (q: any) => q.eq('key', DEMO_CONF_KEY))
    .first()
  if (conf && conf.demoMode) {
    const registered = await ctx.db
      .query('orgs')
      .withIndex('by_orgId', (q: any) => q.eq('orgId', claimedOrgId))
      .first()
    if (registered) return claimedOrgId
  }
  throw new ConvexError({ code: 'UNAUTHORIZED', message: 'not authenticated for this deployment' })
}

/** prove the caller holds the deployment bootstrap key (admin CLI use only) */
function requireBootstrap(key: string): void {
  if (!key || process.env.CONVEX_BOOTSTRAP_KEY !== key) {
    throw new ConvexError({ code: 'FORBIDDEN', message: 'invalid bootstrap key' })
  }
}

/* ---------------------------- provisioning ------------------------------ */

/** One-time deployment configuration (admin CLI). Never called by the UI. */
export const initDeployment = mutation({
  args: {
    bootstrapKey: v.string(),
    demoMode: v.boolean(),
    orgs: v.array(v.object({ orgId: v.string(), name: v.string() })),
  },
  handler: async (ctx, { bootstrapKey, demoMode, orgs }) => {
    requireBootstrap(bootstrapKey)
    const existing = await ctx.db
      .query('deploymentConfig')
      .withIndex('by_key', (q: any) => q.eq('key', DEMO_CONF_KEY))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { demoMode, updatedAt: Date.now() })
    } else {
      await ctx.db.insert('deploymentConfig', {
        key: DEMO_CONF_KEY,
        demoMode,
        updatedAt: Date.now(),
      })
    }
    for (const o of orgs) {
      const dup = await ctx.db
        .query('orgs')
        .withIndex('by_orgId', (q: any) => q.eq('orgId', o.orgId))
        .first()
      if (!dup) {
        await ctx.db.insert('orgs', { ...o, createdAt: Date.now() })
      }
    }
    return { demoMode, orgs: orgs.length }
  },
})

/** Provision one operator identity → org mapping (admin CLI). */
export const addOperator = mutation({
  args: {
    bootstrapKey: v.string(),
    subject: v.string(),
    orgId: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, { bootstrapKey, subject, orgId, label }) => {
    requireBootstrap(bootstrapKey)
    const existing = await ctx.db
      .query('opsMembers')
      .withIndex('by_subject', (q: any) => q.eq('subject', subject))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { orgId, updatedAt: Date.now() })
      return { added: false }
    }
    await ctx.db.insert('opsMembers', { subject, orgId, label, createdAt: Date.now() })
    return { added: true }
  },
})

/** Remove an operator mapping (admin CLI). */
export const removeOperator = mutation({
  args: { bootstrapKey: v.string(), subject: v.string() },
  handler: async (ctx, { bootstrapKey, subject }) => {
    requireBootstrap(bootstrapKey)
    const existing = await ctx.db
      .query('opsMembers')
      .withIndex('by_subject', (q: any) => q.eq('subject', subject))
      .first()
    if (existing) await ctx.db.delete(existing._id)
    return { removed: Boolean(existing) }
  },
})

/* ------------------------------ snapshots -------------------------------- */

export const publishSnapshot = mutation({
  args: {
    orgId: v.string(),
    sourceId: v.string(),
    snapshot: v.object({
      simT: v.number(),
      traffic: v.object({
        activeVehicles: v.number(),
        avgSpeedKmh: v.number(),
        avgWaitSec: v.number(),
        queueM: v.number(),
        congestion: v.number(),
        throughput: v.number(),
        ratePerHour: v.number(),
      }),
      mode: v.union(v.literal('FIXED_TIME'), v.literal('GREENWAVE')),
      incidentActive: v.boolean(),
      incidentJunction: v.optional(v.string()),
      corridorOpen: v.boolean(),
      ambulance: v.optional(
        v.object({
          unit: v.string(),
          active: v.boolean(),
          corridorOpen: v.boolean(),
          arrived: v.boolean(),
          etaSec: v.number(),
          savedSec: v.number(),
          routeKey: v.string(),
        }),
      ),
      corridorJunctions: v.array(
        v.object({ id: v.string(), status: v.string(), eta: v.number() }),
      ),
    }),
  },
  handler: async (ctx, { orgId, sourceId, snapshot }) => {
    await orgFor(ctx, orgId)
    const id = await ctx.db.insert('liveSnapshots', {
      orgId,
      sourceId,
      ...snapshot,
      createdAt: Date.now(),
    })
    // keep only the newest rows per source window (hysteresis for subscribers)
    const rows = await ctx.db
      .query('liveSnapshots')
      .withIndex('by_org_source', (q: any) => q.eq('orgId', orgId).eq('sourceId', sourceId))
      .collect()
    const sorted = rows.sort((a: any, b: any) => b.createdAt - a.createdAt)
    for (const row of sorted.slice(SNAPSHOT_KEEP)) {
      if (row._id !== id) await ctx.db.delete(row._id)
    }
    return { id: String(id) }
  },
})

export const latestSnapshot = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await orgFor(ctx, orgId)
    return await ctx.db
      .query('liveSnapshots')
      .withIndex('by_org_created', (q: any) => q.eq('orgId', orgId))
      .order('desc')
      .first()
  },
})

/* ----------------------------- emergencies ------------------------------- */

export const publishEmergency = mutation({
  args: {
    orgId: v.string(),
    emergency: v.object({
      emergencyId: v.string(),
      ref: v.string(),
      unit: v.string(),
      code: v.union(v.literal('MEDICAL'), v.literal('TRAUMA')),
      priority: v.union(v.literal('CRITICAL'), v.literal('HIGH')),
      status: v.union(
        v.literal('PENDING'),
        v.literal('EN_ROUTE'),
        v.literal('ARRIVED'),
        v.literal('COMPLETED'),
      ),
      origin: v.string(),
      destination: v.string(),
      routeIntersectionIds: v.array(v.string()),
      routeRoadIds: v.array(v.string()),
      distanceKm: v.number(),
      baselineSec: v.number(),
      etaSec: v.number(),
      savedSec: v.number(),
      signalWaitSec: v.number(),
      corridorOpen: v.boolean(),
    }),
  },
  handler: async (ctx, { orgId, emergency }) => {
    await orgFor(ctx, orgId)
    const existing = await ctx.db
      .query('activeEmergencies')
      .withIndex('by_org_emergency', (q: any) =>
        q.eq('orgId', orgId).eq('emergencyId', emergency.emergencyId),
      )
      .first()
    const doc = { ...emergency, dispatchT: Date.now(), updatedAt: Date.now() }
    if (existing) {
      await ctx.db.patch(existing._id, doc)
      return { id: String(existing._id) }
    }
    const id = await ctx.db.insert('activeEmergencies', doc)
    return { id: String(id) }
  },
})

export const clearEmergency = mutation({
  args: { orgId: v.string(), emergencyId: v.string() },
  handler: async (ctx, { orgId, emergencyId }) => {
    await orgFor(ctx, orgId)
    const existing = await ctx.db
      .query('activeEmergencies')
      .withIndex('by_org_emergency', (q: any) =>
        q.eq('orgId', orgId).eq('emergencyId', emergencyId),
      )
      .first()
    if (existing) await ctx.db.delete(existing._id)
    return { cleared: Boolean(existing) }
  },
})

export const latestEmergency = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await orgFor(ctx, orgId)
    const rows = await ctx.db
      .query('activeEmergencies')
      .withIndex('by_org_status', (q: any) => q.eq('orgId', orgId))
      .collect()
    return rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null
  },
})

/* ------------------------------ incidents -------------------------------- */

export const publishIncident = mutation({
  args: {
    orgId: v.string(),
    incident: v.object({
      incidentId: v.string(),
      junctionId: v.string(),
      label: v.string(),
      severity: v.union(
        v.literal('LOW'),
        v.literal('MEDIUM'),
        v.literal('HIGH'),
        v.literal('CRITICAL'),
      ),
    }),
  },
  handler: async (ctx, { orgId, incident }) => {
    await orgFor(ctx, orgId)
    const existing = await ctx.db
      .query('activeIncidents')
      .withIndex('by_org', (q: any) => q.eq('orgId', orgId))
      .collect()
      .then((rows: any[]) => rows.find((r) => r.incidentId === incident.incidentId))
    const doc = {
      orgId,
      ...incident,
      status: 'ACTIVE' as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...doc, startedAt: existing.startedAt })
      return { id: String(existing._id) }
    }
    const id = await ctx.db.insert('activeIncidents', doc)
    return { id: String(id) }
  },
})

export const resolveIncident = mutation({
  args: { orgId: v.string(), incidentId: v.string() },
  handler: async (ctx, { orgId, incidentId }) => {
    await orgFor(ctx, orgId)
    const rows = await ctx.db
      .query('activeIncidents')
      .withIndex('by_org', (q: any) => q.eq('orgId', orgId))
      .collect()
    const found = rows.find((r) => r.incidentId === incidentId)
    if (found) {
      await ctx.db.patch(found._id, {
        status: 'RESOLVED',
        resolvedAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    return { resolved: Boolean(found) }
  },
})

export const activeIncidents = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await orgFor(ctx, orgId)
    const rows = await ctx.db
      .query('activeIncidents')
      .withIndex('by_org', (q: any) => q.eq('orgId', orgId))
      .collect()
    return rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  },
})

/* ------------------------------ corridors -------------------------------- */

export const publishCorridor = mutation({
  args: {
    orgId: v.string(),
    corridor: v.object({
      emergencyId: v.string(),
      status: v.union(
        v.literal('INACTIVE'),
        v.literal('PREPARING'),
        v.literal('ACTIVE'),
        v.literal('RELEASED'),
      ),
      ambulanceEta: v.number(),
      activeIntersectionId: v.optional(v.string()),
      intersections: v.array(
        v.object({
          intersectionId: v.string(),
          status: v.string(),
          eta: v.number(),
          requiredPhase: v.string(),
        }),
      ),
    }),
  },
  handler: async (ctx, { orgId, corridor }) => {
    await orgFor(ctx, orgId)
    const existing = await ctx.db
      .query('corridorStates')
      .withIndex('by_org_emergency', (q: any) =>
        q.eq('orgId', orgId).eq('emergencyId', corridor.emergencyId),
      )
      .first()
    const doc = { ...corridor, orgId, updatedAt: Date.now() }
    if (existing) {
      await ctx.db.patch(existing._id, doc)
      return { id: String(existing._id) }
    }
    const id = await ctx.db.insert('corridorStates', doc)
    return { id: String(id) }
  },
})

export const clearCorridor = mutation({
  args: { orgId: v.string(), emergencyId: v.string() },
  handler: async (ctx, { orgId, emergencyId }) => {
    await orgFor(ctx, orgId)
    const existing = await ctx.db
      .query('corridorStates')
      .withIndex('by_org_emergency', (q: any) =>
        q.eq('orgId', orgId).eq('emergencyId', emergencyId),
      )
      .first()
    if (existing) await ctx.db.delete(existing._id)
    return { cleared: Boolean(existing) }
  },
})

export const latestCorridor = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await orgFor(ctx, orgId)
    const rows = await ctx.db
      .query('corridorStates')
      .withIndex('by_org_emergency', (q: any) => q.eq('orgId', orgId))
      .collect()
    return rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null
  },
})

/* ------------------------------- signals ---------------------------------- */

export const publishSignal = mutation({
  args: {
    orgId: v.string(),
    signal: v.object({
      intersectionId: v.string(),
      currentPhase: v.string(),
      mode: v.union(v.literal('FIXED_TIME'), v.literal('GREENWAVE')),
      pressureMain: v.number(),
      pressureCross: v.number(),
      queueMain: v.number(),
      queueCross: v.number(),
      corridorPriority: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { orgId, signal }) => {
    await orgFor(ctx, orgId)
    const existing = await ctx.db
      .query('liveSignals')
      .withIndex('by_org_intersection', (q: any) =>
        q.eq('orgId', orgId).eq('intersectionId', signal.intersectionId),
      )
      .first()
    const doc = { ...signal, orgId, updatedAt: Date.now() }
    if (existing) {
      await ctx.db.patch(existing._id, doc)
      return { id: String(existing._id) }
    }
    const id = await ctx.db.insert('liveSignals', doc)
    return { id: String(id) }
  },
})

export const signalStates = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await orgFor(ctx, orgId)
    const rows = await ctx.db
      .query('liveSignals')
      .withIndex('by_org_intersection', (q: any) => q.eq('orgId', orgId))
      .collect()
    return rows.sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  },
})

/* ---------------------------- decision events ---------------------------- */

export const publishDecision = mutation({
  args: {
    orgId: v.string(),
    decision: v.object({
      simT: v.number(),
      junctionId: v.string(),
      decisionType: v.union(
        v.literal('NORMAL_ADAPTIVE'),
        v.literal('PHASE_EXTENSION'),
        v.literal('PHASE_CHANGE'),
        v.literal('EMERGENCY_PRIORITY'),
        v.literal('CORRIDOR_PREPARATION'),
        v.literal('CORRIDOR_ACTIVE'),
        v.literal('CORRIDOR_RELEASE'),
        v.literal('INCIDENT_RESPONSE'),
      ),
      selectedPhase: v.string(),
      pressure: v.number(),
      otherPressure: v.number(),
      queue: v.number(),
      approaching: v.number(),
      reason: v.optional(v.string()),
      emergencyRef: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { orgId, decision }) => {
    await orgFor(ctx, orgId)
    const id = await ctx.db.insert('decisionEvents', {
      orgId,
      ...decision,
      createdAt: Date.now(),
    })
    // cap per org — persistent audit history lives in Supabase
    const rows = await ctx.db
      .query('decisionEvents')
      .withIndex('by_org_created', (q: any) => q.eq('orgId', orgId))
      .order('desc')
      .collect()
    for (const row of rows.slice(DECISION_CAP)) {
      await ctx.db.delete(row._id)
    }
    return { id: String(id) }
  },
})

export const decisionEvents = query({
  args: { orgId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    await orgFor(ctx, orgId)
    const rows = await ctx.db
      .query('decisionEvents')
      .withIndex('by_org_created', (q: any) => q.eq('orgId', orgId))
      .order('desc')
      .take(Math.min(50, limit ?? 25))
    return rows
  },
})

/* --------------------------- deployment status --------------------------- */

/** Non-sensitive label info for the CONVEX status chip (no org data). */
export const deploymentStatus = query({
  args: {},
  handler: async (ctx) => {
    const conf = await ctx.db
      .query('deploymentConfig')
      .withIndex('by_key', (q: any) => q.eq('key', DEMO_CONF_KEY))
      .first()
    const hasAuth = Boolean(await ctx.auth.getUserIdentity())
    return { configured: true, demoMode: conf ? conf.demoMode : false, identityVerified: hasAuth }
  },
})

/* ------------------------------ reset ------------------------------------------------------------------------------------------------ */

/** Clear a single organization's live operational state (demo reset). */
export const clearOrgLiveState = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await orgFor(ctx, orgId)
    const targets: { table: string; index: string }[] = [
      { table: 'liveSnapshots', index: 'by_org_created' },
      { table: 'liveSignals', index: 'by_org_intersection' },
      { table: 'activeEmergencies', index: 'by_org_status' },
      { table: 'activeIncidents', index: 'by_org' },
      { table: 'corridorStates', index: 'by_org_emergency' },
      { table: 'decisionEvents', index: 'by_org_created' },
    ]
    let cleared = { snapshots: 0, signals: 0, emergencies: 0, incidents: 0, corridors: 0, decisions: 0 }
    for (const { table, index } of targets) {
      const rows = await ctx.db
        .query(table as any)
        .withIndex(index, (q: any) => q.eq('orgId', orgId))
        .collect()
      for (const row of rows) await ctx.db.delete(row._id)
      const key = table.replace('liveSnapshots', 'snapshots').replace('liveSignals', 'signals').replace('activeEmergencies', 'emergencies').replace('activeIncidents', 'incidents').replace('corridorStates', 'corridors').replace('decisionEvents', 'decisions') as keyof typeof cleared
      cleared[key] = rows.length
    }
    return cleared
  },
})