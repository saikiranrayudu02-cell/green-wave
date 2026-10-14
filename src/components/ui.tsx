import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type Tone = 'green' | 'cyan' | 'amber' | 'red' | 'slate'

const TONE_HEX: Record<Tone, string> = {
  green: '#2fe08a',
  cyan: '#38c4e0',
  amber: '#e8a13c',
  red: '#ef3d52',
  slate: '#5b6b85',
}

export function Led({
  tone = 'green',
  pulse = false,
  size = 7,
  className,
}: {
  tone?: Tone
  pulse?: boolean
  size?: number
  className?: string
}) {
  const c = TONE_HEX[tone]
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full', pulse && 'animate-soft-pulse', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: c,
        boxShadow: `0 0 ${size * 1.4}px ${c}66, 0 0 2px ${c}`,
      }}
    />
  )
}

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-slate-500',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Pill({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode
  tone?: 'slate' | 'cyan' | 'green' | 'amber' | 'red'
  className?: string
}) {
  const map: Record<string, string> = {
    slate: 'border-slate-700/70 text-slate-400',
    cyan: 'border-ops-cyan/40 text-ops-cyan',
    green: 'border-emerald-400/40 text-emerald-300',
    amber: 'border-ops-amber/40 text-ops-amber',
    red: 'border-ops-red/45 text-ops-red',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[3px] border bg-white/[0.02] px-1.5 py-[3px] font-mono text-[9px] font-semibold uppercase tracking-[0.14em]',
        map[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Panel({
  children,
  className,
  title,
  right,
  tone,
}: {
  children?: ReactNode
  className?: string
  title?: string
  right?: ReactNode
  tone?: 'line' | 'green' | 'red'
}) {
  const border =
    tone === 'green'
      ? 'border-emerald-400/25'
      : tone === 'red'
        ? 'border-ops-red/30'
        : 'border-white/[0.07]'
  return (
    <section
      className={cn(
        'relative rounded-md border bg-night-850/80 backdrop-blur-[2px]',
        border,
        className,
      )}
    >
      {title && (
        <header
          className={cn(
            'flex items-center justify-between border-b px-3 py-2',
            tone === 'red' ? 'border-ops-red/20' : 'border-white/[0.05]',
          )}
        >
          <MicroLabel className={tone === 'red' ? 'text-ops-red/90' : 'text-slate-400'}>
            {title}
          </MicroLabel>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  tone = 'cyan',
  className,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'solid' | 'ghost' | 'danger'
  tone?: 'cyan' | 'green'
  className?: string
  title?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 select-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
  const styles =
    variant === 'solid'
      ? tone === 'green'
        ? 'bg-emerald-400/90 text-night-950 hover:bg-emerald-300 active:bg-emerald-200'
        : 'bg-ops-cyan text-night-950 hover:bg-cyan-300 active:bg-cyan-200'
      : variant === 'danger'
        ? 'border border-ops-red/40 text-ops-red/95 hover:bg-ops-red/10 hover:border-ops-red/60'
        : 'border border-white/10 text-slate-300 hover:border-white/25 hover:bg-white/[0.04] active:bg-white/[0.07] text-slate-200'
  return (
    <button type="button" title={title} onClick={onClick} className={cn(base, styles, className)}>
      {children}
    </button>
  )
}

export function Hairline({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-white/[0.05]', className)} />
}
