// ---------------------------------------------------------------------------
// GREENWAVE — rolling live-traffic measurement recorder (Step 12)
//
// This is NOT a second traffic engine — it simply records REAL measurements
// produced by the existing simulation metrics / observations (vehicles.ts)
// on a coarse cadence so the Live Traffic module can chart what actually
// happened while the operator watches. Nothing is fabricated; the series is
// empty until the recorder has observed real state.
// ---------------------------------------------------------------------------

export interface FlowPoint {
  /** sim clock when recorded (s) */
  t: number
  /** active vehicles on the network */
  active: number
  /** total queued vehicles across signalised approaches */
  queue: number
  /** network mean congestion 0..100 */
  loadPct: number
  /** mean speed (km/h) */
  avgSpeedKmh: number
}

const CAP = 90
const points: FlowPoint[] = []

export function pushFlowPoint(p: FlowPoint): void {
  points.push(p)
  if (points.length > CAP) points.splice(0, points.length - CAP)
}

export function flowHistory(): readonly FlowPoint[] {
  return points
}

export function clearFlowHistory(): void {
  points.length = 0
}
