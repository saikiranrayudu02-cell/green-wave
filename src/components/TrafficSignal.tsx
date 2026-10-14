import { cn } from '../lib/cn'

export type SignalColor = 'G' | 'Y' | 'R'

const LAMP: Record<SignalColor, { on: string; glow: string }> = {
  G: { on: '#3df59a', glow: 'rgba(61,245,154,0.55)' },
  Y: { on: '#f5b83d', glow: 'rgba(245,184,61,0.55)' },
  R: { on: '#ff3b4e', glow: 'rgba(255,59,78,0.55)' },
}

/**
 * Tiny signal head — horizontal like a corridor mast arm. `state` is the lamp
 * shown for the road that passes through (the main/coordinated direction).
 */
export default function TrafficSignal({
  state,
  size = 1,
  dim = false,
}: {
  state: SignalColor
  size?: number
  dim?: boolean
}) {
  return (
    <div
      className="pointer-events-none relative flex items-center rounded-[2px] border border-black/70 bg-[#0d1117] px-[2px]"
      style={{
        height: 11 * size,
        width: 28 * size,
        boxShadow: '0 2px 4px rgba(0,0,0,0.55), inset 0 0 6px rgba(255,255,255,0.05)',
        opacity: dim ? 0.6 : 1,
      }}
    >
      {(['G', 'Y', 'R'] as const).map((c) => {
        const on = c === state
        return (
          <span
            key={c}
            className={cn(
              'mx-[1.5px] rounded-full transition-all duration-300 ease-out',
              c === 'G' && 'order-1',
              c === 'Y' && 'order-2',
              c === 'R' && 'order-3',
            )}
            style={{
              width: 6 * size,
              height: 6 * size,
              backgroundColor: on ? LAMP[c].on : '#1a202a',
              boxShadow: on
                ? `0 0 ${7 * size}px ${LAMP[c].glow}, 0 0 2px ${LAMP[c].on}`
                : 'inset 0 1px 2px rgba(0,0,0,0.6)',
            }}
          />
        )
      })}
      {/* mounting arm hint */}
      <span
        className="absolute left-1/2 -translate-x-1/2 bg-[#11151b]"
        style={{ top: '100%', width: 2, height: 7 * size }}
      />
    </div>
  )
}
