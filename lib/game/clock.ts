export const INTERVIEW_SECONDS = 180

export interface ClockTiming { startedAt: number | null; endedAt: number | null; clockOffset: number }

/** Display only: the server owns time. clockOffset is the serverTime correction from the last view. */
export function secondsLeft({ startedAt, endedAt, clockOffset }: ClockTiming, now: number) {
  if(startedAt === null) return INTERVIEW_SECONDS
  const elapsed = ((endedAt ?? now + clockOffset) - startedAt) / 1000
  return Math.min(INTERVIEW_SECONDS, Math.max(0, Math.ceil(INTERVIEW_SECONDS - elapsed)))
}

export const formatClock = (left: number) => `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`

/**
 * Runs at each displayed second until the deadline. Short steps re-read the clock, so a device
 * that slept past the deadline still expires when it wakes. Returns a cancel function.
 */
export function startCountdown({ startedAt, clockOffset, onTick, onExpire }: { startedAt: number; clockOffset: number; onTick?: () => void; onExpire?: () => void }) {
  const deadline = startedAt + INTERVIEW_SECONDS * 1000
  let timer: ReturnType<typeof setTimeout> | undefined
  const step = () => {
    const remaining = deadline - (Date.now() + clockOffset)
    onTick?.()
    if(remaining <= 0) { onExpire?.(); return }
    timer = setTimeout(step, (remaining - 1) % 1000 + 1)
  }
  step()
  return () => clearTimeout(timer)
}
