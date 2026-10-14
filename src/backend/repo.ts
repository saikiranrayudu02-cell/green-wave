// ---------------------------------------------------------------------------
// GREENWAVE — operational repository
//
// One interface, two implementations:
//   LocalRepository      — localStorage-backed demo store (offline default)
//   SupabaseRepository   — persistent PostgreSQL system of record (see
//                          supabaseRepo.ts), used when cloud credentials and a
//                          signed-in cloud session are present.
// Both implementations never throw: failures degrade the *status indicator*
// and fall back to the local store so the command center keeps operating.
// ---------------------------------------------------------------------------
import type {
  BenchmarkRecord,
  DecisionRecord,
  DecisionType,
  EmergencyMetricsRecord,
  EmergencyRecord,
  IncidentRecord,
  OpRole,
  SessionRecord,
} from './types'
import { demoMode } from './config'

/* ------------------------------ health hub ------------------------------- */

export type DbHealthKind = 'local' | 'supabase'
export type DbHealth =
  | { kind: 'local'; state: 'ok'; label: string; since: number }
  | { kind: 'supabase'; state: 'connected' | 'syncing' | 'degraded' | 'offline'; label: string; since: number }

let dbHealth: DbHealth = {
  kind: 'local',
  state: 'ok',
  label: demoMode ? 'LOCAL STORE' : 'LOCAL STORE',
  since: Date.now(),
}
const healthSubs = new Set<(h: DbHealth) => void>()

export function setDbHealth(h: DbHealth): void {
  dbHealth = h
  healthSubs.forEach((cb) => cb(h))
}
export function getDbHealth(): DbHealth {
  return dbHealth
}
export function onDbHealth(cb: (h: DbHealth) => void): () => void {
  healthSubs.add(cb)
  return () => {
    healthSubs.delete(cb)
  }
}

/* ------------------------------ helpers ---------------------------------- */

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** classify an engine pressure decision into an auditable decision type */
export function classifyDecision(reason: string | undefined, corridorActive: boolean): DecisionType {
  const r = (reason ?? '').toLowerCase()
  if (corridorActive && /corridor|hold|wave/.test(r)) return 'CORRIDOR_ACTIVE'
  if (/ambulance|emergency|priority/.test(r)) return 'EMERGENCY_PRIORITY'
  if (r.includes('max green') || r.includes('force')) return 'PHASE_CHANGE'
  if (/extend|extension/.test(r)) return 'PHASE_EXTENSION'
  if (/switch|flip|yield|change/.test(r)) return 'PHASE_CHANGE'
  return 'NORMAL_ADAPTIVE'
}

/* --------------------------- repository API ------------------------------ */

export interface OpsRepository {
  kind: 'local' | 'supabase'
  /** demo/counter-based next emergency reference (e.g. EM-1043) */
  nextEmergencyRef(): string
  createEmergency(rec: Omit<EmergencyRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<string | null>
  updateEmergency(id: string, patch: Partial<EmergencyRecord>): Promise<void>
  logIncident(rec: Omit<IncidentRecord, 'id' | 'createdAt' | 'status'>): Promise<string | null>
  resolveIncident(id: string): Promise<void>
  logDecision(rec: Omit<DecisionRecord, 'id' | 'createdAt'>): Promise<void>
  startSession(mode: SessionRecord['mode'], operator: string, role: OpRole): Promise<string | null>
  touchSessionMode(id: string, mode: SessionRecord['mode']): Promise<void>
  endSession(id: string): Promise<void>
  recordEmergencyMetrics(rec: Omit<EmergencyMetricsRecord, 'createdAt'>): Promise<void>
  recordBenchmark(rec: Omit<BenchmarkRecord, 'createdAt'>): Promise<void>
  snapshot(): Promise<{ emergencies: EmergencyRecord[]; incidents: IncidentRecord[]; decisions: DecisionRecord[]; sessions: SessionRecord[] }>
  ping(): Promise<boolean>
  clearAll(): Promise<void>
}

/* --------------------------- local (demo) store -------------------------- */

interface LocalDb {
  emergencies: EmergencyRecord[]
  incidents: IncidentRecord[]
  decisions: DecisionRecord[]
  sessions: SessionRecord[]
  metrics: EmergencyMetricsRecord[]
  benchmarks: BenchmarkRecord[]
  emergencyCounter: number
}

const LS_KEY = 'gw.ops.v1'
const CAP = { emergencies: 40, incidents: 40, decisions: 300, sessions: 24, metrics: 80, benchmarks: 40 }

function loadDb(): LocalDb {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalDb>
      return {
        emergencies: parsed.emergencies ?? [],
        incidents: parsed.incidents ?? [],
        decisions: parsed.decisions ?? [],
        sessions: parsed.sessions ?? [],
        metrics: parsed.metrics ?? [],
        benchmarks: parsed.benchmarks ?? [],
        emergencyCounter: parsed.emergencyCounter ?? 0,
      }
    }
  } catch {
    /* corrupted store — start fresh */
  }
  return {
    emergencies: [],
    incidents: [],
    decisions: [],
    sessions: [],
    metrics: [],
    benchmarks: [],
    emergencyCounter: 0,
  }
}

