// ---------------------------------------------------------------------------
// INTELLIGENT HOSPITAL RECOMMENDATION — advisory panel (feature: recommendation
// + capability matching + "why this hospital" explainability).
//
// Pure presentation over the deterministic recommendHospitals() result. The
// ETAs shown are the EXISTING GreenWave routePlanner travel times (computed in
// App from the real graph) — this panel invents nothing. It is ADVISORY: it
// never redirects an ambulance; a human confirms the destination.
// ---------------------------------------------------------------------------

import { Building2, Stethoscope } from 'lucide-react'
import type { RecommendationResult } from '../arogya/hospitalRecommend'
import { fmtClock } from '../lib/format'
import { cn } from '../lib/cn'
import { MicroLabel } from './ui'

export default function HospitalRecommendationPanel({
  recommendation,
  title = 'Recommended Hospital',
}: {
  recommendation: RecommendationResult | null
  title?: string
}) {
  if (!recommendation || !recommendation.recommended) return null
  const { ranked, recommended } = recommendation

  return (
    <div className="rounded-[4px] border border-emerald-400/20 bg-emerald-400/[0.02] px-2.5 py-2 text-left">
      <div className="flex items-center gap-1.5">
        <Stethoscope size={11} className="text-emerald-300" />
        <MicroLabel className="text-slate-500">{title}</MicroLabel>
        <span className="ml-auto rounded-[2px] border border-emerald-400/30 px-1.5 py-[1px] font-mono text-[7px] font-semibold tracking-[0.12em] text-emerald-300">
          GREENWAVE AI
        </span>
      </div>

      {/* recommended hospital */}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[4px] border border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300">
          <Building2 size={11} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-mono text-[10px] font-semibold tracking-[0.06em] text-slate-100">
            {recommended.hospital.name}
          </div>
          <div className="font-mono text-[7.5px] tracking-[0.1em] text-slate-600">
            SCORE {recommended.score} · {recommended.capabilityMatch ? 'CAPABILITY MATCH' : 'CAPABILITY GAP'}
          </div>
        </div>
        {recommended.etaSec != null && (
          <span className="font-mono text-[11px] font-semibold tabular text-ops-cyan">{fmtClock(recommended.etaSec)}</span>
        )}
      </div>

      {/* ranked comparison — real ETA, capability, beds */}
      <div className="mt-2 overflow-hidden rounded-[3px] border border-white/[0.05]">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1 border-b border-white/[0.05] bg-white/[0.015] px-1.5 py-1 font-mono text-[6.5px] uppercase tracking-[0.1em] text-slate-600">
          <span>Hospital</span>
          <span className="text-right">ETA</span>
          <span className="text-right">Beds</span>
          <span className="text-right">Score</span>
        </div>
        {ranked.map((r) => {
          const isRec = r.hospital.id === recommended.hospital.id
          return (
            <div
              key={r.hospital.id}
              className={cn(
                'grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 px-1.5 py-1 font-mono text-[8px] tracking-[0.04em]',
                isRec ? 'bg-emerald-400/[0.05] text-slate-200' : 'text-slate-500',
              )}
            >
              <span className="flex items-center gap-1 truncate">
                {isRec && <span className="text-emerald-300">★</span>}
                <span className="truncate">{r.hospital.name.replace(/ Hospital| Medical Center/, '')}</span>
              </span>
              <span className="text-right tabular">{r.etaSec != null ? fmtClock(r.etaSec) : '—'}</span>
              <span className={cn('text-right tabular', r.emergencyBedsAvailable === 0 && 'text-ops-red/80')}>
                {r.emergencyBedsAvailable}
              </span>
              <span className={cn('text-right tabular font-semibold', isRec ? 'text-emerald-300' : 'text-slate-400')}>
                {r.score}
              </span>
            </div>
          )
        })}
      </div>

      {/* why-this-hospital explanation */}
      <p className="mt-1.5 font-mono text-[7.5px] leading-relaxed tracking-[0.06em] text-slate-500">
        {recommended.explanation}
      </p>
      <p className="mt-1 font-mono text-[6.5px] leading-relaxed tracking-[0.08em] text-slate-700">
        ADVISORY · OPERATOR CONFIRMS DESTINATION · DEMO CAPACITY DATA
      </p>
    </div>
  )
}
