// ---------------------------------------------------------------------------
// GREENWAVE — Supabase repository
//
// Implements the same OpsRepository contract over PostgreSQL via the anon
// client. Row Level Security keeps every query inside the signed-in user's
// organization. If a remote call fails (migrations not applied yet, network
// drop, RLS denial) the repository degrades to the local demo store and the
// DB status indicator flips to DEGRADED — the command center never stalls.
// ---------------------------------------------------------------------------
import { supabase } from './supabase'
import {
  type OpsRepository,
  LocalRepository,
  localRepository,
  uid,
  setDbHealth,
} from './repo'
import type {
  BenchmarkRecord,
  DecisionRecord,
  EmergencyMetricsRecord,
  EmergencyRecord,
  IncidentRecord,
  OpRole,
  SessionRecord,
} from './types'

const EMERGENCIES = 'emergencies'
const INCIDENTS = 'incidents'
const DECISIONS = 'signal_decision_logs'
const SESSIONS = 'simulation_sessions'
const METRICS = 'emergency_metrics'
const BENCHMARKS = 'simulation_benchmarks'

function nowIso(): string {
  return new Date().toISOString()
}
function msOf(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Date.parse(v) || Date.now()
  return Date.now()
}

export class SupabaseRepository implements OpsRepository {
  kind = 'supabase' as const
  private fallback: LocalRepository = localRepository()
  private remoteOk = false
  /** org id of the signed-in cloud user (RLS scope) — bound after auth */
  private orgId: string | null = null

  bindOrg(orgId: string | null): void {
    this.orgId = orgId
  }

  private ok(): void {
    this.remoteOk = true
    setDbHealth({ kind: 'supabase', state: 'connected', label: 'SUPABASE', since: Date.now() })
  }
  private fail(): void {
    if (!this.remoteOk) return
    this.remoteOk = false
    setDbHealth({ kind: 'supabase', state: 'degraded', label: 'SUPABASE · LOCAL FALLBACK', since: Date.now() })
  }
  private syncingOn(): void {
    setDbHealth({ kind: 'supabase', state: 'syncing', label: 'SUPABASE', since: Date.now() })
  }

  nextEmergencyRef(): string {
    return this.fallback.nextEmergencyRef()
  }

  private emergencyRow(rec: Omit<EmergencyRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>) {
    return {
      org_id: this.orgId ?? undefined, // omitted → RLS/not-null rejects → local fallback
      emergency_ref: rec.emergencyRef,
      unit: rec.unit,
      code: rec.code,
      priority: rec.priority,
      incident: rec.incident,
      origin: rec.origin,
      destination: rec.destination,
      origin_intersection_id: rec.originIntersectionId,
      destination_intersection_id: rec.destinationIntersectionId,
      route_intersection_ids: rec.routeIntersectionIds,
      route_road_ids: rec.routeRoadIds,
      distance_km: rec.distanceKm,
      baseline_sec: rec.baselineSec,
      status: 'EN_ROUTE',
      corridor_active: rec.corridorActive,
      corridor_opened_at: rec.corridorActive ? nowIso() : null,
      dispatched_at: rec.dispatchedAt ? new Date(rec.dispatchedAt).toISOString() : nowIso(),
      signal_wait_sec: rec.signalWaitSec,
      saved_sec: rec.savedSec,
    }
  }

  async createEmergency(
    rec: Omit<EmergencyRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
  ): Promise<string | null> {
    const sb = supabase()
    const localId = uid()
    if (!sb) {
      return this.fallback.createEmergency(rec)
    }
    this.syncingOn()
    const { error } = await sb.from(EMERGENCIES).insert({ id: localId, ...this.emergencyRow(rec) })
    if (error) {
      this.fail()
      return this.fallback.createEmergency(rec)
    }
    this.ok()
    return localId
  }

  async updateEmergency(id: string, patch: Partial<EmergencyRecord>): Promise<void> {
    const sb = supabase()
    const col: Record<string, unknown> = {}
    if (patch.status !== undefined) col.status = patch.status
    if (patch.corridorActive !== undefined) {
      col.corridor_active = patch.corridorActive
      col.corridor_opened_at = patch.corridorActive ? nowIso() : col.corridor_opened_at
    }
    if (patch.arrivedAt !== undefined) col.arrived_at = patch.arrivedAt ? new Date(patch.arrivedAt).toISOString() : null
    if (patch.signalWaitSec !== undefined) col.signal_wait_sec = patch.signalWaitSec
    if (patch.savedSec !== undefined) col.saved_sec = patch.savedSec
    if (patch.distanceKm !== undefined) col.distance_km = patch.distanceKm
    if (patch.baselineSec !== undefined) col.baseline_sec = patch.baselineSec
    if (!sb || Object.keys(col).length === 0) {
      if (sb) this.fail()
      await this.fallback.updateEmergency(id, patch)
      return
    }
    const { error } = await sb.from(EMERGENCIES).update(col).eq('id', id)
    if (error) {
      this.fail()
      await this.fallback.updateEmergency(id, patch)
      return
    }
    this.ok()
  }