function saveDb(db: LocalDb): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db))
  } catch {
    /* storage full / unavailable — simulation continues regardless */
  }
}

function pushCap<T>(arr: T[], item: T, cap: number): void {
  arr.unshift(item)
  if (arr.length > cap) arr.length = cap
}

function endedLastRunning(db: LocalDb, id: string): void {
  for (const s of db.sessions) {
    if (s.status === 'RUNNING' && s.id !== id) {
      s.status = 'ENDED'
      s.endedAt = Date.now()
    }
  }
}

export class LocalRepository implements OpsRepository {
  kind = 'local' as const
  private db = loadDb()

  private persist(): void {
    saveDb(this.db)
    setDbHealth({ kind: 'local', state: 'ok', label: 'LOCAL STORE', since: Date.now() })
  }

  nextEmergencyRef(): string {
    this.db.emergencyCounter += 1
    return `EM-${1000 + this.db.emergencyCounter}`
  }

  async createEmergency(
    rec: Omit<EmergencyRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
  ): Promise<string | null> {
    const now = Date.now()
    const full: EmergencyRecord = { ...rec, id: uid(), status: 'EN_ROUTE', createdAt: now, updatedAt: now }
    pushCap(this.db.emergencies, full, CAP.emergencies)
    this.persist()
    return full.id
  }

  async updateEmergency(id: string, patch: Partial<EmergencyRecord>): Promise<void> {
    const e = this.db.emergencies.find((x) => x.id === id)
    if (!e) return
    Object.assign(e, patch, { updatedAt: Date.now() })
    this.persist()
  }

  async logIncident(
    rec: Omit<IncidentRecord, 'id' | 'createdAt' | 'status'>,
  ): Promise<string | null> {
    const now = Date.now()
    const full: IncidentRecord = {
      ...rec,
      id: uid(),
      status: 'ACTIVE',
      createdAt: now,
    }
    pushCap(this.db.incidents, full, CAP.incidents)
    this.persist()
    return full.id
  }

  async resolveIncident(id: string): Promise<void> {
    const i = this.db.incidents.find((x) => x.id === id)
    if (!i) return
    i.status = 'RESOLVED'
    i.resolvedAt = Date.now()
    this.persist()
  }

  async logDecision(rec: Omit<DecisionRecord, 'id' | 'createdAt'>): Promise<void> {
    const full: DecisionRecord = { ...rec, id: uid(), createdAt: Date.now() }
    pushCap(this.db.decisions, full, CAP.decisions)
    this.persist()
  }

  async startSession(mode: SessionRecord['mode'], operator: string, role: OpRole): Promise<string | null> {
    const id = uid()
    const now = Date.now()
    const rec: SessionRecord = { id, mode, operator, role, seed: 'seed-' + Math.floor(now / 1000), status: 'RUNNING', startedAt: now, createdAt: now }
    endedLastRunning(this.db, id)
    pushCap(this.db.sessions, rec, CAP.sessions)
    this.persist()
    return id
  }

  async touchSessionMode(id: string, mode: SessionRecord['mode']): Promise<void> {
    const s = this.db.sessions.find((x) => x.id === id)
    if (!s) return
    s.mode = mode
    this.persist()
  }

  async endSession(id: string): Promise<void> {
    const s = this.db.sessions.find((x) => x.id === id)
    if (!s) return
    s.status = 'ENDED'
    s.endedAt = Date.now()
    this.persist()
  }

  async recordEmergencyMetrics(rec: Omit<EmergencyMetricsRecord, 'createdAt'>): Promise<void> {
    const full: EmergencyMetricsRecord = { ...rec, createdAt: Date.now() }
    pushCap(this.db.metrics, full, CAP.metrics)
    this.persist()
  }

  async recordBenchmark(rec: Omit<BenchmarkRecord, 'createdAt'>): Promise<void> {
    const full: BenchmarkRecord = { ...rec, createdAt: Date.now() }
    pushCap(this.db.benchmarks, full, CAP.benchmarks)
    this.persist()
  }

  async snapshot(): Promise<{
    emergencies: EmergencyRecord[]
    incidents: IncidentRecord[]
    decisions: DecisionRecord[]
    sessions: SessionRecord[]
  }> {
    return {
      emergencies: [...this.db.emergencies],
      incidents: [...this.db.incidents],
      decisions: [...this.db.decisions],
      sessions: [...this.db.sessions],
    }
  }

  async ping(): Promise<boolean> {
    return true
  }

  async clearAll(): Promise<void> {
    this.db = {
      emergencies: [],
      incidents: [],
      decisions: [],
      sessions: [],
      metrics: [],
      benchmarks: [],
      emergencyCounter: 0,
    }
    saveDb(this.db)
  }
}

let localRepo: LocalRepository | null = null
export function localRepository(): LocalRepository {
  if (!localRepo) localRepo = new LocalRepository()
  return localRepo
}

/* active repository (local by default; Supabase when a cloud session is live)
   — App calls setActiveRepository on session changes */
let activeRepo: OpsRepository | null = null
export function setActiveRepository(r: OpsRepository): void {
  activeRepo = r
}
export function repository(): OpsRepository {
  if (!activeRepo) {
    activeRepo = localRepository()
  }
  return activeRepo
}
