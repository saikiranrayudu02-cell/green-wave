/// <reference lib="webworker" />
// Step 16 — the A/B benchmark runs inside a dedicated Web Worker so its
// module-level engine stores (vehicles / prediction / pressure) never touch
// the live app's simulation. The worker is a fresh JS realm: every leg starts
// from resetTraffic(seed, 0) + initSigCtl(id, 0) + resetPrediction().
import { assembleABResult, runABLeg } from './abComparison'
import type { ABConfig, ABResult } from './abComparison'

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ABConfig>) => void) | null
  postMessage: (m: { ok: boolean; progress?: 'RUNNING_FIXED' | 'RUNNING_GREENWAVE'; result?: ABResult; error?: string }) => void
}

ctx.onmessage = (e: MessageEvent<ABConfig>) => {
  try {
    ctx.postMessage({ ok: true, progress: 'RUNNING_FIXED' })
    const fixed = runABLeg(e.data, 'fixed')
    ctx.postMessage({ ok: true, progress: 'RUNNING_GREENWAVE' })
    const greenWave = runABLeg(e.data, 'greenwave')
    const result = assembleABResult(e.data, fixed, greenWave)
    ctx.postMessage({ ok: true, result })
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}