  async logIncident(
    rec: Omit<IncidentRecord, 'id' | 'createdAt' | 'status'>,
  ): Promise<string | null> {
    const sb = supabase()
    if (!sb) return this.fallback.logIncident(rec)
    const id = uid()
    this.syncingOn()
    const { error } = await sb
      .from(INCIDENTS)
      .insert({
        id,
        org_id: this.orgId ?? undefined,
        junction_id: rec.junctionId,
        label: rec.label,
        severity: rec.severity,
        status: 'ACTIVE',
        started_at: new Date(rec.startedAt).toISOString(),
      })
    if (error) {
      this.fail()
      return this.fallback.logIncident(rec)
    }
    this.ok()
    return id
  }

  async resolveIncident(id: string): Promise<void> {
    const sb = supabase()
    if (!sb) {
      await this.fallback.resolveIncident(id)
      return
    }
    const { error } = await sb
      .from(INCIDENTS)
      .update({ status: 'RESOLVED', resolved_at: nowIso() })
      .eq('id', id)
    if (error) {
      this.fail()
      await this.fallback.resolveIncident(id)
      return
    }
    this.ok()
  }

  async logDecision(rec: Omit<DecisionRecord, 'id' | 'createdAt'>): Promise<void> {
    const sb = supabase()
    if (!sb) {
      await this.fallback.logDecision(rec)
      return
    }
    const id = uid()
    const { error } = await sb.from(DECISIONS).insert({
      id,
      org_id: this.orgId ?? undefined,
      sim_t: rec.simT,
      junction_id: rec.junctionId,
      mode: rec.mode,
      decision_type: rec.decisionType,
      previous_phase: rec.previousPhase ?? null,
      selected_phase: rec.selectedPhase,
      pressure: rec.pressure,
      other_pressure: rec.otherPressure,
      queue: rec.queue,
      approaching: rec.approaching,
      reason: rec.reason ?? null,
      emergency_id: null,
      created_at: nowIso(),
    })
    if (error) {
      this.fail()
      await this.fallback.logDecision(rec)
      return
    }
    this.ok()
  }

  async startSession(mode: SessionRecord['mode'], operator: string, role: OpRole): Promise<string | null> {
    const sb = supabase()
    if (!sb) return this.fallback.startSession(mode, operator, role)
    const id = uid()
    this.syncingOn()
    const { error } = await sb
      .from(SESSIONS)
      .insert({ id, org_id: this.orgId ?? undefined, mode, status: 'RUNNING', started_at: nowIso(), created_at: nowIso() })
    if (error) {
      this.fail()
      return this.fallback.startSession(mode, operator, role)
    }
    // end any other running sessions for this org
    await sb.from(SESSIONS).update({ status: 'ENDED', ended_at: nowIso() }).neq('id', id).eq('status', 'RUNNING')
    this.ok()
    return id
  }

  async touchSessionMode(id: string, mode: SessionRecord['mode']): Promise<void> {
    const sb = supabase()
    if (!sb) {
      await this.fallback.touchSessionMode(id, mode)
      return
    }
    const { error } = await sb.from(SESSIONS).update({ mode }).eq('id', id)
    if (error) {
      this.fail()
      await this.fallback.touchSessionMode(id, mode)
      return
    }
    this.ok()
  }

  async endSession(id: string): Promise<void> {
    const sb = supabase()
    if (!sb) {
      await this.fallback.endSession(id)
      return
    }
    const { error } = await sb.from(SESSIONS).update({ status: 'ENDED', ended_at: nowIso() }).eq('id', id)
    if (error) {
      this.fail()
      await this.fallback.endSession(id)
      return
    }
    this.ok()
  }

  async recordEmergencyMetrics(rec: Omit<EmergencyMetricsRecord, 'createdAt'>): Promise<void> {
    const sb = supabase()
    if (!sb) {
      await this.fallback.recordEmergencyMetrics(rec)
      return
    }
    const { error } = await sb.from(METRICS).insert({
      org_id: this.orgId ?? undefined,
      emergency_id: rec.emergencyId,
      baseline_eta_sec: rec.baselineEtaSec,
      travel_sec: rec.travelSec,
      signal_wait_sec: rec.signalWaitSec,
      intersections_passed: rec.intersectionsPassed,
      delay_avoided_sec: rec.delayAvoidedSec,
    })
    if (error) {
      this.fail()
      await this.fallback.recordEmergencyMetrics(rec)
      return
    }
    this.ok()
  }

