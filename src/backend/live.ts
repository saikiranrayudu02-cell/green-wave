// ---------------------------------------------------------------------------
// GREENWAVE — live operational sync bus (Step 6)
//
// The high-frequency vehicle animation stays entirely local. This module
// publishes *aggregated operational snapshots* (every ~2 s) so multiple
// command-center windows converge on the same shared state.
//
// Transport, in priority order:
//   1. Supabase Realtime broadcast  — when cloud is configured + signed in
//   2. BroadcastChannel             — cross-window, same-browser, always on
//
// The bus never throws and never blocks the simulation: failures surface as a
// DEGRADED state on the LIVE SYNC indicator while the local bus keeps going.
// ---------------------------------------------------------------------------
import { supabase } from './supabase'
import type { OpsSnapshot } from './types'

export type BusState = 'off' | 'local' | 'realtime' | 'degraded'

export interface BusHealth {
  state: BusState
  label: string
  lastTx: number
  peers: number
  sourceId: string
}

const busSubs = new Set<(h: BusHealth) => void>()

let busHealth: BusHealth = {
  state: 'off',
  label: 'LOCAL BUS',
  lastTx: 0,
  peers: 0,
  sourceId: '',
}

function setBusHealth(patch: Partial<BusHealth>): void {
  busHealth = { ...busHealth, ...patch }
  busSubs.forEach((cb) => cb(busHealth))
}

export function onBusHealth(cb: (h: BusHealth) => void): () => void {
  busSubs.add(cb)
  cb(busHealth)
  return () => {
    busSubs.delete(cb)
  }
}
export function getBusHealth(): BusHealth {
  return busHealth
}

/** last snapshot received from *any* source (including remote windows) */
let lastRemoteTs = 0
let peers = new Map<string, number>()

class LiveSyncBus {
  private channel: BroadcastChannel | null = null
  private seq = 0
  private realtime: ReturnType<typeof supabase> = null
  private realtimeOk = false
  private realtimeCh: { send: (msg: Record<string, unknown>) => void } | null = null
  private realtimeChObj: { unsubscribe: () => void } | null = null
  readonly sourceId: string

  constructor() {
    this.sourceId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)
    setBusHealth({ sourceId: this.sourceId, lastTx: Date.now() })
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('gw.ops.live.v1')
        this.channel.onmessage = (ev: MessageEvent) => this.receive(ev.data)
        setBusHealth({ state: 'local', label: 'LIVE SYNC · LOCAL BUS', peers: 0 })
      }
    } catch {
      this.channel = null
    }
    // Clean up stale peer heartbeats periodically.
    window.setInterval(() => {
      const now = Date.now()
      let removed = false
      for (const [k, v] of peers) {
        if (now - v > 12000) {
          peers.delete(k)
          removed = true
        }
      }
      if (removed) setBusHealth({ peers: peers.size })
    }, 5000)
  }

  /** attach Supabase Realtime broadcast when cloud auth is active */
  attachRealtime(): void {
    const sb = supabase()
    if (!sb || this.realtime) return
    this.realtime = sb
    const ch = sb.channel('gw-ops-live')
    void ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.realtimeOk = true
        setBusHealth({ state: 'realtime', label: 'LIVE SYNC · REALTIME' })
      } else {
        this.realtimeOk = false
        setBusHealth({ state: 'degraded', label: 'LIVE SYNC · LOCAL BUS' })
      }
    })
    this.realtimeChObj = { unsubscribe: () => void sb.removeChannel(ch) }
    this.realtimeCh = {
      send: (msg: Record<string, unknown>) => {
        try {
          void ch.send({ type: 'broadcast', event: 'snapshot', payload: msg })
        } catch {
          /* keep the local bus alive */
        }
      },
    }
  }

  detachRealtime(): void {
    this.realtimeChObj?.unsubscribe()
    this.realtime = null
    this.realtimeCh = null
    this.realtimeChObj = null
    this.realtimeOk = false
    setBusHealth({ state: 'local', label: 'LIVE SYNC · LOCAL BUS' })
  }

  /** send an aggregated operational snapshot (called ~every 2 s by the app) */
  publish(snap: Omit<OpsSnapshot, 'seq' | 'source' | 'ts'>): void {
    this.seq += 1
    const full: OpsSnapshot = {
      ...snap,
      seq: this.seq,
      source: this.sourceId,
      ts: Date.now(),
    }
    if (this.channel) {
      try {
        this.channel.postMessage(full)
      } catch {
        /* ignore */
      }
    }
    if (this.realtimeOk && this.realtimeCh) {
      this.realtimeCh.send({ ...full })
    }
    setBusHealth({ lastTx: full.ts, state: this.realtimeOk ? 'realtime' : 'local' })
  }

  private receive(msg: OpsSnapshot | null): void {
    if (!msg || typeof msg !== 'object' || !msg.source) return
    if (msg.source === this.sourceId) return // BroadcastChannel does not echo, but stay safe
    lastRemoteTs = Date.now()
    peers.set(msg.source, lastRemoteTs)
    setBusHealth({ peers: peers.size, state: this.realtimeOk ? 'realtime' : 'local' })
  }
}

let instance: LiveSyncBus | null = null
export function liveBus(): LiveSyncBus {
  if (!instance) instance = new LiveSyncBus()
  return instance
}

/** true when a peer snapshot arrived recently (multi-window convergence) */
export function multiWindowActive(): boolean {
  return Date.now() - lastRemoteTs < 8000
}
