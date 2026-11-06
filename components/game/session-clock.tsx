'use client'

import { useEffect, useState } from 'react'
import { formatClock, secondsLeft, startCountdown, type ClockTiming } from '@/lib/game/clock'
import { cn } from '@/lib/utils'

// The tick lives here so each second re-renders only what shows the time, not the session around it.
export function useSecondsLeft(timing: ClockTiming) {
  const { startedAt, endedAt, clockOffset } = timing
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if(startedAt === null || endedAt !== null) return
    return startCountdown({ startedAt, clockOffset, onTick: () => setNow(Date.now()) })
  }, [startedAt, endedAt, clockOffset])
  return secondsLeft(timing, now)
}

export function SessionClock({ timing, className }: { timing: ClockTiming; className?: string }) {
  return <span className={className}>{formatClock(useSecondsLeft(timing))}</span>
}

export function InterviewClock({ timing, counting, closed }: { timing: ClockTiming; counting: boolean; closed: boolean }) {
  const left = useSecondsLeft(timing)
  const clock = formatClock(left)
  const lowTime = counting && left <= 30
  const finalSeconds = counting && left <= 10
  return <div className="flex shrink-0 flex-col items-end">
    <time className={cn('font-mono text-2xl tabular-nums leading-none tracking-wider sm:text-3xl', finalSeconds ? 'bg-oxblood px-2 py-1 text-ivory animate-pulse motion-reduce:animate-none' : lowTime ? 'text-gold' : counting ? 'text-ivory' : 'text-gold')} aria-label={`${clock} remaining`}>{clock}</time>
    <p className="label-mono mt-1 text-ivory/50" aria-live="polite">{finalSeconds ? 'Final seconds' : lowTime ? 'Thirty seconds' : closed ? 'Interview closed' : 'Remaining'}</p>
  </div>
}
