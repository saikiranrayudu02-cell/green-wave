// ---------------------------------------------------------------------------
// AROGYAOS × GREENWAVE — intelligent hospital recommendation (advisory only)
//
// A PURE, deterministic scorer. It never chooses for the operator and never
// redirects an ambulance on its own (see feature: assisted rerouting) — it
// ranks the demo hospital registry and returns a transparent, explainable
// recommendation for a human to confirm.
//
// Honesty rules:
//  · ETA is supplied by the caller from the EXISTING GreenWave routePlanner
//    (real graph travel time) — this module computes no travel time itself and
//    invents no ETA when one is unavailable (etaSec may be null).
//  · Bed availability + capabilities come from the demo HOSPITAL_REGISTRY and
//    are clearly demo capacity values, never live hospital-information-system
//    data.
//  · No clinical data influences the score beyond the coarse capability match
//    derived from the emergency type.
// ---------------------------------------------------------------------------

import {
  HOSPITAL_REGISTRY,
  requiredCapabilities,
  type CapabilityKey,
  type HospitalRecord,
} from './emergencyCase'

export interface HospitalCandidateInput {
  hospital: HospitalRecord
  /** real routePlanner ETA (sim seconds) — null when it cannot be computed */
  etaSec: number | null
}

export interface HospitalRecommendation {
  hospital: HospitalRecord
  etaSec: number | null
  capabilityMatch: boolean
  missingCapabilities: CapabilityKey[]
  emergencyBedsAvailable: number
  /** demo capacity — available / total emergency beds, 0..100 */
  capacityPct: number
  /** overall advisory score, 0..100 (higher is better) */
  score: number
  breakdown: { eta: number; capability: number; beds: number }
  explanation: string
}

export interface RecommendationResult {
  ranked: HospitalRecommendation[]
  recommended: HospitalRecommendation | null
  reason: string
}

const W_CAPABILITY = 0.4
const W_ETA = 0.35
const W_BEDS = 0.25

const CAP_LABEL: Record<CapabilityKey, string> = {
  trauma: 'trauma care',
  cardiac: 'cardiac / cath lab',
  stroke: 'stroke unit',
  imaging: 'imaging',
  surgery: 'surgery',
  icu: 'ICU',
}

function fmtEta(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/**
 * Rank the given candidate hospitals for an emergency type. Deterministic:
 * the same inputs always produce the same ranking (ties broken by hospital id).
 */
export function recommendHospitals(input: {
  emergencyType: string
  candidates: HospitalCandidateInput[]
}): RecommendationResult {
  const required = requiredCapabilities(input.emergencyType)
  const withEta = input.candidates.filter((c) => c.etaSec != null)
  const minEta = withEta.length ? Math.min(...withEta.map((c) => c.etaSec as number)) : null

  const ranked: HospitalRecommendation[] = input.candidates
    .map((c) => {
      const caps = c.hospital.capabilities
      const missing = required.filter((k) => !caps[k])
      const capabilityMatch = missing.length === 0

      // capability sub-score: full marks when nothing is missing, heavy
      // penalty per missing required capability (safety-relevant)
      const capabilityScore = Math.max(0, 100 - missing.length * 40)

      // eta sub-score relative to the fastest candidate (real ETAs only)
      let etaScore = 50 // neutral when no ETA can be computed
      if (c.etaSec != null && minEta != null && c.etaSec > 0) {
        etaScore = Math.max(20, Math.min(100, Math.round((minEta / c.etaSec) * 100)))
      }

      const total = Math.max(1, c.hospital.emergencyBedsTotal)
      const capacityPct = Math.round((c.hospital.emergencyBedsAvailable / total) * 100)
      // beds sub-score: zero when no bed is free (cannot receive), otherwise
      // scaled by available capacity
      const bedsScore =
        c.hospital.emergencyBedsAvailable <= 0 ? 0 : Math.min(100, 40 + capacityPct * 0.6)

      const score = Math.round(
        capabilityScore * W_CAPABILITY + etaScore * W_ETA + bedsScore * W_BEDS,
      )

      const explanation = buildExplanation({
        hospital: c.hospital,
        etaSec: c.etaSec,
        capabilityMatch,
        missing,
        required,
      })

      return {
        hospital: c.hospital,
        etaSec: c.etaSec,
        capabilityMatch,
        missingCapabilities: missing,
        emergencyBedsAvailable: c.hospital.emergencyBedsAvailable,
        capacityPct,
        score,
        breakdown: { eta: etaScore, capability: capabilityScore, beds: bedsScore },
        explanation,
      }
    })
    .sort((a, b) => b.score - a.score || a.hospital.id.localeCompare(b.hospital.id))

  // prefer a candidate that both matches capability AND can actually receive
  const receivable = ranked.filter((r) => r.capabilityMatch && r.emergencyBedsAvailable > 0)
  const recommended = receivable[0] ?? ranked[0] ?? null

  const reason = recommended
    ? recommended.explanation
    : 'No hospital in the registry can currently receive this case.'

  return { ranked, recommended, reason }
}

function buildExplanation(a: {
  hospital: HospitalRecord
  etaSec: number | null
  capabilityMatch: boolean
  missing: CapabilityKey[]
  required: CapabilityKey[]
}): string {
  const parts: string[] = []
  if (a.required.length === 0) {
    parts.push('meets general emergency-department requirements')
  } else if (a.capabilityMatch) {
    parts.push(`matches the required capabilities (${a.required.map((k) => CAP_LABEL[k]).join(', ')})`)
  } else {
    parts.push(`is missing required ${a.missing.map((k) => CAP_LABEL[k]).join(', ')}`)
  }
  if (a.hospital.emergencyBedsAvailable > 0) {
    parts.push(`${a.hospital.emergencyBedsAvailable} emergency bed${a.hospital.emergencyBedsAvailable === 1 ? '' : 's'} available`)
  } else {
    parts.push('no emergency bed currently available')
  }
  if (a.etaSec != null) parts.push(`ETA ${fmtEta(a.etaSec)}`)
  return `${a.hospital.name}: ${parts.join(', ')}.`
}

/** convenience: every registry hospital as a candidate (caller supplies ETAs) */
export function registryCandidates(
  etaFor: (h: HospitalRecord) => number | null,
): HospitalCandidateInput[] {
  return Object.values(HOSPITAL_REGISTRY).map((hospital) => ({ hospital, etaSec: etaFor(hospital) }))
}