  async recordBenchmark(rec: Omit<BenchmarkRecord, 'createdAt'>): Promise<void> {
    const sb = supabase()
    if (!sb) {
      await this.fallback.recordBenchmark(rec)
      return
    }
    const { error } = await sb.from(BENCHMARKS).insert({
      org_id: this.orgId ?? undefined,
      session_id: rec.sessionId ?? null,
      baseline_wait: rec.baselineWait,
      adaptive_wait: rec.adaptiveWait,
      baseline_speed: rec.baselineSpeed,
      adaptive_speed: rec.adaptiveSpeed,
      baseline_queue: rec.baselineQueue,
      adaptive_queue: rec.adaptiveQueue,
      baseline_throughput: rec.baselineThroughput,
      adaptive_throughput: rec.adaptiveThroughput,
    })
    if (error) {
      this.fail()
      await this.fallback.recordBenchmark(rec)
      return
    }
    this.ok()
  }

  async snapshot(): Promise<{
    emergencies: EmergencyRecord[]
    incidents: IncidentRecord[]
    decisions: DecisionRecord[]
    sessions: SessionRecord[]
  }> {
    const sb = supabase()
    if (!sb) return this.fallback.snapshot()
    if (!this.remoteOk) {
      // remote has been failing — read from the local fallback to stay coherent
      return this.fallback.snapshot()
    }
    try {
      const desc = () => ({ ascending: false as const })
      const [em, inc, dec, ses] = await Promise.all([
        sb.from(EMERGENCIES).select('*').order('created_at', desc()).limit(40),
        sb.from(INCIDENTS).select('*').order('created_at', desc()).limit(40),
        sb.from(DECISIONS).select('*').order('created_at', desc()).limit(120),
        sb.from(SESSIONS).select('*').order('created_at', desc()).limit(24),
      ])
      if (em.error || inc.error || dec.error || ses.error) {
        this.fail()
        return this.fallback.snapshot()
      }
      this.ok()
      return {
        emergencies: (em.data ?? []).map((r) => ({
          id: r.id,
          emergencyRef: r.emergency_ref,
          unit: r.unit ?? '',
          code: r.code,
          priority: r.priority,
          incident: r.incident ?? '',
          origin: r.origin ?? '',
          destination: r.destination ?? '',
          originIntersectionId: r.origin_intersection_id ?? '',
          destinationIntersectionId: r.destination_intersection_id ?? '',
          routeIntersectionIds: r.route_intersection_ids ?? [],
          routeRoadIds: r.route_road_ids ?? [],
          distanceKm: Number(r.distance_km ?? 0),
          baselineSec: r.baseline_sec ?? 0,
          status: r.status,
          corridorActive: r.corridor_active ?? false,
          dispatchedAt: r.dispatched_at ? msOf(r.dispatched_at) : undefined,
          arrivedAt: r.arrived_at ? msOf(r.arrived_at) : undefined,
          signalWaitSec: Number(r.signal_wait_sec ?? 0),
          savedSec: r.saved_sec ?? 0,
          createdAt: msOf(r.created_at),
          updatedAt: msOf(r.updated_at),
        })),
        incidents: (inc.data ?? []).map((r) => ({
          id: r.id,
          junctionId: r.junction_id,
          label: r.label ?? '',
          severity: r.severity,
          status: r.status,
          startedAt: msOf(r.started_at),
          resolvedAt: r.resolved_at ? msOf(r.resolved_at) : undefined,
          createdAt: msOf(r.created_at),
        })),
        decisions: (dec.data ?? []).map((r) => ({
          id: r.id,
          simT: r.sim_t ?? 0,
          junctionId: r.junction_id,
          mode: r.mode,
          decisionType: r.decision_type,
          previousPhase: r.previous_phase ?? undefined,
          selectedPhase: r.selected_phase,
          pressure: Number(r.pressure ?? 0),
          otherPressure: Number(r.other_pressure ?? 0),
          queue: r.queue ?? 0,
          approaching: r.approaching ?? 0,
          reason: r.reason ?? undefined,
          emergencyRef: undefined,
          createdAt: msOf(r.created_at),
        })),
        sessions: (ses.data ?? []).map((r) => ({
          id: r.id,
          mode: r.mode,
          operator: 'ops-console',
          role: 'TRAFFIC_OPERATOR' as OpRole,
          seed: r.seed ?? '',
          status: r.status,
          startedAt: msOf(r.started_at),
          endedAt: r.ended_at ? msOf(r.ended_at) : undefined,
          createdAt: msOf(r.created_at),
        })),
      }
    } catch {
      this.fail()
      return this.fallback.snapshot()
    }
  }

  async ping(): Promise<boolean> {
    const sb = supabase()
    if (!sb) return false
    this.syncingOn()
    const { error } = await sb.from('organizations').select('id').limit(1)
    if (error) {
      this.fail()
      return false
    }
    this.ok()
    return true
  }

  async clearAll(): Promise<void> {
    // deliberate: remote history is never silently erased by a demo reset
    await this.fallback.clearAll()
  }
}

let supabaseRepo: SupabaseRepository | null = null
export function supabaseRepository(): SupabaseRepository {
  if (!supabaseRepo) supabaseRepo = new SupabaseRepository()
  return supabaseRepo
}
