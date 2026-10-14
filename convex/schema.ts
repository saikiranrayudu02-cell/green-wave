// ===========================================================================
// GREENWAVE — Convex live operational state (Step 7)
//
// Convex carries ONLY live/shared operational state for the command center:
//   snapshots · active emergencies · active incidents · corridor states
//   signal states · decision events
//
// The high-frequency traffic simulation stays in the browser engine. This
// schema mirrors the aggregated payloads in src/backend/types.ts and is
// org-scoped: every row carries `orgId` and every function enforces org
// isolation server-side (see convex/functions.ts).
//
// This file is NOT part of the Vite bundle / app tsconfig — it compiles
// inside the Convex project (convex/_generated).
// ===========================================================================
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // Registered municipalities — demo-trust validation for the dev tier.
  orgs: defineTable({
    orgId: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index('by_orgId', ['orgId']),

  // Identity → org mapping (production tier). Provisioned via the admin CLI
  // (`npx convex run functions:addOperator ...`) — never writeable by the
  // browser.
  opsMembers: defineTable({
    subject: v.string(), // auth identity subject (e.g. Supabase user UUID)
    orgId: v.string(),
    label: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_subject', ['subject']),

  // Single-document deployment configuration (demo-trust gate). Set once via
  // `npx convex run functions:initDeployment` with the server-side bootstrap
  // key — never from the browser.
  deploymentConfig: defineTable({
    key: v.string(), // 'main'
    demoMode: v.boolean(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // Latest aggregated operational snapshot (newest rows per source window).
  liveSnapshots: defineTable({
    orgId: v.string(),
    sourceId: v.string(),
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
    createdAt: v.number(),
  })
    .index('by_org_source', ['orgId', 'sourceId'])
    .index('by_org_created', ['orgId', 'createdAt']),

  // Live per-intersection signal state (meaningful phase changes only).
  liveSignals: defineTable({
    orgId: v.string(),
    intersectionId: v.string(),
    currentPhase: v.string(),
    mode: v.union(v.literal('FIXED_TIME'), v.literal('GREENWAVE')),
    pressureMain: v.number(),
    pressureCross: v.number(),
    queueMain: v.number(),
    queueCross: v.number(),
    corridorPriority: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_org_intersection', ['orgId', 'intersectionId'])
    .index('by_org_updated', ['orgId', 'updatedAt']),

  // Live active emergency (cleared when the run completes).
  activeEmergencies: defineTable({
    orgId: v.string(),
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
    dispatchT: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_emergency', ['orgId', 'emergencyId'])
    .index('by_org_status', ['orgId', 'status']),

  // Live active incidents (RESOLVED rows linger for subscribers to observe).
  activeIncidents: defineTable({
    orgId: v.string(),
    incidentId: v.string(),
    junctionId: v.string(),
    label: v.string(),
    severity: v.union(
      v.literal('LOW'),
      v.literal('MEDIUM'),
      v.literal('HIGH'),
      v.literal('CRITICAL'),
    ),
    status: v.union(v.literal('ACTIVE'), v.literal('RESOLVED')),
    startedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_status', ['orgId', 'status']),

  // Live corridor coordination state (one row per emergency).
  corridorStates: defineTable({
    orgId: v.string(),
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
    updatedAt: v.number(),
  }).index('by_org_emergency', ['orgId', 'emergencyId']),

  // Append-only live decision events (capped per org; full history lives in
  // Supabase signal_decision_logs).
  decisionEvents: defineTable({
    orgId: v.string(),
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
    createdAt: v.number(),
  })
    .index('by_org_created', ['orgId', 'createdAt'])
    .index('by_org_type', ['orgId', 'decisionType']),
})