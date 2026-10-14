import { useEffect } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'
import { cn } from '../lib/cn'

interface Props {
  value: number
  format?: (v: number) => string
  className?: string
  /** seconds the tween takes to settle on value changes */
  duration?: number
  /** start from 0 and count up on mount */
  countUp?: boolean
}

/**
 * Renders a number that smoothly tweens toward `value` whenever it changes.
 * The formatted string is a motion value, so no intermediate re-renders occur.
 */
export default function AnimatedMetric({
  value,
  format = (v) => Math.round(v).toString(),
  className,
  duration = 1,
  countUp = true,
}: Props) {
  const mv = useMotionValue(countUp ? 0 : value)
  const text: MotionValue<string> = useTransform(mv, (v) => format(v))

  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: 'easeOut' })
    return () => controls.stop()
  }, [value, mv, duration])

  return (
    <motion.span className={cn('tabular inline-block', className)}>{text}</motion.span>
  )
}
